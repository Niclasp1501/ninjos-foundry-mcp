/**
 * world-rewrite-paths, the actor tools and the folder tools, on a fake world.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { FakeFoundry, type FakeFoundryOptions } from '../../../testing/fake-foundry.js';
import { mergeAdvancement } from './actors.js';
import { withPacks } from './testing.js';

let harness: AreaHarness | null = null;
afterEach(() => {
  harness?.close();
  harness = null;
});

const open = (options: FakeFoundryOptions = {}) => {
  harness = createAreaHarness({ foundry: new FakeFoundry(options) });
  return { h: harness, f: harness.foundry };
};

describe('rewriteWorldPaths', () => {
  const world = (options: FakeFoundryOptions = {}) => {
    const { h, f } = open(options);
    const scene = f.seed('Scene', {
      _id: 's1',
      name: 'Coast',
      background: { src: 'Bilder/Karten/K%C3%BCstenweg.webp' },
      tokens: [{ _id: 't1', texture: { src: 'Bilder/Token/bandit.png' } }],
    });
    f.seed('Actor', {
      _id: 'a1',
      name: 'Bandit',
      img: 'Bilder/Token/bandit.png',
      prototypeToken: { texture: { src: 'Bilder/Tokenringe/bandit.png' } },
      items: [
        {
          _id: 'i1',
          name: 'Knife',
          img: 'Bilder/Token/knife.png',
          effects: [{ _id: 'e1', img: 'Bilder/Token/fx.png' }],
        },
      ],
    });
    f.seed('JournalEntry', {
      _id: 'j1',
      name: 'Notes',
      pages: [
        {
          _id: 'p1',
          type: 'text',
          text: { content: '<img src="Bilder/Token/map.png"> Bilder/Token/x' },
        },
      ],
    });
    f.seed('Macro', { _id: 'm1', name: 'M', img: 'Bilder/Token/macro.png' });
    return { h, f, scene };
  };

  it('reports in a dry run what the real run then writes, touching only paths at a boundary', async () => {
    const { h, f } = world();
    const dry = (await h.query('rewriteWorldPaths', {
      from: 'Bilder/Token/',
      to: 'Bilder/Figuren',
      dryRun: true,
    })) as Record<string, any>;
    expect(f.operations).toEqual([]);
    expect(dry).toMatchObject({
      from: 'Bilder/Token',
      to: 'Bilder/Figuren',
      changes: 6,
      documents: 6,
      byCollection: { scenes: 1, actors: 3, journal: 1, macros: 1 },
      worldId: 'test-world',
    });
    expect(dry['refused']).toBeUndefined();

    const real = (await h.query('rewriteWorldPaths', {
      from: 'Bilder/Token',
      to: 'Bilder/Figuren',
    })) as Record<string, any>;
    expect({ ...dry, dryRun: false }).toEqual(real);
    expect(f.fromUuid('Scene.s1.Token.t1')?.['texture']).toEqual({
      src: 'Bilder/Figuren/bandit.png',
    });
    expect(f.fromUuid('Actor.a1')?.['prototypeToken']).toEqual({
      texture: { src: 'Bilder/Tokenringe/bandit.png' },
    });
    expect(f.fromUuid('Actor.a1.Item.i1.ActiveEffect.e1')?.['img']).toBe('Bilder/Figuren/fx.png');
    expect(f.fromUuid('JournalEntry.j1.JournalEntryPage.p1')?.['text']).toEqual({
      content: '<img src="Bilder/Figuren/map.png"> Bilder/Token/x',
    });
    expect(h.changeLog.list()[0]).toMatchObject({ tool: 'world-rewrite-paths', undoable: false });
  });

  it('finds encoded spellings and restricts to the named collections', async () => {
    const { h, f } = world();
    await h.query('rewriteWorldPaths', {
      from: 'Bilder/Karten/Küstenweg.webp',
      to: 'Bilder/Karten/Küste.webp',
      collections: ['scenes'],
    });
    expect(f.fromUuid('Scene.s1')?.['background']).toEqual({
      src: 'Bilder/Karten/K%C3%BCste.webp',
    });
    await expect(h.query('rewriteWorldPaths', { from: 'ab', to: 'x' })).rejects.toThrow(
      /at least 3/
    );
    await expect(
      h.query('rewriteWorldPaths', { from: 'abc', to: 'x', collections: ['users'] })
    ).rejects.toThrow(/Unknown collection/);
  });

  it('checks the level of every kind that would change before the first write', async () => {
    const { h, f } = world({ settings: { 'ninjos-foundry-mcp.permScenes': 'read' } });
    const dry = (await h.query('rewriteWorldPaths', {
      from: 'Bilder/Token',
      to: 'Bilder/Figuren',
      dryRun: true,
    })) as Record<string, any>;
    expect(dry['refused']).toMatchObject([{ collection: 'scenes' }]);
    await expect(
      h.query('rewriteWorldPaths', { from: 'Bilder/Token', to: 'Bilder/Figuren' })
    ).rejects.toThrow(/Nothing was changed: the move would write into scenes/);
    expect(f.operations).toEqual([]);
    await expect(
      h.query('rewriteWorldPaths', {
        from: 'Bilder/Token',
        to: 'Bilder/Figuren',
        collections: ['actors', 'journal', 'macros'],
      })
    ).resolves.toMatchObject({ documents: 5 });
  });

  it('says how far a run got when a write fails halfway', async () => {
    const { h, f } = world();
    let count = 0;
    f.onWrite(() => {
      count += 1;
      if (count === 3) throw new Error('database locked');
    });
    await expect(
      h.query('rewriteWorldPaths', { from: 'Bilder/Token', to: 'Bilder/Figuren' })
    ).rejects.toThrow(/database locked\. 2 of 6 documents were already changed/);
  });
});

describe('setActorToken', () => {
  const actors = (options: FakeFoundryOptions = {}) => {
    const { h, f } = open(options);
    f.seed('Actor', {
      _id: 'a1',
      name: 'Bandit',
      img: 'old.png',
      prototypeToken: { name: 'Bandit', disposition: -1, ring: { subject: { scale: 0.8 } } },
    });
    f.seed('Actor', { _id: 'a2', name: 'Twin' });
    f.seed('Actor', { _id: 'a3', name: 'Twin' });
    return { h, f };
  };

  it('sets image, portrait, name and ring, coloured by disposition, and keeps the scale', async () => {
    const { h, f } = actors();
    await expect(
      h.query('setActorToken', {
        actorIdentifier: 'Bandit',
        tokenImg: 't.png',
        portraitImg: 'p.png',
        tokenName: 'Jorn',
        ring: true,
      })
    ).resolves.toEqual({
      success: true,
      actorId: 'a1',
      name: 'Bandit',
      tokenImg: 't.png',
      ringEnabled: true,
      ringColor: '#e72124',
    });
    const actor = f.fromUuid('Actor.a1')!;
    expect(actor['img']).toBe('p.png');
    expect(actor['prototypeToken']).toEqual({
      name: 'Jorn',
      disposition: -1,
      texture: { src: 't.png' },
      ring: {
        enabled: true,
        subject: { scale: 0.8, texture: 't.png' },
        colors: { ring: '#e72124' },
      },
    });
    await h.query('setActorToken', { actorIdentifier: 'a1', tokenImg: 't.png', ring: false });
    expect((actor['prototypeToken'] as any).ring.enabled).toBe(false);
  });

  it('refuses an ambiguous name, a bad colour and the actor level on read', async () => {
    const { h } = actors();
    await expect(
      h.query('setActorToken', { actorIdentifier: 'Twin', tokenImg: 't.png' })
    ).rejects.toThrow(/2 actors are named "Twin": "Twin" \(a2\); "Twin" \(a3\)\. Pass the id/);
    await expect(
      h.query('setActorToken', { actorIdentifier: 'a2', tokenImg: 't.png', ringColor: 'red' })
    ).rejects.toThrow(/hex colour/);
    await expect(
      h.query('setActorToken', { actorIdentifier: 'Nobody', tokenImg: 't.png' })
    ).rejects.toThrow('Actor not found: Nobody');
    harness?.close();
    const read = actors({ settings: { 'ninjos-foundry-mcp.permActors': 'read' } });
    await expect(
      read.h.query('setActorToken', { actorIdentifier: 'a2', tokenImg: 't.png' })
    ).rejects.toMatchObject({
      moduleCode: 'PERMISSION_DENIED',
    });
  });
});

describe('refreshActorItemsFromSource', () => {
  const setup = () => {
    const { h, f } = open();
    withPacks(f, [
      {
        id: 'dnd5e.spells',
        documentName: 'Item',
        entries: [
          {
            _id: 'fireball',
            name: 'Fireball',
            img: 'fb.png',
            system: { description: { value: '<p>Boom</p>' } },
          },
          {
            _id: 'rogue',
            name: 'Rogue',
            img: 'r.png',
            system: {
              description: { value: 'r' },
              advancement: [{ _id: 'adv1', title: 'Expertise (new)', configuration: { n: 2 } }],
            },
          },
        ],
      },
      {
        id: 'de.spells',
        documentName: 'Item',
        entries: [
          {
            _id: 'fireball',
            name: 'Feuerball',
            img: 'fb.png',
            system: { description: { value: '<p>Bumm</p>' } },
          },
        ],
      },
      {
        id: 'de.loot',
        documentName: 'Item',
        entries: [
          { _id: 'rope', name: 'Seil', img: 's.png', system: { description: { value: 'Seil' } } },
        ],
      },
    ]);
    f.seed('Actor', {
      _id: 'hero',
      name: 'Hero',
      items: [
        {
          _id: 'i1',
          name: 'Fireball',
          img: 'fb.png',
          system: {
            description: { value: 'old' },
            preparation: { prepared: true },
            uses: { spent: 1 },
          },
          _stats: { compendiumSource: 'Compendium.dnd5e.spells.Item.fireball' },
        },
        {
          _id: 'i2',
          name: 'Rogue',
          system: {
            levels: 5,
            description: { value: 'r' },
            advancement: [
              { _id: 'adv1', title: 'Expertise', value: { chosen: ['stealth'] } },
              { _id: 'own', title: 'Homebrew' },
            ],
          },
          flags: { core: { sourceId: 'Compendium.dnd5e.spells.Item.rogue' } },
        },
        { _id: 'i3', name: 'seil', system: { quantity: 3 } },
        { _id: 'i4', name: 'Loot', _stats: { compendiumSource: 'Compendium.gone.pack.Item.x' } },
        { _id: 'i5', name: 'Trinket' },
      ],
    });
    return { h, f };
  };

  it('refreshes presentation only, follows preferPacks and namePacks, and lists the unresolved', async () => {
    const { h, f } = setup();
    const answer = (await h.query('refreshActorItemsFromSource', {
      actorIdentifier: 'Hero',
      preferPacks: ['de.spells'],
      namePacks: ['de.loot'],
    })) as Record<string, any>;
    expect(answer['changes']).toEqual([
      {
        itemId: 'i1',
        itemName: 'Fireball',
        fields: ['name', 'description'],
        source: 'Compendium.de.spells.Item.fireball',
        via: 'preferPacks',
      },
      {
        itemId: 'i2',
        itemName: 'Rogue',
        fields: ['img'],
        source: 'Compendium.dnd5e.spells.Item.rogue',
        via: 'sourceId',
      },
      {
        itemId: 'i3',
        itemName: 'seil',
        fields: ['name', 'img', 'description'],
        source: 'Compendium.de.loot.Item.rope',
        via: 'namePacks',
      },
    ]);
    expect(answer['unresolved']).toEqual([
      { itemId: 'i4', itemName: 'Loot', reason: 'source not found in world' },
      { itemId: 'i5', itemName: 'Trinket', reason: 'no source (hand-made?)' },
    ]);
    const fireball = f.fromUuid('Actor.hero.Item.i1')!;
    expect(fireball['name']).toBe('Feuerball');
    expect(fireball['system']).toEqual({
      description: { value: '<p>Bumm</p>' },
      preparation: { prepared: true },
      uses: { spent: 1 },
    });
    expect(fireball['_stats']).toEqual({ compendiumSource: 'Compendium.de.spells.Item.fireball' });
    expect((f.fromUuid('Actor.hero.Item.i3')!['system'] as any).quantity).toBe(3);
    expect((f.fromUuid('Actor.hero.Item.i2')!['system'] as any).advancement[0].title).toBe(
      'Expertise'
    );
  });

  it('refreshes advancement only when asked, keeping the choices', async () => {
    const { h, f } = setup();
    const answer = (await h.query('refreshActorItemsFromSource', {
      actorIdentifier: 'hero',
      fields: ['advancement'],
      dryRun: true,
    })) as Record<string, any>;
    expect(f.operations).toEqual([]);
    expect(answer['changes']).toMatchObject([{ itemId: 'i2', fields: ['advancement'] }]);
    await h.query('refreshActorItemsFromSource', {
      actorIdentifier: 'hero',
      fields: ['advancement'],
    });
    expect((f.fromUuid('Actor.hero.Item.i2')!['system'] as any).advancement).toEqual([
      {
        _id: 'adv1',
        title: 'Expertise (new)',
        configuration: { n: 2 },
        value: { chosen: ['stealth'] },
      },
      { _id: 'own', title: 'Homebrew' },
    ]);
  });

  it('refuses an unknown pack and an unknown field', async () => {
    const { h } = setup();
    await expect(
      h.query('refreshActorItemsFromSource', { actorIdentifier: 'hero', namePacks: ['nope'] })
    ).rejects.toThrow('Compendium pack not found: nope');
    await expect(
      h.query('refreshActorItemsFromSource', { actorIdentifier: 'hero', fields: [] })
    ).rejects.toThrow(/at least one/);
  });

  it('merges advancement kept as an object as well', () => {
    expect(mergeAdvancement({ a: { title: 'new' } }, { a: { title: 'old', value: 1 } })).toEqual({
      merged: { a: { title: 'new', value: 1 } },
      kept: [],
    });
    expect(mergeAdvancement(undefined, [])).toBeNull();
  });
});

describe('folders', () => {
  const tree = (options: FakeFoundryOptions = {}) => {
    const { h, f } = open(options);
    f.seed('Folder', { _id: 'top', name: 'Campaign', type: 'JournalEntry', folder: null });
    f.seed('Folder', { _id: 'mid', name: 'Chapter', type: 'JournalEntry', folder: 'top' });
    f.seed('Folder', { _id: 'low', name: 'Scenes', type: 'JournalEntry', folder: 'mid' });
    f.seed('Folder', { _id: 'act', name: 'Chapter', type: 'Actor', folder: null });
    f.seed('JournalEntry', { _id: 'j1', name: 'In mid', folder: 'mid' });
    f.seed('JournalEntry', { _id: 'j2', name: 'In low', folder: 'low' });
    f.seed('JournalEntry', { _id: 'j3', name: 'Elsewhere', folder: 'top' });
    return { h, f };
  };

  it('renames by name within a type, and lists folders of the same name instead of picking one', async () => {
    const { h, f } = tree();
    await expect(
      h.query('renameFolder', { folderName: 'Chapter', newName: 'Kapitel' })
    ).rejects.toThrow(
      /2 folders are named "Chapter": "Chapter" \(mid, JournalEntry, in "Campaign"\); "Chapter" \(act, Actor\)/
    );
    await expect(
      h.query('renameFolder', { folderName: 'Chapter', type: 'Actor', newName: 'Kapitel' })
    ).resolves.toMatchObject({
      id: 'act',
      name: 'Kapitel',
    });
    await expect(
      h.query('renameFolder', { folderName: 'mid', newName: 'Kapitel' })
    ).resolves.toMatchObject({ id: 'mid' });
    expect(f.fromUuid('Folder.mid')?.['name']).toBe('Kapitel');
    await expect(
      h.query('renameFolder', { folderName: 'x', type: 'Thing', newName: 'y' })
    ).rejects.toThrow(/Unknown folder type/);
  });

  it('refuses deleting at the default level', async () => {
    const { h, f } = tree();
    await expect(h.query('deleteFolder', { folderName: 'mid' })).rejects.toThrow(/permFolders/);
    expect(f.operations).toEqual([]);
  });

  it('moves documents and subfolders up one level by default', async () => {
    const { h, f } = tree({ settings: { 'ninjos-foundry-mcp.permFolders': 'full' } });
    await expect(h.query('deleteFolder', { folderName: 'mid' })).resolves.toMatchObject({
      moved: { documents: 1, folders: 1 },
      deleted: { documents: 0, folders: 1 },
    });
    expect(f.fromUuid('Folder.mid')).toBeNull();
    expect(f.fromUuid('JournalEntry.j1')?.['folder']).toBe('top');
    expect(f.fromUuid('Folder.low')?.['folder']).toBe('top');
  });

  it('deletes the whole subtree with deleteContents, only with the level for its documents', async () => {
    const denied = tree({ settings: { 'ninjos-foundry-mcp.permFolders': 'full' } });
    await expect(
      denied.h.query('deleteFolder', { folderName: 'mid', deleteContents: true })
    ).rejects.toThrow(/permJournals/);
    expect(denied.f.operations).toEqual([]);
    harness?.close();

    const { h, f } = tree({
      settings: {
        'ninjos-foundry-mcp.permFolders': 'full',
        'ninjos-foundry-mcp.permJournals': 'full',
      },
    });
    await expect(
      h.query('deleteFolder', { folderName: 'mid', deleteContents: true })
    ).resolves.toMatchObject({
      deleted: { documents: 2, folders: 2 },
    });
    expect([...f.collection('JournalEntry').keys()]).toEqual(['j3']);
    expect([...f.collection('Folder').keys()]).toEqual(['top', 'act']);
  });
});
