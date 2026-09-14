/**
 * The world the tests of the combat-rolls area share: a Gamemaster and a player, a
 * hero the player owns, a goblin and a hidden wolf on the active scene, a
 * token on a second scene.
 *
 * A test file on purpose: files ending in .test.ts are in no build, and this
 * one pulls in the harness with the server side.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { MODULE_ID } from '../../../common/constants.js';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { FakeFoundry } from '../../../testing/fake-foundry.js';
import { withCombatRolls, type CombatRollsFake, type CombatRollsFakeOptions } from './testing.js';

export interface CombatWorldOptions extends CombatRollsFakeOptions {
  settings?: Record<string, unknown>;
  system?: string;
  /** Seed encounter "c1" on the active scene with hero and goblin. Default false. */
  encounter?: boolean;
}

export interface CombatWorld {
  harness: AreaHarness;
  foundry: FakeFoundry;
  fake: CombatRollsFake;
}

export const SWITCH_OFF = { [`${MODULE_ID}.allowWriteOperations`]: false };

export const json = (result: { content: Array<{ text?: string }> }) =>
  JSON.parse(result.content[0]?.text ?? 'null');
export const textOf = (result: { content: Array<{ text?: string }> }) =>
  result.content[0]?.text ?? '';

export function openCombatWorld(options: CombatWorldOptions = {}): CombatWorld {
  const foundry = new FakeFoundry({
    users: [
      { id: 'gm', name: 'Gamemaster', isGM: true },
      { id: 'p1', name: 'Player One' },
    ],
    user: 'gm',
    system: { id: options.system ?? 'testsys', version: '1.0' },
    settings: options.settings ?? {},
  });
  const fake = withCombatRolls(foundry, options);
  foundry.seed('Actor', {
    _id: 'hero',
    name: 'Hero',
    type: 'character',
    ownership: { default: 0, p1: 3 },
    system: { init: 3, abilities: { str: { mod: 2 } } },
  });
  foundry.seed('Actor', {
    _id: 'goblin',
    name: 'Goblin',
    type: 'npc',
    ownership: { default: 0 },
    system: { init: 1 },
  });
  foundry.seed('Actor', {
    _id: 'wolf',
    name: 'Wolf',
    type: 'npc',
    ownership: { default: 0 },
    system: {},
  });
  foundry.seed('Scene', {
    _id: 'scene1',
    name: 'Arena',
    active: true,
    tokens: [
      { _id: 'tokH', name: 'Hero', actorId: 'hero', actorLink: true, x: 100, y: 100 },
      { _id: 'tokG', name: 'Goblin', actorId: 'goblin', x: 200, y: 100 },
      { _id: 'tokW', name: 'Wolf', actorId: 'wolf', x: 300, y: 100, hidden: true },
    ],
  });
  foundry.seed('Scene', {
    _id: 'scene2',
    name: 'Keller',
    tokens: [{ _id: 'tokK', name: 'Rat', actorId: 'wolf' }],
  });
  if (options.encounter) {
    const combat = foundry.seed('Combat', {
      _id: 'c1',
      scene: 'scene1',
      active: true,
      round: 0,
      turn: null,
    });
    foundry.seed(
      'Combatant',
      { _id: 'cH', tokenId: 'tokH', sceneId: 'scene1', actorId: 'hero', initiative: null },
      combat
    );
    foundry.seed(
      'Combatant',
      { _id: 'cG', tokenId: 'tokG', sceneId: 'scene1', actorId: 'goblin', initiative: null },
      combat
    );
  }
  const harness = createAreaHarness({ foundry });
  return { harness, foundry, fake };
}

describe('the shared test world of the combat-rolls area', () => {
  let world: CombatWorld | null = null;
  afterEach(() => {
    world?.harness.close();
    world = null;
  });

  it('gives combatants their token and actor, and sorts turns by initiative', () => {
    world = openCombatWorld({ encounter: true });
    const combat = world.foundry
      .collection('Combat')
      .get('c1') as unknown as FoundryCombatRollsCombat;
    const hero = combat.combatants.get('cH');
    expect(hero?.token?.name).toBe('Hero');
    expect(hero?.actor?.id).toBe('hero');
    void hero?.update({ initiative: 5 });
    expect(combat.turns?.map(c => c.id)).toEqual(['cH', 'cG']);
  });
});
