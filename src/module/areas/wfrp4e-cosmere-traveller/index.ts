/**
 * Area wfrp4e-cosmere-traveller: adapters for WFRP4e, Cosmere, Traveller.
 *
 * Module side: the three adapters for the core registry, which answers only
 * while the matching system is loaded and which the compendium package also
 * reads; and the two WFRP4e queries under the names of the
 * previous generation.
 */
import { cosmereAdapter } from '../../../common/areas/wfrp4e-cosmere-traveller/cosmere.js';
import { travellerAdapter } from '../../../common/areas/wfrp4e-cosmere-traveller/traveller.js';
import { wfrp4eAdapter } from '../../../common/areas/wfrp4e-cosmere-traveller/wfrp4e.js';
import type { ModuleArea } from '../../areas.js';
import { addWfrp4eItems, updateWfrp4eActor } from './wfrp4e.js';

export const wfrp4eCosmereTravellerArea: ModuleArea = {
  id: 'wfrp4e-cosmere-traveller',
  adapters: [wfrp4eAdapter, cosmereAdapter, travellerAdapter],
  queries: [
    { names: 'updateWfrp4eActor', handler: updateWfrp4eActor },
    { names: 'addWfrp4eItems', handler: addWfrp4eItems },
  ],
  settings: [],
};
