/**
 * Whom a roll request reaches, decided without Foundry.
 *
 * The previous generation took the first of several hits and let a partial
 * user name win over an exact character name. Here, in this order:
 *
 * 1. a user whose name is the text, ignoring case
 * 2. a character whose name is the text, ignoring case
 * 3. users and characters whose name contains the text
 *
 * Several hits on a step are an error naming all of them. A user's character
 * is the one assigned in Foundry, else the only one the user owns. A
 * character's player is the one who has it assigned, else its only owner,
 * else its only owner who is online. A player who is offline is refused.
 */

export interface RollUser {
  id: string;
  name: string;
  isGM: boolean;
  active: boolean;
  /** Id of the character assigned in Foundry's user configuration. */
  characterId: string | null;
}

export interface RollActor {
  id: string;
  name: string;
  /** Users with the owner level set for them on this actor (not through "all players"). */
  ownerIds: readonly string[];
}

export interface RollTarget {
  /** Who is asked to roll. Null when nobody but a Gamemaster can. */
  user: RollUser | null;
  /** Whose values the formula uses. */
  actor: RollActor | null;
  via: 'user' | 'actor';
  notes: string[];
}

export class RollTargetError extends Error {
  constructor(
    readonly code: 'INVALID_ARGUMENT' | 'AMBIGUOUS' | 'TARGET_NOT_FOUND' | 'PLAYER_OFFLINE',
    message: string
  ) {
    super(message);
    this.name = 'RollTargetError';
  }
}

const listed = (entries: ReadonlyArray<{ id: string; name: string }>) =>
  entries.map(entry => `"${entry.name}" [${entry.id}]`).join(', ');

function forUser(user: RollUser, actors: readonly RollActor[]): RollTarget {
  const assigned = user.characterId ? actors.find(a => a.id === user.characterId) : undefined;
  if (assigned) return { user, actor: assigned, via: 'user', notes: [] };
  if (user.isGM) {
    return {
      user,
      actor: null,
      via: 'user',
      notes: [`"${user.name}" is a Gamemaster without an assigned character.`],
    };
  }
  const owned = actors.filter(actor => actor.ownerIds.includes(user.id));
  if (owned.length === 1 && owned[0]) return { user, actor: owned[0], via: 'user', notes: [] };
  if (owned.length > 1) {
    throw new RollTargetError(
      'AMBIGUOUS',
      `The player "${user.name}" owns several characters (${listed(owned)}) and has none assigned in Foundry. ` +
        'Name the character in targetPlayer instead.'
    );
  }
  return {
    user,
    actor: null,
    via: 'user',
    notes: [`The player "${user.name}" owns no character, so the roll uses no character values.`],
  };
}

function forActor(actor: RollActor, users: readonly RollUser[]): RollTarget {
  const owners = users.filter(user => !user.isGM && actor.ownerIds.includes(user.id));
  const assigned = owners.filter(user => user.characterId === actor.id);
  if (assigned.length === 1 && assigned[0])
    return { user: assigned[0], actor, via: 'actor', notes: [] };
  if (owners.length === 1 && owners[0]) return { user: owners[0], actor, via: 'actor', notes: [] };
  if (owners.length === 0) {
    return {
      user: null,
      actor,
      via: 'actor',
      notes: [`No player owns the character "${actor.name}", so only a Gamemaster can roll.`],
    };
  }
  const online = owners.filter(user => user.active);
  if (online.length === 1 && online[0]) {
    return {
      user: online[0],
      actor,
      via: 'actor',
      notes: [
        `Several players own "${actor.name}" (${listed(owners)}); the request goes to "${online[0].name}", the only one online.`,
      ],
    };
  }
  throw new RollTargetError(
    'AMBIGUOUS',
    `Several players own the character "${actor.name}" (${listed(owners)}) and none has it assigned. ` +
      'Name the player in targetPlayer instead.'
  );
}

function offline(target: RollTarget): void {
  const user = target.user;
  if (!user || user.active) return;
  const owner =
    target.via === 'actor' && target.actor ? ` (owner of character "${target.actor.name}")` : '';
  throw new RollTargetError(
    'PLAYER_OFFLINE',
    `Player "${user.name}"${owner} is registered but not currently logged in. They need to be online to receive ` +
      'roll requests. Nothing was posted to the chat.'
  );
}

export function resolveRollTarget(
  text: string,
  users: readonly RollUser[],
  actors: readonly RollActor[]
): RollTarget {
  const wanted = text.trim().toLowerCase();
  if (!wanted) throw new RollTargetError('INVALID_ARGUMENT', 'targetPlayer must not be empty');

  const same = (name: string) => name.trim().toLowerCase() === wanted;
  const exactUsers = users.filter(user => same(user.name));
  if (exactUsers.length > 1) {
    throw new RollTargetError(
      'AMBIGUOUS',
      `Several users are named "${text}" (${listed(exactUsers)}). Rename one of them in Foundry or name the character instead.`
    );
  }
  let target: RollTarget | null = exactUsers[0] ? forUser(exactUsers[0], actors) : null;

  if (!target) {
    const exactActors = actors.filter(actor => same(actor.name));
    if (exactActors.length > 1) {
      throw new RollTargetError(
        'AMBIGUOUS',
        `Several characters are named "${text}" (${listed(exactActors)}). Name the player instead.`
      );
    }
    if (exactActors[0]) target = forActor(exactActors[0], users);
  }

  if (!target) {
    const contains = (name: string) => name.toLowerCase().includes(wanted);
    const partUsers = users.filter(user => contains(user.name));
    const partActors = actors.filter(actor => contains(actor.name));
    if (partUsers.length + partActors.length > 1) {
      const parts = [
        ...(partUsers.length ? [`users ${listed(partUsers)}`] : []),
        ...(partActors.length ? [`characters ${listed(partActors)}`] : []),
      ];
      throw new RollTargetError(
        'AMBIGUOUS',
        `"${text}" is part of several names: ${parts.join('; ')}. Pass the full name.`
      );
    }
    if (partUsers[0]) target = forUser(partUsers[0], actors);
    else if (partActors[0]) target = forActor(partActors[0], users);
  }

  if (!target) {
    const players = users.filter(user => !user.isGM).map(user => user.name);
    throw new RollTargetError(
      'TARGET_NOT_FOUND',
      `No player or character named "${text}" found. Available players: ${players.length ? players.join(', ') : 'none'}`
    );
  }
  offline(target);
  return target;
}
