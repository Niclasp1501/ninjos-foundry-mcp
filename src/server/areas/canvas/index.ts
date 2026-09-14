/**
 * Area canvas: walls, doors, lights, regions, tiles, drawings, sounds, camera, ping, targets, range, path finding.
 *
 * Server side: tools, resources and prompts of the package.
 */
import type { ServerArea } from '../../tools/areas.js';
import { CANVAS_TOOLS } from './tools.js';

export const canvasArea: ServerArea = {
  id: 'canvas',
  tools: CANVAS_TOOLS,
  resources: [],
  prompts: [],
};
