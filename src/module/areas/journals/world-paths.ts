/**
 * world-rewrite-paths: move a path prefix in every document of the world.
 *
 * First everything is scanned without writing. Then the permission levels of
 * exactly the collections that would change are checked, all before the first
 * write, so a refused kind never leaves half a move behind. A dry run reports
 * the refusals instead of failing.
 */
import type { DocumentKind } from '../../../common/permissions.js';
import type { QueryHandler } from '../../dispatcher.js';
import { QueryError } from '../../dispatcher.js';
import { requireWorld } from '../../world-ready.js';
import {
  accessProblem,
  argsOf,
  containsAll,
  isRecord,
  optionalBoolean,
  optionalTextList,
  requiredText,
  valueAt,
  verifyFailed,
} from './common.js';
import { makePathRule, PathRuleError, rewriteData, type PathRule } from './path-rewrite.js';

export const PATH_COLLECTIONS: Readonly<
  Record<string, { documentName: string; kind: DocumentKind | null }>
> = {
  scenes: { documentName: 'Scene', kind: 'Scenes' },
  actors: { documentName: 'Actor', kind: 'Actors' },
  items: { documentName: 'Item', kind: null },
  journal: { documentName: 'JournalEntry', kind: 'Journals' },
  playlists: { documentName: 'Playlist', kind: 'Playlists' },
  tables: { documentName: 'RollTable', kind: 'RollTables' },
  cards: { documentName: 'Cards', kind: null },
  macros: { documentName: 'Macro', kind: null },
};

/** Embedded document types and the field holding them, walked as documents of their own. */
const EMBEDDED: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  Scene: {
    Token: 'tokens',
    Tile: 'tiles',
    Drawing: 'drawings',
    Note: 'notes',
    AmbientSound: 'sounds',
    Wall: 'walls',
    AmbientLight: 'lights',
    Region: 'regions',
  },
  Region: { RegionBehavior: 'behaviors' },
  Actor: { Item: 'items', ActiveEffect: 'effects' },
  Item: { ActiveEffect: 'effects' },
  JournalEntry: { JournalEntryPage: 'pages' },
  Playlist: { PlaylistSound: 'sounds' },
  RollTable: { TableResult: 'results' },
  Cards: { Card: 'cards' },
};

/** Fields that never hold an asset path and must not be written: identity, metadata, sorting, rights. */
const NEVER = ['_id', '_stats', 'folder', 'sort', 'ownership'];

const EXAMPLE_LIMIT = 12;

interface Plan {
  collection: string;
  document: FoundryDocument;
  changes: Record<string, unknown>;
  count: number;
}

function embeddedChildren(
  document: FoundryDocument
): Array<{ field: string; children: FoundryDocument[] }> {
  const out: Array<{ field: string; children: FoundryDocument[] }> = [];
  for (const field of Object.values(EMBEDDED[document.documentName] ?? {})) {
    const collection = (document as unknown as Record<string, unknown>)[field];
    if (collection && typeof (collection as { values?: unknown }).values === 'function') {
      out.push({
        field,
        children: [...(collection as ReadonlyMap<string, FoundryDocument>).values()],
      });
    }
  }
  return out;
}

function scan(
  collection: string,
  document: FoundryDocument,
  rule: PathRule,
  plans: Plan[],
  examples: string[]
): number {
  const own = embeddedChildren(document);
  const skip = new Set([...NEVER, ...Object.values(EMBEDDED[document.documentName] ?? {})]);
  const result = rewriteData(document.toObject(), rule, skip);
  if (result.count) {
    plans.push({ collection, document, changes: result.changes, count: result.count });
    for (const example of result.examples)
      if (examples.length < EXAMPLE_LIMIT) examples.push(example);
  }
  let scanned = 1;
  for (const { children } of own) {
    for (const child of children) scanned += scan(collection, child, rule, plans, examples);
  }
  return scanned;
}

export const rewriteWorldPaths: QueryHandler = {
  access: { kind: 'write', document: 'Journals', action: 'update' },
  run: async (data, context) => {
    requireWorld();
    const args = argsOf(data);
    const from = requiredText(args, 'from', { allowEmpty: true });
    const to = requiredText(args, 'to', { allowEmpty: true });
    const dryRun = optionalBoolean(args, 'dryRun') ?? false;
    const wanted = optionalTextList(args, 'collections');

    let rule: PathRule;
    try {
      rule = makePathRule(from, to);
    } catch (error) {
      if (error instanceof PathRuleError) throw new QueryError('INVALID_ARGUMENT', error.message);
      throw error;
    }

    const names = wanted ?? Object.keys(PATH_COLLECTIONS);
    const unknown = names.filter(name => !(name in PATH_COLLECTIONS));
    if (unknown.length) {
      throw new QueryError(
        'INVALID_ARGUMENT',
        `Unknown collection(s): ${unknown.join(', ')}. Known: ${Object.keys(PATH_COLLECTIONS).join(', ')}`
      );
    }
    if (!names.length)
      throw new QueryError('INVALID_ARGUMENT', 'collections must name at least one collection');

    const plans: Plan[] = [];
    const examples: string[] = [];
    const worldDocuments = names.map(name => {
      const collection = (game as unknown as Record<string, unknown>)[name] as
        FoundryCollection<FoundryDocument> | undefined;
      return { name, documents: collection ? [...collection.contents] : [] };
    });
    const total = worldDocuments.reduce((sum, entry) => sum + entry.documents.length, 0);
    let done = 0;
    let scanned = 0;
    for (const { name, documents } of worldDocuments) {
      for (const document of documents) {
        scanned += scan(name, document, rule, plans, examples);
        done += 1;
        if (done % 100 === 0)
          context.progress({ progress: done, total, message: 'scanning the world' });
      }
    }

    const byCollection: Record<string, number> = {};
    for (const plan of plans)
      byCollection[plan.collection] = (byCollection[plan.collection] ?? 0) + plan.count;

    const refused: Array<{ collection: string; reason: string }> = [];
    for (const collection of Object.keys(byCollection)) {
      const kind = PATH_COLLECTIONS[collection]?.kind;
      const problem = kind ? accessProblem(kind, 'update') : null;
      if (problem) refused.push({ collection, reason: problem });
    }

    const changes = plans.reduce((sum, plan) => sum + plan.count, 0);
    const report = {
      success: true,
      worldId: game.world?.id ?? '',
      from: rule.from,
      to: rule.to,
      dryRun,
      collections: names,
      scannedDocuments: scanned,
      changes,
      documents: plans.length,
      byCollection,
      examples,
      // The names of the previous generation, which an old server passes on.
      world: game.world?.id ?? '',
      totalChanges: changes,
      documentsTouched: plans.length,
      samples: examples,
    };

    if (dryRun) return refused.length ? { ...report, refused } : report;

    if (refused.length) {
      throw new QueryError(
        'PERMISSION_DENIED',
        `Nothing was changed: the move would write into ${refused.map(r => r.collection).join(', ')}, which is not permitted. ` +
          refused.map(r => `${r.collection}: ${r.reason}`).join(' ') +
          ' Allow those kinds, or restrict collections (a partial move leaves broken references behind).'
      );
    }

    let written = 0;
    for (const plan of plans) {
      try {
        await plan.document.update(plan.changes);
      } catch (error) {
        throw new QueryError(
          'PARTIAL',
          `Rewriting stopped at ${plan.document.uuid}: ${(error as Error).message}. ${written} of ${plans.length} documents ` +
            'were already changed. Run again with dryRun to see what is left.'
        );
      }
      written += 1;
      if (written % 25 === 0)
        context.progress({ progress: written, total: plans.length, message: 'writing' });
    }

    const mismatches: string[] = [];
    for (const plan of plans) {
      const fresh = plan.document.toObject();
      for (const [key, expected] of Object.entries(plan.changes)) {
        const actual = Object.hasOwn(fresh, key) ? fresh[key] : valueAt(fresh, key);
        const ok = isRecord(expected)
          ? containsAll(actual, expected)
          : JSON.stringify(actual) === JSON.stringify(expected);
        if (!ok) mismatches.push(`${plan.document.uuid} ${key}`);
      }
    }
    if (mismatches.length) {
      verifyFailed(
        `${mismatches.length} field(s) do not read back as rewritten, for example ${mismatches.slice(0, 5).join(', ')}`
      );
    }

    if (plans.length) {
      context.recordChange({
        query: 'rewriteWorldPaths',
        tool: 'world-rewrite-paths',
        document: 'Journals',
        action: 'update',
        targets: plans
          .slice(0, 200)
          .map(plan => ({ id: plan.document.id, uuid: plan.document.uuid })),
        summary: `Rewrote the path prefix ${rule.from} to ${rule.to} in ${plans.length} documents (${Object.keys(byCollection).join(', ')}).`,
      });
    }
    return report;
  },
};
