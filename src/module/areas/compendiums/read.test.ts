/**
 * The reading queries of the compendiums area: lists, entries, search, item, the
 * creature search with and without an adapter, and the release window logic.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { FakeFoundry } from '../../../testing/fake-foundry.js';
import { registerCompendiumAdapter, type CompendiumAdapter } from './adapter.js';
import { creatureIndex } from './creature-index.js';
import { releaseWindowModel, saveReleaseList } from './release-window.js';
import {
  getModuleSetting,
  memoryIndexStore,
  setModuleSetting,
  withCompendiums,
  type CompendiumWorld,
  type FakePackOptions,
} from './testing.js';

let harness: AreaHarness | null = null;
let removeAdapter: (() => void) | null = null;
let store = memoryIndexStore();

beforeEach(() => {
  store = memoryIndexStore();
  creatureIndex.useStore(store);
});

afterEach(() => {
  harness?.close();
  harness = null;
  removeAdapter?.();
  removeAdapter = null;
  creatureIndex.useStore(null);
});

function open(
  packs: FakePackOptions[],
  settings: Record<string, unknown> = {},
  system = 'testsys'
) {
  const foundry = new FakeFoundry({
    system: { id: system, version: '1.0' },
    settings: Object.fromEntries(
      Object.entries(settings).map(([key, value]) => [`ninjos-foundry-mcp.${key}`, value])
    ),
    modules: [{ id: 'monster-module', version: '1' }],
  });
  const world: CompendiumWorld = withCompendiums(foundry, packs);
  harness = createAreaHarness({ foundry });
  return { h: harness, foundry, world };
}

const testAdapter: CompendiumAdapter = {
  id: 'testsys',
  title: 'Test System',
  handles: id => id.toLowerCase() === 'testsys',
  creatures: {
    version: 1,
    actorTypes: ['npc'],
    row: document => {
      const system = (document.toObject()['system'] ?? {}) as Record<string, unknown>;
      if (system['broken']) throw new Error('broken data');
      return {
        cr: Number(system['cr'] ?? 0),
        kind: String(system['kind'] ?? 'unknown'),
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
  search: {
    filters: [{ name: 'challengeRating', kind: 'numberOrRange', field: 'cr' }],
    indexFilters: ['challengeRating'],
    estimate: entry => (/ancient/i.test(entry.name ?? '') ? 2 : null),
  },
};

const monsters = (): FakePackOptions => ({
  id: 'monster-module.bestiary',
  label: 'Bestiary',
  type: 'Actor',
  entries: [
    {
      _id: 'm1',
      name: 'Ancient Dragon',
      type: 'npc',
      system: { cr: 20, kind: 'dragon', casts: true },
    },
    { _id: 'm2', name: 'Goblin', type: 'npc', system: { cr: 0.25, kind: 'humanoid' } },
    { _id: 'm3', name: 'Ogre', type: 'npc', system: { cr: 2, kind: 'giant' } },
    { _id: 'm4', name: 'Hero', type: 'character', system: { cr: 5 } },
    { _id: 'm5', name: 'Glitch', type: 'npc', system: { broken: true } },
  ],
});

describe('listCompendiums', () => {
  it('says honestly which compendiums are writable and why the others are not', async () => {
    const { h } = open(
      [
        { id: 'world.open', label: 'Open', type: 'Item' },
        { id: 'world.closed', label: 'Closed', type: 'Item', locked: true },
        { id: 'other.listed', label: 'Listed', type: 'Item', locked: true },
      ],
      { writableCompendiums: 'world.open,other' }
    );
    const result = (await h.query('listCompendiums')) as {
      compendiums: Array<Record<string, unknown>>;
      writeAccess: unknown;
    };
    const byId = Object.fromEntries(result.compendiums.map(pack => [pack['id'], pack]));
    expect(byId['world.open']).toMatchObject({
      writable: true,
      notWritableReason: null,
      onReleaseList: true,
    });
    expect(byId['world.closed']).toMatchObject({
      writable: false,
      notWritableReason: 'not on the release list',
    });
    expect(byId['other.listed']).toMatchObject({
      writable: true,
      locked: true,
      onReleaseList: true,
    });
    expect(result.writeAccess).toEqual({
      writeOperationsEnabled: true,
      level: 'write',
      releaseList: ['world.open', 'other'],
      releaseListProblem: null,
    });
  });

  it('marks nothing writable with the switch off or a damaged release list', async () => {
    const { h, foundry } = open([{ id: 'world.open', label: 'Open', type: 'Item' }], {
      allowWriteOperations: false,
    });
    let result = (await h.query('listCompendiums')) as {
      compendiums: Array<Record<string, unknown>>;
    };
    expect(result.compendiums[0]).toMatchObject({
      writable: false,
      notWritableReason: '"Allow Write Operations" is off',
    });

    await setModuleSetting(foundry, 'allowWriteOperations', true);
    await setModuleSetting(foundry, 'writableCompendiums', '[broken');
    result = (await h.query('listCompendiums')) as { compendiums: Array<Record<string, unknown>> };
    expect(result.compendiums[0]?.['notWritableReason']).toMatch(/release list could not be read/);
  });
});

describe('listCompendiumEntries and getAvailablePacks', () => {
  it('pages by name and says how to continue', async () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({
      _id: `e${i}`,
      name: `Entry ${5 - i}`,
      folder: i < 2 ? 'f1' : null,
    }));
    const { h } = open([
      {
        id: 'world.big',
        label: 'Big',
        type: 'JournalEntry',
        entries,
        folders: [{ _id: 'f1', name: 'Act 1' }],
      },
    ]);
    const first = (await h.query('listCompendiumEntries', {
      packId: 'world.big',
      limit: 2,
    })) as Record<string, unknown>;
    expect(first).toMatchObject({ total: 5, returned: 2, hasMore: true, nextOffset: 2 });
    expect(first['entries']).toEqual([
      { id: 'e4', name: 'Entry 1', type: 'JournalEntry', folder: null },
      { id: 'e3', name: 'Entry 2', type: 'JournalEntry', folder: null },
    ]);
    const folder = (await h.query('list-compendium-entries', {
      packId: 'world.big',
      folderName: 'act 1',
    })) as Record<string, unknown>;
    expect(folder).toMatchObject({ total: 2, folderFound: true, hasMore: false });
    const missing = (await h.query('listCompendiumEntries', {
      packId: 'world.big',
      folderName: 'Act 9',
    })) as Record<string, unknown>;
    expect(missing).toMatchObject({ total: 0, folderFound: false, folders: ['Act 1'] });
    await expect(
      h.query('listCompendiumEntries', { packId: 'world.big', limit: 5000 })
    ).rejects.toThrow('limit must be between 1 and 1000, got 5000');
  });

  it('lists packs as a bare list, filtered when a type is given', async () => {
    const { h } = open([monsters(), { id: 'world.notes', label: 'Notes', type: 'JournalEntry' }]);
    await expect(h.query('getAvailablePacks', { type: 'actor' })).resolves.toEqual([
      {
        id: 'monster-module.bestiary',
        label: 'Bestiary',
        type: 'Actor',
        system: null,
        private: false,
      },
    ]);
    await expect(h.query('getAvailablePacks')).resolves.toHaveLength(2);
  });
});

describe('searchCompendium', () => {
  it('collects every match before sorting, so a late exact match comes first', async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      _id: `g${i}`,
      name: `Goblin ${i}`,
      type: 'npc',
    }));
    const { h } = open([
      { id: 'a.first', label: 'First', type: 'Actor', entries: many },
      {
        id: 'z.last',
        label: 'Last',
        type: 'Actor',
        entries: [{ _id: 'exact', name: 'Goblin', type: 'npc' }],
      },
      {
        id: 'world.maps',
        label: 'Maps',
        type: 'Scene',
        entries: [{ _id: 's', name: 'Goblin Cave' }],
      },
    ]);
    const result = (await h.query('searchCompendium', {
      query: 'goblin',
      limit: 5,
      answerShape: 'report',
    })) as Record<string, unknown>;
    expect(result).toMatchObject({ totalFound: 121, showing: 5, hasMore: true, mode: 'name' });
    expect((result['results'] as Array<Record<string, unknown>>)[0]).toMatchObject({
      id: 'exact',
      pack: 'z.last',
      packLabel: 'Last',
    });
  });

  it('refuses a short or missing query instead of guessing one', async () => {
    const { h } = open([]);
    await expect(h.query('searchCompendium', { query: 'a' })).rejects.toThrow(
      /at least two characters/
    );
    await expect(h.query('searchCompendium', { packType: 'dragon' })).rejects.toThrow(
      /query is required/
    );
  });

  it('reports filters as ignored when the system has no adapter', async () => {
    const { h } = open([monsters()], {}, 'unknown-system');
    const result = (await h.query('searchCompendium', {
      query: 'dragon',
      filters: { challengeRating: 20 },
      answerShape: 'report',
    })) as Record<string, unknown>;
    expect(result['ignoredFilters']).toEqual([
      {
        name: 'challengeRating',
        reason: expect.stringContaining('The game system "unknown-system" has no adapter'),
      },
    ]);
    expect(result['totalFound']).toBe(1);
  });

  it('asks the creature index for actor searches with index filters, and estimates otherwise', async () => {
    removeAdapter = registerCompendiumAdapter(testAdapter);
    const { h } = open([monsters()]);
    const filters = { challengeRating: { min: 1, max: 30 } };
    const indexed = (await h.query('searchCompendium', {
      query: 'ogre',
      packType: 'Actor',
      filters,
      answerShape: 'report',
    })) as Record<string, unknown>;
    expect(indexed['mode']).toBe('creature-index');
    expect(
      (indexed['results'] as Array<Record<string, unknown>>).map(hit => hit['summary'])
    ).toEqual(['CR 2 giant from Bestiary']);
    const excluded = (await h.query('searchCompendium', {
      query: 'goblin',
      packType: 'Actor',
      filters,
      answerShape: 'report',
    })) as Record<string, unknown>;
    expect(excluded['totalFound']).toBe(0);

    const estimated = (await h.query('searchCompendium', {
      query: 'dr',
      filters: { challengeRating: 20 },
      answerShape: 'report',
    })) as Record<string, unknown>;
    expect(estimated['mode']).toBe('name-estimate');
    expect((estimated['results'] as unknown[]).length).toBe(1);
  });
});

describe('getCompendiumItem', () => {
  it('returns the full document or a compact version, and names a missing id', async () => {
    const { h } = open([
      {
        id: 'world.gear',
        label: 'Gear',
        type: 'Actor',
        entries: [
          {
            _id: 'k1',
            name: 'Knight',
            type: 'npc',
            system: { description: { value: '<p>A <b>brave</b> knight</p>' } },
            items: Array.from({ length: 7 }, (_, i) => ({
              _id: `i${i}`,
              name: `Item ${i}`,
              type: 'weapon',
            })),
            effects: [{ _id: 'fx', name: 'Blessed' }],
          },
        ],
      },
    ]);
    const full = (await h.query('getCompendiumItem', {
      packId: 'world.gear',
      itemId: 'k1',
    })) as Record<string, unknown>;
    expect(full).toMatchObject({
      mode: 'full',
      description: 'A brave knight',
      effects: [{ id: 'fx', name: 'Blessed', disabled: false }],
    });
    expect((full['items'] as unknown[]).length).toBe(7);
    const compact = (await h.query('getCompendiumItem', {
      packId: 'world.gear',
      itemId: 'k1',
      compact: true,
    })) as Record<string, unknown>;
    expect(compact).toMatchObject({ mode: 'compact', itemCount: 7, stats: null });
    expect(compact['fullData']).toBeUndefined();
    expect((compact['items'] as unknown[]).length).toBe(5);
    await expect(
      h.query('getCompendiumItem', { packId: 'world.gear', itemId: 'nope' })
    ).rejects.toThrow('Document nope not found in pack world.gear');
  });
});

/** The creature answer comes wrapped under `response`, as both server generations unwrap it. */
async function creaturesOf(h: AreaHarness, data: Record<string, unknown>) {
  const answer = (await h.query('listCreaturesByCriteria', data)) as {
    response: Record<string, unknown>;
  };
  return answer.response;
}

describe('listCreaturesByCriteria', () => {
  it('without an adapter refuses filters and lists names without them', async () => {
    const { h } = open([monsters()], {}, 'unknown-system');
    await expect(h.query('listCreaturesByCriteria', { challengeRating: 5 })).rejects.toMatchObject({
      moduleCode: 'NO_ADAPTER',
      message: expect.stringContaining('cannot be filtered by challengeRating'),
    });
    const result = await creaturesOf(h, {});
    expect(result).toMatchObject({ source: 'names', fallback: true, totalFound: 5, adapter: null });
  });

  it('filters the index generically, sorts by the adapter field and reports ignored filters', async () => {
    removeAdapter = registerCompendiumAdapter(testAdapter);
    const { h } = open([monsters()]);
    const result = await creaturesOf(h, {
      challengeRating: '{"max": 25}',
      level: 3,
    });
    expect(result).toMatchObject({
      source: 'creature-index',
      fallback: false,
      criteria: { challengeRating: { min: 0, max: 25 } },
      ignoredFilters: [
        { name: 'level', reason: '"level" is not a filter of the Test System adapter' },
      ],
      index: { rebuilt: true, failed: 1 },
    });
    expect(
      (result['creatures'] as Array<Record<string, unknown>>).map(creature => creature['summary'])
    ).toEqual([
      'CR 0.25 humanoid from Bestiary',
      'CR 2 giant from Bestiary',
      'CR 20 dragon from Bestiary',
    ]);
    const all = await creaturesOf(h, {});
    expect(
      (all['creatures'] as Array<Record<string, unknown>>).find(
        creature => creature['name'] === 'Glitch'
      )
    ).toMatchObject({
      summary: 'npc from Bestiary',
      valuesUnreadable: 'broken data',
    });
    await expect(h.query('listCreaturesByCriteria', { challengeRating: 'many' })).rejects.toThrow(
      /Parameter validation failed: challengeRating must be/
    );
  });

  it('keeps the index until something changes, and rebuilds after a change', async () => {
    removeAdapter = registerCompendiumAdapter(testAdapter);
    const { h, world } = open([monsters()]);
    const pack = world.get('monster-module.bestiary');
    await h.query('listCreaturesByCriteria', { creatureType: 'giant' });
    expect(pack.documentLoads).toBe(1);
    expect(store.saves).toBe(1);

    await h.query('listCreaturesByCriteria', { creatureType: 'giant' });
    expect(pack.documentLoads).toBe(1);

    await pack.create(
      [{ _id: 'm9', name: 'Troll', type: 'npc', system: { cr: 5, kind: 'giant' } }],
      { keepId: true }
    );
    const after = await creaturesOf(h, { creatureType: 'giant' });
    expect(pack.documentLoads).toBe(2);
    expect(after['totalFound']).toBe(2);

    creatureIndex.invalidate();
    await h.query('listCreaturesByCriteria', {});
    expect(pack.documentLoads).toBe(3);
  });

  it('uses a stored index of a fresh start instead of building, and reports a store that fails', async () => {
    removeAdapter = registerCompendiumAdapter(testAdapter);
    const { h, world } = open([monsters()]);
    await h.query('listCreaturesByCriteria', {});
    creatureIndex.useStore(store);
    const pack = world.get('monster-module.bestiary');
    const loads = pack.documentLoads;
    await h.query('listCreaturesByCriteria', {});
    expect(pack.documentLoads).toBe(loads);

    creatureIndex.invalidate();
    store.failSave = 'no space';
    const result = await creaturesOf(h, {});
    expect(result['index']).toMatchObject({
      problem: expect.stringContaining('could not be stored at memory: no space'),
    });
  });

  it('falls back to an estimate from names when the index is switched off', async () => {
    removeAdapter = registerCompendiumAdapter(testAdapter);
    const { h } = open([monsters()], { enableEnhancedCreatureIndex: false });
    const result = await creaturesOf(h, {
      challengeRating: 20,
      hasSpells: true,
    });
    expect(result).toMatchObject({ source: 'name-estimate', fallback: true, totalFound: 1 });
    expect(result['fallbackReason']).toMatch(/switched off/);
  });
});

describe('release window logic', () => {
  it('groups world, modules by title and the system, and ticks by id or package', async () => {
    const { foundry } = open(
      [
        { id: 'dnd5e.spells', label: 'Spells', type: 'Item', packageType: 'system' },
        { id: 'monster-module.b', label: 'B pack', type: 'Actor' },
        { id: 'monster-module.a', label: 'A pack', type: 'Actor' },
        { id: 'world.archive', label: 'Archive', type: 'JournalEntry' },
      ],
      { writableCompendiums: 'monster-module' }
    );
    const model = releaseWindowModel();
    expect(model.allowAllUnlocked).toBe(false);
    expect(
      model.groups.map(group => [
        group.kind,
        group.packageName,
        group.packs.map(pack => `${pack.label}:${pack.checked}`),
      ])
    ).toEqual([
      ['world', 'world', ['Archive:false']],
      ['module', 'monster-module', ['A pack:true', 'B pack:true']],
      ['system', 'dnd5e', ['Spells:false']],
    ]);

    await expect(saveReleaseList(['world.archive', 'monster-module.a'])).resolves.toEqual({
      entries: ['world.archive', 'monster-module.a'],
      allowAllUnlocked: false,
    });
    expect(getModuleSetting(foundry, 'writableCompendiums')).toBe(
      'world.archive, monster-module.a'
    );
    await expect(saveReleaseList([])).resolves.toEqual({ entries: [], allowAllUnlocked: true });
  });
});
