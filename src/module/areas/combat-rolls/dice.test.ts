/**
 * Free rolls and system rolls, from the registry to the handler, with and
 * without an adapter for the game system.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SystemAdapter } from '../../../common/game-systems.js';
import { moduleSystemAdapters } from '../../game-systems.js';
import {
  json,
  openCombatWorld,
  SWITCH_OFF,
  textOf,
  type CombatWorld,
  type CombatWorldOptions,
} from './world.test.js';

let world: CombatWorld | null = null;
let removeAdapter: (() => void) | null = null;
afterEach(() => {
  world?.harness.close();
  world = null;
  removeAdapter?.();
  removeAdapter = null;
});
const open = (options: CombatWorldOptions = {}) => (world = openCombatWorld(options));

const testAdapter: SystemAdapter = {
  id: 'testsys',
  title: 'Test System',
  rolls: {
    types: [{ id: 'ability', description: '1d20 plus the modifier', targets: ['str'] }],
    plan: (request, actor) => {
      const data = (actor?.['rollData'] ?? {}) as { abilities?: Record<string, { mod: number }> };
      const target = request.rollTarget ?? '';
      const ability = data.abilities?.[target];
      if (!ability) throw new Error(`unknown ability "${target}"`);
      return { formula: `1d20+${ability.mod}`, label: `Ability ${target}` };
    },
  },
};

describe('roll-dice', () => {
  it('rolls a formula in Foundry, returns the dice and posts nothing', async () => {
    const w = open({ totals: [17] });
    const answer = json(
      await w.harness.call('roll-dice', { formula: '1d20+2', rollMode: 'publicroll' })
    );
    expect(answer).toMatchObject({
      success: true,
      formula: '1d20+2',
      total: 17,
      dice: [{ expression: '1d20', faces: 20, number: 1, results: [{ result: 17, active: true }] }],
      chat: null,
      notes: ['rollMode was ignored: without toChat nothing is posted.'],
    });
    expect(w.fake.rolls[0]?.options).toEqual({ allowInteractive: false });
    expect(w.foundry.collection('ChatMessage').size).toBe(0);
  });

  it('posts as gmroll by default, read back, and needs the switch only then', async () => {
    const w = open({ settings: SWITCH_OFF });
    expect(json(await w.harness.call('roll-dice', { formula: '2d6' })).total).toBe(10);
    expect(textOf(await w.harness.call('roll-dice', { formula: '2d6', toChat: true }))).toMatch(
      /is off/
    );
    w.harness.close();

    const on = open();
    const posted = json(
      await on.harness.call('roll-dice', { formula: '2d6', toChat: true, flavor: 'Falling' })
    );
    expect(posted.chat).toMatchObject({ rollMode: 'gmroll', visibleTo: 'Gamemaster' });
    const message = on.foundry.collection('ChatMessage').get(posted.chat.messageId);
    expect(message).toMatchObject({
      whisper: ['gm'],
      blind: false,
      flavor: 'Falling',
      author: 'gm',
    });
    expect(on.harness.changeLog.size).toBe(0);
  });

  it('fails when Foundry stores other recipients, and on a formula Foundry rejects', async () => {
    const w = open({ alterMessage: data => ({ ...data, whisper: [] }) });
    const result = await w.harness.call('roll-dice', {
      formula: '1d4',
      toChat: true,
      rollMode: 'selfroll',
    });
    expect(textOf(result)).toMatch(
      /^Error: Failed to roll dice: The roll message \[.+\] was stored visible to everyone instead of Gamemaster\. It stays in the chat/
    );
    expect(textOf(await w.harness.call('roll-dice', { formula: 'banana' }))).toBe(
      'Error: Failed to roll dice: Foundry does not accept the roll formula "banana".'
    );
    expect(textOf(await w.harness.call('roll-dice', { formula: '1d4', rollMode: 'loud' }))).toMatch(
      /rollMode must be one of/
    );
  });

  it('fills @ references from an actor and warns without one', async () => {
    const w = open();
    const withActor = json(
      await w.harness.call('roll-dice', { formula: '1d20 + @init', actorId: 'Hero' })
    );
    expect(withActor.actor).toEqual({ id: 'hero', name: 'Hero' });
    expect(w.fake.rolls[0]?.data).toMatchObject({ init: 3 });
    const without = json(await w.harness.call('roll-dice', { formula: '1d20 + @init' }));
    expect(without.notes).toContain(
      'The formula uses @ references but no actorId was given; Foundry counts them as 0.'
    );
  });
});

describe('roll-actor-check', () => {
  it('answers SYSTEM_NOT_SUPPORTED without an adapter and points to roll-dice', async () => {
    const w = open({ system: 'nosys' });
    await expect(
      w.harness.query('rollActorCheck', { actorId: 'hero', rollType: 'ability', rollTarget: 'str' })
    ).rejects.toMatchObject({
      moduleCode: 'SYSTEM_NOT_SUPPORTED',
    });
    const text = textOf(
      await w.harness.call('roll-actor-check', { actorId: 'hero', rollType: 'ability' })
    );
    expect(text).toMatch(
      /is not supported for the game system "nosys".*roll-dice rolls a free formula in any system\./
    );
    expect(w.fake.rolls).toHaveLength(0);
  });

  it('rolls the formula the adapter builds from the roll data', async () => {
    removeAdapter = moduleSystemAdapters.register(testAdapter, 'combat-rolls test');
    const w = open({ totals: [12] });
    const answer = json(
      await w.harness.call('roll-actor-check', {
        actorId: 'Hero',
        rollType: 'ability',
        rollTarget: 'str',
        toChat: true,
      })
    );
    expect(answer).toMatchObject({
      actor: { id: 'hero', name: 'Hero' },
      gameSystem: 'testsys',
      adapter: 'Test System',
      label: 'Ability str',
      formula: '1d20+2',
      total: 12,
      chat: { rollMode: 'gmroll' },
    });
    const message = w.foundry.collection('ChatMessage').get(answer.chat.messageId);
    expect(message?.['flavor']).toBe('Hero: Ability str');

    expect(
      textOf(await w.harness.call('roll-actor-check', { actorId: 'Hero', rollType: 'skill' }))
    ).toMatch(
      /The roll type "skill" is not offered for the game system "testsys"\. Roll types: ability \(1d20 plus the modifier; targets: str\)/
    );
    expect(
      textOf(
        await w.harness.call('roll-actor-check', {
          actorId: 'Hero',
          rollType: 'ability',
          rollTarget: 'luck',
        })
      )
    ).toMatch(/The adapter "Test System" could not build the roll: unknown ability "luck"/);
  });
});
