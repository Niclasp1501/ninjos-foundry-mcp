/**
 * Area tokens-dice: tokens, conditions, roll requests to players.
 *
 * Server side: the six token tools in the group "tokens", the roll request in
 * the group "dice".
 */
import type { ServerArea } from '../../tools/areas.js';
import { tokensDiceTools } from './tools.js';

export const tokensDiceArea: ServerArea = {
  id: 'tokens-dice',
  tools: tokensDiceTools,
  resources: [],
  prompts: [],
};
