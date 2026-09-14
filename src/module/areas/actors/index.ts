/**
 * Area actors: read, create and manage actors, items, using items, ownership, the generic part.
 *
 * Module side: query handlers and settings of the package. The query names
 * are the ones a server of the previous generation sends, plus
 * getCharacterEntity and changeActorOwnership of this generation.
 * getCompendiumDocumentFull belongs to the compendiums area and is only asked.
 */
import type { ModuleArea } from '../../areas.js';
import {
  addActorsToScene,
  createActors,
  deleteActorItems,
  deleteActors,
  updateActorItems,
  updateActors,
} from './actors-write.js';
import { MAX_ACTORS_DEFAULT, MAX_ACTORS_SETTING } from './common.js';
import { createActorFromCompendium } from './compendium-copy.js';
import {
  addActorItems,
  createWorldItems,
  getSystemSchema,
  listWorldItems,
  removeActorItems,
  updateWorldItems,
} from './items.js';
import {
  changeActorOwnership,
  findActorQuery,
  findPlayers,
  getActorOwnership,
  getConnectedPlayers,
  getFriendlyNPCs,
  getPartyCharacters,
  setActorOwnership,
} from './ownership.js';
import { getCharacterEntity, getCharacterInfo, listActors, searchCharacterItems } from './read.js';
import { useItem } from './use-item.js';

export const actorsArea: ModuleArea = {
  id: 'actors',
  queries: [
    { names: 'getCharacterInfo', handler: getCharacterInfo },
    { names: 'getCharacterEntity', handler: getCharacterEntity },
    { names: 'listActors', handler: listActors },
    { names: 'searchCharacterItems', handler: searchCharacterItems },
    { names: 'createActorFromCompendium', handler: createActorFromCompendium },
    { names: 'createActors', handler: createActors },
    { names: 'updateActors', handler: updateActors },
    { names: 'deleteActors', handler: deleteActors },
    { names: 'addActorsToScene', handler: addActorsToScene },
    { names: 'updateActorItems', handler: updateActorItems },
    { names: 'deleteActorItems', handler: deleteActorItems },
    { names: 'createWorldItems', handler: createWorldItems },
    { names: 'listWorldItems', handler: listWorldItems },
    { names: 'updateWorldItems', handler: updateWorldItems },
    { names: 'addActorItems', handler: addActorItems },
    { names: 'removeActorItems', handler: removeActorItems },
    { names: 'getSystemSchema', handler: getSystemSchema },
    { names: 'useItem', handler: useItem },
    { names: 'changeActorOwnership', handler: changeActorOwnership },
    { names: 'getActorOwnership', handler: getActorOwnership },
    { names: 'getFriendlyNPCs', handler: getFriendlyNPCs },
    { names: 'getPartyCharacters', handler: getPartyCharacters },
    { names: 'getConnectedPlayers', handler: getConnectedPlayers },
    { names: 'findPlayers', handler: findPlayers },
    { names: 'findActor', handler: findActorQuery },
    { names: 'setActorOwnership', handler: setActorOwnership },
  ],
  settings: [{ key: MAX_ACTORS_SETTING, kind: Number, initial: MAX_ACTORS_DEFAULT, listed: true }],
};
