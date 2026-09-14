/**
 * Walls, lights, sounds, regions, tiles and drawings of a scene.
 * List, create, change and delete them in batches, and open, close or lock doors.
 *
 * Decisions:
 * - They are part of their scene. Creating and changing need the level
 *   "change" for scenes, deleting needs "full", as deleting does everywhere
 *   (the default keeps it off).
 * - Every id and every entry is checked before the first write; one bad entry
 *   stops the whole batch. A dry run reports what would happen, including a
 *   refusal, and changes nothing.
 * - After writing, everything is read back from the world collection. What
 *   Foundry stored differently is named; what it did not store is an error.
 * - Created elements carry the three markers of the core, so a later cleanup
 *   finds everything the MCP made.
 */
import {
  boxesTouch,
  boxOf,
  DOOR_STATES,
  differences,
  ELEMENT_KINDS,
  ELEMENT_TYPES,
  isRecord,
  LIST_DEFAULT_LIMIT,
  LIST_MAX_LIMIT,
  MAX_BATCH,
  prepareElement,
  summarize,
  valueAt,
  type Box,
  type Difference,
  type ElementType,
} from '../../../common/areas/canvas/elements.js';
import { smallEnough, type ChangeTarget } from '../../../common/change-log.js';
import { MODULE_ID } from '../../../common/constants.js';
import { afterWriteWarning, errorText, settleWrite } from '../../client-errors.js';
import type { QueryHandler } from '../../dispatcher.js';
import { folderCreationFlags } from '../../folders.js';
import { requireWorld } from '../../world-ready.js';
import {
  argsOf,
  chooseScene,
  elementsOf,
  elementTypeOf,
  fail,
  finite,
  freshScene,
  idsIn,
  listIn,
  numberIn,
  operation,
  optionalBoolean,
  READ,
  SCENE_DELETE,
  SCENE_UPDATE,
  sceneInfo,
  type ChosenScene,
} from './support.js';

const dryRunOf = (data: unknown) => argsOf(data)['dryRun'] === true;

function sceneLabel(chosen: ChosenScene): string {
  return `"${chosen.scene.name ?? ''}" [${chosen.scene.id}]`;
}

function target(type: ElementType, id: string, scene: FoundryCanvasScene): ChangeTarget {
  const { documentName } = ELEMENT_KINDS[type];
  return { id, uuid: `${scene.uuid}.${documentName}.${id}`, documentName };
}

function show(value: unknown): string {
  const text = JSON.stringify(value);
  return text === undefined ? 'nothing' : text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function differenceText(list: Difference[]): string {
  return list.map(d => `${d.path} is ${show(d.stored)} instead of ${show(d.requested)}`).join('; ');
}

/** The ids of a batch that are not elements of this type on the scene, with a hint where they are. */
function missingIds(chosen: ChosenScene, type: ElementType, ids: string[]): string | null {
  const collection = elementsOf(chosen.scene, type);
  const missing = ids.filter(id => !collection.get(id));
  if (!missing.length) return null;
  const hints: string[] = [];
  for (const id of missing) {
    const other = ELEMENT_TYPES.find(
      kind => kind !== type && elementsOf(chosen.scene, kind).get(id)
    );
    if (other) hints.push(`${id} is a ${other}`);
  }
  return (
    `No ${type} with the id ${missing.join(', ')} on the scene ${sceneLabel(chosen)}.` +
    (hints.length ? ` ${hints.join('; ')}.` : ' list-canvas-elements shows the ids.') +
    ' Nothing was changed.'
  );
}

function boundsOf(args: Record<string, unknown>): Box | null {
  const value = args['bounds'];
  if (value === undefined || value === null) return null;
  if (
    !isRecord(value) ||
    !finite(value['x']) ||
    !finite(value['y']) ||
    !finite(value['width']) ||
    !finite(value['height'])
  )
    fail('INVALID_ARGUMENT', 'bounds must have x, y, width and height as numbers, in pixels');
  return { x: value['x'], y: value['y'], width: value['width'], height: value['height'] };
}

export const listCanvasElements: QueryHandler = {
  access: READ,
  run: data =>
    operation('list canvas elements', () => {
      requireWorld();
      const args = argsOf(data);
      const chosen = chooseScene(args);
      let types: ElementType[] = [...ELEMENT_TYPES];
      if (args['elementTypes'] !== undefined) {
        const list = listIn(args, 'elementTypes', ELEMENT_TYPES.length);
        types = [
          ...new Set(list.map(entry => elementTypeOf({ elementTypes: entry }, 'elementTypes'))),
        ];
      }
      const bounds = boundsOf(args);
      const doorsOnly = optionalBoolean(args, 'doorsOnly') === true;
      const raw = optionalBoolean(args, 'raw') === true;
      const limit =
        numberIn(args, 'limit', { min: 1, max: LIST_MAX_LIMIT, integer: true }) ??
        LIST_DEFAULT_LIMIT;
      const offset = numberIn(args, 'offset', { min: 0, max: 1_000_000, integer: true }) ?? 0;

      const counts: Record<string, number> = {};
      const rows: Array<Record<string, unknown>> = [];
      for (const type of types) {
        const all = elementsOf(chosen.scene, type).contents;
        counts[type] = all.length;
        for (const element of all) {
          const stored = element.toObject();
          if (doorsOnly && (type !== 'wall' || !stored['door'])) continue;
          if (bounds) {
            const box = boxOf(type, stored);
            if (box && !boxesTouch(box, bounds)) continue;
          }
          rows.push({ type, ...(raw ? stored : summarize(type, { ...stored, _id: element.id })) });
        }
      }
      const page = rows.slice(offset, offset + limit);
      const next = offset + page.length < rows.length ? offset + page.length : null;
      return {
        scene: sceneInfo(chosen),
        counts,
        matching: rows.length,
        offset,
        elements: page,
        nextOffset: next,
      };
    }),
};

export const createCanvasElements: QueryHandler = {
  access: data => (dryRunOf(data) ? READ : SCENE_UPDATE),
  run: (data, context) =>
    operation('create canvas elements', async () => {
      requireWorld();
      const args = argsOf(data);
      const type = elementTypeOf(args);
      const chosen = chooseScene(args);
      const kind = ELEMENT_KINDS[type];
      const entries = listIn(args, 'elements', MAX_BATCH);
      const prepared = entries.map(entry => prepareElement(type, entry, 'create'));
      const problems = prepared.flatMap((entry, index) =>
        entry.problems.map(p => `elements[${index}]: ${p}`)
      );
      if (problems.length) fail('INVALID_ARGUMENT', `${problems.join('; ')}. Nothing was created.`);
      const collection = elementsOf(chosen.scene, type);

      if (optionalBoolean(args, 'dryRun') === true) {
        return {
          dryRun: true,
          scene: sceneInfo(chosen),
          type,
          wouldCreate: prepared.length,
          elements: prepared.map(entry => summarize(type, entry.data)),
          refusal: context.accessProblem(SCENE_UPDATE),
        };
      }

      const marker = folderCreationFlags();
      const source = prepared.map(entry => {
        const flags = isRecord(entry.data['flags']) ? entry.data['flags'] : {};
        return { ...entry.data, flags: { ...flags, [MODULE_ID]: marker } };
      });
      const idsBefore = new Set(collection.map(element => element.id));
      // A throw can come after the server created them (client code without a canvas): read back either way.
      const attempt = await settleWrite(() =>
        chosen.scene.createEmbeddedDocuments(kind.documentName, source)
      );
      const stored = elementsOf(freshScene(chosen.scene.id), type);
      const madeIds = (Array.isArray(attempt.value) ? attempt.value : [])
        .map(element => element?.id)
        .filter(Boolean) as string[];
      const found = attempt.threw
        ? stored.map(element => element.id).filter(id => !idsBefore.has(id))
        : madeIds.filter(id => stored.get(id));
      const complete = found.length === source.length;
      const warnings: string[] = [];
      const created = found.map((id, index) => {
        const now = (stored.get(id) as FoundryCanvasElement).toObject();
        if (complete) {
          const { flags: _flags, ...asked } = source[index] as Record<string, unknown>;
          const different = differences(asked, now);
          if (different.length) warnings.push(`${type} ${id}: ${differenceText(different)}.`);
        }
        return { stored: now, summary: summarize(type, { ...now, _id: id }) };
      });

      // What is on the scene is logged even when the call fails, so undo-change can remove it.
      const change = found.length
        ? context.recordChange({
            query: 'createCanvasElements',
            tool: 'create-canvas-elements',
            document: 'Scenes',
            action: 'create',
            targets: found.map(id => target(type, id, chosen.scene)),
            summary: `Created ${found.length} ${kind.plural} on the scene ${sceneLabel(chosen)}.`,
            after: smallEnough(created.map(entry => entry.stored)),
          })
        : null;
      const recorded = change
        ? ` They are recorded as change ${change.id}; undo-change removes them.`
        : '';
      if (!complete && attempt.threw) {
        fail(
          'CREATE_FAILED',
          `Foundry refused to create the ${kind.plural}: ${errorText(attempt.error)}. ` +
            (found.length
              ? `${found.length} of ${source.length} were created before the failure: ${found.join(', ')}.${recorded}`
              : 'None was created.')
        );
      }
      if (!complete) {
        fail(
          'NOT_APPLIED',
          `Foundry reported ${madeIds.length} new ${kind.plural} for ${source.length} asked, and ${found.length} ` +
            `are on the scene when read back${found.length ? `: ${found.join(', ')}.${recorded}` : '.'}`
        );
      }
      if (attempt.threw)
        warnings.unshift(
          afterWriteWarning(
            attempt.error,
            `Read back, all ${found.length} ${kind.plural} are on the scene, and the creation is recorded.`
          )
        );
      return {
        scene: sceneInfo(chosen),
        type,
        created: created.map(entry => entry.summary),
        warnings,
      };
    }),
};

interface PlannedUpdate {
  id: string;
  changes: Record<string, unknown>;
  before: Record<string, unknown>;
}

interface UpdateOutcome {
  /** The planned entries that hold their changes when read back. */
  applied: PlannedUpdate[];
  changed: Array<Record<string, unknown>>;
  warnings: string[];
  after: unknown[];
  notApplied: string[];
  error: unknown;
  threw: boolean;
}

/** Writes and reads back; a throw is kept, because the server may have stored the changes anyway. */
async function writeUpdates(
  chosen: ChosenScene,
  type: ElementType,
  planned: PlannedUpdate[]
): Promise<UpdateOutcome> {
  const kind = ELEMENT_KINDS[type];
  const attempt = await settleWrite(() =>
    chosen.scene.updateEmbeddedDocuments(
      kind.documentName,
      planned.map(entry => ({ _id: entry.id, ...entry.changes }))
    )
  );
  const collection = elementsOf(freshScene(chosen.scene.id), type);
  const warnings: string[] = [];
  const notApplied: string[] = [];
  const applied: PlannedUpdate[] = [];
  const changed: Array<Record<string, unknown>> = [];
  const after: unknown[] = [];
  for (const entry of planned) {
    const element = collection.get(entry.id);
    if (!element) {
      notApplied.push(`${entry.id} is gone`);
      continue;
    }
    const now = element.toObject();
    const different = differences(entry.changes, now);
    const untouched = different.filter(
      d => JSON.stringify(valueAt(entry.before, d.path) ?? null) === JSON.stringify(d.stored)
    );
    if (untouched.length === Object.keys(entry.changes).length) {
      notApplied.push(`${entry.id}: ${differenceText(untouched)}`);
      continue;
    }
    if (different.length) warnings.push(`${type} ${entry.id}: ${differenceText(different)}.`);
    applied.push(entry);
    after.push(now);
    changed.push(summarize(type, { ...now, _id: entry.id }));
  }
  if (attempt.threw && !notApplied.length)
    warnings.unshift(
      afterWriteWarning(
        attempt.error,
        `Read back, all ${applied.length} ${kind.plural} hold the changes, and the change is recorded.`
      )
    );
  return {
    applied,
    changed,
    warnings,
    after,
    notApplied,
    error: attempt.error,
    threw: attempt.threw,
  };
}

/** Fails for what does not hold its changes, after the caller recorded what does. */
function failUnapplied(outcome: UpdateOutcome, type: ElementType, changeId: string | null): void {
  if (!outcome.notApplied.length) return;
  const kind = ELEMENT_KINDS[type];
  const others = outcome.changed.length
    ? ` The others were changed: ${outcome.changed.map(c => String(c['id'])).join(', ')}` +
      (changeId ? `, recorded as change ${changeId}; undo-change restores them.` : '.')
    : '';
  if (outcome.threw)
    fail(
      'UPDATE_FAILED',
      `Foundry refused to change the ${kind.plural}: ${errorText(outcome.error)}. Read back, these do not hold ` +
        `the changes: ${outcome.notApplied.join('; ')}.${others}`
    );
  fail(
    'NOT_APPLIED',
    `Foundry did not store the changes of ${outcome.notApplied.join('; ')}.${others}`
  );
}

export const updateCanvasElements: QueryHandler = {
  access: data => (dryRunOf(data) ? READ : SCENE_UPDATE),
  run: (data, context) =>
    operation('update canvas elements', async () => {
      requireWorld();
      const args = argsOf(data);
      const type = elementTypeOf(args);
      const chosen = chooseScene(args);
      const kind = ELEMENT_KINDS[type];
      const entries = listIn(args, 'updates', MAX_BATCH);
      const problems: string[] = [];
      const ids: string[] = [];
      const prepared = entries.map((entry, index) => {
        if (!isRecord(entry) || typeof entry['id'] !== 'string' || !entry['id'].trim()) {
          problems.push(`updates[${index}]: needs an id and changes`);
          return { id: '', changes: {} };
        }
        const id = entry['id'].trim();
        if (ids.includes(id))
          problems.push(`updates[${index}]: the id ${id} appears twice; merge its changes`);
        ids.push(id);
        const result = prepareElement(type, entry['changes'], 'update');
        problems.push(...result.problems.map(p => `updates[${index}] (${id}): ${p}`));
        return { id, changes: result.data };
      });
      if (problems.length) fail('INVALID_ARGUMENT', `${problems.join('; ')}. Nothing was changed.`);
      const missing = missingIds(chosen, type, ids);
      if (missing) fail('NOT_FOUND', missing);

      const collection = elementsOf(chosen.scene, type);
      const planned: PlannedUpdate[] = [];
      const unchanged: string[] = [];
      for (const entry of prepared) {
        const before = (collection.get(entry.id) as FoundryCanvasElement).toObject();
        if (type === 'wall' && finite(entry.changes['ds']) && entry.changes['ds'] !== 0) {
          const door = entry.changes['door'] ?? before['door'];
          if (!door)
            fail(
              'INVALID_ARGUMENT',
              `wall ${entry.id} is no door, so it has no door state. Nothing was changed.`
            );
        }
        if (differences(entry.changes, before).length === 0) unchanged.push(entry.id);
        else planned.push({ id: entry.id, changes: entry.changes, before });
      }

      if (optionalBoolean(args, 'dryRun') === true) {
        return {
          dryRun: true,
          scene: sceneInfo(chosen),
          type,
          wouldChange: planned.map(entry => ({
            id: entry.id,
            fields: differences(entry.changes, entry.before).map(d => ({
              path: d.path,
              from: d.stored,
              to: d.requested,
            })),
          })),
          unchanged,
          refusal: planned.length ? context.accessProblem(SCENE_UPDATE) : null,
        };
      }
      if (!planned.length)
        return { scene: sceneInfo(chosen), type, changed: [], unchanged, warnings: [] };

      const result = await writeUpdates(chosen, type, planned);
      const change = result.applied.length
        ? context.recordChange({
            query: 'updateCanvasElements',
            tool: 'update-canvas-elements',
            document: 'Scenes',
            action: 'update',
            targets: result.applied.map(entry => target(type, entry.id, chosen.scene)),
            summary: `Changed ${result.applied.length} ${kind.plural} on the scene ${sceneLabel(chosen)}.`,
            before: smallEnough(result.applied.map(entry => entry.before)),
            after: smallEnough(result.after),
          })
        : null;
      failUnapplied(result, type, change?.id ?? null);
      return {
        scene: sceneInfo(chosen),
        type,
        changed: result.changed,
        unchanged,
        warnings: result.warnings,
      };
    }),
};

export const setDoorState: QueryHandler = {
  access: data => (dryRunOf(data) ? READ : SCENE_UPDATE),
  run: (data, context) =>
    operation('set the door state', async () => {
      requireWorld();
      const args = argsOf(data);
      const chosen = chooseScene(args);
      const state = args['state'];
      if (typeof state !== 'string' || DOOR_STATES[state] === undefined)
        fail('INVALID_ARGUMENT', `state must be one of ${Object.keys(DOOR_STATES).join(', ')}`);
      const ds = DOOR_STATES[state] as number;
      const ids = idsIn(args, 'wallIds', MAX_BATCH);
      const missing = missingIds(chosen, 'wall', ids);
      if (missing) fail('NOT_FOUND', missing);
      const walls = elementsOf(chosen.scene, 'wall');
      const notDoors = ids.filter(
        id => !(walls.get(id) as FoundryCanvasElement).toObject()['door']
      );
      if (notDoors.length)
        fail(
          'NOT_A_DOOR',
          `These walls are no doors: ${notDoors.join(', ')}. Nothing was changed.`
        );
      const planned: PlannedUpdate[] = [];
      const unchanged: string[] = [];
      for (const id of ids) {
        const before = (walls.get(id) as FoundryCanvasElement).toObject();
        if ((before['ds'] ?? 0) === ds) unchanged.push(id);
        else planned.push({ id, changes: { ds }, before });
      }
      if (optionalBoolean(args, 'dryRun') === true) {
        return {
          dryRun: true,
          scene: sceneInfo(chosen),
          state,
          wouldChange: planned.map(entry => entry.id),
          unchanged,
          refusal: planned.length ? context.accessProblem(SCENE_UPDATE) : null,
        };
      }
      if (!planned.length)
        return { scene: sceneInfo(chosen), state, changed: [], unchanged, warnings: [] };
      const result = await writeUpdates(chosen, 'wall', planned);
      const change = result.applied.length
        ? context.recordChange({
            query: 'setDoorState',
            tool: 'set-door-state',
            document: 'Scenes',
            action: 'update',
            targets: result.applied.map(entry => target('wall', entry.id, chosen.scene)),
            summary: `Set ${result.applied.length} doors to ${state} on the scene ${sceneLabel(chosen)}.`,
            before: smallEnough(result.applied.map(entry => entry.before)),
            after: smallEnough(result.after),
          })
        : null;
      failUnapplied(result, 'wall', change?.id ?? null);
      return {
        scene: sceneInfo(chosen),
        state,
        changed: result.changed.map(entry => entry['id']),
        unchanged,
        warnings: result.warnings,
      };
    }),
};

export const deleteCanvasElements: QueryHandler = {
  access: data => (dryRunOf(data) ? READ : SCENE_DELETE),
  run: (data, context) =>
    operation('delete canvas elements', async () => {
      requireWorld();
      const args = argsOf(data);
      const type = elementTypeOf(args);
      const chosen = chooseScene(args);
      const kind = ELEMENT_KINDS[type];
      const ids = idsIn(args, 'ids', MAX_BATCH);
      const missing = missingIds(chosen, type, ids);
      if (missing) fail('NOT_FOUND', missing);
      const collection = elementsOf(chosen.scene, type);
      const before = ids.map(id => (collection.get(id) as FoundryCanvasElement).toObject());

      if (optionalBoolean(args, 'dryRun') === true) {
        return {
          dryRun: true,
          scene: sceneInfo(chosen),
          type,
          wouldDelete: before.map((entry, index) => summarize(type, { ...entry, _id: ids[index] })),
          refusal: context.accessProblem(SCENE_DELETE),
        };
      }

      // Foundry 14 without a drawn canvas throws from _onDeleteOperation after the server deleted them.
      const attempt = await settleWrite(() =>
        chosen.scene.deleteEmbeddedDocuments(kind.documentName, ids)
      );
      const left = elementsOf(freshScene(chosen.scene.id), type);
      const gone = ids.filter(id => !left.get(id));
      const still = ids.filter(id => left.get(id));

      // What is gone is logged with its state before, even when the call fails, so undo-change can recreate it.
      const change = gone.length
        ? context.recordChange({
            query: 'deleteCanvasElements',
            tool: 'delete-canvas-elements',
            document: 'Scenes',
            action: 'delete',
            targets: gone.map(id => target(type, id, chosen.scene)),
            summary: `Deleted ${gone.length} ${kind.plural} from the scene ${sceneLabel(chosen)}.`,
            before: smallEnough(before.filter((_, index) => !left.get(ids[index] as string))),
          })
        : null;
      if (still.length) {
        fail(
          attempt.threw ? 'DELETE_FAILED' : 'NOT_APPLIED',
          (attempt.threw
            ? `Foundry refused to delete the ${kind.plural}: ${errorText(attempt.error)}. `
            : '') +
            `These ${kind.plural} are still on the scene when read back: ${still.join(', ')}. ` +
            (change
              ? `Deleted all the same: ${gone.join(', ')}, recorded as change ${change.id}; undo-change recreates them.`
              : 'None was deleted.')
        );
      }
      const warnings = attempt.threw
        ? [
            afterWriteWarning(
              attempt.error,
              `Read back, all ${ids.length} ${kind.plural} are gone, and the deletion is recorded, so undo-change can recreate them.`
            ),
          ]
        : [];
      return { scene: sceneInfo(chosen), type, deleted: ids, warnings };
    }),
};
