/**
 * Area pf2e: the Pathfinder Second Edition adapter.
 *
 * Module side: the adapter for the core registry, which the compendium
 * package also reads, and the query behind pf2e-manage-conditions.
 */
import { pf2eAdapter } from '../../../common/areas/pf2e/adapter.js';
import type { ModuleArea } from '../../areas.js';
import { manageConditions } from './conditions.js';

export const pf2eArea: ModuleArea = {
  id: 'pf2e',
  adapters: [pf2eAdapter],
  queries: [{ names: 'pf2eManageConditions', handler: manageConditions }],
  settings: [],
};
