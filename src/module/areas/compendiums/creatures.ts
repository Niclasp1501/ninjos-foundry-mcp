/**
 * list-creatures-by-criteria and the raw creature index.
 *
 * Three ways, and the answer always says which one ran:
 * - `creature-index`: the adapter's index, filtered generically
 * - `name-estimate`: the index is switched off or failed; the adapter scores
 *   names instead, and the answer is marked as a fallback
 * - `names`: no adapter for this system. Without filters every actor of the
 *   actor compendiums is listed by name; with filters the call is refused with
 *   the filters named, because an unfiltered list would pretend they applied
 */
import { byName } from '../../../common/areas/compendiums/names.js';
import { CREATURE_LIMIT } from '../../../common/areas/compendiums/shapes.js';
import { QueryError, type HandlerContext, type QueryHandler } from '../../dispatcher.js';
import { requireWorld } from '../../world-ready.js';
import {
  activeCompendiumAdapter,
  activeSystemId,
  noAdapterText,
  type CompendiumAdapter,
  type CreatureRow,
} from './adapter.js';
import { asData, integerInRange, messageOf } from './args.js';
import { creatureIndex, indexEnabled } from './creature-index.js';
import {
  describeFilters,
  matchesAll,
  readFilters,
  type ActiveFilter,
  type IgnoredFilter,
} from './filters.js';
import { allPacks, packLabel, readIndex } from './packs.js';

const NOT_FILTERS = new Set(['limit']);
const NOTE =
  'Choose by name first, then fetch details with get-compendium-item only for the final selection.';

function toNumber(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : Number.NEGATIVE_INFINITY;
}

/** One creature of the result. A row whose values could not be read says so instead of showing defaults. */
function creatureEntry(
  row: CreatureRow,
  creatures: NonNullable<CompendiumAdapter['creatures']>
): Record<string, unknown> {
  const base = {
    id: row.id,
    name: row.name,
    type: row.type,
    pack: row.packId,
    packLabel: row.packLabel,
    hasImage: !!row.img,
  };
  if (typeof row['indexError'] === 'string')
    return {
      ...base,
      system: {},
      summary: `${row.type || 'Actor'} from ${row.packLabel}`,
      valuesUnreadable: row['indexError'],
    };
  const fields = creatures.listFields(row);
  return { ...base, ...fields, system: { ...fields }, summary: creatures.summary(row) };
}

/**
 * Wrapped under `response` with `creatures` and `searchSummary`, the form a
 * server of the previous generation unwraps. A server of this generation
 * unwraps it the same way, so there is only one answer.
 */
function wrapped(result: Record<string, unknown> & { creatures: unknown[] }): {
  response: Record<string, unknown>;
} {
  return {
    response: {
      ...result,
      searchSummary: {
        totalFound: result['totalFound'],
        showing: result['showing'],
        hasMore: result['hasMore'],
        source: result['source'],
        criteria: result['criteria'],
        packsSearched: result['packsSearched'],
      },
    },
  };
}

interface ListOutcome {
  creatures: Record<string, unknown>[];
  totalFound: number;
  packsSearched: Array<{ id: string; label: string; count: number }>;
}

async function listByNames(
  limit: number,
  adapter: CompendiumAdapter | null,
  active: readonly ActiveFilter[],
  context: HandlerContext
): Promise<ListOutcome> {
  const packs = allPacks().filter(pack => pack.documentName === 'Actor');
  const types = adapter?.creatures?.actorTypes;
  const filterValues = describeFilters(active);
  const found: Array<Record<string, unknown> & { name: string; score: number }> = [];
  const packsSearched: ListOutcome['packsSearched'] = [];

  for (const [position, pack] of packs.entries()) {
    const entries = await readIndex(pack, adapter?.search?.indexFields ?? []);
    packsSearched.push({ id: pack.collection, label: packLabel(pack), count: entries.length });
    for (const entry of entries) {
      if (types && !types.includes(entry.type ?? '')) continue;
      let score = 0;
      if (active.length && adapter?.search?.estimate) {
        const estimate = adapter.search.estimate(entry, filterValues);
        if (estimate === null) continue;
        score = estimate;
      }
      found.push({
        id: entry._id,
        name: entry.name ?? '',
        type: entry.type ?? '',
        pack: pack.collection,
        packLabel: packLabel(pack),
        system: {},
        hasImage: !!entry.img,
        summary: `${entry.type || 'Actor'} from ${packLabel(pack)}`,
        score,
      });
    }
    context.progress({
      progress: position + 1,
      total: packs.length,
      message: 'Reading actor compendiums',
    });
  }
  found.sort((a, b) => b.score - a.score || byName(a, b));
  return {
    creatures: found.slice(0, limit).map(({ score: _score, ...creature }) => creature),
    totalFound: found.length,
    packsSearched,
  };
}

export const listCreaturesByCriteria: QueryHandler = {
  access: { kind: 'read' },
  run: async (data, context) => {
    requireWorld();
    const input = asData(data);
    const limit = integerInRange(input, 'limit', {
      min: 1,
      max: CREATURE_LIMIT.max,
      fallback: CREATURE_LIMIT.fallback,
    });
    const given = Object.fromEntries(
      Object.entries(input).filter(
        ([key, value]) => !NOT_FILTERS.has(key) && value !== undefined && value !== null
      )
    );
    const adapter = activeCompendiumAdapter();
    const creatures = adapter?.creatures;
    const base = { system: activeSystemId(), adapter: adapter?.title ?? null, note: NOTE };

    if (!adapter || !creatures) {
      const names = Object.keys(given);
      const why = adapter
        ? `The ${adapter.title} adapter builds no creature index`
        : noAdapterText();
      if (names.length) {
        throw new QueryError(
          'NO_ADAPTER',
          `${why}, so creatures cannot be filtered by ${names.join(', ')}. Nothing was searched. ` +
            'Call list-creatures-by-criteria without filters to list every actor of the actor compendiums by name, ' +
            'or use search-compendium with packType "Actor" to search names.'
        );
      }
      const outcome = await listByNames(limit, adapter, [], context);
      return wrapped({
        ...base,
        source: 'names',
        fallback: true,
        fallbackReason: `${why}: only names and actor types are listed, without any values.`,
        criteria: {},
        ignoredFilters: [],
        ...outcome,
        showing: outcome.creatures.length,
        hasMore: outcome.totalFound > outcome.creatures.length,
      });
    }

    const reading = readFilters(
      creatures.filters,
      given,
      name => `"${name}" is not a filter of the ${adapter.title} adapter`
    );
    if (reading.problems.length) {
      throw new QueryError(
        'INVALID_ARGUMENT',
        `Parameter validation failed: ${reading.problems.join('; ')}. Received: ${JSON.stringify(given)}`
      );
    }
    const ignored: IgnoredFilter[] = [...reading.ignored];
    const active = reading.active;

    let fallbackReason: string | null = indexEnabled()
      ? null
      : 'The creature index is switched off (setting "enableEnhancedCreatureIndex"), so the result is an estimate from names.';
    let indexInfo: Record<string, unknown> | null = null;

    if (!fallbackReason) {
      try {
        const answer = await creatureIndex.get(adapter, progress => context.progress(progress));
        const rows = answer.data.rows.filter(row => matchesAll(active, row));
        const sortField = creatures.sortField;
        rows.sort(
          (a: CreatureRow, b: CreatureRow) =>
            (sortField ? toNumber(a[sortField]) - toNumber(b[sortField]) : 0) || byName(a, b)
        );
        const page = rows.slice(0, limit);
        const counts = new Map<string, number>();
        for (const row of answer.data.rows)
          counts.set(row.packId, (counts.get(row.packId) ?? 0) + 1);
        return wrapped({
          ...base,
          source: 'creature-index',
          fallback: false,
          criteria: describeFilters(active),
          ignoredFilters: ignored,
          creatures: page.map(row => creatureEntry(row, creatures)),
          totalFound: rows.length,
          showing: page.length,
          hasMore: rows.length > page.length,
          packsSearched: answer.data.packs.map(pack => ({
            id: pack.id,
            label: pack.label,
            count: counts.get(pack.id) ?? 0,
          })),
          index: {
            builtAt: answer.data.builtAt,
            rebuilt: answer.rebuilt,
            failed: answer.data.failed,
            problem: answer.storeProblem,
          },
        });
      } catch (error) {
        fallbackReason = `The creature index could not be built (${messageOf(error)}), so the result is an estimate from names.`;
        indexInfo = { problem: messageOf(error) };
      }
    }

    let usable = active;
    if (active.length && !adapter.search?.estimate) {
      ignored.push(
        ...active.map(filter => ({
          name: filter.spec.name,
          reason: `the ${adapter.title} adapter cannot estimate this from names`,
        }))
      );
      usable = [];
    }
    const outcome = await listByNames(limit, adapter, usable, context);
    return wrapped({
      ...base,
      source: 'name-estimate',
      fallback: true,
      fallbackReason,
      criteria: describeFilters(usable),
      ignoredFilters: ignored,
      ...outcome,
      showing: outcome.creatures.length,
      hasMore: outcome.totalFound > outcome.creatures.length,
      index: indexInfo,
    });
  },
};

/** The whole index, as the query of the previous generation offered it. No tool of this server asks for it. */
export const getEnhancedCreatureIndex: QueryHandler = {
  access: { kind: 'read' },
  run: async (_data, context) => {
    requireWorld();
    const adapter = activeCompendiumAdapter();
    if (!adapter?.creatures)
      throw new QueryError('NO_ADAPTER', `${noAdapterText()} that builds a creature index`);
    if (!indexEnabled())
      throw new QueryError(
        'INDEX_OFF',
        'The creature index is switched off (setting "enableEnhancedCreatureIndex")'
      );
    const answer = await creatureIndex.get(adapter, progress => context.progress(progress));
    return { ...answer.data, rebuilt: answer.rebuilt, storeProblem: answer.storeProblem };
  },
};
