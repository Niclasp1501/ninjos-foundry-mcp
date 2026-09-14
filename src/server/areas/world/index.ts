/**
 * Area world: permission overview, playlists, roll tables.
 *
 * Server side: tools, resources and prompts of the package. Names and
 * parameters are the ones in the tool directory.
 */
import type { ServerArea } from '../../tools/areas.js';
import { getPermissionsTool } from './permissions.js';
import { deletePlaylistTool, listPlaylistsTool, setScenePlaylistTool } from './playlists.js';
import { createRollTableTool, deleteRollTableTool, listRollTablesTool } from './roll-tables.js';

export const worldArea: ServerArea = {
  id: 'world',
  tools: [
    getPermissionsTool,
    listPlaylistsTool,
    setScenePlaylistTool,
    deletePlaylistTool,
    listRollTablesTool,
    createRollTableTool,
    deleteRollTableTool,
  ],
  resources: [],
  prompts: [],
};
