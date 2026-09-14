/**
 * Area dnd5e: D&D 5e adapter, NPC building, features, spells.
 *
 * Module side: the adapter for the core registry, which the compendium
 * package also reads, and the nine queries of the NPC builder
 * under the names a server of the previous generation sends.
 */
import { dnd5eAdapter } from '../../../common/areas/dnd5e/adapter.js';
import type { ModuleArea } from '../../areas.js';
import { FEATURE_QUERIES, featureHandler } from './features.js';
import { FEATURE_IMPORT, SPELL_IMPORT, importHandler } from './imports.js';
import { createNpcActor } from './npc.js';
import { setActorSpellcasting } from './spellcasting.js';

export const dnd5eArea: ModuleArea = {
  id: 'dnd5e',
  adapters: [dnd5eAdapter],
  queries: [
    { names: 'createNpcActor', handler: createNpcActor },
    ...FEATURE_QUERIES.map(query => ({
      names: query.name,
      handler: featureHandler(query.mode, query.name),
    })),
    { names: 'setActorSpellcasting', handler: setActorSpellcasting },
    { names: 'addSpellsToActor', handler: importHandler(SPELL_IMPORT) },
    { names: 'addFeaturesFromCompendium', handler: importHandler(FEATURE_IMPORT) },
  ],
  settings: [],
};
