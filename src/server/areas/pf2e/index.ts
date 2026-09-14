/**
 * Area pf2e: the Pathfinder Second Edition adapter.
 *
 * Server side: the same adapter object the module registers, so get-character
 * with an old module and manage-actors describe know pf2e on the server, and
 * the one pf2e tool.
 */
import { pf2eAdapter } from '../../../common/areas/pf2e/adapter.js';
import type { ServerArea } from '../../tools/areas.js';
import { manageConditionsTool } from './tools.js';

export const pf2eArea: ServerArea = {
  id: 'pf2e',
  tools: [manageConditionsTool],
  resources: [],
  prompts: [],
  adapters: [pf2eAdapter],
};
