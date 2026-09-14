/**
 * Ownership of actors: changeActorOwnership (this generation), getActorOwnership,
 * and for servers of the previous generation getFriendlyNPCs,
 * getPartyCharacters, getConnectedPlayers, findPlayers, findActor and
 * setActorOwnership.
 *
 * Rules:
 * - Actors by the one lookup rule, players by id or exact name ignoring case,
 *   then as the owners of an actor of that exact name. No partial matches.
 * - The fixed phrases match as whole phrases, not as parts of a text.
 * - A Gamemaster is never a target.
 * - More than one actor or player needs confirmBulkOperation, also when removing.
 * - Removing deletes the player's explicit entry instead of writing NONE, so a
 *   higher default level of the actor applies again, and the answer says so.
 * - Every pair is read back.
 */
import {
  ALL_ACTORS,
  FRIENDLY_NPCS,
  PARTY,
  PARTY_CHARACTERS,
  levelName,
  levelNumber,
  phrase,
} from '../../../common/areas/actors/ownership.js';
import { QueryError, type HandlerContext, type QueryHandler } from '../../dispatcher.js';
import { requireWorld } from '../../world-ready.js';
import {
  actors,
  activeScene,
  describeDocuments,
  idOf,
  inputOf,
  invalid,
  messageOf,
  quoteList,
  textOf,
  users,
} from './common.js';
import { findActor, tryFindActor } from './lookup.js';

const FRIENDLY = 1;
const OWNER = 3;

type Data = Record<string, unknown>;

function explicitLevel(actor: FoundryActorsActor, userId: string): number | null {
  const value = actor.ownership?.[userId];
  return typeof value === 'number' ? value : null;
}

function defaultLevel(actor: FoundryActorsActor): number {
  const value = actor.ownership?.['default'];
  return typeof value === 'number' && value >= 0 ? value : 0;
}

function effectiveLevel(actor: FoundryActorsActor, userId: string): number {
  const explicit = explicitLevel(actor, userId);
  return explicit !== null && explicit >= 0 ? explicit : defaultLevel(actor);
}

function players(): FoundryActorsUser[] {
  return users().contents.filter(user => !user.isGM);
}

function hasPlayerOwner(actor: FoundryActorsActor): boolean {
  return players().some(user => effectiveLevel(actor, user.id) === OWNER);
}

function friendlyNpcs(): FoundryActorsActor[] {
  const scene = activeScene();
  if (!scene) {
    throw new QueryError(
      'NO_ACTIVE_SCENE',
      `"${FRIENDLY_NPCS}" means the friendly tokens of the active scene, and no scene is active.`
    );
  }
  const found = new Map<string, FoundryActorsActor>();
  for (const token of scene.tokens.contents) {
    if (token.disposition !== FRIENDLY || !token.actorId) continue;
    const actor = actors().get(token.actorId);
    if (actor && !hasPlayerOwner(actor)) found.set(actor.id, actor);
  }
  return [...found.values()];
}

function partyCharacters(): FoundryActorsActor[] {
  return actors().filter(hasPlayerOwner);
}

function resolveActors(identifier: string): FoundryActorsActor[] {
  const wanted = phrase(identifier);
  if (wanted === FRIENDLY_NPCS) return friendlyNpcs();
  if (wanted === PARTY_CHARACTERS) return partyCharacters();
  return [findActor(identifier, { worldActor: true }).actor];
}

function describeUsers(list: readonly FoundryActorsUser[]): string {
  return list.map(user => `"${user.name}" (id ${user.id})`).join(', ');
}

/** Players for an identifier, or null when nothing matches. Throws for a Gamemaster and on ambiguity. */
function tryResolvePlayers(identifier: string): FoundryActorsUser[] | null {
  const wanted = identifier.trim();
  if (!wanted) throw invalid('The player identifier is empty.');
  if (phrase(wanted) === PARTY) {
    const connected = players().filter(user => user.active);
    if (!connected.length)
      throw new QueryError(
        'NOT_FOUND',
        `"${PARTY}" means every connected player, and no player is connected.`
      );
    return connected;
  }
  const all = users().contents;
  const lower = wanted.toLowerCase();
  const byId = all.filter(user => user.id === wanted);
  const named = byId.length ? byId : all.filter(user => user.name.toLowerCase() === lower);
  if (named.length > 1) {
    throw new QueryError(
      'AMBIGUOUS',
      `${named.length} users are named "${wanted}": ${describeUsers(named)}. Pass the id.`
    );
  }
  const user = named[0];
  if (user) {
    if (user.isGM) {
      throw new QueryError(
        'GAMEMASTER_TARGET',
        `"${user.name}" is a Gamemaster. Gamemasters see and control every actor, so their ownership is never changed.`
      );
    }
    return [user];
  }
  const characters = actors().filter(actor => (actor.name ?? '').toLowerCase() === lower);
  if (!characters.length) return null;
  const owners = new Map<string, FoundryActorsUser>();
  for (const actor of characters) {
    for (const player of players()) {
      if (idOf(player.character) === actor.id || explicitLevel(actor, player.id) === OWNER)
        owners.set(player.id, player);
    }
  }
  return owners.size ? [...owners.values()] : null;
}

function resolvePlayers(identifier: string): FoundryActorsUser[] {
  const found = tryResolvePlayers(identifier);
  if (found) return found;
  const names = players().map(user => user.name);
  throw new QueryError(
    'NOT_FOUND',
    `Player "${identifier.trim()}" not found: no user has this id or name, and no actor of this name has a player as owner. ` +
      `Players: ${names.length ? quoteList(names) : 'none'}.`
  );
}

interface PairResult extends Data {
  actorId: string;
  actorName: string;
  playerId: string;
  playerName: string;
  success: boolean;
  changed: boolean;
}

async function applyOwnership(
  actor: FoundryActorsActor,
  targets: readonly FoundryActorsUser[],
  level: number | null,
  context: HandlerContext,
  tool: string
): Promise<PairResult[]> {
  const before = targets.map(user => ({
    explicit: explicitLevel(actor, user.id),
    effective: effectiveLevel(actor, user.id),
  }));
  const changes: Data = {};
  targets.forEach((user, index) => {
    const had = before[index]?.explicit ?? null;
    if (level === null) {
      if (had !== null) changes[`ownership.-=${user.id}`] = null;
    } else if (had !== level) {
      changes[`ownership.${user.id}`] = level;
    }
  });

  let failure: string | null = null;
  if (Object.keys(changes).length) {
    const ownershipBefore = { ...(actor.ownership ?? {}) };
    try {
      await actor.update(changes);
      context.recordChange({
        query: 'changeActorOwnership',
        tool,
        document: 'Actors',
        action: 'update',
        targets: [{ id: actor.id, uuid: actor.uuid, name: actor.name }],
        summary: `${level === null ? 'Removed the explicit ownership of' : `Set ownership ${levelName(level)} for`} ${targets.map(user => user.name).join(', ')} on actor "${actor.name}".`,
        before: { ownership: ownershipBefore },
        after: { ownership: { ...(actors().get(actor.id)?.ownership ?? {}) } },
      });
    } catch (error) {
      failure = messageOf(error);
    }
  }

  const current = actors().get(actor.id) ?? actor;
  return targets.map((user, index) => {
    const was = before[index] as { explicit: number | null; effective: number };
    const explicit = explicitLevel(current, user.id);
    const effective = effectiveLevel(current, user.id);
    const wanted = level === null ? explicit === null : explicit === level;
    const changed = level === null ? was.explicit !== null : was.explicit !== level;
    const base = {
      actorId: actor.id,
      actorName: actor.name,
      playerId: user.id,
      playerName: user.name,
      before: { explicit: was.explicit, effective: levelName(was.effective) },
      after: { explicit, effective: levelName(effective) },
    };
    if (failure || !wanted) {
      return {
        ...base,
        success: false,
        changed: false,
        message: failure
          ? `Could not change "${actor.name}" for ${user.name}: ${failure}`
          : `"${actor.name}" for ${user.name} reads back as ${explicit === null ? 'no explicit entry' : levelName(explicit)} instead of ${level === null ? 'no explicit entry' : levelName(level)}.`,
      };
    }
    let message: string;
    if (level === null) {
      message = changed
        ? `Removed the explicit ownership of ${user.name} on "${actor.name}".`
        : `${user.name} had no explicit ownership on "${actor.name}"; nothing to remove.`;
      if (effective > 0)
        message += ` ${user.name} still has ${levelName(effective)} through the default level of the actor.`;
    } else {
      message = changed
        ? `Set ${actor.name} ownership to ${levelName(level)} for ${user.name}.`
        : `${user.name} already had ${levelName(level)} on "${actor.name}"; unchanged.`;
    }
    return {
      ...base,
      success: true,
      changed,
      message,
      ...(level === null && effective > 0 ? { warning: 'default level still grants access' } : {}),
    };
  });
}

export const changeActorOwnership: QueryHandler = {
  access: { kind: 'write', document: 'Actors', action: 'update' },
  run: async (data, context) => {
    requireWorld();
    const input = inputOf(data);
    const remove = input['remove'] === true;
    const tool = remove ? 'remove-actor-ownership' : 'assign-actor-ownership';
    const actorIdentifier = textOf(input['actorIdentifier']);
    const playerIdentifier = textOf(input['playerIdentifier']);
    if (!actorIdentifier) throw invalid('actorIdentifier is required.');
    if (!playerIdentifier) throw invalid('playerIdentifier is required.');
    const level = remove ? null : levelNumber(input['permissionLevel']);
    if (!remove && level === null)
      throw invalid('permissionLevel must be one of NONE, LIMITED, OBSERVER, OWNER.');

    const targets = resolveActors(actorIdentifier);
    if (!targets.length) {
      throw new QueryError(
        'NOT_FOUND',
        `"${actorIdentifier}" matches no actor, so nothing was changed.`
      );
    }
    const people = resolvePlayers(playerIdentifier);
    const pairs = targets.length * people.length;
    if (remove && input['confirmRemoval'] !== true) {
      throw new QueryError(
        'NEEDS_CONFIRMATION',
        `Nothing was changed. Removing the ownership of ${describeUsers(people)} on ${describeDocuments(targets)} needs confirmRemoval set to true.`
      );
    }
    if ((targets.length > 1 || people.length > 1) && input['confirmBulkOperation'] !== true) {
      throw new QueryError(
        'NEEDS_CONFIRMATION',
        `Bulk operation detected: ${targets.length} actors × ${people.length} players = ${pairs} ownership changes. Nothing was changed. ` +
          `Actors: ${describeDocuments(targets.slice(0, 20))}${targets.length > 20 ? ' and more' : ''}. Players: ${describeUsers(people)}. ` +
          'Set confirmBulkOperation to true to proceed.'
      );
    }

    const results: PairResult[] = [];
    for (const actor of targets)
      results.push(...(await applyOwnership(actor, people, level, context, tool)));
    const failed = results.filter(result => !result.success);
    const changed = results.filter(result => result.success && result.changed).length;
    const unchanged = results.length - failed.length - changed;
    const summary =
      `${results.length - failed.length} ownership ${remove ? 'removals' : 'assignments'} completed` +
      ` (${changed} changed, ${unchanged} unchanged)${failed.length ? `, ${failed.length} failed` : ''}`;
    // `success` false only when nothing worked, so a partial result is not read as a total failure.
    return {
      success: failed.length < results.length,
      allSucceeded: failed.length === 0,
      mode: remove ? 'remove' : 'assign',
      level: level === null ? null : levelName(level),
      summary,
      results,
      ...(failed.length === results.length
        ? { error: `${summary}: ${failed.map(result => result['message']).join(' ')}` }
        : {}),
    };
  },
};

export const getActorOwnership: QueryHandler = {
  access: { kind: 'read' },
  run: data => {
    requireWorld();
    const input = inputOf(data);
    const actorIdentifier = textOf(input['actorIdentifier']);
    const playerIdentifier = textOf(input['playerIdentifier']);
    const list =
      !actorIdentifier || phrase(actorIdentifier) === ALL_ACTORS
        ? actors().contents
        : [findActor(actorIdentifier, { worldActor: true }).actor];
    let shown = players();
    if (playerIdentifier) {
      const lower = playerIdentifier.toLowerCase();
      const user =
        users().contents.find(entry => entry.id === playerIdentifier) ??
        users().contents.find(entry => entry.name.toLowerCase() === lower);
      if (!user) {
        throw new QueryError(
          'NOT_FOUND',
          `Player "${playerIdentifier}" not found. Players: ${quoteList(players().map(entry => entry.name))}.`
        );
      }
      if (user.isGM)
        throw new QueryError(
          'GAMEMASTER_TARGET',
          `"${user.name}" is a Gamemaster and owns every actor.`
        );
      shown = [user];
    }
    return list.map(actor => ({
      id: actor.id,
      name: actor.name,
      type: actor.type,
      defaultLevel: levelName(defaultLevel(actor)),
      players: shown.map(user => {
        const effective = effectiveLevel(actor, user.id);
        return {
          id: user.id,
          name: user.name,
          level: effective,
          levelName: levelName(effective),
          explicit: explicitLevel(actor, user.id) !== null,
        };
      }),
    }));
  },
};

// Queries of a server of the previous generation -------------------------------------

const ref = (entry: { id: string; name: string }) => ({ id: entry.id, name: entry.name });

export const getFriendlyNPCs: QueryHandler = {
  access: { kind: 'read' },
  run: () => {
    requireWorld();
    return friendlyNpcs().map(ref);
  },
};

export const getPartyCharacters: QueryHandler = {
  access: { kind: 'read' },
  run: () => {
    requireWorld();
    return partyCharacters().map(ref);
  },
};

export const getConnectedPlayers: QueryHandler = {
  access: { kind: 'read' },
  run: () => {
    requireWorld();
    return players()
      .filter(user => user.active)
      .map(ref);
  },
};

export const findPlayers: QueryHandler = {
  access: { kind: 'read' },
  run: data => {
    requireWorld();
    // allowPartialMatch of the previous server is not honoured: no partial matches.
    return (tryResolvePlayers(textOf(inputOf(data)['identifier'])) ?? []).map(ref);
  },
};

export const findActorQuery: QueryHandler = {
  access: { kind: 'read' },
  run: data => {
    requireWorld();
    const match = tryFindActor(textOf(inputOf(data)['identifier']), { worldActor: true });
    return match ? ref(match.actor) : null;
  },
};

export const setActorOwnership: QueryHandler = {
  access: { kind: 'write', document: 'Actors', action: 'update' },
  run: async (data, context) => {
    requireWorld();
    const input = inputOf(data);
    const actor = actors().get(textOf(input['actorId']));
    if (!actor) throw new QueryError('NOT_FOUND', `Actor "${textOf(input['actorId'])}" not found.`);
    const user = users().contents.find(entry => entry.id === textOf(input['userId']));
    if (!user) throw new QueryError('NOT_FOUND', `User "${textOf(input['userId'])}" not found.`);
    if (user.isGM) {
      throw new QueryError(
        'GAMEMASTER_TARGET',
        `"${user.name}" is a Gamemaster; their ownership is never changed.`
      );
    }
    const level = levelNumber(input['permission']);
    if (level === null) throw invalid('permission must be a number from 0 to 3.');
    // The previous server removes by writing 0; its meaning is kept for it.
    const [result] = await applyOwnership(actor, [user], level, context, 'assign-actor-ownership');
    if (!result?.success)
      throw new QueryError('NOT_APPLIED', String(result?.['message'] ?? 'Ownership not applied'));
    return { success: true, message: result['message'] };
  },
};
