/**
 * Area dsa5: the adapter for Das Schwarze Auge 5 and the archetype tools.
 *
 * Server side: the two archetype tools and the same adapter object the module
 * registers, so manage-actors describe and get-character on an old module
 * know DSA5 on the server as well.
 */
import { dsa5Adapter } from '../../../common/areas/dsa5/adapter.js';
import type { ServerArea } from '../../tools/areas.js';
import { createFromArchetypeTool, listArchetypesTool } from './tools.js';

export const dsa5Area: ServerArea = {
  id: 'dsa5',
  tools: [listArchetypesTool, createFromArchetypeTool],
  resources: [],
  prompts: [],
  adapters: [dsa5Adapter],
};
