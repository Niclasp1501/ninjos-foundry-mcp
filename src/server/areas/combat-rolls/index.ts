/**
 * Area combat-rolls: combat tracker, free rolls, system rolls through the adapter.
 *
 * Server side: tools, resources and prompts of the package.
 */
import type { ServerArea } from '../../tools/areas.js';
import { combatRollsTools } from './tools.js';

export const combatRollsArea: ServerArea = {
  id: 'combat-rolls',
  tools: combatRollsTools,
  resources: [],
  prompts: [],
};
