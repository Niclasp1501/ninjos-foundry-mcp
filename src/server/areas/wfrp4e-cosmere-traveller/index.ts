/**
 * Area wfrp4e-cosmere-traveller: adapters for WFRP4e, Cosmere, Traveller.
 *
 * Server side: the two WFRP4e tools and the same three adapter objects the
 * module registers, so get-character on an old module and manage-actors
 * describe know these systems on the server as well.
 */
import { cosmereAdapter } from '../../../common/areas/wfrp4e-cosmere-traveller/cosmere.js';
import { travellerAdapter } from '../../../common/areas/wfrp4e-cosmere-traveller/traveller.js';
import { wfrp4eAdapter } from '../../../common/areas/wfrp4e-cosmere-traveller/wfrp4e.js';
import type { ServerArea } from '../../tools/areas.js';
import { addItemsTool, updateActorTool } from './tools.js';

export const wfrp4eCosmereTravellerArea: ServerArea = {
  id: 'wfrp4e-cosmere-traveller',
  tools: [updateActorTool, addItemsTool],
  resources: [],
  prompts: [],
  adapters: [wfrp4eAdapter, cosmereAdapter, travellerAdapter],
};
