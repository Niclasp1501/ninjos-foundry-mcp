import { describe, expect, it } from 'vitest';
import {
  checkRollResult,
  newRequestId,
  readRollRequest,
  sameFormula,
  type RollRequestRecord,
} from './roll-request.js';
import {
  resolveRollTarget,
  RollTargetError,
  type RollActor,
  type RollUser,
} from './roll-target.js';
import { dispositionWord, nestedTokenDetails, readTokenUpdates } from './tokens.js';

const users: RollUser[] = [
  { id: 'gm', name: 'Gamemaster', isGM: true, active: true, characterId: null },
  { id: 'p1', name: 'Anna', isGM: false, active: true, characterId: 'a1' },
  { id: 'p2', name: 'Bert', isGM: false, active: false, characterId: null },
  { id: 'p3', name: 'Annabell', isGM: false, active: true, characterId: null },
];
const actors: RollActor[] = [
  { id: 'a1', name: 'Aria', ownerIds: ['p1'] },
  { id: 'a2', name: 'Borin', ownerIds: ['p2'] },
  { id: 'a3', name: 'Ogre', ownerIds: [] },
  { id: 'a4', name: 'Twin', ownerIds: ['p1', 'p3'] },
  { id: 'a5', name: 'Familiar', ownerIds: ['p3'] },
  { id: 'a6', name: 'Horse', ownerIds: ['p3'] },
  { id: 'a7', name: 'Anna', ownerIds: ['p3'] },
];

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof RollTargetError ? `${error.code}: ${error.message}` : String(error);
  }
  return 'no error';
}

describe('resolveRollTarget', () => {
  it('takes an exact user name first, with the assigned character', () => {
    const target = resolveRollTarget('anna', users, actors);
    expect(target.user?.id).toBe('p1');
    expect(target.actor?.id).toBe('a1');
    expect(target.via).toBe('user');
  });

  it('lets an exact character name win over a partial user name', () => {
    const target = resolveRollTarget('Aria', users, actors);
    expect(target).toMatchObject({ via: 'actor', user: { id: 'p1' }, actor: { id: 'a1' } });
  });

  it('refuses several partial hits and names them all', () => {
    expect(code(() => resolveRollTarget('an', users, actors))).toMatch(
      /^AMBIGUOUS: "an" is part of several names: users "Anna" \[p1\], "Annabell" \[p3\]/
    );
  });

  it('refuses a player with several characters and none assigned', () => {
    expect(code(() => resolveRollTarget('Annabell', users, actors))).toMatch(
      /^AMBIGUOUS: The player "Annabell" owns several characters/
    );
  });

  it('picks the only online owner of a shared character and says so', () => {
    const offline = users.map(user => (user.id === 'p3' ? { ...user, active: false } : user));
    const target = resolveRollTarget('Twin', offline, actors);
    expect(target.user?.id).toBe('p1');
    expect(target.notes[0]).toContain('the only one online');
    expect(code(() => resolveRollTarget('Twin', users, actors))).toMatch(
      /^AMBIGUOUS: Several players own/
    );
  });

  it('prefers the player who has the shared character assigned', () => {
    const assigned = users.map(user => (user.id === 'p3' ? { ...user, characterId: 'a4' } : user));
    expect(resolveRollTarget('Twin', assigned, actors).user?.id).toBe('p3');
  });

  it('lets a Gamemaster roll for a character nobody owns', () => {
    const target = resolveRollTarget('ogre', users, actors);
    expect(target.user).toBeNull();
    expect(target.notes[0]).toContain('only a Gamemaster can roll');
  });

  it('refuses an offline player with the reason, by player and by character', () => {
    expect(code(() => resolveRollTarget('Bert', users, actors))).toBe(
      'PLAYER_OFFLINE: Player "Bert" is registered but not currently logged in. They need to be online to receive roll requests. Nothing was posted to the chat.'
    );
    expect(code(() => resolveRollTarget('Borin', users, actors))).toContain(
      'Player "Bert" (owner of character "Borin") is registered'
    );
  });

  it('names the players when nothing matches', () => {
    expect(code(() => resolveRollTarget('Zed', users, actors))).toBe(
      'TARGET_NOT_FOUND: No player or character named "Zed" found. Available players: Anna, Bert, Annabell'
    );
  });
});

describe('token updates and details', () => {
  it('collects every problem and refuses unknown fields', () => {
    const { problems } = readTokenUpdates({
      rotation: 400,
      width: 0,
      texture: 'x',
      disposition: 2,
    });
    expect(problems).toHaveLength(4);
    expect(problems[0]).toContain('texture');
  });

  it('accepts the secret disposition and refuses an empty change', () => {
    expect(readTokenUpdates({ disposition: -2 }).problems).toEqual([]);
    expect(readTokenUpdates({}).problems).toEqual([
      'updates is empty, so there is nothing to change',
    ]);
    expect(dispositionWord(-2)).toBe('secret');
    expect(dispositionWord(7)).toBe('unknown');
  });

  it('nests a flat answer and marks an actor that is gone', () => {
    const nested = nestedTokenDetails({
      id: 't',
      name: 'T',
      x: 1,
      y: 2,
      disposition: -1,
      actorId: 'gone',
      actorData: null,
    });
    expect(nested).toMatchObject({
      position: { x: 1, y: 2 },
      appearance: { scale: 1, alpha: 1 },
      behavior: { disposition: 'hostile' },
      actor: null,
      actorMissing: 'gone',
    });
  });
});

describe('roll request records', () => {
  const request: RollRequestRecord = {
    version: 1,
    requestId: 'roll-x',
    status: 'open',
    rollType: 'custom',
    rollTarget: '1d20',
    label: 'L',
    formula: '1d20 + 3',
    isPublic: false,
    flavor: '',
    actorId: null,
    actorName: null,
    targetUserId: 'p1',
    targetUserName: 'Anna',
    requestedBy: 'gm',
    requestedAt: '2026-09-14T10:00:00.000Z',
  };

  it('reads only a complete record', () => {
    expect(readRollRequest({ rollRequest: request })?.requestId).toBe('roll-x');
    expect(readRollRequest({ rollRequest: { ...request, formula: '' } })).toBeNull();
    expect(newRequestId(() => 0)).toBe('roll-aaaaaaaaaaaaaaaa');
  });

  it('trusts the stored author, the stored formula and the visibility', () => {
    expect(sameFormula('1d20+3', '1D20 + 3')).toBe(true);
    const ok = { author: { id: 'p1', isGM: false }, formula: '1d20+3', whispered: true };
    expect(checkRollResult(request, ok)).toEqual({ ok: true });
    expect(checkRollResult(request, { ...ok, author: { id: 'p3', isGM: false } })).toMatchObject({
      reason: 'notAllowed',
    });
    expect(checkRollResult(request, { ...ok, author: { id: 'gm', isGM: true } })).toEqual({
      ok: true,
    });
    expect(checkRollResult(request, { ...ok, formula: '1d20+30' })).toMatchObject({
      reason: 'formula',
    });
    expect(checkRollResult(request, { ...ok, whispered: false })).toMatchObject({
      reason: 'visibility',
    });
    expect(checkRollResult({ ...request, status: 'completed' }, ok)).toMatchObject({
      reason: 'completed',
    });
  });
});
