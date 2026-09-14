/**
 * The writing queries of the compendiums area through the dispatcher: permission gate,
 * release list, lock, reading the effect back.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { FakeFoundry } from '../../../testing/fake-foundry.js';
import {
  setModuleSetting,
  withCompendiums,
  type CompendiumWorld,
  type FakePackOptions,
} from './testing.js';

let harness: AreaHarness | null = null;
afterEach(() => {
  harness?.close();
  harness = null;
});

function open(packs: FakePackOptions[], settings: Record<string, unknown> = {}) {
  const foundry = new FakeFoundry({
    settings: Object.fromEntries(
      Object.entries(settings).map(([key, value]) => [`ninjos-foundry-mcp.${key}`, value])
    ),
  });
  const world: CompendiumWorld = withCompendiums(foundry, packs);
  harness = createAreaHarness({ foundry });
  return { h: harness, foundry, world };
}

const archive = (extra: Partial<FakePackOptions> = {}): FakePackOptions => ({
  id: 'world.archive',
  label: 'Archive',
  type: 'JournalEntry',
  ...extra,
});

describe('exportToCompendium', () => {
  it('creates new entries, overwrites existing ones by id, and reads both back', async () => {
    const { h, foundry, world } = open([
      archive({ entries: [{ _id: 'j2', name: 'Old chapter 2' }] }),
    ]);
    foundry.seed('JournalEntry', { _id: 'j1', name: 'Chapter 1' });
    foundry.seed('JournalEntry', { _id: 'j2', name: 'Chapter 2' });

    const result = (await h.query('exportToCompendium', {
      packId: 'world.archive',
      documentType: 'JournalEntry',
    })) as Record<string, unknown>;
    expect(result).toMatchObject({
      pack: 'world.archive',
      exported: ['Chapter 1'],
      replaced: ['Chapter 2'],
      skipped: [],
      lost: [],
      exportedEntries: [{ id: 'j1', name: 'Chapter 1' }],
      replacedEntries: [{ id: 'j2', name: 'Chapter 2' }],
      skippedEntries: [],
      lostEntries: [],
    });
    expect(world.get('world.archive').docs.get('j2')?.['name']).toBe('Chapter 2');
    expect(h.changeLog.list()[0]?.query).toBe('exportToCompendium');
  });

  it('removes and rewrites only when overwriting fails, and calls a failed rewrite lost', async () => {
    const { h, foundry, world } = open([
      {
        id: 'world.maps',
        label: 'Maps',
        type: 'Scene',
        entries: [
          { _id: 's1', name: 'Keep' },
          { _id: 's2', name: 'Harbour' },
        ],
      },
    ]);
    foundry.seed('Scene', { _id: 's1', name: 'Keep' });
    foundry.seed('Scene', { _id: 's2', name: 'Harbour' });
    const pack = world.get('world.maps');
    pack.failures.update = () => 'Token actor missing';
    pack.failures.create = data => (data['_id'] === 's2' ? 'broken wall data' : undefined);

    const result = (await h.query('exportToCompendium', {
      packId: 'world.maps',
      documentType: 'Scene',
    })) as Record<string, unknown>;
    expect(result['replacedEntries']).toEqual([
      { id: 's1', name: 'Keep', rewrittenBecause: 'Token actor missing' },
    ]);
    expect(result['lostEntries']).toEqual([
      expect.objectContaining({ id: 's2', reason: expect.stringContaining('broken wall data') }),
    ]);
    expect(result['lost']).toEqual(['Harbour']);
    expect(result['skippedEntries']).toEqual([]);
  });

  it('refuses a wrong type, an unknown folder and an empty selection with the cause', async () => {
    const { h, foundry } = open([archive()]);
    foundry.seed('Folder', { _id: 'f1', name: 'Act 1', type: 'JournalEntry', folder: null });
    await expect(
      h.query('exportToCompendium', { packId: 'world.archive', documentType: 'Scene' })
    ).rejects.toThrow('"world.archive" takes JournalEntry, not Scene');
    await expect(
      h.query('exportToCompendium', {
        packId: 'world.archive',
        documentType: 'JournalEntry',
        folderName: 'Act 2',
      })
    ).rejects.toMatchObject({ moduleCode: 'FOLDER_NOT_FOUND' });
    await expect(
      h.query('exportToCompendium', {
        packId: 'world.archive',
        documentType: 'JournalEntry',
        folderName: 'Act 1',
      })
    ).rejects.toThrow('No JournalEntry in the folder "Act 1"');
    await expect(
      h.query('exportToCompendium', {
        packId: 'world.archive',
        documentType: 'JournalEntry',
        names: ['Nope'],
      })
    ).rejects.toThrow(/Nothing found to save/);
    await expect(
      h.query('exportToCompendium', { packId: 'world.nope', documentType: 'JournalEntry' })
    ).rejects.toThrow('Compendium "world.nope" not found');
  });

  it('takes names ignoring case and reports the ones it did not find', async () => {
    const { h, foundry, world } = open([archive()]);
    foundry.seed('JournalEntry', { _id: 'j1', name: 'Chapter 1' });
    foundry.seed('JournalEntry', { _id: 'j2', name: 'Chapter 10' });
    const result = (await h.query('exportToCompendium', {
      packId: 'world.archive',
      documentType: 'JournalEntry',
      names: ['chapter 1', 'Chapter 3'],
    })) as Record<string, unknown>;
    expect(result['exportedEntries']).toEqual([{ id: 'j1', name: 'Chapter 1' }]);
    expect(result['notFound']).toEqual(['Chapter 3']);
    expect([...world.get('world.archive').docs.keys()]).toEqual(['j1']);
  });

  it('refuses a locked compendium, and with unlockIfNeeded sets the lock again', async () => {
    const { h, foundry, world } = open([archive({ locked: true })]);
    foundry.seed('JournalEntry', { _id: 'j1', name: 'Chapter 1' });
    await expect(
      h.query('exportToCompendium', { packId: 'world.archive', documentType: 'JournalEntry' })
    ).rejects.toMatchObject({ moduleCode: 'PACK_LOCKED' });

    const result = (await h.query('exportToCompendium', {
      packId: 'world.archive',
      documentType: 'JournalEntry',
      unlockIfNeeded: true,
    })) as Record<string, unknown>;
    expect(result['lock']).toEqual({
      wasLocked: true,
      lifted: true,
      restored: true,
      problem: null,
    });
    expect(world.get('world.archive').locked).toBe(true);
  });

  it('sets the lock again after a failure, and reports a lock it could not set again', async () => {
    const { h, foundry, world } = open([archive({ locked: true })]);
    foundry.seed('JournalEntry', { _id: 'j1', name: 'Chapter 1' });
    const pack = world.get('world.archive');
    pack.getIndex = async () => {
      throw new Error('index broken');
    };
    await expect(
      h.query('exportToCompendium', {
        packId: 'world.archive',
        documentType: 'JournalEntry',
        unlockIfNeeded: true,
      })
    ).rejects.toThrow('index broken');
    expect(pack.locked).toBe(true);

    pack.failures.lock = locked => (locked ? 'disk full' : undefined);
    await expect(
      h.query('exportToCompendium', {
        packId: 'world.archive',
        documentType: 'JournalEntry',
        unlockIfNeeded: true,
      })
    ).rejects.toThrow(
      /index broken CAUTION: in addition, the lock of "world.archive" could not be set again \(disk full\)/
    );
    expect(pack.locked).toBe(false);
  });

  it('follows the release list: refuses what it does not name, and lets its own compendiums past the lock', async () => {
    const { h, foundry, world } = open([archive({ locked: true })], {
      writableCompendiums: 'other-module',
    });
    foundry.seed('JournalEntry', { _id: 'j1', name: 'Chapter 1' });
    await expect(
      h.query('exportToCompendium', {
        packId: 'world.archive',
        documentType: 'JournalEntry',
        unlockIfNeeded: true,
      })
    ).rejects.toMatchObject({ moduleCode: 'NOT_RELEASED' });

    await setModuleSetting(foundry, 'writableCompendiums', 'world.archive');
    const result = (await h.query('exportToCompendium', {
      packId: 'world.archive',
      documentType: 'JournalEntry',
    })) as Record<string, unknown>;
    expect(result['exported']).toHaveLength(1);
    expect(world.get('world.archive').locked).toBe(true);
  });

  it('writes nothing with the write switch off', async () => {
    const { h, foundry, world } = open([archive()], { allowWriteOperations: false });
    foundry.seed('JournalEntry', { _id: 'j1', name: 'Chapter 1' });
    await expect(
      h.query('exportToCompendium', { packId: 'world.archive', documentType: 'JournalEntry' })
    ).rejects.toMatchObject({ moduleCode: 'WRITE_DISABLED' });
    await expect(
      h.query('importFromCompendium', { packId: 'world.archive', entryId: 'x' })
    ).rejects.toMatchObject({
      moduleCode: 'WRITE_DISABLED',
    });
    expect(world.get('world.archive').writes).toEqual([]);
  });

  it('reports progress while saving', async () => {
    const { h, foundry } = open([archive()]);
    for (let i = 0; i < 25; i += 1)
      foundry.seed('JournalEntry', { _id: `j${i}`, name: `Page ${i}` });
    const seen: number[] = [];
    await h.query(
      'exportToCompendium',
      { packId: 'world.archive', documentType: 'JournalEntry' },
      {
        onProgress: progress => seen.push(progress.progress),
      }
    );
    expect(seen).toEqual([10, 20, 25]);
  });
});

describe('importFromCompendium', () => {
  const presets = (): FakePackOptions => ({
    id: 'my-module.presets',
    label: 'Presets',
    type: 'JournalEntry',
    entries: [
      {
        _id: 'e1',
        name: 'Tavern',
        folder: 'pf',
        ownership: { default: 3 },
        _stats: { createdTime: 1 },
      },
      { _id: 'e2', name: 'Tavern Brawl' },
      { _id: 'e3', name: 'Dup' },
      { _id: 'e4', name: 'dup' },
    ],
  });

  it('imports by whole name with a fresh id and without the metadata', async () => {
    const { h, foundry } = open([presets()]);
    const result = (await h.query('importFromCompendium', {
      packId: 'my-module.presets',
      entryName: 'tavern',
      newName: 'The Inn',
    })) as Record<string, unknown>;
    expect(result).toMatchObject({
      name: 'The Inn',
      type: 'JournalEntry',
      sourceId: 'e1',
      folderId: null,
    });
    expect(result['id']).not.toBe('e1');
    const created = foundry.collection('JournalEntry').get(result['id'] as string);
    expect(created?.['folder']).toBeUndefined();
    expect(created?.['_stats']).toBeUndefined();
    expect(created?.['ownership']).toBeUndefined();
  });

  it('refuses an ambiguous name with the ids, and a missing name with suggestions', async () => {
    const { h } = open([presets()]);
    await expect(
      h.query('importFromCompendium', { packId: 'my-module.presets', entryName: 'DUP' })
    ).rejects.toThrow(/matches 2 entries .*ids e3, e4/);
    await expect(
      h.query('importFromCompendium', { packId: 'my-module.presets', entryName: 'Tav' })
    ).rejects.toThrow(/No entry named "Tav".*Names containing the text: Tavern, Tavern Brawl/);
    await expect(h.query('importFromCompendium', { packId: 'my-module.presets' })).rejects.toThrow(
      'entryName or entryId is required'
    );
  });

  it('creates missing folders of the path, and checks the folder level before creating anything', async () => {
    const { h, foundry } = open([presets()], { permFolders: 'read' });
    await expect(
      h.query('importFromCompendium', {
        packId: 'my-module.presets',
        entryId: 'e2',
        folderPath: 'Places/Inns',
      })
    ).rejects.toMatchObject({ moduleCode: 'PERMISSION_DENIED' });
    expect(foundry.operations).toEqual([]);

    await setModuleSetting(foundry, 'permFolders', 'write');
    foundry.seed('Folder', { _id: 'places', name: 'Places', type: 'JournalEntry', folder: null });
    const result = (await h.query('importFromCompendium', {
      packId: 'my-module.presets',
      entryId: 'e2',
      folderPath: 'Places/Inns',
    })) as Record<string, unknown>;
    expect(result['createdFolders']).toEqual(['Inns']);
    const inns = foundry.collection('Folder').get(result['folderId'] as string);
    expect(inns).toMatchObject({
      name: 'Inns',
      folder: 'places',
      flags: {
        'ninjos-foundry-mcp': {
          createdByMcp: true,
          mcpGenerated: true,
          createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        },
      },
    });
  });

  it('checks the level of the target kind, and refuses adventures', async () => {
    const { h } = open(
      [
        presets(),
        {
          id: 'world.adv',
          label: 'Adventures',
          type: 'Adventure',
          entries: [{ _id: 'a1', name: 'Mine' }],
        },
      ],
      { permJournals: 'read' }
    );
    await expect(
      h.query('importFromCompendium', { packId: 'my-module.presets', entryId: 'e1' })
    ).rejects.toThrow(/Creating journals is not permitted/);
    await expect(
      h.query('importFromCompendium', { packId: 'world.adv', entryId: 'a1' })
    ).rejects.toMatchObject({
      moduleCode: 'UNSUPPORTED_TYPE',
    });
  });
});

describe('organizeCompendium', () => {
  it('moves whole names only, reports the rest, and reads the folder back', async () => {
    const { h, world } = open([
      archive({
        entries: [
          { _id: 'g1', name: 'Goblin' },
          { _id: 'g2', name: 'Goblin Boss' },
          { _id: 'o1', name: 'Orc' },
          { _id: 'o2', name: 'Orc' },
        ],
      }),
    ]);
    const result = (await h.query('organizeCompendium', {
      packId: 'world.archive',
      folderName: 'Monsters',
      entryNames: ['goblin', 'Orc', 'Troll'],
    })) as Record<string, unknown>;
    const pack = world.get('world.archive');
    const folderId = pack.folders.contents[0]?.id;
    expect(result).toMatchObject({
      pack: 'world.archive',
      folder: 'Monsters',
      folderId,
      folderCreated: true,
      moved: ['Goblin'],
      movedEntries: [{ id: 'g1', name: 'Goblin' }],
      notMoved: [],
      notFound: ['Troll'],
      ambiguous: [{ name: 'Orc', ids: ['o1', 'o2'] }],
    });
    expect(pack.docs.get('g2')?.['folder']).toBeUndefined();
  });

  it('moves nothing and creates no folder when nothing matches', async () => {
    const { h, world } = open([archive({ entries: [{ _id: 'g1', name: 'Goblin' }] })]);
    await expect(
      h.query('organizeCompendium', {
        packId: 'world.archive',
        folderName: 'Monsters',
        entryNames: ['Gob'],
      })
    ).rejects.toThrow(/Nothing was moved in "Archive": not found: "Gob"/);
    expect(world.get('world.archive').writes).toEqual([]);
  });
});

describe('setCompendiumLock', () => {
  it('unlocks a locked compendium with an empty release list', async () => {
    const { h, world } = open([archive({ locked: true })]);
    await expect(
      h.query('setCompendiumLock', { packId: 'world.archive', locked: false })
    ).resolves.toEqual({
      pack: 'world.archive',
      packId: 'world.archive',
      label: 'Archive',
      locked: false,
      changed: true,
    });
    expect(world.get('world.archive').locked).toBe(false);
  });

  it('refuses a compendium a filled release list does not name, and a lock that is not a boolean', async () => {
    const { h } = open([archive({ locked: true })], { writableCompendiums: 'world.other' });
    await expect(
      h.query('setCompendiumLock', { packId: 'world.archive', locked: false })
    ).rejects.toMatchObject({
      moduleCode: 'NOT_RELEASED',
    });
    await expect(
      h.query('setCompendiumLock', { packId: 'world.archive', locked: 'false' })
    ).rejects.toThrow('locked must be a boolean');
  });
});

describe('deleteCompendiumEntries', () => {
  const forest = (): FakePackOptions =>
    archive({
      entries: [
        { _id: 'w1', name: 'Wald' },
        { _id: 'w2', name: 'Waldrand' },
        { _id: 'd1', name: 'Dup' },
        { _id: 'd2', name: 'Dup' },
      ],
    });

  it('is off by default', async () => {
    const { h } = open([forest()]);
    await expect(
      h.query('deleteCompendiumEntries', { packId: 'world.archive', ids: ['w1'] })
    ).rejects.toMatchObject({
      moduleCode: 'PERMISSION_DENIED',
    });
  });

  it('deletes exact names only and leaves ambiguous names alone', async () => {
    const { h, world } = open([forest()], { permCompendiums: 'full' });
    await expect(h.query('deleteCompendiumEntries', { packId: 'world.archive' })).rejects.toThrow(
      /Nothing selected/
    );

    const result = (await h.query('deleteCompendiumEntries', {
      packId: 'world.archive',
      names: ['Wald', 'Dup', 'waldrand'],
    })) as Record<string, unknown>;
    expect(result).toMatchObject({
      deleted: 1,
      entries: [{ id: 'w1', name: 'Wald' }],
      notDeleted: [],
      ambiguous: [{ name: 'Dup', ids: ['d1', 'd2'] }],
      notFound: ['waldrand'],
      notFoundIds: [],
      notFoundNames: ['waldrand'],
      spellingHints: [{ name: 'waldrand', candidates: ['Waldrand'] }],
      totalInPack: 3,
    });
    expect([...world.get('world.archive').docs.keys()]).toEqual(['w2', 'd1', 'd2']);
  });

  it('needs the exact label when the selection covers every entry, and a dry run changes nothing', async () => {
    const { h, world } = open([forest()], { permCompendiums: 'full' });
    const all = { packId: 'world.archive', ids: ['w1', 'w2', 'd1', 'd2'] };
    const dry = (await h.query('deleteCompendiumEntries', { ...all, dryRun: true })) as Record<
      string,
      unknown
    >;
    expect(dry).toMatchObject({
      dryRun: true,
      requiresConfirmLabel: true,
      confirmLabelMissing: true,
      remainingAfter: 0,
    });
    expect(world.get('world.archive').writes).toEqual([]);

    await expect(h.query('deleteCompendiumEntries', all)).rejects.toMatchObject({
      moduleCode: 'CONFIRM_LABEL_REQUIRED',
    });
    await expect(
      h.query('deleteCompendiumEntries', { ...all, confirmLabel: 'archive' })
    ).rejects.toMatchObject({
      moduleCode: 'LABEL_MISMATCH',
    });
    const done = (await h.query('deleteCompendiumEntries', {
      ...all,
      confirmLabel: 'Archive',
    })) as Record<string, unknown>;
    expect(done['totalInPack']).toBe(0);
  });

  it('deletes in batches of 200 and reports progress', async () => {
    const entries = Array.from({ length: 450 }, (_, i) => ({ _id: `e${i}`, name: `Entry ${i}` }));
    const { h, world } = open([archive({ entries: [...entries, { _id: 'keep', name: 'Keep' }] })], {
      permCompendiums: 'full',
    });
    const seen: number[] = [];
    const result = (await h.query(
      'delete-compendium-entries',
      { packId: 'world.archive', ids: entries.map(entry => entry._id) },
      { onProgress: progress => seen.push(progress.progress) }
    )) as Record<string, unknown>;
    expect(result['deleted']).toBe(450);
    expect((result['entries'] as unknown[]).length).toBe(450);
    expect(
      world.get('world.archive').writes.filter(write => write.action === 'delete')
    ).toHaveLength(3);
    expect(seen).toEqual([200, 400, 450]);
  });
});

describe('deleteCompendium and createCompendium', () => {
  it('deletes only world compendiums with their exact label', async () => {
    const { h, world } = open(
      [
        archive({ entries: [{ _id: 'a', name: 'A' }] }),
        { id: 'my-module.presets', label: 'Presets', type: 'Item' },
      ],
      { permCompendiums: 'full' }
    );
    await expect(
      h.query('deleteCompendium', { packId: 'my-module.presets', confirmLabel: 'Presets' })
    ).rejects.toMatchObject({
      moduleCode: 'NOT_WORLD_PACK',
    });
    await expect(
      h.query('deleteCompendium', { packId: 'world.archive', confirmLabel: 'archive' })
    ).rejects.toMatchObject({
      moduleCode: 'LABEL_MISMATCH',
    });
    await expect(
      h.query('deleteCompendium', { packId: 'world.archive', confirmLabel: 'Archive' })
    ).resolves.toEqual({
      packId: 'world.archive',
      label: 'Archive',
      type: 'JournalEntry',
      entries: 1,
    });
    expect(world.packs.has('world.archive')).toBe(false);
  });

  it('refuses to delete a locked world compendium', async () => {
    const { h } = open([archive({ locked: true })], { permCompendiums: 'full' });
    await expect(
      h.query('deleteCompendium', { packId: 'world.archive', confirmLabel: 'Archive' })
    ).rejects.toThrow(/is locked\. Unlock it first with set-compendium-lock/);
  });

  it('creates a world compendium, refuses an unknown type and an id that exists', async () => {
    const { h, world } = open([], { writableCompendiums: 'world.other' });
    await expect(h.query('createCompendium', { label: 'Act 1', type: 'Token' })).rejects.toThrow(
      /type has to be one of: Actor, Item, Scene/
    );
    await expect(
      h.query('createCompendium', { label: 'Geheimnisse der Tiefe, Akt 0', type: 'journalentry' })
    ).resolves.toEqual({
      id: 'world.geheimnisse-der-tiefe-akt-0',
      label: 'Geheimnisse der Tiefe, Akt 0',
      type: 'JournalEntry',
      packageType: 'world',
      onReleaseList: false,
      releaseListFilled: true,
    });
    expect(world.packs.has('world.geheimnisse-der-tiefe-akt-0')).toBe(true);
    await expect(
      h.query('createCompendium', { label: 'Geheimnisse der Tiefe: Akt 0', type: 'Item' })
    ).rejects.toMatchObject({
      moduleCode: 'PACK_EXISTS',
    });
  });
});
