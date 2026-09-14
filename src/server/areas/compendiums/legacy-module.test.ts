/**
 * The new server with a module of the previous generation.
 *
 * The fake old module answers with the shapes described for
 * the previous generation: `compendiums`, bare
 * lists, `response`, counts, names, `pack` as text, a refusal as
 * `{ error, success: false }`, and no handler for queries it does not know.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ModuleArea } from '../../../module/areas.js';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';

type Rec = Record<string, unknown>;
type Answer = (data: Rec) => unknown;

let harness: AreaHarness | null = null;
afterEach(() => {
  harness?.close();
  harness = null;
});

const textOf = (result: { content: Array<{ type: string; text?: string }> }) =>
  result.content[0]?.text ?? '';

const knight = {
  id: 'k1',
  name: 'Knight',
  type: 'npc',
  pack: 'world.gear',
  packLabel: 'Gear',
  img: null,
  system: { hp: 5 },
  items: Array.from({ length: 7 }, (_, i) => ({ _id: `i${i}`, name: `Item ${i}`, type: 'weapon' })),
  effects: [{ name: 'Blessed' }],
  fullData: { _id: 'k1', name: 'Knight' },
};

/** What the old module answers per query, following the documented contracts. */
function oldAnswers(): Record<string, Answer> {
  return {
    listCompendiums: () => ({
      compendiums: [
        {
          id: 'world.open',
          label: 'Open',
          type: 'Item',
          writable: true,
          locked: false,
          entries: 3,
          packageType: 'world',
          packageName: 'world',
        },
        {
          id: 'mod.closed',
          label: 'Closed',
          type: 'Actor',
          writable: false,
          locked: true,
          entries: 10,
          packageType: 'module',
          packageName: 'mod',
        },
      ],
      total: 2,
    }),
    getAvailablePacks: () => [
      { id: 'mod.beasts', label: 'Beasts', type: 'Actor', system: 'dnd5e', private: false },
      { id: 'world.notes', label: 'Notes', type: 'JournalEntry', system: null, private: true },
    ],
    listCompendiumEntries: () => ({
      label: 'Archive',
      documentType: 'JournalEntry',
      packageType: 'world',
      locked: true,
      total: 3,
      returned: 2,
      offset: 0,
      hasMore: true,
      entries: [
        { name: 'A', type: 'base', folder: 'Act 1', id: 'a' },
        { name: 'B', type: 'base', folder: null, id: 'b' },
      ],
    }),
    searchCompendium: () =>
      Array.from({ length: 60 }, (_, i) => ({
        id: `g${i}`,
        name: `Goblin ${i}`,
        type: 'npc',
        pack: 'mod.beasts',
        packLabel: 'Beasts',
        img: null,
        system: {},
      })),
    getCompendiumDocumentFull: () => knight,
    listCreaturesByCriteria: () => ({
      response: {
        creatures: [
          { name: 'Ogre', id: 'o1', pack: 'mod.beasts', packLabel: 'Beasts', system: {} },
        ],
        searchSummary: { totalFound: 1 },
      },
    }),
    createCompendium: () => ({ label: 'Act 1', type: 'JournalEntry', id: 'world.act-1' }),
    exportToCompendium: () => ({
      pack: 'world.archive',
      exported: ['Chapter 1'],
      replaced: ['Chapter 2'],
      skipped: [],
      lost: ['Harbour'],
    }),
    importFromCompendium: () => ({
      type: 'JournalEntry',
      name: 'Tavern',
      pack: 'my-module.presets',
      id: 'new1',
    }),
    organizeCompendium: () => ({
      pack: 'world.archive',
      folder: 'Monsters',
      moved: ['Goblin', 'Orc'],
    }),
    setCompendiumLock: () => ({ pack: 'world.archive', locked: false }),
    deleteCompendiumEntries: data =>
      data['dryRun'] === true
        ? {
            dryRun: true,
            label: 'Archive',
            wouldDelete: 1,
            totalInPack: 4,
            entries: [{ name: 'Wald', id: 'w1' }],
            notFound: ['Moor'],
            ambiguous: [{ name: 'Dup', ids: ['d1', 'd2'] }],
          }
        : {
            dryRun: false,
            label: 'Archive',
            deleted: 1,
            totalInPack: 3,
            entries: [{ name: 'Wald', id: 'w1' }],
            notFound: [],
            ambiguous: [],
          },
    deleteCompendium: () => ({ label: 'Archive', entries: 12 }),
  };
}

interface OldModule {
  area: ModuleArea;
  /** The data each query arrived with, by query name. */
  seen: Record<string, Rec>;
  /** Answer every query with the refusal of a user who is not Gamemaster. */
  denied: boolean;
}

function oldModule(answers: Record<string, Answer> = oldAnswers()): OldModule {
  const state: OldModule = {
    area: { id: 'previous-generation' },
    seen: {},
    denied: false,
  };
  state.area = {
    id: 'previous-generation',
    queries: Object.entries(answers).map(([name, answer]) => ({
      names: name,
      handler: {
        access: { kind: 'read' },
        run: (data: unknown) => {
          const input = (data ?? {}) as Rec;
          state.seen[name] = input;
          return state.denied ? { error: 'Access denied', success: false } : answer(input);
        },
      },
    })),
  };
  return state;
}

function open(old = oldModule()) {
  harness = createAreaHarness({ moduleAreas: [old.area] });
  return { h: harness, old };
}

describe('lists and entries from a module of the previous generation', () => {
  it('formats list-compendiums from compendiums with writable and entries', async () => {
    const { h } = open();
    expect(textOf(await h.call('list-compendiums'))).toBe(
      [
        'Unlocked, so editable (1):',
        '- Open [world.open] Item, 3 entries (world)',
        'Locked (1), unlock before editing:',
        '- Closed [mod.closed] Actor, 10 entries (module mod)',
      ].join('\n')
    );
  });

  it('filters the bare pack list itself and names every available type', async () => {
    const { h, old } = open();
    const result = JSON.parse(textOf(await h.call('list-compendium-packs', { type: 'actor' })));
    expect(old.seen['getAvailablePacks']).toEqual({});
    expect(result).toEqual({
      packs: [
        { id: 'mod.beasts', label: 'Beasts', type: 'Actor', system: 'dnd5e', private: false },
      ],
      total: 1,
      filter: 'actor',
      availableTypes: ['Actor', 'JournalEntry'],
    });
  });

  it('formats list-compendium-entries from documentType and the pack id of the call', async () => {
    const { h } = open();
    const text = textOf(
      await h.call('list-compendium-entries', { packId: 'world.archive', limit: 2 })
    );
    expect(text).toContain('Archive [world.archive] (JournalEntry, world, locked): 3 entries.');
    expect(text).toContain('- A [a] (base) in "Act 1"');
    expect(text).toContain(
      'MORE ENTRIES FOLLOW: 1 are not shown. Call list-compendium-entries again with offset 2'
    );
  });
});

describe('search, entry and creatures from a module of the previous generation', () => {
  it('cuts a bare search list to the limit and says so first', async () => {
    const { h, old } = open();
    const result = JSON.parse(textOf(await h.call('search-compendium', { query: 'goblin' })));
    expect(old.seen['searchCompendium']).toMatchObject({ query: 'goblin', answerShape: 'report' });
    expect(result).toMatchObject({ totalFound: 60, showing: 50, hasMore: true });
    expect(result.results).toHaveLength(50);
    expect(result.warnings[0]).toMatch(/previous generation/);
    expect(result.warnings[1]).toBe(
      'Only 50 of 60 matches are shown; narrow the search or raise limit.'
    );
  });

  it('falls back to getCompendiumDocumentFull with documentId and builds full and compact itself', async () => {
    const { h, old } = open();
    const full = JSON.parse(
      textOf(await h.call('get-compendium-item', { packId: 'world.gear', itemId: 'k1' }))
    );
    expect(old.seen['getCompendiumDocumentFull']).toEqual({
      packId: 'world.gear',
      documentId: 'k1',
      itemId: 'k1',
    });
    expect(full).toMatchObject({
      mode: 'full',
      name: 'Knight',
      pack: { id: 'world.gear', label: 'Gear' },
      system: { hp: 5 },
      fullData: { _id: 'k1' },
    });
    const compact = JSON.parse(
      textOf(
        await h.call('get-compendium-item', { packId: 'world.gear', itemId: 'k1', compact: true })
      )
    );
    expect(compact).toMatchObject({ mode: 'compact', itemCount: 7, effectCount: 1 });
    expect(compact.items).toHaveLength(5);
    expect(compact.fullData).toBeUndefined();
  });

  it('unwraps creatures under response, and takes a bare list as the creatures', async () => {
    const { h } = open();
    const wrapped = JSON.parse(textOf(await h.call('list-creatures-by-criteria', {})));
    expect(wrapped).toEqual({
      creatures: [{ name: 'Ogre', id: 'o1', pack: 'mod.beasts', packLabel: 'Beasts', system: {} }],
      searchSummary: { totalFound: 1 },
    });
    harness?.close();

    const bare = oldModule({ ...oldAnswers(), listCreaturesByCriteria: () => [{ name: 'Troll' }] });
    const second = open(bare).h;
    expect(JSON.parse(textOf(await second.call('list-creatures-by-criteria', {})))).toEqual({
      creatures: [{ name: 'Troll' }],
      totalFound: 1,
      showing: 1,
    });
  });
});

describe('create, export, import, organize and lock from a module of the previous generation', () => {
  it('formats the answers with pack as text and lists of names', async () => {
    const { h } = open();
    expect(
      textOf(await h.call('create-compendium', { label: 'Act 1', type: 'JournalEntry' }))
    ).toBe('Compendium "Act 1" created (JournalEntry).\nId: world.act-1');

    const exported = textOf(
      await h.call('export-to-compendium', {
        packId: 'world.archive',
        documentType: 'JournalEntry',
      })
    );
    expect(exported).toContain('Saved into "world.archive": 2 JournalEntry documents.');
    expect(exported).toContain('CAUTION: 1 entries are LOST from the compendium');
    expect(exported).toContain('\n- Harbour\n');
    expect(exported).toContain('Newly created (1):\n- Chapter 1');
    expect(exported).toContain('Overwrote the existing version (1):\n- Chapter 2');

    expect(
      textOf(
        await h.call('import-from-compendium', { packId: 'my-module.presets', entryName: 'Tavern' })
      )
    ).toBe('JournalEntry "Tavern" imported from my-module.presets.\nNew id: new1');

    expect(
      textOf(
        await h.call('organize-compendium', {
          packId: 'world.archive',
          folderName: 'Monsters',
          entryNames: ['Goblin', 'Orc'],
        })
      )
    ).toBe('Moved in "world.archive" to "Monsters": 2 entries\n- Goblin\n- Orc');

    expect(
      textOf(await h.call('set-compendium-lock', { packId: 'world.archive', locked: false }))
    ).toBe('"world.archive" is now unlocked.');
  });
});

describe('deleting with a module of the previous generation', () => {
  it('formats counts, entries, the flat notFound list and ambiguous names', async () => {
    const { h } = open();
    const dry = textOf(
      await h.call('delete-compendium-entries', {
        packId: 'world.archive',
        names: ['Wald', 'Dup', 'Moor'],
        dryRun: true,
      })
    );
    expect(dry).toContain(
      'Dry run for "Archive" [world.archive]: 1 of 4 entries would be removed. Nothing was changed.\n- Wald [w1]'
    );
    expect(dry).toContain('NOT FOUND (1): "Moor"');
    expect(dry).toContain(
      'AMBIGUOUS, left untouched (1); pass one of the ids instead:\n- "Dup": d1, d2'
    );

    const done = textOf(
      await h.call('delete-compendium-entries', { packId: 'world.archive', ids: ['w1'] })
    );
    expect(done).toBe('Removed from "Archive" [world.archive]: 1 entries. 3 remain.\n- Wald [w1]');

    expect(
      textOf(
        await h.call('delete-compendium', { packId: 'world.archive', confirmLabel: 'Archive' })
      )
    ).toBe('Compendium "Archive" deleted, with 12 entries.');
  });
});

describe('failures of a module of the previous generation', () => {
  const calls: Array<[string, Rec]> = [
    ['list-compendiums', {}],
    ['list-compendium-packs', {}],
    ['list-compendium-entries', { packId: 'world.archive' }],
    ['search-compendium', { query: 'goblin' }],
    ['get-compendium-item', { packId: 'world.gear', itemId: 'k1' }],
    ['list-creatures-by-criteria', {}],
    ['create-compendium', { label: 'Act 1', type: 'Item' }],
    ['export-to-compendium', { packId: 'world.archive', documentType: 'JournalEntry' }],
    ['import-from-compendium', { packId: 'world.archive', entryName: 'A' }],
    ['organize-compendium', { packId: 'world.archive', folderName: 'F', entryNames: ['A'] }],
    ['set-compendium-lock', { packId: 'world.archive', locked: true }],
    ['delete-compendium-entries', { packId: 'world.archive', ids: ['a'] }],
    ['delete-compendium', { packId: 'world.archive', confirmLabel: 'Archive' }],
  ];

  it('turns "Access denied" returned as a normal value into a tool error for every tool', async () => {
    const { h, old } = open();
    old.denied = true;
    expect(calls).toHaveLength(13);
    for (const [tool, args] of calls) {
      const result = await h.call(tool, args);
      expect(result.isError, tool).toBe(true);
      expect(textOf(result), tool).toContain('Access denied');
    }
  });

  it('reports a query the old module does not know as a tool error with the cause', async () => {
    const answers = oldAnswers();
    delete answers['setCompendiumLock'];
    const { h } = open(oldModule(answers));
    const result = await h.call('set-compendium-lock', { packId: 'world.archive', locked: true });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('No handler found for query: setCompendiumLock');
  });
});
