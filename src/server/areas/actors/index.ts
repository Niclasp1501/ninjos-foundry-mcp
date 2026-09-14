/**
 * Area actors: read, create and manage actors, items, using items, ownership, the generic part.
 *
 * Server side: the twelve tools of the package. The dnd5e tools belong to 4.7.
 */
import type { ServerArea } from '../../tools/areas.js';
import { createActorFromCompendiumTool, manageActorsTool } from './actor-tools.js';
import { manageWorldItemsTool, useItemTool } from './item-tools.js';
import {
  assignActorOwnershipTool,
  listActorOwnershipTool,
  removeActorOwnershipTool,
} from './ownership-tools.js';
import {
  getCharacterEntityTool,
  getCharacterTool,
  getCompendiumEntryFullTool,
  listCharactersTool,
  searchCharacterItemsTool,
} from './read-tools.js';

export const actorsArea: ServerArea = {
  id: 'actors',
  tools: [
    getCharacterTool,
    getCharacterEntityTool,
    listCharactersTool,
    searchCharacterItemsTool,
    createActorFromCompendiumTool,
    getCompendiumEntryFullTool,
    manageActorsTool,
    manageWorldItemsTool,
    useItemTool,
    assignActorOwnershipTool,
    removeActorOwnershipTool,
    listActorOwnershipTool,
  ],
  resources: [],
  prompts: [],
};
