/**
 * Every area, in a fixed order.
 *
 * An area fills its own folder and never edits this list; only a new area
 * is a reason to change it.
 */
import type { ModuleArea } from '../areas.js';
import { journalsArea } from './journals/index.js';
import { scenesArea } from './scenes/index.js';
import { compendiumsArea } from './compendiums/index.js';
import { worldArea } from './world/index.js';
import { interfaceArea } from './interface/index.js';
import { actorsArea } from './actors/index.js';
import { dnd5eArea } from './dnd5e/index.js';
import { tokensDiceArea } from './tokens-dice/index.js';
import { effectsPlaybackArea } from './effects-playback/index.js';
import { campaignArea } from './campaign/index.js';
import { mapsArea } from './maps/index.js';
import { combatRollsArea } from './combat-rolls/index.js';
import { chatTablesMacrosArea } from './chat-tables-macros/index.js';
import { canvasArea } from './canvas/index.js';
import { sceneImageArea } from './scene-image/index.js';
import { worldFilesDecksArea } from './world-files-decks/index.js';
import { genericAccessArea } from './generic-access/index.js';
import { pf2eArea } from './pf2e/index.js';
import { dsa5Area } from './dsa5/index.js';
import { wfrp4eCosmereTravellerArea } from './wfrp4e-cosmere-traveller/index.js';
import { mcpExtrasArea } from './mcp-extras/index.js';
import { previewUndoArea } from './preview-undo/index.js';

export const MODULE_AREAS: readonly ModuleArea[] = [
  journalsArea,
  scenesArea,
  compendiumsArea,
  worldArea,
  interfaceArea,
  actorsArea,
  dnd5eArea,
  tokensDiceArea,
  effectsPlaybackArea,
  campaignArea,
  mapsArea,
  combatRollsArea,
  chatTablesMacrosArea,
  canvasArea,
  sceneImageArea,
  worldFilesDecksArea,
  genericAccessArea,
  pf2eArea,
  dsa5Area,
  wfrp4eCosmereTravellerArea,
  mcpExtrasArea,
  previewUndoArea,
];
