/**
 * Area dnd5e: D&D 5e adapter, NPC building, features, spells.
 *
 * Server side: the three NPC builder tools and the same adapter object the
 * module registers, so get-character on an old module and manage-actors
 * describe know dnd5e on the server as well.
 */
import { dnd5eAdapter } from '../../../common/areas/dnd5e/adapter.js';
import type { ServerArea } from '../../tools/areas.js';
import { addFeatureTool, addFeaturesFromCompendiumTool, createNpcTool } from './tools.js';

export const dnd5eArea: ServerArea = {
  id: 'dnd5e',
  tools: [createNpcTool, addFeatureTool, addFeaturesFromCompendiumTool],
  resources: [],
  prompts: [],
  adapters: [dnd5eAdapter],
};
