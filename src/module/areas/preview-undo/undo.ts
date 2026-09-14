/**
 * undoChanges: put the world back to the state the change log recorded.
 *
 * The order is fixed:
 *
 * 1. Choose the entries: one by id, the entries of one tool call, or the
 *    latest tool call that is not undone yet.
 * 2. Check every entry before the first write: can it be undone at all, does
 *    the dispatcher's gate allow it with the kind and action of the first
 *    write of its chain, and has the world moved on since (a later entry on
 *    the same document, a state after the change that no longer matches, a
 *    modification time after the entry). One refusal refuses all.
 * 3. Newest first: restore fields, remove what was created, recreate what was
 *    deleted with its old id. Every step is read back.
 * 4. Each undo is itself a change in the log, so undoing it again redoes.
 */
import {
  smallEnough,
  type ChangeEntry,
  type ChangeLog,
  type ChangeTarget,
} from '../../../common/change-log.js';
import {
  differences,
  isData,
  readPath,
  restorePlan,
  reversibility,
  rightsAction,
  sameTarget,
  sameValue,
  splitUuid,
  statesPerTarget,
  undoAccesses,
  WORLD_COLLECTION_OF,
  type Data,
} from '../../../common/areas/preview-undo/rules.js';
import type { Access } from '../../../common/permissions.js';
import {
  afterWriteWarning,
  errorText,
  settleWrite,
  type SettledWrite,
} from '../../client-errors.js';
import { QueryError, type HandlerContext, type QueryHandler } from '../../dispatcher.js';
import { requireWorld } from '../../world-ready.js';
import { argsOf, logOf, optionalCount, optionalText } from './history.js';

type Operation = 'restore' | 'remove' | 'recreate';

interface TargetPlan {
  target: ChangeTarget;
  operation: Operation;
  documentName: string | null;
  parentUuid: string | null;
  document: FoundryDocument | null;
  before?: Data;
  after?: Data;
  /** Paths an update would write, for the preview. */
  fields: string[];
  conflicts: string[];
  problems: string[];
}

interface EntryPlan {
  entry: ChangeEntry;
  targets: TargetPlan[];
  problems: string[];
  accesses: Access[];
}

/** Modification times up to this much after the entry count as the change itself. */
const CLOCK_TOLERANCE_MS = 2000;

function shown(value: unknown): string {
  if (value === undefined) return '(absent)';
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function selectEntries(log: ChangeLog, args: Record<string, unknown>): ChangeEntry[] {
  const changeId = optionalText(args, 'changeId');
  const callId = optionalText(args, 'callId');
  const count = optionalCount(args, 'count', 50);
  if (changeId && callId)
    throw new QueryError('INVALID_ARGUMENT', 'Give changeId or callId, not both');
  const all = log.list();

  if (changeId) {
    const entry = log.get(changeId);
    if (!entry)
      throw new QueryError(
        'NOT_FOUND',
        `No change "${changeId}" in the log. The log keeps the latest 200 changes of this browser session; list-changes shows them.`
      );
    if (count !== undefined && count !== 1)
      throw new QueryError('INVALID_ARGUMENT', 'count only applies together with callId or alone');
    return [entry];
  }

  let group: ChangeEntry[];
  if (callId) {
    group = all.filter(entry => entry.callId === callId);
    if (!group.length)
      throw new QueryError('NOT_FOUND', `No change of the call "${callId}" in the log.`);
  } else {
    const latest = all.find(entry => !entry.undoneAt && !entry.restores);
    if (!latest)
      throw new QueryError('NOTHING_TO_UNDO', 'The log has no change that is not undone yet.');
    group = latest.callId ? all.filter(entry => entry.callId === latest.callId) : [latest];
  }
  const open = group.filter(entry => !entry.undoneAt);
  if (!open.length)
    throw new QueryError(
      'NOTHING_TO_UNDO',
      `Every change of the call "${group[0]?.callId ?? ''}" is undone already.`
    );
  return count === undefined ? open : open.slice(0, count);
}

async function lookUp(uuid: string): Promise<FoundryDocument | null> {
  try {
    return await fromUuid(uuid);
  } catch {
    return null;
  }
}

function worldPlace(entry: ChangeEntry, target: ChangeTarget) {
  const byName = target.documentName
    ? Object.values(WORLD_COLLECTION_OF).find(place => place.documentName === target.documentName)
    : undefined;
  return (
    byName ?? (entry.document === 'Multiple' ? undefined : WORLD_COLLECTION_OF[entry.document])
  );
}

async function locate(
  entry: ChangeEntry,
  target: ChangeTarget
): Promise<Pick<TargetPlan, 'document' | 'documentName' | 'parentUuid' | 'problems'>> {
  if (target.uuid) {
    const parts = splitUuid(target.uuid);
    return {
      document: await lookUp(target.uuid),
      documentName: parts?.documentName ?? target.documentName ?? null,
      parentUuid: parts?.parent ?? null,
      problems: [],
    };
  }
  const place = worldPlace(entry, target);
  if (!place || !target.id)
    return {
      document: null,
      documentName: target.documentName ?? null,
      parentUuid: null,
      problems: ['the entry names the document without a uuid, and its collection is unknown'],
    };
  const collection = (game as unknown as Record<string, unknown>)[place.collection] as
    FoundryCollection<FoundryDocument> | undefined;
  return {
    document: collection?.get(target.id) ?? null,
    documentName: place.documentName,
    parentUuid: null,
    problems: [],
  };
}

/** Later entries on the same documents that are neither undone nor cancelled by a later undo. */
function laterTouches(all: ChangeEntry[], entry: ChangeEntry, batch: Set<string>): ChangeEntry[] {
  const index = all.findIndex(item => item.id === entry.id);
  const newer = all.slice(0, Math.max(0, index));
  const newerIds = new Set(newer.map(item => item.id));
  return newer.filter(
    later =>
      !batch.has(later.id) &&
      !later.undoneAt &&
      !(later.restores && newerIds.has(later.restores.changeId)) &&
      later.targets.some(t => entry.targets.some(own => sameTarget(t, own)))
  );
}

function touchedInBatch(
  all: ChangeEntry[],
  entry: ChangeEntry,
  target: ChangeTarget,
  batch: Set<string>
): boolean {
  const index = all.findIndex(item => item.id === entry.id);
  return all
    .slice(0, Math.max(0, index))
    .some(later => batch.has(later.id) && later.targets.some(t => sameTarget(t, target)));
}

function modifiedAfter(document: FoundryDocument, entry: ChangeEntry): string | null {
  const stats = document.toObject()['_stats'];
  const modified = isData(stats) ? stats['modifiedTime'] : undefined;
  if (typeof modified !== 'number') return null;
  return modified > Date.parse(entry.at) + CLOCK_TOLERANCE_MS
    ? `it was modified at ${new Date(modified).toISOString()}, after the change at ${entry.at}`
    : null;
}

async function planEntry(
  entry: ChangeEntry,
  all: ChangeEntry[],
  batch: Set<string>
): Promise<EntryPlan> {
  const problems: string[] = [];
  const state = reversibility(entry);
  const rights = undoAccesses(entry);
  if (rights.refusal) problems.push(rights.refusal);
  const plan: EntryPlan = { entry, targets: [], problems, accesses: rights.accesses };
  if (!state.reversible) {
    problems.push(`It cannot be undone: ${state.reason}.`);
    return plan;
  }

  const operation: Operation =
    entry.action === 'create' ? 'remove' : entry.action === 'delete' ? 'recreate' : 'restore';
  const befores = statesPerTarget(entry.before, entry.targets);
  const afters = statesPerTarget(entry.after, entry.targets);
  const later = laterTouches(all, entry, batch);

  for (const [index, target] of entry.targets.entries()) {
    const found = await locate(entry, target);
    const item: TargetPlan = {
      target,
      operation,
      ...found,
      fields: [],
      conflicts: [],
      ...(befores?.[index] ? { before: befores[index] } : {}),
      ...(afters?.[index] ? { after: afters[index] } : {}),
    };
    const name = target.name ?? target.uuid ?? target.id ?? '?';
    for (const touch of later.filter(l => l.targets.some(t => sameTarget(t, target))))
      item.conflicts.push(
        `the later change ${touch.id} (${touch.tool ?? touch.query}) touched "${name}"`
      );

    if (operation === 'recreate') {
      if (item.document) item.problems.push(`a document with the id of "${name}" exists again`);
      if (item.parentUuid && !(await lookUp(item.parentUuid)))
        item.problems.push(
          `the document that held "${name}" (${item.parentUuid}) no longer exists`
        );
      if (!item.documentName) item.problems.push(`the document type of "${name}" is unknown`);
    } else if (!item.document) {
      item.problems.push(`"${name}" no longer exists`);
    } else if (!touchedInBatch(all, entry, target, batch)) {
      const current = item.document.toObject();
      if (item.after) {
        for (const diff of differences(item.after, current))
          item.conflicts.push(
            `"${name}" changed since: ${diff.path} was ${shown(diff.expected)} after the change, now ${shown(diff.actual)}`
          );
      } else {
        const modified = modifiedAfter(item.document, entry);
        if (modified) item.conflicts.push(`"${name}": ${modified}`);
      }
      if (operation === 'restore' && item.before) {
        const restore = restorePlan(item.before, current, item.after);
        item.fields = restore.paths;
        item.problems.push(...restore.problems);
      }
    }
    plan.targets.push(item);
  }
  return plan;
}

function refusalsOf(plan: EntryPlan, force: boolean): string[] {
  const lines = [...plan.problems];
  for (const target of plan.targets) {
    lines.push(...target.problems);
    if (target.conflicts.length && !(force && target.operation === 'restore'))
      lines.push(...target.conflicts);
  }
  return lines;
}

function documentClassOf(
  documentName: string
): { create(data: Data, options?: Data): Promise<unknown> } | null {
  const config = (globalThis as { CONFIG?: Record<string, unknown> }).CONFIG?.[documentName];
  const candidate = isData(config) ? config['documentClass'] : undefined;
  const cls = candidate ?? (globalThis as Record<string, unknown>)[documentName];
  return cls && typeof (cls as { create?: unknown }).create === 'function'
    ? (cls as { create(data: Data, options?: Data): Promise<unknown> })
    : null;
}

function targetOf(document: FoundryDocument, fallback: ChangeTarget): ChangeTarget {
  return {
    id: document.id,
    uuid: document.uuid,
    ...((document.name ?? fallback.name) ? { name: document.name ?? fallback.name } : {}),
    documentName: document.documentName,
  };
}

function pick(data: Data, paths: string[]): Data {
  return Object.fromEntries(paths.map(path => [path, readPath(data, path)]));
}

/** One state for one target, a list for several: the form statesPerTarget reads back. */
function stateList(states: Data[]): unknown {
  return smallEnough(states.length === 1 ? states[0] : states);
}

interface Outcome {
  changeId: string;
  summary: string;
  restoredBy: string | null;
  targets: Array<Record<string, unknown>>;
}

async function runEntry(
  plan: EntryPlan,
  context: HandlerContext,
  log: ChangeLog
): Promise<Outcome> {
  const { entry } = plan;
  const befores: Data[] = [];
  const afters: Data[] = [];
  const recorded: ChangeTarget[] = [];
  const report: Array<Record<string, unknown>> = [];

  for (const item of plan.targets) {
    const name = item.target.name ?? item.target.uuid ?? item.target.id ?? '?';
    if (item.operation === 'restore') {
      const document = item.document as FoundryDocument;
      const current = document.toObject();
      const restore = restorePlan(item.before ?? {}, current, item.after);
      if (restore.problems.length)
        throw new QueryError('CONFLICT', `"${name}": ${restore.problems.join('; ')}`);
      if (!restore.paths.length) {
        report.push({
          target: item.target,
          operation: 'restore',
          fields: [],
          note: 'already in the recorded state',
        });
        continue;
      }
      // Every write is read back: Foundry's client code can throw after the server stored it (no canvas).
      const attempt = await settleWrite(() => document.update(restore.update));
      const fresh = (item.target.uuid ? await lookUp(item.target.uuid) : document) ?? document;
      const stored = fresh.toObject();
      const missed = Object.entries(restore.update).filter(([path, value]) =>
        path.includes('-=')
          ? readPath(stored, path.replace('-=', '')) !== undefined
          : !sameValue(value, readPath(stored, path))
      );
      if (missed.length)
        throw new QueryError(
          attempt.threw ? 'WRITE_FAILED' : 'NOT_APPLIED',
          (attempt.threw
            ? `Foundry refused to write "${name}": ${errorText(attempt.error)}. Reading`
            : `"${name}" was written, but reading`) +
            ` it back shows ${missed.map(([path]) => path.replace('-=', '')).join(', ')} not restored`
        );
      befores.push(pick(current, restore.paths));
      afters.push(pick(stored, restore.paths));
      recorded.push(item.target);
      report.push({
        target: item.target,
        operation: 'restore',
        fields: restore.paths,
        ...(attempt.threw
          ? { note: afterWriteWarning(attempt.error, 'Read back, the fields are restored.') }
          : {}),
      });
    } else if (item.operation === 'remove') {
      const document = item.document as FoundryDocument;
      const state = document.toObject();
      const attempt = await settleWrite(() => document.delete());
      if (attempt.threw && !item.target.uuid)
        throw new QueryError(
          'WRITE_FAILED',
          `Foundry threw while deleting "${name}": ${errorText(attempt.error)}. The entry has no uuid to read it back.`
        );
      const still = item.target.uuid ? await lookUp(item.target.uuid) : null;
      if (still)
        throw new QueryError(
          attempt.threw ? 'WRITE_FAILED' : 'NOT_APPLIED',
          attempt.threw
            ? `Foundry refused to delete "${name}": ${errorText(attempt.error)}. It still exists`
            : `"${name}" was deleted, but it still exists`
        );
      befores.push(state);
      recorded.push(item.target);
      report.push({
        target: item.target,
        operation: 'remove',
        ...(attempt.threw
          ? { note: afterWriteWarning(attempt.error, 'Read back, it is gone.') }
          : {}),
      });
    } else {
      const data = structuredClone(item.before ?? {});
      delete data['_stats'];
      const documentName = item.documentName as string;
      let attempt: SettledWrite<unknown>;
      let expectedUuid = item.target.uuid ?? null;
      if (item.parentUuid) {
        const parent = await lookUp(item.parentUuid);
        if (!parent)
          throw new QueryError('CONFLICT', `the document that held "${name}" no longer exists`);
        attempt = await settleWrite(() =>
          parent.createEmbeddedDocuments(documentName, [data], { keepId: true })
        );
        if (!expectedUuid && item.target.id)
          expectedUuid = `${item.parentUuid}.${documentName}.${item.target.id}`;
      } else {
        const cls = documentClassOf(documentName);
        if (!cls)
          throw new QueryError(
            'UNSUPPORTED',
            `Foundry offers no document class for ${documentName}`
          );
        attempt = await settleWrite(() => cls.create(data, { keepId: true }));
        if (!expectedUuid && item.target.id) expectedUuid = `${documentName}.${item.target.id}`;
      }
      const answer = attempt.value;
      const created = ((Array.isArray(answer) ? answer[0] : answer) ??
        null) as FoundryDocument | null;
      // Without an answer (Foundry threw), the old id tells where to look, because it was kept.
      const readBack = created
        ? await lookUp(created.uuid)
        : attempt.threw && expectedUuid
          ? await lookUp(expectedUuid)
          : null;
      if (!readBack)
        throw new QueryError(
          attempt.threw ? 'WRITE_FAILED' : 'NOT_APPLIED',
          attempt.threw
            ? `Foundry refused to recreate "${name}": ${errorText(attempt.error)}. Reading back finds nothing`
            : `"${name}" was sent to Foundry, but reading it back finds nothing`
        );
      const notes = [
        ...(item.target.id && readBack.id !== item.target.id
          ? [`Foundry gave it the new id ${readBack.id} instead of ${item.target.id}`]
          : []),
        ...(attempt.threw ? [afterWriteWarning(attempt.error, 'Read back, it exists again.')] : []),
      ];
      afters.push(readBack.toObject());
      recorded.push(targetOf(readBack, item.target));
      report.push({
        target: targetOf(readBack, item.target),
        operation: 'recreate',
        ...(notes.length ? { note: notes.join(' ') } : {}),
      });
    }
  }

  let restoredBy: string | null = null;
  if (recorded.length) {
    const action =
      plan.targets[0]?.operation === 'remove'
        ? 'delete'
        : plan.targets[0]?.operation === 'recreate'
          ? 'create'
          : 'update';
    const change = context.recordChange({
      query: 'undoChanges',
      tool: 'undo-change',
      document: entry.document,
      ...(entry.documents ? { documents: entry.documents } : {}),
      action,
      targets: recorded,
      summary: `Undid ${entry.id}: ${entry.summary}`,
      ...(befores.length ? { before: stateList(befores) } : {}),
      ...(afters.length ? { after: stateList(afters) } : {}),
      restores: { changeId: entry.id, action: rightsAction(entry) },
    });
    restoredBy = change.id;
  }
  log.markUndone(entry.id);
  if (entry.restores) log.clearUndone(entry.restores.changeId);
  return { changeId: entry.id, summary: entry.summary, restoredBy, targets: report };
}

export const undoChanges: QueryHandler = {
  // Rights depend on the entries, which only the log knows: asked in run, before the first write.
  access: { kind: 'read' },
  run: async (data, context) => {
    requireWorld();
    const args = argsOf(data);
    const dryRun = args['dryRun'] === true;
    const force = args['force'] === true;
    const log = logOf(context);
    const entries = selectEntries(log, args);
    const all = log.list();
    const batch = new Set(entries.map(entry => entry.id));

    const plans: EntryPlan[] = [];
    for (const entry of entries) plans.push(await planEntry(entry, all, batch));
    const accesses = plans.flatMap(plan => plan.accesses);
    const refusals = plans.flatMap(plan =>
      refusalsOf(plan, force).map(line => `${plan.entry.id}: ${line}`)
    );

    if (dryRun) {
      const refusal = context.accessProblem(accesses);
      return {
        dryRun: true,
        wouldUndo: refusals.length === 0 && refusal === null,
        permission: refusal,
        refusals,
        changes: plans.map(plan => ({
          changeId: plan.entry.id,
          tool: plan.entry.tool ?? plan.entry.query,
          summary: plan.entry.summary,
          targets: plan.targets.map(item => ({
            target: item.target,
            operation: item.operation,
            ...(item.fields.length ? { fields: item.fields } : {}),
            ...(item.conflicts.length ? { conflicts: item.conflicts } : {}),
            ...(item.problems.length ? { problems: item.problems } : {}),
          })),
        })),
      };
    }

    context.requireAccess(accesses, 'Undo refused, nothing was changed.');
    if (refusals.length) {
      const conflictsOnly = plans.every(
        plan => plan.problems.length === 0 && plan.targets.every(t => !t.problems.length)
      );
      throw new QueryError(
        conflictsOnly ? 'CONFLICT' : 'NOT_REVERSIBLE',
        `Undo refused, nothing was changed. ${refusals.join(' ')}` +
          (conflictsOnly && plans.every(plan => plan.targets.every(t => t.operation === 'restore'))
            ? ' Look at the differences with list-changes or get-document; force: true restores the recorded fields anyway.'
            : '')
      );
    }

    const done: Outcome[] = [];
    for (const plan of plans) {
      try {
        done.push(await runEntry(plan, context, log));
      } catch (error) {
        const cause = error instanceof Error ? error.message : String(error);
        const code = error instanceof QueryError ? error.code : 'FAILED';
        throw new QueryError(
          done.length ? 'PARTIALLY_UNDONE' : code,
          done.length
            ? `Undid ${done.length} of ${plans.length} changes (${done.map(d => d.changeId).join(', ')}, recorded as ` +
                `${done.map(d => d.restoredBy ?? 'nothing to write').join(', ')}, which undo-change can redo), then ${plan.entry.id} failed: ${cause}`
            : `Undoing ${plan.entry.id} failed: ${cause}`
        );
      }
    }
    return { undone: done };
  },
};
