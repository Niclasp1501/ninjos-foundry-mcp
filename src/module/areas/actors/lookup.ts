/**
 * One rule to find an actor, for every tool of the actors area.
 *
 * In this order, and each step either finds exactly one or stops:
 * 1. the id of a world actor
 * 2. the exact name
 * 3. the name ignoring case
 * 4. the id of a token in any scene
 *
 * Two actors on one step are an error that lists them. There is no partial
 * match on any path: before, four rules existed, and on writing paths "Ann"
 * could change "Joanna". A miss names the actors whose
 * name contains the text, so the model can pick one and ask again.
 */
import { QueryError } from '../../dispatcher.js';
import { actors, describeDocuments, invalid, quoteList, scenes } from './common.js';

export interface ActorMatch {
  actor: FoundryActorsActor;
  via: 'id' | 'name' | 'token';
  /** When found through a token. `linked` false: the token's own copy of the actor. */
  token?: { id: string; sceneId: string; sceneName: string; linked: boolean };
}

export interface FindActorOptions {
  /** Resolve a token to the world actor even when it is not linked (ownership lives there). */
  worldActor?: boolean;
}

function byToken(identifier: string, options: FindActorOptions): ActorMatch | null {
  for (const scene of scenes().contents) {
    const token = scene.tokens?.get(identifier);
    if (!token) continue;
    const linked = token.actorLink === true;
    const where = { id: token.id, sceneId: scene.id, sceneName: scene.name, linked };
    if (!linked && !options.worldActor && token.actor)
      return { actor: token.actor, via: 'token', token: where };
    const world = token.actorId ? actors().get(token.actorId) : undefined;
    if (!world) {
      throw new QueryError(
        'NOT_FOUND',
        `Token "${identifier}" in scene "${scene.name}" points at actor "${token.actorId ?? ''}", which is not in the world.`
      );
    }
    return { actor: world, via: 'token', token: where };
  }
  return null;
}

/** The actor or null; throws on ambiguity and on an empty identifier. */
export function tryFindActor(
  identifier: string,
  options: FindActorOptions = {}
): ActorMatch | null {
  const wanted = identifier.trim();
  if (!wanted) throw invalid('The actor identifier is empty. Pass an actor id or its exact name.');

  const byId = actors().get(wanted);
  if (byId) return { actor: byId, via: 'id' };

  const lower = wanted.toLowerCase();
  const steps: Array<[string, (actor: FoundryActorsActor) => boolean]> = [
    ['named', actor => actor.name === wanted],
    ['named, ignoring case,', actor => (actor.name ?? '').toLowerCase() === lower],
  ];
  for (const [how, test] of steps) {
    const found = actors().filter(test);
    if (found.length === 1) return { actor: found[0] as FoundryActorsActor, via: 'name' };
    if (found.length > 1) {
      throw new QueryError(
        'AMBIGUOUS',
        `${found.length} actors are ${how} "${wanted}": ${describeDocuments(found)}. Pass the id instead.`
      );
    }
  }
  return byToken(wanted, options);
}

export function findActor(identifier: string, options: FindActorOptions = {}): ActorMatch {
  const match = tryFindActor(identifier, options);
  if (match) return match;
  const lower = identifier.trim().toLowerCase();
  const similar = actors()
    .filter(actor => (actor.name ?? '').toLowerCase().includes(lower))
    .slice(0, 10);
  throw new QueryError(
    'NOT_FOUND',
    `Actor "${identifier.trim()}" not found: no world actor has this id or exact name (also ignoring case), and no token in any scene has this id. ` +
      (similar.length
        ? `Actors whose name contains it: ${describeDocuments(similar)}. Pass one of these exactly.`
        : 'No actor name contains it either; list-characters shows every actor.')
  );
}

/** An item on an actor by id, exact name or name ignoring case; ambiguity is an error. */
export function findItemOnActor(
  actor: FoundryActorsActor,
  identifier: string
): FoundryActorsItem | null {
  const wanted = identifier.trim();
  if (!wanted) throw invalid('The item identifier is empty. Pass an item id or its exact name.');
  const byId = actor.items.get(wanted);
  if (byId) return byId;
  const lower = wanted.toLowerCase();
  for (const test of [
    (item: FoundryActorsItem) => item.name === wanted,
    (item: FoundryActorsItem) => (item.name ?? '').toLowerCase() === lower,
  ]) {
    const found = actor.items.filter(test);
    if (found.length === 1) return found[0] as FoundryActorsItem;
    if (found.length > 1) {
      throw new QueryError(
        'AMBIGUOUS',
        `${found.length} items on "${actor.name}" are named "${wanted}": ${describeDocuments(found)}. Pass the id instead.`
      );
    }
  }
  return null;
}

export function itemNotFound(actor: FoundryActorsActor, identifier: string): QueryError {
  const lower = identifier.trim().toLowerCase();
  const similar = actor.items
    .filter(item => (item.name ?? '').toLowerCase().includes(lower))
    .slice(0, 10);
  return new QueryError(
    'NOT_FOUND',
    `Item "${identifier.trim()}" not found on actor "${actor.name}" (id ${actor.id}). ` +
      (similar.length
        ? `Items whose name contains it: ${describeDocuments(similar)}.`
        : `It has ${actor.items.size} item(s); search-character-items lists them.`)
  );
}

export { quoteList };
