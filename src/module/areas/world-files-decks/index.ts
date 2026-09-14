/**
 * Area world-files-decks: world time, pause, notifications, users,
 * files with reference check, card stacks, settings.
 *
 * Module side: query handlers. No settings of its own.
 */
import type { ModuleArea } from '../../areas.js';
import {
  createCardStack,
  dealCards,
  deleteCardStack,
  drawCards,
  getCardStack,
  listCardStacks,
  passCards,
  resetCardStack,
  shuffleCardStack,
} from './cards.js';
import { browseFiles, copyFile, createDirectory, uploadFile } from './files.js';
import { listenForNotifications, sendNotification } from './notifications.js';
import { findFileReferences, findMissingFiles } from './references.js';
import { listSettings, setWorldSetting } from './settings.js';
import { advanceWorldTime, getWorldTime, setGamePause } from './time.js';
import { listUsers } from './users.js';

export const worldFilesDecksArea: ModuleArea = {
  id: 'world-files-decks',
  queries: [
    { names: 'getWorldTime', handler: getWorldTime },
    { names: 'advanceWorldTime', handler: advanceWorldTime },
    { names: 'setGamePause', handler: setGamePause },
    { names: 'sendNotification', handler: sendNotification },
    { names: 'listUsers', handler: listUsers },
    { names: 'browseFiles', handler: browseFiles },
    { names: 'createDirectory', handler: createDirectory },
    { names: 'uploadFile', handler: uploadFile },
    { names: 'copyFile', handler: copyFile },
    { names: 'findFileReferences', handler: findFileReferences },
    { names: 'findMissingFiles', handler: findMissingFiles },
    { names: 'listCardStacks', handler: listCardStacks },
    { names: 'getCardStack', handler: getCardStack },
    { names: 'createCardStack', handler: createCardStack },
    { names: 'shuffleCardStack', handler: shuffleCardStack },
    { names: 'drawCards', handler: drawCards },
    { names: 'dealCards', handler: dealCards },
    { names: 'passCards', handler: passCards },
    { names: 'resetCardStack', handler: resetCardStack },
    { names: 'deleteCardStack', handler: deleteCardStack },
    { names: 'listSettings', handler: listSettings },
    { names: 'setWorldSetting', handler: setWorldSetting },
  ],
  settings: [],
  // Every browser listens, players too: a notification is meant for them.
  ready: () => listenForNotifications(),
};
