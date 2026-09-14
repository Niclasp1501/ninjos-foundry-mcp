/**
 * The tools of the combat-rolls area in the registry: names, groups, annotations,
 * argument checks, and a module that does not know the queries yet.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { MODULE_AREAS } from '../../../module/areas/index.js';
import {
  openCombatWorld,
  textOf,
  type CombatWorld,
} from '../../../module/areas/combat-rolls/world.test.js';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { combatRollsTools } from './tools.js';

let world: CombatWorld | null = null;
let harness: AreaHarness | null = null;
afterEach(() => {
  world?.harness.close();
  harness?.close();
  world = null;
  harness = null;
});

describe('the combat and roll tools', () => {
  it('offers twelve tools in the groups combat and dice with honest annotations', async () => {
    world = openCombatWorld();
    const listed = await world.harness.tools.list();
    const names = combatRollsTools.map(tool => tool.name);
    for (const name of names) expect(listed.map(tool => tool.name)).toContain(name);
    expect(names).toHaveLength(12);
    expect(combatRollsTools.filter(tool => tool.group === 'dice').map(tool => tool.name)).toEqual([
      'roll-dice',
      'roll-actor-check',
    ]);
    const readOnly = combatRollsTools
      .filter(tool => tool.annotations.readOnlyHint)
      .map(tool => tool.name);
    expect(readOnly).toEqual(['list-combats', 'get-combat']);
    for (const name of ['remove-combatants', 'update-combatant', 'roll-initiative', 'end-combat'])
      expect(combatRollsTools.find(tool => tool.name === name)?.annotations.destructiveHint).toBe(
        true
      );
    for (const name of names) expect(name).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });

  it('checks arguments before the module and says "Failed to" once', async () => {
    world = openCombatWorld();
    expect(textOf(await world.harness.call('change-combat-turn', { action: 'sideways' }))).toMatch(
      /Invalid arguments for change-combat-turn: action must be one of/
    );
    expect(textOf(await world.harness.call('add-combatants', { tokenIds: [] }))).toMatch(
      /tokenIds must have at least 1 entry/
    );
    const text = textOf(await world.harness.call('get-combat'));
    expect(text.match(/Failed to get combat/g)).toHaveLength(1);
  });

  it('names a module too old for the queries, and nothing changes', async () => {
    harness = createAreaHarness({
      moduleAreas: MODULE_AREAS.filter(area => area.id !== 'combat-rolls'),
    });
    const result = await harness.call('list-combats');
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(
      /^Error: Failed to list combats: the connected Foundry module does not know the query "listCombats"/
    );
    expect(harness.foundry.operations).toHaveLength(0);
  });
});
