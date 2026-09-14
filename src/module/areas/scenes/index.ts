/**
 * Area scenes: create, change, restore and delete scenes, folders, notes, thumbnails, switching, world info.
 *
 * Module side: query handlers and settings of the package. The query names
 * are the ones a server of either generation sends.
 */
import type { ModuleArea } from '../../areas.js';
import { createScene, restoreScene } from './create.js';
import { createSceneNote, refreshSceneThumb, switchScene, updateScene } from './change.js';
import { deleteScene } from './delete.js';
import { getActiveScene, listSceneFolders, listScenes } from './read.js';
import { getWorldInfo } from './world-info.js';

export const scenesArea: ModuleArea = {
  id: 'scenes',
  queries: [
    { names: 'getWorldInfo', handler: getWorldInfo },
    { names: 'list-scenes', handler: listScenes },
    { names: 'listSceneFolders', handler: listSceneFolders },
    { names: 'getActiveScene', handler: getActiveScene },
    { names: 'createScene', handler: createScene },
    { names: 'restoreScene', handler: restoreScene },
    { names: 'updateScene', handler: updateScene },
    { names: 'createSceneNote', handler: createSceneNote },
    { names: 'refreshSceneThumb', handler: refreshSceneThumb },
    { names: 'switch-scene', handler: switchScene },
    { names: 'deleteScene', handler: deleteScene },
  ],
  settings: [],
};
