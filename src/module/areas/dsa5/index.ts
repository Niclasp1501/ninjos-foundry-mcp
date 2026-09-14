/**
 * Area dsa5: the adapter for Das Schwarze Auge 5 and the archetype tools.
 *
 * Module side: the adapter for the core registry, which the compendium
 * package also reads, and the query that creates a hero from an
 * archetype. Listing archetypes needs no query of its own: the server reads
 * the compendium indexes through getAvailablePacks and getPackIndex of 4.3.
 */
import { dsa5Adapter } from '../../../common/areas/dsa5/adapter.js';
import type { ModuleArea } from '../../areas.js';
import { QUERY, createDsa5CharacterFromArchetype } from './archetype.js';

export const dsa5Area: ModuleArea = {
  id: 'dsa5',
  adapters: [dsa5Adapter],
  queries: [{ names: QUERY, handler: createDsa5CharacterFromArchetype }],
  settings: [],
};
