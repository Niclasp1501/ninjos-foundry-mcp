/**
 * Area maps: map generator through ComfyUI, only when switched on.
 *
 * Server side. The three tools belong to the group `maps`, which the core
 * lists only with COMFYUI_ENABLED=true. The runtime (queue, ComfyUI client,
 * process) is created when the area starts and only then, never at import
 * (area.ts).
 */
import { createMapsArea } from './area.js';
import { createMapsRuntime } from './runtime.js';
import { MapsRuntimeHolder } from './tools.js';

/** The one runtime of this backend. */
export const mapsRuntime = new MapsRuntimeHolder((env, logger) =>
  createMapsRuntime(env, { logger })
);

export const mapsArea = createMapsArea(mapsRuntime);
