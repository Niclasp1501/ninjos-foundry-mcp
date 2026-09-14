/**
 * Area compendiums: every compendium tool, release list, lock, creature index.
 *
 * Module side: query handlers and settings of the area.
 *
 * For other packages:
 * - the interface area draws the windows "Release compendiums" and "Creature
 *   index" with `releaseWindowModel`, `saveReleaseList` and `rebuildCreatureIndex`.
 * - dnd5e and the other system areas register only their core adapter
 *   (`adapters` of their area); this package derives its view from
 *   it with `compendiumAdapterFor`. `registerCompendiumAdapter` is left for tests.
 */
import type { ModuleArea } from '../../areas.js';
import { RELEASE_LIST_SETTING } from '../../../common/areas/compendiums/release-list.js';
import { getEnhancedCreatureIndex, listCreaturesByCriteria } from './creatures.js';
import {
  AUTO_REBUILD_SETTING,
  INDEX_SETTING,
  prepareCreatureIndex,
  watchCompendiumActors,
} from './creature-index.js';
import { deleteCompendium, deleteCompendiumEntries } from './delete.js';
import { importFromCompendium } from './import.js';
import { getAvailablePacks, getPackIndex, listCompendiumEntries, listCompendiums } from './read.js';
import { getCompendiumDocumentFull, getCompendiumItem, searchCompendium } from './search.js';
import {
  createCompendium,
  exportToCompendium,
  organizeCompendium,
  setCompendiumLock,
} from './write.js';

export {
  registerCompendiumAdapter,
  activeCompendiumAdapter,
  compendiumAdapterFor,
} from './adapter.js';
export type { CompendiumAdapter, CreatureFilterSpec, CreatureRow } from './adapter.js';
export { rebuildCreatureIndex } from './creature-index.js';
export { getCompendiumDocumentFull } from './search.js';
export { releaseWindowModel, saveReleaseList } from './release-window.js';

export const compendiumsArea: ModuleArea = {
  id: 'compendiums',
  queries: [
    { names: 'listCompendiums', handler: listCompendiums },
    { names: 'getAvailablePacks', handler: getAvailablePacks },
    { names: ['listCompendiumEntries', 'list-compendium-entries'], handler: listCompendiumEntries },
    { names: ['getPackIndex', 'get-pack-index'], handler: getPackIndex },
    { names: 'searchCompendium', handler: searchCompendium },
    { names: 'getCompendiumItem', handler: getCompendiumItem },
    // Read by servers of the previous generation; the actors area imports the handler, never registers it again.
    { names: 'getCompendiumDocumentFull', handler: getCompendiumDocumentFull },
    { names: 'listCreaturesByCriteria', handler: listCreaturesByCriteria },
    { names: 'getEnhancedCreatureIndex', handler: getEnhancedCreatureIndex },
    { names: 'createCompendium', handler: createCompendium },
    { names: 'exportToCompendium', handler: exportToCompendium },
    { names: 'importFromCompendium', handler: importFromCompendium },
    { names: 'organizeCompendium', handler: organizeCompendium },
    { names: 'setCompendiumLock', handler: setCompendiumLock },
    {
      names: ['deleteCompendiumEntries', 'delete-compendium-entries'],
      handler: deleteCompendiumEntries,
    },
    { names: 'deleteCompendium', handler: deleteCompendium },
  ],
  settings: [
    // Maintained through the window "Release compendiums" (the interface area), not in the list.
    { key: RELEASE_LIST_SETTING, kind: String, initial: '', listed: false },
    // Both in the window "Creature index" (the interface area).
    { key: INDEX_SETTING, kind: Boolean, initial: true, listed: false },
    { key: AUTO_REBUILD_SETTING, kind: Boolean, initial: true, listed: false },
  ],
  ready: () => {
    if (!game.user?.isGM) return;
    watchCompendiumActors();
    void prepareCreatureIndex();
  },
};
