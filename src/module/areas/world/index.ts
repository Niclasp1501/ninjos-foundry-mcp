/**
 * Area world: permission overview, playlists, roll tables.
 *
 * Module side: query handlers and settings of the package. The query names
 * are the ones a server of either generation sends.
 */
import type { ModuleArea } from '../../areas.js';
import { getPermissions } from './permissions.js';
import { deletePlaylist, listPlaylists, setScenePlaylist } from './playlists.js';
import { createRollTable, deleteRollTable, listRollTables } from './roll-tables.js';

export const worldArea: ModuleArea = {
  id: 'world',
  queries: [
    { names: 'getPermissions', handler: getPermissions },
    { names: 'listPlaylists', handler: listPlaylists },
    { names: 'setScenePlaylist', handler: setScenePlaylist },
    { names: 'deletePlaylist', handler: deletePlaylist },
    { names: 'listRollTables', handler: listRollTables },
    { names: 'createRollTable', handler: createRollTable },
    { names: 'deleteRollTable', handler: deleteRollTable },
  ],
  settings: [],
};
