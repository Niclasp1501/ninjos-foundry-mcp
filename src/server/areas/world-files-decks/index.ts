/**
 * Area world-files-decks: world time, pause, notifications, users,
 * files with reference check, card stacks, settings.
 *
 * Server side: tools of the package. All names are new; the previous generation had no
 * tool for any of this.
 */
import type { ServerArea } from '../../tools/areas.js';
import {
  createCardDeckTool,
  dealCardsTool,
  deleteCardStackTool,
  drawCardsTool,
  getCardStackTool,
  listCardStacksTool,
  passCardsTool,
  resetCardStackTool,
  shuffleCardStackTool,
} from './card-tools.js';
import {
  browseFilesTool,
  copyFileTool,
  createDirectoryTool,
  findFileReferencesTool,
  findMissingFilesTool,
  uploadFileTool,
} from './file-tools.js';
import {
  advanceWorldTimeTool,
  getWorldTimeTool,
  listSettingsTool,
  listUsersTool,
  sendNotificationTool,
  setGamePauseTool,
  setWorldSettingTool,
} from './world-tools.js';

export const worldFilesDecksArea: ServerArea = {
  id: 'world-files-decks',
  tools: [
    getWorldTimeTool,
    advanceWorldTimeTool,
    setGamePauseTool,
    sendNotificationTool,
    listUsersTool,
    listSettingsTool,
    setWorldSettingTool,
    browseFilesTool,
    createDirectoryTool,
    uploadFileTool,
    copyFileTool,
    findFileReferencesTool,
    findMissingFilesTool,
    listCardStacksTool,
    getCardStackTool,
    createCardDeckTool,
    shuffleCardStackTool,
    drawCardsTool,
    dealCardsTool,
    passCardsTool,
    resetCardStackTool,
    deleteCardStackTool,
  ],
  resources: [],
  prompts: [],
};
