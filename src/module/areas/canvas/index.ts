/**
 * Area canvas: walls, doors, lights, regions, tiles, drawings, sounds, camera, ping, targets, range, path finding.
 *
 * Module side: query handlers and settings of the package.
 */
import type { ModuleArea } from '../../areas.js';
import {
  createCanvasElements,
  deleteCanvasElements,
  listCanvasElements,
  setDoorState,
  updateCanvasElements,
} from './elements.js';
import { checkWallCollision, findPath, findTokensInRange, measureDistance } from './measure.js';
import { getCanvasView, panCamera, pingCanvas, setTargets } from './view.js';

export const canvasArea: ModuleArea = {
  id: 'canvas',
  queries: [
    { names: 'listCanvasElements', handler: listCanvasElements },
    { names: 'createCanvasElements', handler: createCanvasElements },
    { names: 'updateCanvasElements', handler: updateCanvasElements },
    { names: 'deleteCanvasElements', handler: deleteCanvasElements },
    { names: 'setDoorState', handler: setDoorState },
    { names: 'getCanvasView', handler: getCanvasView },
    { names: 'panCamera', handler: panCamera },
    { names: 'pingCanvas', handler: pingCanvas },
    { names: 'setTargets', handler: setTargets },
    { names: 'measureDistance', handler: measureDistance },
    { names: 'checkWallCollision', handler: checkWallCollision },
    { names: 'findPath', handler: findPath },
    { names: 'findTokensInRange', handler: findTokensInRange },
  ],
  settings: [],
};
