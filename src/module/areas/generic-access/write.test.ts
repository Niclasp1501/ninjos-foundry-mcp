import { afterEach, describe, expect, it } from 'vitest';
import { MODULE_ID } from '../../../common/constants.js';
import type { FakeDocument, FakeFoundry } from '../../../testing/fake-foundry.js';
import { openGeneric, type GenericSetup } from './testing.js';

let setup: GenericSetup | null = null;
afterEach(() => {
  setup?.harness.close();
  setup = null;
});

type Answer = Record<string, unknown>;

const setting = (key: string) => `${MODULE_ID}.${key}`;

function seedWorld(foundry: FakeFoundry): void {
  foundry.seed('Folder', { _id: 'f1', name: 'Heroes', type: 'Actor' });
  foundry.seed('Folder', { _id: 'f2', name: 'Empty', type: 'Actor' });
  foundry.seed('Actor', {
    _id: 'a1',
    name: 'Grok',
    type: 'character',
    folder: 'f1',
    ownership: { default: 0 },
    system: {
      attributes: { hp: { value: 10, max: 10 } },
      skills: [
        { name: 'climb', value: 1 },
        { name: 'swim', value: 2 },
      ],
    },
    flags: { [MODULE_ID]: { createdByMcp: true } },
    items: [{ _id: 'i1', name: 'Sword', type: 'weapon' }],
  });
  foundry.seed('JournalEntry', { _id: 'j1', name: 'Lore' });
  foundry.seed('Playlist', { _id: 'p1', name: 'Tavern' });
  foundry.seed('Scene', { _id: 's1', name: 'Inn', active: true, playlist: 'p1' });
  foundry.seed('Scene', { _id: 's2', name: 'Road' });
  foundry.seed('Combat', { _id: 'c1', round: 1 });
  foundry.seed('ChatMessage', { _id: 'm1', author: 'gm', content: 'Hello', whisper: [] });
  foundry.seed('ChatMessage', { _id: 'm2', author: 'alice', content: 'Hi' });
  foundry.addPack({
    id: 'dnd5e.monsters',
    documentName: 'Actor',
    documents: [{ _id: 'm1', name: 'Goblin' }],
  });
}

function open(settings: Record<string, unknown> = {}): GenericSetup {
  setup = openGeneric({
    settings: Object.fromEntries(
      Object.entries(settings).map(([key, value]) => [setting(key), value])
    ),
    users: [
      { id: 'gm', name: 'Gamemaster', isGM: true },
      { id: 'alice', name: 'Alice' },
    ],
  });
  seedWorld(setup.foundry);
  return setup;
}

const actor = (foundry: FakeFoundry) => foundry.collection('Actor').get('a1') as FakeDocument;

describe('createDocument', () => {
  it('creates, reads back, marks and logs', async () => {
    const { harness, foundry } = open();
    const answer = (await harness.query('createDocument', {
      documentType: 'Actor',
      data: { name: 'Goblin', type: 'npc', folder: 'f1', system: { details: { cr: 1 } } },
    })) as Answer;
    expect(answer).toMatchObject({
      created: true,
      documentName: 'Actor',
      name: 'Goblin',
      storedDifferently: [],
    });
    const created = foundry.collection('Actor').get(answer['id'] as string) as FakeDocument;
    expect(created['flags']).toEqual({
      [MODULE_ID]: { createdByMcp: true, mcpGenerated: true, createdAt: expect.any(String) },
    });
    expect(foundry.operations).toHaveLength(1);
    expect(harness.changeLog.list()[0]).toMatchObject({
      tool: 'create-document',
      document: 'Actors',
      action: 'create',
      undoable: true,
    });
  });

  it('creates an embedded document as a change of the outermost document', async () => {
    const { harness, foundry } = open({ permJournals: 'write' });
    const page = (await harness.query('createDocument', {
      documentType: 'JournalEntryPage',
      parentUuid: 'JournalEntry.j1',
      data: { name: 'Page', type: 'text', text: { content: '<p>x</p>' } },
    })) as Answer;
    expect(page).toMatchObject({ created: true, parentUuid: 'JournalEntry.j1' });
    expect(foundry.operations[0]).toMatchObject({ action: 'create', parent: 'JournalEntry.j1' });
    expect(harness.changeLog.list()[0]).toMatchObject({ document: 'Journals', action: 'create' });
  });

  it('asks switch and level before anything happens', async () => {
    const off = open({ allowWriteOperations: false });
    await expect(
      off.harness.query('createDocument', { documentType: 'Actor', data: { name: 'x' } })
    ).rejects.toMatchObject({ moduleCode: 'WRITE_DISABLED' });
    const dry = (await off.harness.query('createDocument', {
      documentType: 'Actor',
      data: { name: 'x' },
      dryRun: true,
    })) as Answer;
    expect(dry).toMatchObject({ dryRun: true, allowed: false });
    expect(String(dry['refused'])).toContain('Allow Write Operations');
    off.harness.close();

    const readOnly = open({ permActors: 'read' });
    await expect(
      readOnly.harness.query('createDocument', {
        documentType: 'Item',
        parentUuid: 'Actor.a1',
        data: { name: 'Axe', type: 'weapon' },
      })
    ).rejects.toMatchObject({
      moduleCode: 'PERMISSION_DENIED',
      message: expect.stringContaining('permActors'),
    });
    // A world item follows the core rule for items: the switch is enough.
    await readOnly.harness.query('createDocument', {
      documentType: 'Item',
      data: { name: 'Axe', type: 'weapon' },
    });
    expect(readOnly.foundry.operations).toHaveLength(1);
  });

  it('refuses protected fields, also inside embedded data, and writes nothing', async () => {
    const { harness, foundry } = open();
    await expect(
      harness.query('createDocument', {
        documentType: 'Actor',
        data: { name: 'x', ownership: { alice: 3 } },
      })
    ).rejects.toMatchObject({
      moduleCode: 'PROTECTED',
      message: expect.stringContaining('ownership'),
    });
    await expect(
      harness.query('createDocument', {
        documentType: 'Actor',
        data: {
          name: 'x',
          items: [{ name: 'y', flags: { [MODULE_ID]: { createdByMcp: false } } }],
        },
      })
    ).rejects.toThrow(/data\.items\.0/);
    await expect(
      harness.query('createDocument', { documentType: 'Scene', data: { name: 'x', active: true } })
    ).rejects.toThrow(/switch-scene/);
    expect(foundry.operations).toHaveLength(0);
  });

  it('checks type, folder and refused types', async () => {
    const { harness, foundry } = open();
    foundry.setDocumentSubtypes({ Actor: ['base', 'character', 'npc'] });
    await expect(
      harness.query('createDocument', {
        documentType: 'Actor',
        data: { name: 'x', type: 'dragon' },
      })
    ).rejects.toThrow(/Types: character, npc/);
    await expect(
      harness.query('createDocument', { documentType: 'Scene', data: { name: 'x', folder: 'f1' } })
    ).rejects.toThrow(/holds Actor documents/);
    await expect(
      harness.query('createDocument', {
        documentType: 'Actor',
        data: { name: 'x', folder: 'Heroes' },
      })
    ).rejects.toThrow(/id f1/);
    await expect(
      harness.query('createDocument', { documentType: 'ChatMessage', data: { content: 'x' } })
    ).rejects.toMatchObject({
      moduleCode: 'REFUSED',
      message: expect.stringContaining('send-chat-message'),
    });
    await expect(
      harness.query('createDocument', { documentType: 'User', data: { name: 'x' } })
    ).rejects.toMatchObject({ moduleCode: 'REFUSED' });
    await expect(
      harness.query('createDocument', { documentType: 'Actor', data: { 'system.cr': 1 } })
    ).rejects.toThrow(/nested objects/);
    await expect(
      harness.query('createDocument', {
        documentType: 'Item',
        parentUuid: 'Compendium.dnd5e.monsters.Actor.m1',
        data: { name: 'x' },
      })
    ).rejects.toMatchObject({ moduleCode: 'READ_ONLY' });
    expect(foundry.operations).toHaveLength(0);
  });
});

describe('updateDocument', () => {
  it('merges, reports the real difference and logs the state before', async () => {
    const { harness, foundry } = open();
    const answer = (await harness.query('updateDocument', {
      uuid: 'Actor.a1',
      changes: { 'system.attributes.hp.value': 7, name: 'Grok' },
    })) as Answer;
    expect(answer).toMatchObject({ updated: true, notApplied: [] });
    expect(answer['changes']).toEqual([
      { path: 'system.attributes.hp.value', before: 10, after: 7 },
    ]);
    expect(foundry.operations[0]?.data).toEqual({ 'system.attributes.hp.value': 7 });
    expect(harness.changeLog.list()[0]).toMatchObject({
      document: 'Actors',
      action: 'update',
      undoable: true,
    });
  });

  it('replaces an object on request, changes one list entry and removes', async () => {
    const { harness, foundry } = open();
    await harness.query('updateDocument', {
      documentType: 'Actor',
      id: 'a1',
      changes: { 'system.attributes': { hp: { value: 3 } }, 'system.skills[1].value': 5 },
      replace: ['system.attributes'],
      remove: ['system.skills.0'],
    });
    expect(actor(foundry)['system'] as Answer).toEqual({
      attributes: { hp: { value: 3 } },
      skills: [{ name: 'swim', value: 5 }],
    });
  });

  it('changes an embedded document as a change of its parent', async () => {
    const { harness, foundry } = open({ permActors: 'read' });
    await expect(
      harness.query('updateDocument', { uuid: 'Actor.a1.Item.i1', changes: { name: 'Blade' } })
    ).rejects.toMatchObject({ moduleCode: 'PERMISSION_DENIED' });
    harness.close();
    const allowed = open();
    await allowed.harness.query('updateDocument', {
      documentType: 'Item',
      id: 'i1',
      parentUuid: 'Actor.a1',
      changes: { name: 'Blade' },
    });
    expect(actor(allowed.foundry).getEmbeddedCollection('Item').get('i1')?.['name']).toBe('Blade');
    expect(foundry.operations).toHaveLength(0);
  });

  it('refuses operators and protected fields, without writing', async () => {
    const { harness, foundry } = open();
    await expect(
      harness.query('updateDocument', {
        uuid: 'Actor.a1',
        changes: { [`flags.-=${MODULE_ID}`]: null },
      })
    ).rejects.toMatchObject({
      moduleCode: 'INVALID_ARGUMENT',
      message: expect.stringContaining('remove'),
    });
    await expect(
      harness.query('updateDocument', {
        uuid: 'Actor.a1',
        changes: { flags: {} },
        replace: ['flags'],
      })
    ).rejects.toMatchObject({ moduleCode: 'PROTECTED' });
    await expect(
      harness.query('updateDocument', {
        uuid: 'Actor.a1',
        changes: { type: 'npc', ownership: { alice: 3 } },
      })
    ).rejects.toThrow(/"type".*"ownership"|"ownership".*"type"/);
    await expect(
      harness.query('updateDocument', { uuid: 'Actor.a1', changes: { items: [] } })
    ).rejects.toThrow(/parentUuid/);
    await expect(
      harness.query('updateDocument', { uuid: 'ChatMessage.m2', changes: { content: 'edited' } })
    ).rejects.toThrow(/written by the user "alice"/);
    await expect(
      harness.query('updateDocument', { uuid: 'ChatMessage.m1', changes: { whisper: ['alice'] } })
    ).rejects.toThrow(/send-chat-message/);
    await expect(
      harness.query('updateDocument', {
        uuid: 'Compendium.dnd5e.monsters.Actor.m1',
        changes: { name: 'x' },
      })
    ).rejects.toMatchObject({ moduleCode: 'READ_ONLY' });
    await expect(
      harness.query('updateDocument', { uuid: 'Actor.a1', changes: { 'system.skills.7.value': 1 } })
    ).rejects.toThrow(/outside/);
    expect(foundry.operations).toHaveLength(0);
  });

  it('previews in a dry run and reports values already there', async () => {
    const { harness, foundry } = open({ permActors: 'read' });
    const dry = (await harness.query('updateDocument', {
      uuid: 'Actor.a1',
      changes: { 'system.attributes.hp.value': 1, ownership: { default: 2 } },
      dryRun: true,
    })) as Answer;
    expect(dry).toMatchObject({ dryRun: true, allowed: false, changed: false });
    expect((dry['refused'] as string[]).join(' ')).toMatch(/permActors.*ownership/);
    expect(dry['wouldChange']).toEqual(
      expect.arrayContaining([{ path: 'system.attributes.hp.value', before: 10, after: 1 }])
    );
    harness.close();
    const same = open();
    const answer = (await same.harness.query('updateDocument', {
      uuid: 'Actor.a1',
      changes: { name: 'Grok' },
    })) as Answer;
    expect(answer).toMatchObject({ changed: false });
    expect(foundry.operations).toHaveLength(0);
    expect(same.foundry.operations).toHaveLength(0);
  });

  it('reports what Foundry stored differently, and fails when nothing changed', async () => {
    const { harness, foundry } = open();
    const cast = (document: FakeDocument) => {
      const hp = (document['system'] as { attributes: { hp: { value: unknown } } }).attributes.hp;
      hp.value = Math.min(Number(hp.value), 5);
    };
    foundry.hooks.on('updateActor', document => cast(document as FakeDocument));
    const answer = (await harness.query('updateDocument', {
      uuid: 'Actor.a1',
      changes: { 'system.attributes.hp.value': 8, name: 'Grak' },
    })) as Answer;
    expect(answer['notApplied']).toEqual([
      { path: 'system.attributes.hp.value', requested: 8, stored: 5 },
    ]);
    expect(answer['warnings']).toHaveLength(1);

    foundry.hooks.on('updateActor', document => {
      (document as FakeDocument)['name'] = 'Grak';
    });
    await expect(
      harness.query('updateDocument', { uuid: 'Actor.a1', changes: { name: 'Grok the Bold' } })
    ).rejects.toMatchObject({ moduleCode: 'NOT_APPLIED' });

    foundry.onWrite(() => {
      throw new Error('a module said no');
    });
    await expect(
      harness.query('updateDocument', { uuid: 'Actor.a1', changes: { name: 'Other' } })
    ).rejects.toThrow(/a module said no.*no change/);
  });

  it('changes a kind the settings do not know with the switch alone', async () => {
    const { harness } = open();
    await harness.query('updateDocument', {
      documentType: 'Combat',
      id: 'c1',
      changes: { round: 2 },
    });
    expect(harness.changeLog.list()[0]).toMatchObject({ document: 'Combats', action: 'update' });
  });
});

describe('deleteDocument', () => {
  it('needs the full level of the outermost kind', async () => {
    const { harness, foundry } = open();
    await expect(harness.query('deleteDocument', { uuid: 'Actor.a1' })).rejects.toMatchObject({
      moduleCode: 'PERMISSION_DENIED',
      message: expect.stringContaining('create, change and delete'),
    });
    await expect(
      harness.query('deleteDocument', { uuid: 'Actor.a1.Item.i1' })
    ).rejects.toMatchObject({
      moduleCode: 'PERMISSION_DENIED',
    });
    await expect(harness.query('deleteDocument', { uuid: 'Combat.c1' })).rejects.toThrow(
      /Combat encounters have no level/
    );
    await expect(harness.query('deleteDocument', { uuid: 'ChatMessage.m1' })).rejects.toMatchObject(
      {
        moduleCode: 'PERMISSION_DENIED',
      }
    );
    const dry = (await harness.query('deleteDocument', {
      uuid: 'Actor.a1',
      dryRun: true,
    })) as Answer;
    expect(dry).toMatchObject({ dryRun: true, allowed: false, embeddedCounts: { Item: 1 } });
    expect(foundry.operations).toHaveLength(0);
  });

  it('deletes, reads back and logs the state before', async () => {
    const { harness, foundry } = open({ permActors: 'full' });
    const answer = (await harness.query('deleteDocument', {
      documentType: 'Actor',
      id: 'a1',
    })) as Answer;
    expect(answer).toMatchObject({ deleted: true, embeddedCounts: { Item: 1 } });
    expect(foundry.collection('Actor').has('a1')).toBe(false);
    expect(harness.changeLog.list()[0]).toMatchObject({
      tool: 'delete-document',
      document: 'Actors',
      undoable: true,
      before: expect.objectContaining({ name: 'Grok' }),
    });
  });

  it('counts an embedded document Foundry deleted before throwing as deleted and logs it', async () => {
    const { harness, foundry } = open({ permScenes: 'full' });
    foundry.defineDocumentType('Scene', { embedded: { Drawing: 'drawings' } });
    foundry.seed('Scene', { _id: 's3', name: 'Cellar', drawings: [{ _id: 'dr1', x: 5 }] });
    foundry.hooks.on('deleteDrawing', () => {
      throw new TypeError("Cannot read properties of null (reading 'clipboard')");
    });
    const answer = (await harness.query('deleteDocument', {
      uuid: 'Scene.s3.Drawing.dr1',
    })) as Answer;
    expect(answer).toMatchObject({ deleted: true });
    expect((answer['warnings'] as string[])[0]).toContain("reading 'clipboard'");
    expect(harness.changeLog.list()[0]).toMatchObject({
      tool: 'delete-document',
      action: 'delete',
      undoable: true,
      before: expect.objectContaining({ _id: 'dr1' }),
    });
  });

  it('keeps the rules of the specialised tools', async () => {
    const { harness, foundry } = open({
      permFolders: 'full',
      permPlaylists: 'full',
      permScenes: 'full',
    });
    await expect(harness.query('deleteDocument', { uuid: 'Folder.f1' })).rejects.toThrow(
      /folder-delete/
    );
    await expect(harness.query('deleteDocument', { uuid: 'Playlist.p1' })).rejects.toThrow(
      /"Inn" \(s1\)/
    );
    await expect(harness.query('deleteDocument', { uuid: 'Scene.s1' })).rejects.toThrow(
      /switch-scene/
    );
    const dry = (await harness.query('deleteDocument', {
      uuid: 'Playlist.p1',
      dryRun: true,
    })) as Answer;
    expect(dry).toMatchObject({ allowed: false });
    expect(foundry.operations).toHaveLength(0);
    await harness.query('deleteDocument', { uuid: 'Folder.f2' });
    await harness.query('deleteDocument', { uuid: 'Scene.s2' });
    expect(foundry.operations.map(operation => operation.id)).toEqual(['f2', 's2']);
  });

  it('never reaches settings, users or compendiums', async () => {
    const { harness } = open({ permCompendiums: 'full' });
    await expect(
      harness.query('deleteDocument', { documentType: 'Setting', id: 'x' })
    ).rejects.toMatchObject({
      moduleCode: 'REFUSED',
    });
    await expect(
      harness.query('deleteDocument', { documentType: 'User', id: 'alice' })
    ).rejects.toMatchObject({
      moduleCode: 'REFUSED',
    });
    await expect(
      harness.query('deleteDocument', { uuid: 'Compendium.dnd5e.monsters.Actor.m1' })
    ).rejects.toMatchObject({ moduleCode: 'READ_ONLY' });
  });
});
