/**
 * Area effects-playback: effects, playlist control, scene music, replacing a page.
 *
 * Server side: the five tools the original gained after our fork, with its
 * names and parameters.
 */
import type { ServerArea } from '../../tools/areas.js';
import { EFFECTS_PLAYBACK_TOOLS } from './tools.js';

export const effectsPlaybackArea: ServerArea = {
  id: 'effects-playback',
  tools: EFFECTS_PLAYBACK_TOOLS,
  resources: [],
  prompts: [],
};
