/**
 * manage-actors on the module side: createActors, updateActors, deleteActors,
 * addActorsToScene, updateActorItems, deleteActorItems.
 *
 * Common to all of them: every target is found (with the one lookup rule of
 * lookup.ts, deleting by id only) before the first write; what was not found
 * is named; each write is read back, and values the data model did not store
 * as given are listed in `mismatches` instead of hidden behind "updated".
 */
import type { PlacementKind, Point } from '../../../common/areas/actors/placement.js';
import { QueryError, type HandlerContext, type QueryHandler } from '../../dispatcher.js';
import { systemAnswer } from '../../game-systems.js';
import { requireWorld } from '../../world-ready.js';
import {
  actors,
  describeDocuments,
  documentClass,
  expandDotted,
  idOf,
  inputOf,
  invalid,
  isRecord,
  messageOf,
  mismatches,
  quoteList,
  records,
  requireActiveScene,
  requireValidTypes,
  requireWithinLimit,
  textList,
  textOf,
} from './common.js';
import { ACTOR_FOLDER, resolveFolder } from './folders.js';
import { findActor, tryFindActor, type ActorMatch } from './lookup.js';
import { placeActorTokens } from './tokens.js';

type Data = Record<string, unknown>;
const TOOL = 'manage-actors';

/** Free `system` data with dotted keys expanded and brought into the system's shape by the adapter. */
function systemData(
  raw: unknown,
  actorType: string,
  mode: 'create' | 'update',
  notes: string[]
): Data | undefined {
  if (!isRecord(raw)) return undefined;
  const expanded = expandDotted(raw) as Data;
  const answer = systemAnswer('actorData');
  if (answer.fallbackFor.includes('normalize')) {
    notes.push(
      `No adapter for the game system "${answer.system.rawId}" reshapes system data; it was written as given.`
    );
    return expanded;
  }
  try {
    return answer.questions.normalize?.(expanded, { actorType, mode }) ?? expanded;
  } catch (error) {
    throw invalid(
      `The adapter "${answer.system.title}" could not read the system data for "${actorType}": ${messageOf(error)}. Nothing was changed.`
    );
  }
}

function afterWrite(already: string[], failed: string, error: unknown): QueryError {
  return new QueryError(
    'WRITE_FAILED',
    `${failed} failed: ${messageOf(error)}. ` +
      (already.length
        ? `Already changed before it, and still changed: ${quoteList(already)}.`
        : 'Nothing was changed.')
  );
}

export const createActors: QueryHandler = {
  access: { kind: 'write', document: 'Actors', action: 'create' },
  run: async (data, context) => {
    requireWorld();
    const input = inputOf(data);
    const list = records(input['actors']);
    if (!list.length) throw invalid('actors needs at least one entry with name and type.');
    requireWithinLimit(list.length, 'Actors to create');
    const notes: string[] = [];
    const prepared = list.map((entry, index) => {
      const name = textOf(entry['name']);
      const type = textOf(entry['type']);
      if (!name || !type) throw invalid(`actors[${index}] needs a name and a type.`);
      const out: Data = { name, type };
      if (typeof entry['img'] === 'string' && entry['img']) out['img'] = entry['img'];
      const system = systemData(entry['system'], type, 'create', notes);
      if (system) out['system'] = system;
      return out;
    });
    requireValidTypes(
      'Actor',
      prepared.map(entry => entry['type'] as string)
    );

    const folder = await resolveFolder(textOf(input['folder']) || ACTOR_FOLDER, 'Actor', {
      context,
      query: 'createActors',
      tool: TOOL,
    });
    for (const entry of prepared) entry['folder'] = folder.id;

    const ActorClass = documentClass('Actor');
    let made: unknown[];
    try {
      made = ActorClass.createDocuments
        ? await ActorClass.createDocuments(prepared)
        : [await ActorClass.create(prepared[0] as Data)];
    } catch (error) {
      throw new QueryError('NOT_CREATED', `The actors could not be created: ${messageOf(error)}`);
    }
    const created = made.map(document => actors().get(idOf(document) ?? ''));
    if (created.some(actor => !actor) || created.length !== prepared.length) {
      throw new QueryError(
        'NOT_APPLIED',
        `${prepared.length} actor(s) were written, but only ${created.filter(Boolean).length} are in the world when read back.`
      );
    }
    const result = (created as FoundryActorsActor[]).map(actor => ({
      id: actor.id,
      name: actor.name,
      type: actor.type,
    }));
    context.recordChange({
      query: 'createActors',
      tool: TOOL,
      document: 'Actors',
      action: 'create',
      targets: result.map(actor => ({ id: actor.id, name: actor.name })),
      summary: `Created ${result.length} actor(s) in folder "${folder.path}".`,
    });
    return {
      created: result,
      total: result.length,
      folder: { id: folder.id, path: folder.path },
      createdFolders: folder.created,
      notes: [...new Set(notes)],
    };
  },
};

function currentData(match: ActorMatch): Data {
  const world = match.token && !match.token.linked ? null : actors().get(match.actor.id);
  return (world ?? match.actor).toObject();
}

export const updateActors: QueryHandler = {
  access: { kind: 'write', document: 'Actors', action: 'update' },
  run: async (data, context) => {
    requireWorld();
    const updates = records(inputOf(data)['updates']);
    if (!updates.length) throw invalid('updates needs at least one entry with id.');
    const notes: string[] = [];
    const seen = new Set<string>();
    const plans = updates.map((entry, index) => {
      const identifier = textOf(entry['id']);
      if (!identifier) throw invalid(`updates[${index}].id is required.`);
      const match = findActor(identifier);
      const key = match.actor.uuid;
      if (seen.has(key))
        throw invalid(`updates names actor "${match.actor.name}" twice; merge the changes.`);
      seen.add(key);
      const changes: Data = {};
      if (typeof entry['name'] === 'string' && entry['name'].trim())
        changes['name'] = entry['name'].trim();
      if (typeof entry['img'] === 'string') changes['img'] = entry['img'];
      const system = systemData(entry['system'], match.actor.type, 'update', notes);
      if (system) changes['system'] = system;
      if (!Object.keys(changes).length)
        throw invalid(`updates[${index}] changes nothing; give name, img or system.`);
      return { match, changes };
    });

    const done: string[] = [];
    const updated: Data[] = [];
    for (const { match, changes } of plans) {
      const before = match.actor.toObject();
      try {
        await match.actor.update(changes);
      } catch (error) {
        throw afterWrite(done, `Updating actor "${match.actor.name}" (${match.actor.id})`, error);
      }
      const after = currentData(match);
      const differ = mismatches(changes, after);
      done.push(match.actor.name);
      updated.push({
        id: match.actor.id,
        name: after['name'],
        via: match.via,
        ...(match.token ? { token: match.token } : {}),
        mismatches: differ,
      });
      context.recordChange({
        query: 'updateActors',
        tool: TOOL,
        document: 'Actors',
        action: 'update',
        targets: [{ id: match.actor.id, uuid: match.actor.uuid, name: match.actor.name }],
        summary: `Updated actor "${match.actor.name}".`,
        before,
        after,
      });
    }
    if (updated.some(entry => (entry['mismatches'] as unknown[]).length))
      notes.push(
        'Some values were not stored as written; see mismatches (the data model of the system decides).'
      );
    return { updated, total: updated.length, notes: [...new Set(notes)] };
  },
};

export const deleteActors: QueryHandler = {
  access: { kind: 'write', document: 'Actors', action: 'delete' },
  run: async (data, context) => {
    requireWorld();
    const ids = [...new Set(textList(inputOf(data)['ids']))];
    if (!ids.length) throw invalid('ids needs at least one actor id.');
    const found: FoundryActorsActor[] = [];
    const notFound: Array<{ id: string; reason: string }> = [];
    for (const id of ids) {
      const actor = actors().get(id);
      if (actor) {
        found.push(actor);
        continue;
      }
      const named = actors().filter(entry => entry.name === id);
      notFound.push({
        id,
        reason: named.length
          ? `no actor has this id; it is the name of ${describeDocuments(named)}, and deleting works by id only`
          : 'no actor has this id',
      });
    }
    if (!found.length) {
      throw new QueryError(
        'NOT_FOUND',
        `None of the given actor ids exist, nothing was deleted: ${notFound.map(entry => `"${entry.id}" (${entry.reason})`).join('; ')}.`
      );
    }
    const before = found.map(actor => actor.toObject());
    const ActorClass = documentClass('Actor');
    try {
      if (ActorClass.deleteDocuments)
        await ActorClass.deleteDocuments(found.map(actor => actor.id));
      else for (const actor of found) await actor.delete();
    } catch (error) {
      throw new QueryError('NOT_DELETED', `The actors could not be deleted: ${messageOf(error)}`);
    }
    const still = found.filter(actor => actors().get(actor.id));
    if (still.length) {
      throw new QueryError(
        'NOT_APPLIED',
        `Deleting reported success, but these actors are still in the world: ${describeDocuments(still)}.`
      );
    }
    const deleted = found.map(actor => ({ id: actor.id, name: actor.name, type: actor.type }));
    context.recordChange({
      query: 'deleteActors',
      tool: TOOL,
      document: 'Actors',
      action: 'delete',
      targets: deleted.map(actor => ({ id: actor.id, name: actor.name })),
      summary: `Deleted ${deleted.length} actor(s).`,
      before,
    });
    return { deleted, total: deleted.length, notFound };
  },
};

const PLACE_KINDS: readonly PlacementKind[] = ['random', 'grid', 'center', 'coordinates'];

export const addActorsToScene: QueryHandler = {
  // Tokens are part of the scene; the actors themselves do not change.
  access: { kind: 'write', document: 'Scenes', action: 'update' },
  run: async (data, context) => {
    requireWorld();
    const input = inputOf(data);
    const identifiers = [...new Set(textList(input['actorIds']))];
    if (!identifiers.length) throw invalid('actorIds needs at least one actor id.');
    const kind = (textOf(input['placement']) || 'random') as PlacementKind;
    if (!PLACE_KINDS.includes(kind))
      throw invalid(`placement must be one of ${quoteList([...PLACE_KINDS])}.`);
    const coordinates: Point[] = records(input['coordinates']).map(point => ({
      x: Number(point['x']),
      y: Number(point['y']),
    }));
    requireWithinLimit(identifiers.length, 'Actors to place');
    const scene = requireActiveScene('Placing actors');

    const found: FoundryActorsActor[] = [];
    const notFound: string[] = [];
    for (const identifier of identifiers) {
      const match = tryFindActor(identifier, { worldActor: true });
      if (match) found.push(match.actor);
      else notFound.push(identifier);
    }
    if (!found.length) {
      throw new QueryError(
        'NOT_FOUND',
        `None of the given actors exist, no token was placed: ${quoteList(notFound)}.`
      );
    }
    const warnings: string[] = [];
    const tokens = await placeActorTokens(
      scene,
      found,
      { kind, coordinates, hidden: input['hidden'] === true },
      { context, query: 'addActorsToScene', tool: TOOL, warnings }
    );
    return {
      success: true,
      scene: { id: scene.id, name: scene.name, active: true },
      tokensCreated: tokens.length,
      tokenIds: tokens.map(token => token.id),
      tokens,
      notFound,
      errors: notFound.map(identifier => `Actor "${identifier}" not found`),
      ...(warnings.length ? { warnings } : {}),
    };
  },
};

function itemChanges(entry: Data, index: number): Data {
  const id = textOf(entry['id']);
  if (!id) throw invalid(`itemUpdates[${index}].id is required.`);
  const changes: Data = { _id: id };
  if (typeof entry['name'] === 'string' && entry['name'].trim())
    changes['name'] = entry['name'].trim();
  if (typeof entry['img'] === 'string') changes['img'] = entry['img'];
  if (isRecord(entry['system'])) changes['system'] = expandDotted(entry['system']);
  if (Object.keys(changes).length === 1)
    throw invalid(`itemUpdates[${index}] changes nothing; give name, img or system.`);
  return changes;
}

function actorFrom(input: Data): ActorMatch {
  const identifier = textOf(input['actorIdentifier']);
  if (!identifier) throw invalid('actorIdentifier is required: an actor id or its exact name.');
  return findActor(identifier);
}

function recordItems(
  context: HandlerContext,
  query: string,
  action: 'update' | 'delete',
  actor: FoundryActorsActor,
  list: Array<{ id: string; name: string }>,
  before: unknown
): void {
  context.recordChange({
    query,
    tool: TOOL,
    document: 'Actors',
    action,
    targets: [
      { id: actor.id, uuid: actor.uuid, name: actor.name, documentName: 'Actor' },
      ...list.map(item => ({ id: item.id, name: item.name, documentName: 'Item' })),
    ],
    summary: `${action === 'update' ? 'Updated' : 'Deleted'} ${list.length} item(s) on actor "${actor.name}".`,
    before,
  });
}

export const updateActorItems: QueryHandler = {
  access: { kind: 'write', document: 'Actors', action: 'update' },
  run: async (data, context) => {
    requireWorld();
    const input = inputOf(data);
    const { actor } = actorFrom(input);
    const entries = records(input['itemUpdates']);
    if (!entries.length) throw invalid('itemUpdates needs at least one entry with id.');
    const changes = entries.map(itemChanges);
    const ids = changes.map(change => change['_id'] as string);
    if (new Set(ids).size !== ids.length)
      throw invalid('itemUpdates names an item twice; merge the changes.');
    const missing = ids.filter(id => !actor.items.get(id));
    if (missing.length) {
      throw new QueryError(
        'NOT_FOUND',
        `Item id(s) ${quoteList(missing)} not found on actor "${actor.name}" (id ${actor.id}). Nothing was changed.`
      );
    }
    const before = ids.map(id => actor.items.get(id)?.toObject());
    try {
      await actor.updateEmbeddedDocuments('Item', changes);
    } catch (error) {
      throw new QueryError(
        'NOT_UPDATED',
        `The items of "${actor.name}" could not be updated: ${messageOf(error)}`
      );
    }
    const updated = changes.map(change => {
      const id = change['_id'] as string;
      const item = actor.items.get(id);
      const { _id: _ignored, ...written } = change;
      return {
        id,
        name: item?.name ?? '',
        mismatches: item
          ? mismatches(written, item.toObject())
          : [{ path: '', written, stored: null }],
      };
    });
    recordItems(context, 'updateActorItems', 'update', actor, updated, before);
    return { actorId: actor.id, actorName: actor.name, updated, total: updated.length };
  },
};

export const deleteActorItems: QueryHandler = {
  access: { kind: 'write', document: 'Actors', action: 'delete' },
  run: async (data, context) => {
    requireWorld();
    const input = inputOf(data);
    const { actor } = actorFrom(input);
    const ids = [...new Set(textList(input['itemIds']))];
    if (!ids.length) throw invalid('itemIds needs at least one item id.');
    const found = ids
      .map(id => actor.items.get(id))
      .filter((item): item is FoundryActorsItem => !!item);
    const notFound = ids.filter(id => !actor.items.get(id));
    if (!found.length) {
      throw new QueryError(
        'NOT_FOUND',
        `None of the item ids ${quoteList(ids)} are on actor "${actor.name}" (id ${actor.id}); nothing was deleted.`
      );
    }
    return removeItems(context, 'deleteActorItems', actor, found, notFound, 'deleted');
  },
};

/** Delete items of an actor, read back, record. Shared with removeActorItems. */
export async function removeItems(
  context: HandlerContext,
  query: string,
  actor: FoundryActorsActor,
  found: FoundryActorsItem[],
  notFound: string[],
  field: 'deleted' | 'removed'
): Promise<Data> {
  const before = found.map(item => item.toObject());
  try {
    await actor.deleteEmbeddedDocuments(
      'Item',
      found.map(item => item.id)
    );
  } catch (error) {
    throw new QueryError(
      'NOT_DELETED',
      `The items could not be deleted from "${actor.name}": ${messageOf(error)}`
    );
  }
  const still = found.filter(item => actor.items.get(item.id));
  if (still.length) {
    throw new QueryError(
      'NOT_APPLIED',
      `Deleting reported success, but these items are still on "${actor.name}": ${describeDocuments(still)}.`
    );
  }
  const list = found.map(item => ({ id: item.id, name: item.name, type: item.type }));
  recordItems(context, query, 'delete', actor, list, before);
  return { actorId: actor.id, actorName: actor.name, [field]: list, total: list.length, notFound };
}
