/**
 * The compendiums area reads the adapters of the core registry, with the
 * filter kind partialText, and without a second interface in the system
 * packages.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SystemAdapter } from '../../../common/game-systems.js';
import { moduleSystemAdapters } from '../../game-systems.js';
import { activeCompendiumAdapter, compendiumAdapterFor } from './adapter.js';
import { matchesFilter, readFilters } from './filters.js';

const removers: Array<() => void> = [];
afterEach(() => {
  for (const remove of removers.splice(0)) remove();
  (globalThis as { game?: unknown }).game = undefined;
});

const coreAdapter: SystemAdapter = {
  id: 'coresys',
  title: 'Core System',
  creatures: {
    indexVersion: 3,
    actorTypes: ['npc'],
    row: document => ({ alignment: (document['system'] as Record<string, unknown>)['alignment'] }),
    power: { name: 'Level', field: 'level', range: null },
    filters: [{ name: 'alignment', kind: 'partialText', field: 'alignment' }],
    listFields: row => ({ alignment: row['alignment'] }),
    summary: row => `${row.name} from ${row.packLabel}`,
  },
  compendiumStats: {
    indexFields: ['system.alignment'],
    actorStats: entry => ({ alignment: entry['system.alignment'] ?? null }),
    searchFilters: [{ name: 'spellcaster', kind: 'boolean', field: 'hasSpells' }],
  },
};

describe('the view of the compendiums area on a core adapter', () => {
  it('keeps id, version, actor types, filters and sort field, and reads rows from plain data', () => {
    const view = compendiumAdapterFor(coreAdapter);
    expect(view).toMatchObject({ id: 'coresys', title: 'Core System' });
    expect(view.creatures).toMatchObject({ version: 3, actorTypes: ['npc'], sortField: 'level' });
    expect(
      view.creatures?.row({ toObject: () => ({ system: { alignment: 'Chaotic Evil' } }) } as never)
    ).toEqual({ alignment: 'Chaotic Evil' });
    expect(view.search?.filters.map(filter => filter.name)).toEqual(['alignment', 'spellcaster']);
    expect(view.search?.indexFilters).toEqual(['alignment', 'spellcaster']);
    expect(view.search?.estimate?.({ _id: 'a', name: 'A' }, {})).toBe(1);
    expect(view.item?.stats?.({ type: 'npc', 'system.alignment': 'good' })).toEqual({
      alignment: 'good',
    });
    expect(view.item?.stats?.({ type: 'character' })).toBeNull();
    expect(compendiumAdapterFor(coreAdapter)).toBe(view);
  });

  it('is what the active system gets when no view is registered by hand', () => {
    removers.push(moduleSystemAdapters.register(coreAdapter, 'test'));
    (globalThis as { game?: unknown }).game = { system: { id: 'CoreSys', version: '1' } };
    expect(activeCompendiumAdapter()?.id).toBe('coresys');
    (globalThis as { game?: unknown }).game = { system: { id: 'elsewhere', version: '1' } };
    expect(activeCompendiumAdapter()).toBeNull();
  });
});

describe('partialText', () => {
  it('finds a part of the text ignoring case, and still refuses an empty text', () => {
    const specs = coreAdapter.creatures?.filters ?? [];
    const reading = readFilters(specs, { alignment: 'EVIL' }, name => name);
    expect(reading.problems).toEqual([]);
    const filter = reading.active[0];
    expect(filter && matchesFilter(filter, { alignment: 'chaotic evil' })).toBe(true);
    expect(filter && matchesFilter(filter, { alignment: 'lawful good' })).toBe(false);
    expect(readFilters(specs, { alignment: ' ' }, name => name).problems).toEqual([
      'alignment must be a non-empty text, got " "',
    ]);
  });
});
