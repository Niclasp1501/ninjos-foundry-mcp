/**
 * Area scene-image: screenshot of the scene with grid and token list.
 *
 * Server side: the tool get-scene-image (tools.ts).
 */
import type { ServerArea } from '../../tools/areas.js';
import { getSceneImageTool } from './tools.js';

export const sceneImageArea: ServerArea = {
  id: 'scene-image',
  tools: [getSceneImageTool],
  resources: [],
  prompts: [],
};
