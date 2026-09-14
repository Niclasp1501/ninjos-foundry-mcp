/**
 * The compendium tools from the registry to the module handlers and back:
 * names and schemas as in the tool directory, and the texts the model reads.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  withCompendiums,
  type FakePackOptions,
} from '../../../module/areas/compendiums/testing.js';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { FakeFoundry } from '../../../testing/fake-foundry.js';
import { readToolDirectory } from '../../../testing/tool-directory.js';
import { SERVER_AREAS } from '../index.js';
import { formatExport, lockLines } from './format.js';
import { COMPENDIUM_TOOLS } from './tools.js';

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
  const world = withCompendiums(foundry, packs);
  harness = createAreaHarness({ foundry });
  return { h: harness, foundry, world };
}

const textOf = (result: { content: Array<{ type: string; text?: string }> }) =>
  result.content[0]?.text ?? '';

/** The schema without descriptions and defaults: what a caller relies on. */
function shape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shape);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'description' && key !== 'default')
      .map(([key, item]) => [key, shape(item)])
  );
}

type Shape = Record<string, any>;

/**
 * Filters added to two tools, so the filters of every adapter reach the
 * module. Each is optional, so a call that fits the tool directory still fits.
 */
const FURTHER = [
  'species',
  'culture',
  'profession',
  'experiencePoints',
  'hasLiturgies',
  'hasPrayers',
  'hits',
  'minHits',
  'hasPsionics',
];
const ADDED: Record<string, { top?: string[]; filters?: string[] }> = {
  'list-creatures-by-criteria': { top: ['alignment', ...FURTHER] },
  'search-compendium': {
    filters: [
      'tier',
      'role',
      'hasInvestiture',
      'hitPoints',
      'defensesMin',
      'deflectMin',
      ...FURTHER,
    ],
  },
};

/**
 * The schema as a caller of the previous generation relies on it: the added optional
 * parameters taken out, and an enum that was widened (or, for free creature
 * types, dropped) put back to the described values once it is shown to
 * accept every one of them.
 */
function asDescribed(actual: Shape, described: Shape, name: string): Shape {
  const copy: Shape = structuredClone(actual);
  const added = ADDED[name] ?? {};
  for (const key of added.top ?? []) {
    expect(copy['properties'][key], `${name}.${key}`).toBeDefined();
    expect(copy['required'] ?? [], name).not.toContain(key);
    delete copy['properties'][key];
  }
  for (const key of added.filters ?? []) {
    expect(
      copy['properties']['filters']['properties'][key],
      `${name}.filters.${key}`
    ).toBeDefined();
    delete copy['properties']['filters']['properties'][key];
  }
  const relax = (now: Shape | undefined, then: Shape | undefined) => {
    if (!now || !then || typeof now !== 'object' || typeof then !== 'object') return;
    if (Array.isArray(then['enum'])) {
      if (Array.isArray(now['enum']))
        expect(now['enum']).toEqual(expect.arrayContaining(then['enum']));
      else expect(now['type']).toBe(then['type']);
      now['enum'] = then['enum'];
    }
    for (const key of Object.keys(then['properties'] ?? {}))
      relax(now['properties']?.[key], then['properties'][key]);
  };
  relax(copy, described);
  return copy;
}

describe('compendium tools', () => {
  it('offers every tool with the names, parameters, types and enums of the tool directory', () => {
    const catalogue = readToolDirectory();
    for (const tool of COMPENDIUM_TOOLS) {
      const described = catalogue.find(entry => entry.name === tool.name);
      expect(described, tool.name).toBeDefined();
      const expected = shape(described?.inputSchema) as Shape;
      expect(asDescribed(shape(tool.inputSchema) as Shape, expected, tool.name), tool.name).toEqual(
        expected
      );
      expect(tool.description, tool.name).not.toMatch(/[–—]/);
    }
    expect(SERVER_AREAS.find(area => area.id === 'compendiums')?.tools).toHaveLength(13);
  });

  it('lists compendiums in blocks that say what can be written', async () => {
    const { h } = open(
      [
        { id: 'world.open', label: 'Open', type: 'Item', entries: [{ _id: 'a', name: 'A' }] },
        { id: 'world.closed', label: 'Closed', type: 'Item', locked: true },
      ],
      {}
    );
    const text = textOf(await h.call('list-compendiums'));
    expect(text).toContain('The release list is empty: every unlocked compendium can be written.');
    expect(text).toContain('Editable (1):\n- Open [world.open] Item, 1 entries (world)');
    expect(text).toContain(
      'Locked (1), unlock before editing (set-compendium-lock, or unlockIfNeeded for one operation):'
    );
  });

  it('puts the next page into the text of list-compendium-entries', async () => {
    const entries = Array.from({ length: 3 }, (_, i) => ({ _id: `e${i}`, name: `Entry ${i}` }));
    const { h } = open([{ id: 'world.big', label: 'Big', type: 'JournalEntry', entries }]);
    const text = textOf(await h.call('list-compendium-entries', { packId: 'world.big', limit: 2 }));
    expect(text).toContain('Big [world.big] (JournalEntry, world): 3 entries.');
    expect(text).toContain('- Entry 0 [e0]');
    expect(text).toContain(
      'MORE ENTRIES FOLLOW: 1 are not shown. Call list-compendium-entries again with offset 2'
    );
  });

  it('writes not found and ambiguous names into the text of a dry run', async () => {
    const { h, world } = open(
      [
        {
          id: 'world.archive',
          label: 'Archive',
          type: 'JournalEntry',
          entries: [
            { _id: 'w1', name: 'Wald' },
            { _id: 'd1', name: 'Dup' },
            { _id: 'd2', name: 'Dup' },
          ],
        },
      ],
      { permCompendiums: 'full' }
    );
    const text = textOf(
      await h.call('delete-compendium-entries', {
        packId: 'world.archive',
        names: ['Wald', 'Dup', 'Moor'],
        dryRun: true,
      })
    );
    expect(text).toContain(
      'Dry run for "Archive" [world.archive]: 1 of 3 entries would be removed. Nothing was changed.'
    );
    expect(text).toContain('NOT FOUND, names (1): "Moor"');
    expect(text).toContain(
      'AMBIGUOUS, left untouched (1); pass one of the ids instead:\n- "Dup": d1, d2'
    );
    expect(world.get('world.archive').docs.size).toBe(3);
  });

  it('turns a refusal into a tool error with its cause', async () => {
    const { h } = open([
      {
        id: 'world.archive',
        label: 'Archive',
        type: 'JournalEntry',
        entries: [{ _id: 'a', name: 'A' }],
      },
    ]);
    const result = await h.call('delete-compendium', {
      packId: 'world.archive',
      confirmLabel: 'Archive',
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(
      /Deleting compendiums is not permitted.*"create, change and delete"/
    );
  });

  it('puts ignored filters first in a JSON answer', async () => {
    const { h } = open([
      {
        id: 'm.b',
        label: 'B',
        type: 'Actor',
        entries: [{ _id: 'a', name: 'Ancient Dragon', type: 'npc' }],
      },
    ]);
    const result = JSON.parse(
      textOf(await h.call('search-compendium', { query: 'dragon', filters: { level: 3 } }))
    );
    expect(Object.keys(result)[0]).toBe('warnings');
    // The compendium tools read the dnd5e adapter of the core registry, so the filter is unknown to it, not the adapter missing.
    expect(result.warnings[0]).toMatch(
      /Filter "level" was IGNORED: "level" is not a search filter of the Dungeons & Dragons Fifth Edition adapter/
    );
  });

  it('asks a module of the previous generation for the full document when it lacks getCompendiumItem', async () => {
    const foundry = new FakeFoundry();
    harness = createAreaHarness({
      foundry,
      moduleAreas: [
        {
          id: 'legacy',
          queries: [
            {
              names: 'getCompendiumDocumentFull',
              handler: { access: { kind: 'read' }, run: data => ({ legacy: true, data }) },
            },
          ],
        },
      ],
    });
    const result = JSON.parse(
      textOf(await harness.call('get-compendium-item', { packId: 'p.x', itemId: 'i1' }))
    );
    expect(result).toEqual({
      legacy: true,
      data: { packId: 'p.x', documentId: 'i1', itemId: 'i1' },
    });
  });
});

describe('texts', () => {
  it('never lists a lost entry among the skipped ones', () => {
    const text = formatExport({
      packId: 'world.maps',
      label: 'Maps',
      documentType: 'Scene',
      selected: 2,
      exported: [],
      replaced: [{ id: 's1', name: 'Keep' }],
      skipped: [],
      lost: [{ id: 's2', name: 'Harbour', reason: 'writing failed' }],
      notFound: [],
      notes: [],
      lock: { wasLocked: false, lifted: false, restored: null, problem: null },
    }) as string;
    expect(text).toMatch(
      /^Saved into "Maps" \[world\.maps\]: 1 of 2 Scene documents\.\nCAUTION: 1 entries are LOST/
    );
    expect(text).toContain('- Harbour [s2]: writing failed');
    expect(text).not.toContain('Skipped');
  });

  it('warns about a lock that could not be set again', () => {
    expect(
      lockLines({ lifted: true, restored: false, problem: 'disk full' }, 'world.a')[0]
    ).toMatch(/^CAUTION: the lock of "world\.a" .* could NOT be set again \(disk full\)/);
    expect(lockLines({ lifted: false }, 'world.a')).toEqual([]);
  });

  it('passes an answer of unknown shape on unchanged', () => {
    const odd = { something: 'else' };
    expect(formatExport(odd)).toBe(odd);
  });
});
