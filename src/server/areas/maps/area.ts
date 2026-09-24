/**
 * The server area of the image generator.
 *
 * Only tools: nothing starts with the backend and nothing runs in the
 * background. The core lists the group `maps` only when GEMINI_API_KEY is set
 * (config.ts), so a server without a key shows none of the three tools.
 */
import type { ServerArea } from '../../tools/areas.js';
import { mapTools, type MapsDeps } from './tools.js';

export function createMapsArea(deps?: MapsDeps): ServerArea {
  return {
    id: 'maps',
    tools: mapTools(deps),
    resources: [],
    prompts: [],
  };
}
