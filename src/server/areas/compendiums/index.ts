/**
 * Area compendiums: every compendium tool, release list, lock, creature index.
 *
 * Server side: tools, resources and prompts of the area.
 */
import type { ServerArea } from '../../tools/areas.js';
import { COMPENDIUM_TOOLS } from './tools.js';

export const compendiumsArea: ServerArea = {
  id: 'compendiums',
  tools: COMPENDIUM_TOOLS,
  resources: [],
  prompts: [],
};
