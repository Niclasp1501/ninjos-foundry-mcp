/**
 * What the compendiums area asks a game system adapter, and nothing more.
 *
 * The compendium tools are system neutral. Three of them need to know what a
 * creature is in the active system: the creature index behind
 * list-creatures-by-criteria, the filters of search-compendium, and the key
 * values of get-compendium-item. That knowledge lives in the adapter of the
 * system in the core registry (src/common/game-systems.ts, `creatures` and
 * `compendiumStats`).
 *
 * This file derives the view the compendium tools work with from that adapter,
 * so a system area registers one adapter and no second interface for them. An
 * adapter only declares filters (name, kind, row field). The comparison itself
 * is generic (filters.ts), so no system ever gets its own comparison rules,
 * and a filter the adapter does not declare is reported, never dropped.
 *
 * `registerCompendiumAdapter` stays for the tests of this package, which build
 * a view by hand; a registered view wins over the registry.
 *
 * Without an adapter every tool still answers: names only, and a clear
 * statement that the system has no adapter.
 */
import type {
  CreatureFilterKind as CoreFilterKind,
  CreatureFilterSpec as CoreFilterSpec,
  CreatureRow as CoreCreatureRow,
  SystemAdapter,
} from '../../../common/game-systems.js';
import { moduleSystemAdapters } from '../../game-systems.js';

/** How a filter compares; the kinds of the core, `partialText` included. */
export type CreatureFilterKind = CoreFilterKind;

export type CreatureFilterSpec = CoreFilterSpec;

/** One creature in the index: the common fields the core fills, plus the adapter's. */
export type CreatureRow = CoreCreatureRow;

export interface CompendiumAdapter {
  /** Adapter id, e.g. "dnd5e". */
  id: string;
  /** Display name, e.g. "Dungeons & Dragons 5th Edition". */
  title: string;
  /** Whether this adapter takes over the Foundry system id (compare case-insensitively). */
  handles(systemId: string): boolean;

  /** The creature index. Absent: the adapter builds none, and says so. */
  creatures?: {
    /** Raise when rows change shape; a stored index of another version is rebuilt. */
    version: number;
    /** Actor types that are creatures. Absent: every actor of an actor compendium. */
    actorTypes?: readonly string[];
    /**
     * The system fields of one row, from the full document. Fill defaults for
     * missing values. A thrown error keeps the creature with the common fields
     * only, and is counted.
     */
    row(document: FoundryCompendiumsDocument): Record<string, unknown>;
    /** Filters of list-creatures-by-criteria. */
    filters: readonly CreatureFilterSpec[];
    /** Row field to sort by before the name, e.g. the challenge rating. */
    sortField?: string;
    /** Fields shown per creature in the result list. */
    listFields(row: CreatureRow): Record<string, unknown>;
    /** One line, e.g. "CR 5 dragon from Monster Manual". */
    summary(row: CreatureRow): string;
  };

  /** search-compendium on actor compendiums. */
  search?: {
    /** Filters it understands in `filters`, compared against creature index rows. */
    filters: readonly CreatureFilterSpec[];
    /** Filters that send an Actor search to the creature index. */
    indexFilters: readonly string[];
    /** Extra index fields to load for actor entries, for `estimate` and `stats`. */
    indexFields?: readonly string[];
    /**
     * Score of a name for the filters when the index is not used, or null for
     * no match. The result says that this is an estimate from names only.
     */
    estimate?(
      entry: Readonly<FoundryCompendiumsIndexEntry>,
      filters: Readonly<Record<string, unknown>>
    ): number | null;
    /** Key values of an actor from its index entry, for the result list. */
    stats?(entry: Readonly<FoundryCompendiumsIndexEntry>): Record<string, unknown> | null;
  };

  /** get-compendium-item. */
  item?: {
    description?(data: Readonly<Record<string, unknown>>): string | null;
    properties?(data: Readonly<Record<string, unknown>>): unknown;
    stats?(data: Readonly<Record<string, unknown>>): Record<string, unknown> | null;
  };
}

const adapters: CompendiumAdapter[] = [];

/**
 * Register a view by hand. Returns a function that removes it again. A second
 * view with the same id is refused. Only the tests of this package need it;
 * system packages register their core adapter instead.
 */
export function registerCompendiumAdapter(adapter: CompendiumAdapter): () => void {
  if (adapters.some(known => known.id === adapter.id))
    throw new Error(`A compendium adapter with the id "${adapter.id}" is already registered`);
  adapters.push(adapter);
  return () => {
    const index = adapters.indexOf(adapter);
    if (index >= 0) adapters.splice(index, 1);
  };
}

const derived = new WeakMap<SystemAdapter, CompendiumAdapter>();

/**
 * The view of the compendiums area on a core adapter. Filters, versions, actor types, the
 * power field for sorting, list fields, summary and key values come from the
 * adapter unchanged, so index fingerprints stay the same. search-compendium
 * offers the creature filters plus the adapter's search filters, and every one
 * of them sends an actor search to the index. Without an estimate of its own,
 * every name stays in with the same score.
 */
export function compendiumAdapterFor(adapter: SystemAdapter): CompendiumAdapter {
  const known = derived.get(adapter);
  if (known) return known;
  const creatures = adapter.creatures;
  const stats = adapter.compendiumStats;
  const types = creatures?.actorTypes ?? [];
  const view: CompendiumAdapter = {
    id: adapter.id,
    title: adapter.title,
    handles: systemId =>
      systemId.toLowerCase() === adapter.id.toLowerCase() || adapter.handles?.(systemId) === true,
    ...(creatures
      ? {
          creatures: {
            version: creatures.indexVersion,
            ...(creatures.actorTypes ? { actorTypes: creatures.actorTypes } : {}),
            row: document => creatures.row(document.toObject()),
            filters: creatures.filters,
            ...(creatures.power ? { sortField: creatures.power.field } : {}),
            listFields: row => creatures.listFields?.(row) ?? {},
            summary: row => creatures.summary?.(row) ?? `${row.type} from ${row.packLabel}`,
          },
        }
      : {}),
    ...(creatures && stats
      ? {
          search: (() => {
            const filters = [...creatures.filters, ...(stats.searchFilters ?? [])];
            return {
              filters,
              indexFilters: filters.map(filter => filter.name),
              ...(stats.indexFields ? { indexFields: stats.indexFields } : {}),
              estimate: (entry, given) => (stats.estimate ? stats.estimate(entry, given) : 1),
              stats: entry => stats.actorStats(entry),
            } satisfies NonNullable<CompendiumAdapter['search']>;
          })(),
          item: {
            stats: data => (types.includes(String(data['type'])) ? stats.actorStats(data) : null),
          },
        }
      : {}),
  };
  derived.set(adapter, view);
  return view;
}

/** The Foundry id of the active system, read fresh on every call: no stale value after a world change. */
export function activeSystemId(): string {
  return game.system?.id ?? 'unknown';
}

export function activeCompendiumAdapter(): CompendiumAdapter | null {
  const systemId = activeSystemId();
  const registered =
    adapters.find(adapter => adapter.id.toLowerCase() === systemId.toLowerCase()) ??
    adapters.find(adapter => adapter.handles(systemId));
  if (registered) return registered;
  const core = moduleSystemAdapters.find(systemId);
  return core ? compendiumAdapterFor(core) : null;
}

export function noAdapterText(): string {
  return `The game system "${activeSystemId()}" has no adapter in Ninjo's Foundry MCP`;
}
