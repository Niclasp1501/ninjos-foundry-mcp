/**
 * Area scene-image: screenshot of the scene with grid and token list.
 *
 * Module side: the reading query getSceneImage (handler.ts). No settings.
 */
import type { ModuleArea } from '../../areas.js';
import { getSceneImage } from './handler.js';

export const sceneImageArea: ModuleArea = {
  id: 'scene-image',
  queries: [{ names: ['getSceneImage'], handler: getSceneImage }],
  settings: [],
};
