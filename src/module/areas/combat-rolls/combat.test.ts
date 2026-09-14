/**
 * The combat tools from the registry through the dispatcher to the handlers
 * and back, on the fake world of world.test.ts.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { packagesInStack } from './turns.js';
import {
  json,
  openCombatWorld,
  SWITCH_OFF,
  textOf,
  type CombatWorld,
  type CombatWorldOptions,
} from './world.test.js';

let world: CombatWorld | null = null;
afterEach(() => {
  world?.harness.close();
  world = null;
});
const open = (options: CombatWorldOptions = {}) => (world = openCombatWorld(options));
const combatOf = (w: CombatWorld, id = 'c1') =>
  w.foundry.collection('Combat').get(id) as unknown as FoundryCombatRollsCombat | undefined;

describe('creating and reading encounters', () => {
  it('creates an active encounter on the active scene with its tokens, read back and logged', async () => {
    const w = open();
    const result = await w.harness.call('create-combat', { tokenIds: ['tokH', 'tokW'] });
    expect(result.isError).toBeUndefined();
    const answer = json(result);
    expect(answer.combat).toMatchObject({
      scene: { id: 'scene1' },
      active: true,
      started: false,
      combatantCount: 2,
    });
    expect(answer.turnOrder.map((c: { tokenId: string }) => c.tokenId).sort()).toEqual([
      'tokH',
      'tokW',
    ]);
    const wolf = answer.turnOrder.find((c: { tokenId: string }) => c.tokenId === 'tokW');
    expect(wolf).toMatchObject({ hidden: true, isNPC: true });
    expect(w.harness.changeLog.list()[0]).toMatchObject({
      document: 'Combats',
      action: 'create',
      tool: 'create-combat',
    });

    const listed = json(await w.harness.call('list-combats'));
    expect(listed.combats).toHaveLength(1);
    expect(listed.activeScene).toEqual({ id: 'scene1', name: 'Arena' });
  });

  it('stops before creating when a token is not on the scene, and a dry run writes nothing', async () => {
    const w = open();
    const missing = await w.harness.call('create-combat', { tokenIds: ['tokH', 'tokK'] });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toMatch(
      /^Error: Failed to create combat: Token "tokK" not found on the scene "Arena".*lies on the scene "Keller"/
    );
    expect(w.foundry.collection('Combat').size).toBe(0);

    const dry = json(
      await w.harness.call('create-combat', {
        sceneIdentifier: 'Keller',
        tokenIds: ['tokK'],
        dryRun: true,
      })
    );
    expect(dry).toMatchObject({
      dryRun: true,
      scene: { name: 'Keller' },
      combatants: [{ tokenId: 'tokK' }],
      accessProblem: null,
    });
    expect(w.foundry.operations).toHaveLength(0);
  });

  it('refuses writing with the switch off but still reads', async () => {
    const w = open({ settings: SWITCH_OFF, encounter: true });
    expect(textOf(await w.harness.call('create-combat', {}))).toMatch(
      /Allow Write Operations" is off/
    );
    expect(json(await w.harness.call('create-combat', { dryRun: true })).accessProblem).toMatch(
      /is off/
    );
    expect(json(await w.harness.call('get-combat')).combat.id).toBe('c1');
  });

  it('names the encounters when none is active', async () => {
    const w = open({ encounter: true });
    await combatOf(w)?.update({ active: false });
    expect(textOf(await w.harness.call('get-combat'))).toMatch(
      /No combat encounter is active; pass combatId\. Encounters: \[c1\] on scene "Arena"/
    );
    expect(textOf(await w.harness.call('get-combat', { combatId: 'nope' }))).toMatch(
      /Combat encounter "nope" not found/
    );
  });
});

describe('initiative', () => {
  it('rolls with the system formula for those without initiative, posts nothing and sorts', async () => {
    const w = open({ encounter: true, totals: [8, 15] });
    const answer = json(await w.harness.call('roll-initiative', {}));
    expect(answer.rolled).toEqual([
      { combatantId: 'cH', name: 'Hero', formula: '1d20 + @init', total: 8, chat: null },
      { combatantId: 'cG', name: 'Goblin', formula: '1d20 + @init', total: 15, chat: null },
    ]);
    expect(answer.turnOrder.map((c: { id: string }) => c.id)).toEqual(['cG', 'cH']);
    expect(w.fake.rolls[0]).toMatchObject({
      data: { init: 3 },
      options: { allowInteractive: false },
    });
    expect(w.foundry.collection('ChatMessage').size).toBe(0);

    const again = json(await w.harness.call('roll-initiative', {}));
    expect(again).toMatchObject({
      changed: false,
      skipped: [{ reason: 'has initiative 8' }, { reason: 'has initiative 15' }],
    });
  });

  it('rolls for NPCs only and posts a hidden combatant as gmroll', async () => {
    const w = open({ encounter: true, totals: [11, 4] });
    await w.harness.call('add-combatants', { tokenIds: ['tokW'] });
    const answer = json(
      await w.harness.call('roll-initiative', {
        scope: 'npcs',
        toChat: true,
        rollMode: 'publicroll',
      })
    );
    expect(answer.rolled.map((r: { name: string }) => r.name)).toEqual(['Goblin', 'Wolf']);
    expect(answer.skipped).toEqual([{ id: 'cH', name: 'Hero', reason: 'player character' }]);
    const goblin = answer.rolled[0].chat;
    const wolf = answer.rolled[1].chat;
    expect(goblin).toMatchObject({ rollMode: 'publicroll', visibleTo: 'everyone' });
    expect(wolf).toMatchObject({ rollMode: 'gmroll', visibleTo: 'Gamemaster' });
    expect(answer.notes).toContain('"Wolf" is hidden, so its roll was posted as gmroll.');
    expect(w.harness.changeLog.list()[0]).toMatchObject({
      document: 'Multiple',
      documents: ['Combats', 'ChatMessages'],
    });
  });

  it('needs the chat switch only when posting, and a formula where the system has none', async () => {
    const off = open({ encounter: true, settings: SWITCH_OFF });
    expect(textOf(await off.harness.call('roll-initiative', {}))).toMatch(/is off/);
    off.harness.close();

    const w = open({ encounter: true, initiativeRoll: false, initiativeFormula: null });
    expect(textOf(await w.harness.call('roll-initiative', {}))).toMatch(
      /No initiative formula for Hero, Goblin/
    );
    expect(combatOf(w)?.combatants.get('cH')?.initiative).toBeNull();
    const withFormula = json(
      await w.harness.call('roll-initiative', {
        combatantIds: ['cG'],
        formula: '1d6',
        scope: 'npcs',
      })
    );
    expect(withFormula.rolled[0]).toMatchObject({ formula: '1d6', total: 10 });
    expect(withFormula.notes).toContain(
      'scope and onlyMissing were ignored: combatantIds names the combatants.'
    );
  });
});

describe('running an encounter', () => {
  it('starts, moves and sets turns, reporting moves Foundry does not make', async () => {
    const w = open({ encounter: true, totals: [8, 15] });
    expect(textOf(await w.harness.call('change-combat-turn', { action: 'next-turn' }))).toMatch(
      /has not started/
    );
    await w.harness.call('roll-initiative', {});
    const started = json(await w.harness.call('start-combat', {}));
    expect(started.combat).toMatchObject({
      round: 1,
      turn: 0,
      currentCombatant: { name: 'Goblin' },
    });
    expect(started.currentTurn).toMatchObject({
      actor: { id: 'goblin' },
      token: { id: 'tokG' },
      nextUp: { name: 'Hero' },
    });
    expect(json(await w.harness.call('start-combat', {}))).toMatchObject({ changed: false });

    const back = json(await w.harness.call('change-combat-turn', { action: 'previous-turn' }));
    expect(back).toMatchObject({ changed: false, message: 'Foundry kept round 1, turn 0.' });
    const next = json(await w.harness.call('change-combat-turn', { action: 'next-turn' }));
    expect(next).toMatchObject({
      changed: true,
      after: { round: 1, turn: 1, combatant: { name: 'Hero' } },
    });
    const round = json(await w.harness.call('change-combat-turn', { action: 'next-turn' }));
    expect(round.after).toMatchObject({ round: 2, turn: 0 });
    const set = json(
      await w.harness.call('change-combat-turn', { action: 'set-turn', tokenId: 'tokH' })
    );
    expect(set.after.combatant.name).toBe('Hero');
    expect(
      textOf(
        await w.harness.call('change-combat-turn', { action: 'next-round', combatantId: 'cH' })
      )
    ).toMatch(/only work with action "set-turn"/);
  });

  it('names the package that threw when Foundry cannot change the turn, and changes nothing', async () => {
    const w = open({ encounter: true, totals: [8, 15] });
    await w.harness.call('roll-initiative', {});
    await w.harness.call('start-combat', {});
    const logged = w.harness.changeLog.list().length;
    Object.defineProperty(combatOf(w), 'nextTurn', {
      configurable: true,
      value: () => {
        const error = new TypeError("Cannot read properties of undefined (reading 'get')");
        error.stack =
          "TypeError: Cannot read properties of undefined (reading 'get')\n" +
          '    at Object.nextTurn (https://dnd.example.org/modules/monks-combat-details/js/combat-turn.js:10:42)\n' +
          '    at Combat.nextTurn (https://dnd.example.org/modules/lib-wrapper/lib-wrapper.js:1:100)\n' +
          '    at Combat.nextTurn (https://dnd.example.org/scripts/foundry.mjs:5:1)';
        return Promise.reject(error);
      },
    });
    const failed = await w.harness.call('change-combat-turn', { action: 'next-turn' });
    expect(failed.isError).toBe(true);
    expect(textOf(failed)).toMatch(
      /Failed to change combat turn: Foundry's Combat#nextTurn threw "Cannot read properties of undefined \(reading 'get'\)" in the module "monks-combat-details".*Nothing changed: the encounter is still in round 1, turn 0/s
    );
    expect(textOf(failed)).toContain('lib-wrapper');
    expect(combatOf(w)?.turn).toBe(0);
    expect(w.harness.changeLog.list()).toHaveLength(logged);
  });

  it('reads the throwing package from a stack, systems included, and nothing without one', () => {
    expect(
      packagesInStack(
        'Error: x\n    at a (http://localhost:30000/systems/dnd5e/dnd5e.mjs:1:1)\n    at b (http://localhost:30000/modules/dice-so-nice/api.js:2:2)\n    at c (http://localhost:30000/systems/dnd5e/dnd5e.mjs:3:3)'
      )
    ).toEqual([
      { kind: 'system', id: 'dnd5e' },
      { kind: 'module', id: 'dice-so-nice' },
    ]);
    expect(
      packagesInStack('Error: x\n    at c (http://localhost:30000/scripts/foundry.mjs:3:3)')
    ).toEqual([]);
    expect(packagesInStack(undefined)).toEqual([]);
  });

  it('keeps the acting combatant when its initiative changes, and flags combatants', async () => {
    const w = open({ encounter: true, totals: [8, 15] });
    await w.harness.call('roll-initiative', {});
    await w.harness.call('start-combat', {});
    const changed = json(
      await w.harness.call('update-combatant', { combatantId: 'cH', initiative: 30 })
    );
    expect(changed.applied).toEqual({ initiative: 30 });
    expect(changed.combat.currentCombatant.name).toBe('Goblin');
    expect(changed.turnOrder.map((c: { id: string }) => c.id)).toEqual(['cH', 'cG']);

    const flagged = json(
      await w.harness.call('update-combatant', { tokenId: 'tokG', defeated: true, hidden: false })
    );
    expect(flagged.applied).toEqual({ defeated: true });
    expect(flagged.notes[0]).toMatch(/toggle-token-condition/);
    expect(
      json(await w.harness.call('update-combatant', { tokenId: 'tokG', defeated: true })).changed
    ).toBe(false);
    expect(textOf(await w.harness.call('update-combatant', { combatantId: 'cH' }))).toMatch(
      /Nothing to change/
    );
  });

  it('adds without doubles, removes all or nothing', async () => {
    const w = open({ encounter: true });
    const added = json(await w.harness.call('add-combatants', { tokenIds: ['tokH', 'tokW'] }));
    expect(added.added).toEqual([expect.objectContaining({ tokenId: 'tokW', name: 'Wolf' })]);
    expect(added.alreadyInCombat).toEqual([{ tokenId: 'tokH', name: 'Hero' }]);
    expect(
      textOf(
        await w.harness.call('add-combatants', { tokenIds: ['tokK'], sceneIdentifier: 'Keller' })
      )
    ).toMatch(/belongs to the scene "Arena"/);

    const refused = await w.harness.call('remove-combatants', { combatantIds: ['cH', 'ghost'] });
    expect(textOf(refused)).toMatch(
      /Not in this encounter: combatant "ghost"\. Nothing was changed/
    );
    expect(combatOf(w)?.combatants.size).toBe(3);
    const removed = json(await w.harness.call('remove-combatants', { tokenIds: ['tokH'] }));
    expect(removed.removed).toEqual([{ combatantId: 'cH', name: 'Hero', tokenId: 'tokH' }]);
    expect(combatOf(w)?.combatants.has('cH')).toBe(false);
  });

  it('ends by stopping and keeping, refuses deleting, and reports that in a dry run', async () => {
    const w = open({ encounter: true, totals: [8, 15] });
    await w.harness.call('roll-initiative', {});
    await w.harness.call('start-combat', {});
    const dry = json(await w.harness.call('end-combat', { deleteEncounter: true, dryRun: true }));
    expect(dry).toMatchObject({ dryRun: true, wouldDelete: true });
    expect(dry.accessProblem).toMatch(/^Deleting combat encounters is not permitted/);
    expect(textOf(await w.harness.call('end-combat', { deleteEncounter: true }))).toMatch(
      /Deleting combat encounters is not permitted/
    );
    expect(combatOf(w)).toBeDefined();

    const ended = json(await w.harness.call('end-combat', {}));
    expect(ended).toMatchObject({
      changed: true,
      deleted: false,
      combat: { round: 0, active: false, started: false },
    });
    expect(combatOf(w)?.combatants.get('cG')?.initiative).toBe(15);
    const entry = w.harness.changeLog.list()[0];
    expect(entry).toMatchObject({ action: 'update', tool: 'end-combat', undoable: true });
    expect(json(await w.harness.call('end-combat', { combatId: 'c1' })).changed).toBe(false);
  });
});
