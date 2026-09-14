/**
 * The new module answering a server of the previous generation.
 *
 * Every query goes in under the old name with the data the old server sends,
 * and the test asserts the
 * answer fields that server reads, in the types it reads them.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  interpretReleaseList,
  releaseListCovers,
} from '../../../common/areas/compendiums/release-list.js';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { FakeFoundry } from '../../../testing/fake-foundry.js';
import { registerCompendiumAdapter, type CompendiumAdapter } from './adapter.js';
import { creatureIndex } from './creature-index.js';
import { saveReleaseList } from './release-window.js';
import {
  getModuleSetting,
  memoryIndexStore,
  withCompendiums,
  type FakePackOptions,
} from './testing.js';

let harness: AreaHarness | null = null;
let removeAdapter: (() => void) | null = null;

afterEach(() => {
  harness?.close();
  harness = null;
  removeAdapter?.();
  removeAdapter = null;
  creatureIndex.useStore(null);
});

function open(packs: FakePackOptions[], settings: Record<string, unknown> = {}, system = 'oldsys') {
  const foundry = new FakeFoundry({
    system: { id: system, version: '1.0' },
    settings: Object.fromEntries(
      Object.entries(settings).map(([key, value]) => [`ninjos-foundry-mcp.${key}`, value])
    ),
  });
  const world = withCompendiums(foundry, packs);
  harness = createAreaHarness({ foundry });
  return { h: harness, foundry, world };
}

type Rec = Record<string, unknown>;

const archive = (entries: Rec[] = [], extra: Partial<FakePackOptions> = {}): FakePackOptions => ({
  id: 'world.archive',
  label: 'Archive',
  type: 'JournalEntry',
  entries,
  ...extra,
});

const beasts = (): FakePackOptions => ({
  id: 'beast-module.beasts',
  label: 'Beasts',
  type: 'Actor',
  entries: [
    {
      _id: 'g1',
      name: 'Goblin',
      type: 'npc',
      img: 'goblin.webp',
      system: { cr: 0.25, kind: 'humanoid' },
      items: [{ _id: 'i1', name: 'Scimitar', type: 'weapon' }],
      effects: [{ _id: 'e1', name: 'Sneaky' }],
    },
    { _id: 'o1', name: 'Ogre', type: 'npc', system: { cr: 2, kind: 'giant', casts: true } },
  ],
});

const oldSystemAdapter: CompendiumAdapter = {
  id: 'oldsys',
  title: 'Old System',
  handles: id => id === 'oldsys',
  creatures: {
    version: 1,
    actorTypes: ['npc'],
    row: document => {
      const system = (document.toObject()['system'] ?? {}) as Rec;
      return {
        cr: Number(system['cr'] ?? 0),
        kind: String(system['kind'] ?? ''),
        casts: system['casts'] === true,
      };
    },
    filters: [
      {
        name: 'challengeRating',
        kind: 'numberOrRange',
        field: 'cr',
        defaults: { min: 0, max: 30 },
      },
      { name: 'creatureType', kind: 'text', field: 'kind' },
      { name: 'hasSpells', kind: 'boolean', field: 'casts' },
    ],
    sortField: 'cr',
    listFields: row => ({ challengeRating: row['cr'], creatureType: row['kind'] }),
    summary: row => `CR ${String(row['cr'])} ${String(row['kind'])} from ${row.packLabel}`,
  },
};

const isText = (value: unknown) => typeof value === 'string';
const isObject = (value: unknown) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

describe('lists and entries for a server of the previous generation', () => {
  it('answers listCompendiums under compendiums with writable, label, id, type and entries', async () => {
    const { h } = open([
      archive([{ _id: 'a', name: 'A' }]),
      { id: 'beast-module.beasts', label: 'Beasts', type: 'Actor', locked: true },
    ]);
    const answer = (await h.query('listCompendiums')) as Rec;
    const compendiums = answer['compendiums'] as Rec[];
    expect(Array.isArray(compendiums)).toBe(true);
    for (const pack of compendiums) {
      expect(typeof pack['writable']).toBe('boolean');
      expect(isText(pack['label']) && isText(pack['id']) && isText(pack['type'])).toBe(true);
      expect(typeof pack['entries']).toBe('number');
    }
    expect(compendiums.find(pack => pack['id'] === 'world.archive')).toMatchObject({
      writable: true,
      entries: 1,
    });
    expect(compendiums.find(pack => pack['id'] === 'beast-module.beasts')).toMatchObject({
      writable: false,
      locked: true,
    });
  });

  it('answers getAvailablePacks without data as a bare list', async () => {
    const { h } = open([archive(), beasts()]);
    const answer = (await h.query('getAvailablePacks')) as Rec[];
    expect(Array.isArray(answer)).toBe(true);
    expect(answer).toHaveLength(2);
    for (const pack of answer) {
      expect(Object.keys(pack).sort()).toEqual(['id', 'label', 'private', 'system', 'type']);
      expect(typeof pack['private']).toBe('boolean');
    }
  });

  it('answers listCompendiumEntries and its alias with the old fields', async () => {
    const { h } = open([
      archive(
        [
          { _id: 'a', name: 'Alpha', folder: 'f1' },
          { _id: 'b', name: 'Beta' },
          { _id: 'c', name: 'Gamma' },
        ],
        { folders: [{ _id: 'f1', name: 'Act 1' }], locked: true }
      ),
    ]);
    for (const name of ['listCompendiumEntries', 'list-compendium-entries']) {
      const answer = (await h.query(name, { packId: 'world.archive', limit: 2, offset: 0 })) as Rec;
      expect(answer).toMatchObject({
        label: 'Archive',
        documentType: 'JournalEntry',
        packageType: 'world',
        locked: true,
        total: 3,
        returned: 2,
        offset: 0,
        hasMore: true,
      });
      expect(answer['entries']).toEqual([
        { id: 'a', name: 'Alpha', type: 'JournalEntry', folder: 'Act 1' },
        { id: 'b', name: 'Beta', type: 'JournalEntry', folder: null },
      ]);
    }
  });
});

describe('search, entry and creatures for a server of the previous generation', () => {
  it('answers searchCompendium without limit as a bare list with pack as text', async () => {
    const { h } = open([beasts(), archive([{ _id: 'j', name: 'Goblin Lore' }])]);
    const answer = (await h.query('searchCompendium', { query: 'goblin' })) as Rec[];
    expect(Array.isArray(answer)).toBe(true);
    expect(answer.map(hit => hit['id']).sort()).toEqual(['g1', 'j']);
    for (const hit of answer) {
      expect(isText(hit['id']) && isText(hit['name']) && isText(hit['type'])).toBe(true);
      expect(isText(hit['pack']) && isText(hit['packLabel'])).toBe(true);
      expect(hit['img'] === null || isText(hit['img'])).toBe(true);
      expect(isObject(hit['system'])).toBe(true);
    }
    expect(answer.find(hit => hit['id'] === 'g1')).toMatchObject({
      pack: 'beast-module.beasts',
      packLabel: 'Beasts',
      img: 'goblin.webp',
    });
  });

  it('answers getCompendiumDocumentFull with documentId, type as text and named items and effects', async () => {
    const { h } = open([beasts()]);
    const answer = (await h.query('getCompendiumDocumentFull', {
      packId: 'beast-module.beasts',
      documentId: 'g1',
    })) as Rec;
    expect(answer).toMatchObject({
      id: 'g1',
      name: 'Goblin',
      type: 'npc',
      pack: 'beast-module.beasts',
      packLabel: 'Beasts',
      img: 'goblin.webp',
      system: { cr: 0.25, kind: 'humanoid' },
    });
    expect((answer['items'] as Rec[]).map(item => item['name'])).toEqual(['Scimitar']);
    expect((answer['effects'] as Rec[]).map(effect => effect['name'])).toEqual(['Sneaky']);
    expect(answer['fullData']).toMatchObject({ _id: 'g1', name: 'Goblin' });
    await expect(
      h.query('getCompendiumDocumentFull', { packId: 'beast-module.beasts', documentId: 'nope' })
    ).rejects.toThrow('Document nope not found in pack beast-module.beasts');
  });

  it('answers listCreaturesByCriteria under response, with the filter forms the old server sends', async () => {
    creatureIndex.useStore(memoryIndexStore());
    removeAdapter = registerCompendiumAdapter(oldSystemAdapter);
    const { h } = open([beasts()]);
    const answer = (await h.query('listCreaturesByCriteria', {
      challengeRating: { min: 1, max: 30 },
      hasSpells: true,
      level: { min: -1, max: 25 },
      limit: 100,
    })) as { response: Rec };
    const creatures = answer.response['creatures'] as Rec[];
    expect(creatures.map(creature => creature['name'])).toEqual(['Ogre']);
    expect(creatures[0]).toMatchObject({
      id: 'o1',
      pack: 'beast-module.beasts',
      packLabel: 'Beasts',
    });
    expect(isObject(creatures[0]?.['system'])).toBe(true);
    expect(answer.response['searchSummary']).toMatchObject({ totalFound: 1, showing: 1 });
  });

  it('answers listCreaturesByCriteria under response also without an adapter', async () => {
    const { h } = open([beasts()], {}, 'no-adapter-system');
    const answer = (await h.query('listCreaturesByCriteria', { limit: 100 })) as { response: Rec };
    expect((answer.response['creatures'] as Rec[]).map(creature => creature['name'])).toEqual([
      'Goblin',
      'Ogre',
    ]);
    expect(isObject(answer.response['searchSummary'])).toBe(true);
  });
});

describe('create, export, import, organize and lock for a server of the previous generation', () => {
  it('answers createCompendium with label, type and id', async () => {
    const { h } = open([]);
    const answer = (await h.query('createCompendium', {
      label: 'Act 1',
      type: 'JournalEntry',
    })) as Rec;
    expect(answer).toMatchObject({ label: 'Act 1', type: 'JournalEntry', id: 'world.act-1' });
  });

  it('answers exportToCompendium with pack and four lists of names', async () => {
    const { h, foundry } = open([archive([{ _id: 'j2', name: 'Chapter 2' }])]);
    foundry.seed('JournalEntry', { _id: 'j1', name: 'Chapter 1' });
    foundry.seed('JournalEntry', { _id: 'j2', name: 'Chapter 2' });
    const answer = (await h.query('exportToCompendium', {
      packId: 'world.archive',
      documentType: 'JournalEntry',
      names: ['Chapter 1', 'Chapter 2'],
    })) as Rec;
    expect(answer).toMatchObject({
      pack: 'world.archive',
      exported: ['Chapter 1'],
      replaced: ['Chapter 2'],
      skipped: [],
      lost: [],
    });
  });

  it('answers importFromCompendium with type, name, pack as text and id, and marks created folders both ways', async () => {
    const { h, foundry } = open([
      {
        id: 'my-module.presets',
        label: 'Presets',
        type: 'JournalEntry',
        entries: [{ _id: 'e1', name: 'Tavern' }],
      },
    ]);
    const answer = (await h.query('importFromCompendium', {
      packId: 'my-module.presets',
      entryName: 'Tavern',
      folderPath: 'Places',
    })) as Rec;
    expect(answer).toMatchObject({
      type: 'JournalEntry',
      name: 'Tavern',
      pack: 'my-module.presets',
    });
    expect(isText(answer['id'])).toBe(true);
    const folder = foundry.collection('Folder').get(answer['folderId'] as string);
    expect(folder?.['flags']).toEqual({
      'ninjos-foundry-mcp': {
        createdByMcp: true,
        mcpGenerated: true,
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/),
      },
    });
  });

  it('answers organizeCompendium with pack, folder as text and moved names', async () => {
    const { h } = open([
      archive([
        { _id: 'g1', name: 'Goblin' },
        { _id: 'o1', name: 'Orc' },
      ]),
    ]);
    const answer = (await h.query('organizeCompendium', {
      packId: 'world.archive',
      folderName: 'Monsters',
      entryNames: ['Goblin', 'Orc'],
    })) as Rec;
    expect(answer).toMatchObject({
      pack: 'world.archive',
      folder: 'Monsters',
      moved: ['Goblin', 'Orc'],
    });
  });

  it('answers setCompendiumLock with pack and locked', async () => {
    const { h } = open([archive()]);
    await expect(
      h.query('setCompendiumLock', { packId: 'world.archive', locked: true })
    ).resolves.toMatchObject({ pack: 'world.archive', locked: true });
  });
});

describe('deleting for a server of the previous generation', () => {
  const forest = () =>
    archive([
      { _id: 'w1', name: 'Wald' },
      { _id: 'w2', name: 'Waldrand' },
      { _id: 'd1', name: 'Dup' },
      { _id: 'd2', name: 'Dup' },
    ]);

  it('answers a dry run with counts, entries, one notFound list and ambiguous names', async () => {
    const { h } = open([forest()], { permCompendiums: 'full' });
    const answer = (await h.query('deleteCompendiumEntries', {
      packId: 'world.archive',
      names: ['Wald', 'Dup', 'Moor'],
      dryRun: true,
    })) as Rec;
    expect(answer).toMatchObject({
      dryRun: true,
      label: 'Archive',
      wouldDelete: 1,
      totalInPack: 4,
      entries: [{ id: 'w1', name: 'Wald' }],
      notFound: ['Moor'],
      ambiguous: [{ name: 'Dup', ids: ['d1', 'd2'] }],
    });
  });

  it('answers the real deletion under the alias with deleted as a count', async () => {
    const { h } = open([forest()], { permCompendiums: 'full' });
    const answer = (await h.query('delete-compendium-entries', {
      packId: 'world.archive',
      ids: ['w1', 'nope'],
    })) as Rec;
    expect(answer).toMatchObject({
      dryRun: false,
      label: 'Archive',
      deleted: 1,
      totalInPack: 3,
      entries: [{ id: 'w1', name: 'Wald' }],
      notFound: ['nope'],
      ambiguous: [],
    });
  });

  it('answers deleteCompendium with label and the entry count', async () => {
    const { h } = open([archive([{ _id: 'a', name: 'A' }])], { permCompendiums: 'full' });
    await expect(
      h.query('deleteCompendium', { packId: 'world.archive', confirmLabel: 'Archive' })
    ).resolves.toMatchObject({ label: 'Archive', entries: 1 });
  });
});

describe('the release list as both generations store and read it', () => {
  it('writes the chosen entries separated by comma and space', async () => {
    const { foundry } = open([archive()]);
    await saveReleaseList(['world.archive', 'my-module']);
    expect(getModuleSetting(foundry, 'writableCompendiums')).toBe('world.archive, my-module');
    await saveReleaseList([]);
    expect(getModuleSetting(foundry, 'writableCompendiums')).toBe('');
  });

  it('reads commas, semicolons and line breaks, and matches id, package name or id prefix', () => {
    const list = (text: string) => interpretReleaseList(text);
    expect(list(' world.a, b ;c\n\nd ').entries).toEqual(['world.a', 'b', 'c', 'd']);
    expect(releaseListCovers(list('world.a'), 'world.a', 'world')).toBe(true);
    expect(releaseListCovers(list('shipper'), 'my-module.presets', 'shipper')).toBe(true);
    expect(releaseListCovers(list('my-module'), 'my-module.presets', 'shipper')).toBe(true);
    expect(releaseListCovers(list('my-mod'), 'my-module.presets', 'shipper')).toBe(false);
  });

  it('lets a compendium named by its id prefix past the release list', async () => {
    const pack: FakePackOptions = {
      id: 'my-module.presets',
      label: 'Presets',
      type: 'Item',
      packageName: 'shipper',
      locked: true,
    };
    const { h } = open([pack], { writableCompendiums: 'my-module' });
    await expect(
      h.query('setCompendiumLock', { packId: 'my-module.presets', locked: false })
    ).resolves.toMatchObject({ locked: false });
  });
});
