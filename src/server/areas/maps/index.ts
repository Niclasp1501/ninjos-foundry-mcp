/**
 * Area maps: battle maps and location pictures through Gemini, with the key
 * of the PC that runs the server.
 *
 * generate-battlemap, generate-scene-image and edit-map-image belong to the
 * group `maps`, which the core lists only when GEMINI_API_KEY is set.
 */
import { createMapsArea } from './area.js';

export const mapsArea = createMapsArea();
