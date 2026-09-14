/**
 * search-compendium and get-compendium-item.
 *
 * The search looks at names only. Every word of the query has to occur in the
 * name. All matches are collected before sorting, so an exact match in a late
 * compendium is never cut off (the previous generation stopped at 100 matches
 * before sorting). Filters need the adapter of the active system; without
 * one they are reported as ignored, never dropped.
 */
import { foldName } from '../../../common/areas/compendiums/names.js';
import { DETAILED_ANSWER, SEARCH_LIMIT } from '../../../common/areas/compendiums/shapes.js';
import { QueryError, type QueryHandler } from '../../dispatcher.js';
import { requireWorld } from '../../world-ready.js';
import {
  activeCompendiumAdapter,
  activeSystemId,
  noAdapterText,
  type CompendiumAdapter,
} from './adapter.js';
import {
  asData,
  integerInRange,
  invalid,
  messageOf,
  optionalBoolean,
  optionalString,
  requiredString,
} from './args.js';
import { creatureIndex, indexEnabled } from './creature-index.js';
import {
  describeFilters,
  matchesAll,
  readFilters,
  type ActiveFilter,
  type IgnoredFilter,
} from './filters.js';
import { allPacks, packLabel, packRef, plainText, readIndex, requirePack } from './packs.js';

/**
 * `pack` is the id as text and `packLabel` the label: the fields a server of
 * the previous generation reads, kept in the detailed answer as well so both
 * answers name a compendium the same way.
 */
interface SearchHit {
  id: string;
  name: string;
  type: string;
  documentType: string;
  pack: string;
  packLabel: string;
  img: string | null;
  hasImage: boolean;
  summary: string;
  stats?: Record<string, unknown> | null;
  score: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const imageOf = (value: unknown): string | null =>
  typeof value === 'string' && value ? value : null;

function statsOf(
  adapter: CompendiumAdapter | null,
  entry: FoundryCompendiumsIndexEntry,
  problems: Set<string>
): Record<string, unknown> | null {
  if (!adapter?.search?.stats) return null;
  try {
    return adapter.search.stats(entry);
  } catch (error) {
    problems.add(`key values could not be read for some actors: ${messageOf(error)}`);
    return null;
  }
}

export const searchCompendium: QueryHandler = {
  access: { kind: 'read' },
  run: async (data, context) => {
    requireWorld();
    const input = asData(data);
    const rawQuery = input['query'];
    if (typeof rawQuery !== 'string' || rawQuery.trim().length < 2)
      throw invalid(
        `query is required and needs at least two characters, got ${JSON.stringify(rawQuery ?? null)}`
      );
    const query = rawQuery.trim();
    const packType = optionalString(input, 'packType')?.trim() || undefined;
    const limit = integerInRange(input, 'limit', {
      min: 1,
      max: SEARCH_LIMIT.max,
      fallback: SEARCH_LIMIT.fallback,
    });
    const rawFilters = input['filters'];
    if (rawFilters !== undefined && rawFilters !== null && !isRecord(rawFilters))
      throw invalid('filters must be an object');
    const given = isRecord(rawFilters) ? rawFilters : {};

    const adapter = activeCompendiumAdapter();
    const reading = readFilters(adapter?.search?.filters ?? [], given, name =>
      adapter?.search
        ? `"${name}" is not a search filter of the ${adapter.title} adapter`
        : `${noAdapterText()} for compendium searches, so filters cannot be applied`
    );
    if (reading.problems.length)
      throw invalid(`Parameter validation failed: ${reading.problems.join('; ')}`);

    const ignored: IgnoredFilter[] = [...reading.ignored];
    let active: ActiveFilter[] = reading.active;
    const notes = new Set<string>();

    if (active.length && packType && packType !== 'Actor') {
      ignored.push(
        ...active.map(filter => ({
          name: filter.spec.name,
          reason: 'filters only apply to Actor compendiums',
        }))
      );
      active = [];
    }

    const words = foldName(query).split(/\s+/).filter(Boolean);
    const nameMatches = (name: string) => {
      const folded = foldName(name);
      return words.every(word => folded.includes(word));
    };

    let hits: SearchHit[] | null = null;
    let mode = 'name';

    const indexFilterNames = adapter?.search?.indexFilters ?? [];
    const creatures = adapter?.creatures;
    if (
      adapter &&
      creatures &&
      packType === 'Actor' &&
      active.some(filter => indexFilterNames.includes(filter.spec.name))
    ) {
      if (!indexEnabled()) {
        notes.add(
          'the creature index is switched off (setting "enableEnhancedCreatureIndex"), so names were searched'
        );
      } else {
        try {
          const answer = await creatureIndex.get(adapter, progress => context.progress(progress));
          if (answer.storeProblem) notes.add(answer.storeProblem);
          hits = answer.data.rows
            .filter(row => nameMatches(row.name) && matchesAll(active, row))
            .map(row => ({
              id: row.id,
              name: row.name,
              type: row.type,
              documentType: 'Actor',
              pack: row.packId,
              packLabel: row.packLabel,
              img: imageOf(row.img),
              hasImage: !!row.img,
              ...(typeof row['indexError'] === 'string'
                ? { summary: `${row.type || 'Actor'} from ${row.packLabel}`, stats: null }
                : { summary: creatures.summary(row), stats: creatures.listFields(row) }),
              score: 1,
            }));
          mode = 'creature-index';
        } catch (error) {
          notes.add(
            `the creature index could not be used (${messageOf(error)}), so names were searched`
          );
        }
      }
    }

    if (hits === null) {
      if (active.length && !adapter?.search?.estimate) {
        ignored.push(
          ...active.map(filter => ({
            name: filter.spec.name,
            reason: `the ${adapter?.title ?? 'active'} adapter cannot estimate this from names, and the creature index was not used`,
          }))
        );
        active = [];
      }
      const filterValues = describeFilters(active);
      const packs = allPacks().filter(
        pack =>
          pack.documentName !== 'Scene' &&
          (!packType || pack.documentName.toLowerCase() === packType.toLowerCase()) &&
          (!active.length || pack.documentName === 'Actor')
      );
      hits = [];
      for (const [position, pack] of packs.entries()) {
        const actor = pack.documentName === 'Actor';
        const entries = await readIndex(pack, actor ? (adapter?.search?.indexFields ?? []) : []);
        for (const entry of entries) {
          const name = entry.name ?? '';
          if (!nameMatches(name)) continue;
          let score = 0;
          if (active.length && adapter?.search?.estimate) {
            const estimate = adapter.search.estimate(entry, filterValues);
            if (estimate === null) continue;
            score = estimate;
          }
          const hit: SearchHit = {
            id: entry._id,
            name,
            type: entry.type ?? pack.documentName,
            documentType: pack.documentName,
            pack: pack.collection,
            packLabel: packLabel(pack),
            img: imageOf(entry.img),
            hasImage: !!entry.img,
            summary: `${entry.type ?? pack.documentName} from ${packLabel(pack)}`,
            score,
          };
          if (actor) hit.stats = statsOf(adapter, entry, notes);
          hits.push(hit);
        }
        if ((position + 1) % 20 === 0)
          context.progress({
            progress: position + 1,
            total: packs.length,
            message: 'Searching compendiums',
          });
      }
      mode = active.length ? 'name-estimate' : 'name';
    }

    const exact = foldName(query);
    hits.sort(
      (a, b) =>
        Number(foldName(b.name) === exact) - Number(foldName(a.name) === exact) ||
        (active.length ? b.score - a.score : 0) ||
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
    );
    const page = hits.slice(0, limit).map(({ score: _score, ...hit }) => hit);

    if (input[DETAILED_ANSWER.field] !== DETAILED_ANSWER.value) {
      // A server of the previous generation sends no limit, cuts the list
      // itself and reads per hit id, name, type, pack, packLabel, img, system.
      return page.map(hit => ({
        ...hit,
        system: { description: hit.summary, ...(hit.stats ?? {}) },
      }));
    }

    return {
      query,
      packType: packType ?? null,
      system: activeSystemId(),
      adapter: adapter?.title ?? null,
      mode,
      filters: describeFilters(active),
      ignoredFilters: ignored,
      notes: [...notes],
      results: page,
      totalFound: hits.length,
      showing: page.length,
      hasMore: hits.length > page.length,
    };
  },
};

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/** The description by Foundry's common conventions, when no adapter says otherwise. */
function neutralDescription(source: Record<string, unknown>): string {
  const system = source['system'];
  if (isRecord(system)) {
    const description = system['description'];
    if (typeof description === 'string') return description;
    if (isRecord(description) && typeof description['value'] === 'string')
      return description['value'];
  }
  const page = list(source['pages'])[0];
  const pageText = page && isRecord(page['text']) ? page['text']['content'] : undefined;
  if (typeof pageText === 'string') return pageText;
  return text(source['description']);
}

export const getCompendiumItem: QueryHandler = {
  access: { kind: 'read' },
  run: async data => {
    requireWorld();
    const input = asData(data);
    const pack = requirePack(requiredString(input, 'packId'));
    const itemId = requiredString(input, 'itemId');
    const compact = optionalBoolean(input, 'compact') ?? false;
    return readEntry(pack, itemId, compact);
  },
};

/**
 * getCompendiumDocumentFull: one entry in full, as servers of the previous
 * generation ask for it (get-compendium-item and get-compendium-entry-full,
 * data `packId` and `documentId`). The answer carries `type` as text, `pack`
 * as the id, `packLabel`, and items and effects each with a name.
 *
 * The actors area reads compendium documents too; it imports this handler rather
 * than registering the name a second time, which would stop the start.
 */
export const getCompendiumDocumentFull: QueryHandler = {
  access: { kind: 'read' },
  run: async data => {
    requireWorld();
    const input = asData(data);
    const pack = requirePack(requiredString(input, 'packId'));
    const given = ['documentId', 'entryId', 'itemId'].find(
      key => typeof input[key] === 'string' && (input[key] as string).trim() !== ''
    );
    if (!given) throw invalid('documentId is required and must be a non-empty text');
    const answer = await readEntry(pack, input[given] as string, false);
    return { ...answer, pack: pack.collection, packLabel: packLabel(pack) };
  },
};

async function readEntry(
  pack: FoundryCompendiumsPack,
  itemId: string,
  compact: boolean
): Promise<Record<string, unknown>> {
  {
    const document = await pack.getDocument(itemId);
    if (!document)
      throw new QueryError(
        'ENTRY_NOT_FOUND',
        `Document ${itemId} not found in pack ${pack.collection}. list-compendium-entries shows the ids.`
      );
    const source = document.toObject();
    const adapter = activeCompendiumAdapter();
    const description = adapter?.item?.description?.(source) ?? neutralDescription(source);
    const items = list(source['items']).map(item => ({
      id: text(item['_id']),
      name: text(item['name']),
      type: text(item['type']),
      img: typeof item['img'] === 'string' ? item['img'] : null,
    }));
    const effects = list(source['effects']).map(effect => ({
      id: text(effect['_id']),
      name: text(effect['name']) || text(effect['label']),
      disabled: effect['disabled'] === true,
    }));
    const base = {
      id: document.id,
      name: document.name ?? text(source['name']),
      type: document.type ?? document.documentName,
      documentType: document.documentName,
      pack: packRef(pack),
      img: typeof source['img'] === 'string' ? source['img'] : null,
      gameSystem: activeSystemId(),
      adapter: adapter?.title ?? null,
      description: plainText(description, 300),
      properties: adapter?.item?.properties?.(source) ?? null,
    };

    if (compact) {
      return {
        ...base,
        mode: 'compact',
        stats: adapter?.item?.stats?.(source) ?? null,
        items: items.slice(0, 5).map(({ img: _img, ...item }) => item),
        itemCount: items.length,
        effectCount: effects.length,
      };
    }
    return {
      ...base,
      mode: 'full',
      fullDescription: description,
      system: source['system'] ?? null,
      items,
      effects,
      fullData: source,
    };
  }
}
