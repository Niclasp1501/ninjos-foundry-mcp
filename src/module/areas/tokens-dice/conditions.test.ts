/**
 * Conditions: Foundry's list, the lookup, real toggling, where the effect
 * lands, the actor level for linked tokens, and the three ways of setting a
 * condition (adapter, Foundry's toggleStatusEffect, the generic effect).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SystemAdapter } from '../../../common/game-systems.js';
import { moduleSystemAdapters } from '../../game-systems.js';
import { failure, openWorld, type World } from './world.test.js';

let world: World | null = null;
let removeAdapter: (() => void) | null = null;
afterEach(() => {
  world?.harness.close();
  world = null;
  removeAdapter?.();
  removeAdapter = null;
});
const open = (options: Parameters<typeof openWorld>[0] = {}) => (world = openWorld(options));
const effectsOf = (w: World, actorId: string) =>
  w.foundry.collection('Actor').get(actorId)?.getEmbeddedCollection('ActiveEffect').contents ?? [];

describe('get-available-conditions', () => {
  it('lists Foundry conditions with translated names and the system', async () => {
    const w = open({ translations: { 'EFFECT.StatusProne': 'Prone' } });
    expect(await w.harness.query('get-available-conditions', {})).toEqual({
      success: true,
      gameSystem: 'testsys',
      adapter: null,
      conditions: [
        { id: 'prone', name: 'Prone', icon: 'icons/svg/falling.svg', description: '' },
        { id: 'blind', name: 'Blind', icon: 'icons/svg/blind.svg', description: '' },
        { id: 'poisoned', name: 'Poisoned', icon: 'icons/svg/poison.svg', description: '' },
      ],
    });
  });

  it('says so when the system offers none', async () => {
    const w = open({ statusEffects: [] });
    expect(await w.harness.query('getAvailableConditions', {})).toMatchObject({
      conditions: [],
      notes: ['The game system "testsys" offers no conditions.'],
    });
  });
});

describe('toggle-token-condition', () => {
  it('toggles without active, and removing keeps every other effect', async () => {
    const w = open();
    const set = await w.harness.query('toggle-token-condition', {
      tokenId: 'tok1',
      conditionId: 'blind',
    });
    expect(set).toMatchObject({
      success: true,
      isActive: true,
      changed: true,
      method: 'generic',
      effectTarget: 'actor',
      conditionName: 'Blind',
    });
    expect(effectsOf(w, 'actorA').map(e => e['name'])).toEqual(['Bless', 'Blind']);

    const removed = await w.harness.query('toggle-token-condition', {
      tokenId: 'tok1',
      conditionId: 'BLIND',
    });
    expect(removed).toMatchObject({ isActive: false, changed: true });
    expect(effectsOf(w, 'actorA').map(e => e['name'])).toEqual(['Bless']);
  });

  it('writes nothing when the condition already has the wanted state', async () => {
    const w = open();
    const answer = await w.harness.query('toggleTokenCondition', {
      tokenId: 'tok1',
      conditionId: 'blind',
      active: false,
    });
    expect(answer).toMatchObject({ changed: false, isActive: false });
    expect(w.foundry.operations).toEqual([]);
  });

  it('puts the condition of an unlinked token on that token only, with the scene level alone', async () => {
    const w = open({ settings: { 'ninjos-foundry-mcp.permActors': 'read' } });
    const answer = await w.harness.query('toggle-token-condition', {
      tokenId: 'tok2',
      conditionId: 'poisoned',
      active: true,
    });
    expect(answer).toMatchObject({ effectTarget: 'token', isActive: true });
    expect(effectsOf(w, 'actorG')).toEqual([]);
    expect(w.foundry.operations[0]?.parent).toBe('Scene.scene1.Token.tok2.Actor.actorG');
    expect(w.harness.changeLog.list()[0]).toMatchObject({ document: 'Scenes' });
  });

  it('needs the actor level for a linked token and says why', async () => {
    const w = open({ settings: { 'ninjos-foundry-mcp.permActors': 'read' } });
    const refused = await failure(
      w.harness.query('toggle-token-condition', { tokenId: 'tok1', conditionId: 'blind' })
    );
    expect(refused.code).toBe('PERMISSION_DENIED');
    expect(refused.message).toContain(
      'is linked to the actor "Aria", so the condition changes that actor.'
    );
    expect(w.foundry.operations).toEqual([]);
  });

  it("uses Foundry's toggleStatusEffect when the system brings no effect data", async () => {
    const w = open({ toggleStatusEffect: true });
    const answer = await w.harness.query('toggle-token-condition', {
      tokenId: 'tok1',
      conditionId: 'prone',
      active: true,
    });
    expect(answer).toMatchObject({ method: 'foundry', isActive: true });
    expect(w.fake.toggleCalls).toEqual([{ actor: 'actorA', statusId: 'prone', active: true }]);
  });

  it("takes the adapter's effect data over Foundry's own way", async () => {
    const adapter: SystemAdapter = {
      id: 'testsys',
      title: 'Test System',
      conditions: {
        effectData: condition => ({
          name: condition.name,
          statuses: [condition.id],
          flags: { testsys: { level: 1 } },
        }),
      },
    };
    removeAdapter = moduleSystemAdapters.register(adapter, 'test');
    const w = open({ toggleStatusEffect: true });
    const answer = await w.harness.query('toggle-token-condition', {
      tokenId: 'tok1',
      conditionId: 'prone',
    });
    expect(answer).toMatchObject({ method: 'adapter', isActive: true });
    expect(w.fake.toggleCalls).toEqual([]);
    expect(effectsOf(w, 'actorA')[1]?.['flags']).toEqual({ testsys: { level: 1 } });
  });

  it('refuses a token without actor, and an unknown condition with the ids', async () => {
    const w = open();
    expect(
      await failure(
        w.harness.query('toggle-token-condition', { tokenId: 'tok3', conditionId: 'blind' })
      )
    ).toMatchObject({
      code: 'TOKEN_HAS_NO_ACTOR',
    });
    const unknown = await failure(
      w.harness.query('toggle-token-condition', { tokenId: 'tok1', conditionId: 'dazed' })
    );
    expect(unknown.message).toBe(
      'Failed to toggle token condition: Condition not found: "dazed". Condition ids of this game system: prone, blind, poisoned.'
    );
  });
});

describe('toggle-token-condition with levels and read back through the adapter', () => {
  /**
   * A system in the manner of pf2e: its effects are not recognised by matching,
   * only by activeOn, and levels are set through calls on the actor.
   */
  const staged: SystemAdapter = {
    id: 'testsys',
    title: 'Staged Test System',
    conditions: {
      matchesEffect: () => false,
      activeOn: actor =>
        (Array.isArray(actor['effects'])
          ? (actor['effects'] as Array<Record<string, unknown>>)
          : []
        )
          .filter(effect => Array.isArray(effect['statuses']) && effect['statuses'].length > 0)
          .map(effect => ({
            id: String((effect['statuses'] as string[])[0]),
            level: typeof effect['level'] === 'number' ? effect['level'] : null,
          })),
      levels: condition => (condition.id === 'poisoned' ? { max: 3 } : null),
      levelPlan: (condition, level, actor) => {
        const effects = (actor['effects'] as Array<Record<string, unknown>> | undefined) ?? [];
        const own = effects.find(
          effect => Array.isArray(effect['statuses']) && effect['statuses'].includes(condition.id)
        );
        if (level === 0)
          return own
            ? [{ method: 'deleteEmbeddedDocuments', args: ['ActiveEffect', [own['_id']]] }]
            : [];
        if (!own)
          return [
            {
              method: 'createEmbeddedDocuments',
              args: ['ActiveEffect', [{ name: condition.name, statuses: [condition.id], level }]],
            },
          ];
        return own['level'] === level
          ? []
          : [
              {
                method: 'updateEmbeddedDocuments',
                args: ['ActiveEffect', [{ _id: own['_id'], level }]],
              },
            ];
      },
    },
  };

  it('reads the state back through activeOn, so a condition the matcher cannot see is not NOT_APPLIED', async () => {
    removeAdapter = moduleSystemAdapters.register(staged, 'test');
    const w = open({ toggleStatusEffect: true });
    const answer = await w.harness.query('toggle-token-condition', {
      tokenId: 'tok1',
      conditionId: 'prone',
      active: true,
    });
    expect(answer).toMatchObject({ method: 'foundry', isActive: true, changed: true });
    const again = await w.harness.query('toggle-token-condition', {
      tokenId: 'tok1',
      conditionId: 'prone',
      active: true,
    });
    expect(again).toMatchObject({ changed: false, isActive: true });
  });

  it('sets, raises and removes a level through the calls of the adapter, read back each time', async () => {
    removeAdapter = moduleSystemAdapters.register(staged, 'test');
    const w = open();
    const set = await w.harness.query('toggle-token-condition', {
      tokenId: 'tok1',
      conditionId: 'poisoned',
      level: 2,
    });
    expect(set).toMatchObject({ changed: true, isActive: true, level: 2, previousLevel: null });
    const raised = await w.harness.query('toggle-token-condition', {
      tokenId: 'tok1',
      conditionId: 'Poisoned',
      level: 3,
    });
    expect(raised).toMatchObject({ changed: true, level: 3, previousLevel: 2 });
    expect(
      await w.harness.query('toggle-token-condition', {
        tokenId: 'tok1',
        conditionId: 'poisoned',
        level: 3,
      })
    ).toMatchObject({ changed: false, level: 3 });
    const removed = await w.harness.query('toggle-token-condition', {
      tokenId: 'tok1',
      conditionId: 'poisoned',
      level: 0,
    });
    expect(removed).toMatchObject({
      changed: true,
      isActive: false,
      level: null,
      previousLevel: 3,
    });
    expect(effectsOf(w, 'actorA').map(effect => effect['name'])).toEqual(['Bless']);
    expect(w.harness.changeLog.list()[0]?.summary).toContain('from at level 3 to not set');
  });

  it('refuses a level above the highest, a level for a condition without levels, and contradicting active', async () => {
    removeAdapter = moduleSystemAdapters.register(staged, 'test');
    const w = open();
    const tooHigh = await failure(
      w.harness.query('toggle-token-condition', {
        tokenId: 'tok1',
        conditionId: 'poisoned',
        level: 4,
      })
    );
    expect(tooHigh).toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(tooHigh.message).toContain('goes up to level 3');
    const noLevels = await failure(
      w.harness.query('toggle-token-condition', { tokenId: 'tok1', conditionId: 'prone', level: 1 })
    );
    expect(noLevels.message).toContain('has no levels');
    const contradiction = await failure(
      w.harness.query('toggle-token-condition', {
        tokenId: 'tok1',
        conditionId: 'poisoned',
        level: 2,
        active: false,
      })
    );
    expect(contradiction).toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(w.foundry.operations).toEqual([]);
  });

  it('refuses a level without an adapter and names active as the way', async () => {
    const w = open();
    const refused = await failure(
      w.harness.query('toggle-token-condition', {
        tokenId: 'tok1',
        conditionId: 'poisoned',
        level: 1,
      })
    );
    expect(refused).toMatchObject({ code: 'SYSTEM_NOT_SUPPORTED' });
    expect(refused.message).toContain('with active instead');
    expect(w.foundry.operations).toEqual([]);
  });
});
