/**
 * Area scenes: create, change, restore and delete scenes, folders, notes, thumbnails, switching, world info.
 *
 * Server side: tools, resources and prompts of the package.
 */
import type { ServerArea } from '../../tools/areas.js';
import { sceneTools } from './scene-tools.js';
import { getWorldInfoTool, worldInfoResource } from './world-info.js';

export const scenesArea: ServerArea = {
  id: 'scenes',
  tools: [getWorldInfoTool, ...sceneTools],
  resources: [worldInfoResource],
  prompts: [],
};
