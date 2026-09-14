/**
 * Area combat-rolls: combat tracker, free rolls, system rolls through the adapter.
 *
 * Module side: query handlers of the package. No settings of its own.
 */
import type { ModuleArea } from '../../areas.js';
import { addCombatants, removeCombatants, updateCombatant } from './combatants.js';
import { createCombat, endCombat, getCombat, listCombats } from './combats.js';
import { rollActorCheck, rollDice } from './dice.js';
import { rollInitiative } from './initiative.js';
import { changeCombatTurn, startCombat } from './turns.js';

export const combatRollsArea: ModuleArea = {
  id: 'combat-rolls',
  queries: [
    { names: 'listCombats', handler: listCombats },
    { names: 'getCombat', handler: getCombat },
    { names: 'createCombat', handler: createCombat },
    { names: 'addCombatants', handler: addCombatants },
    { names: 'removeCombatants', handler: removeCombatants },
    { names: 'updateCombatant', handler: updateCombatant },
    { names: 'rollInitiative', handler: rollInitiative },
    { names: 'startCombat', handler: startCombat },
    { names: 'changeCombatTurn', handler: changeCombatTurn },
    { names: 'endCombat', handler: endCombat },
    { names: 'rollDice', handler: rollDice },
    { names: 'rollActorCheck', handler: rollActorCheck },
  ],
  settings: [],
};
