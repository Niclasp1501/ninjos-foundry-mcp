/**
 * The module-wide instances an area may read directly: the change log and the
 * tools registered by other modules.
 *
 * They lived in main.ts, which registers hooks when it is loaded, so an area
 * could only reach them through the public API on game.modules. This file
 * creates them without touching Foundry; every Foundry access happens when a
 * method is called.
 */
import { ChangeLog } from '../common/change-log.js';
import { MODULE_ID } from '../common/constants.js';
import { ExtensionTools, type ListedExtensionTool } from './extension-tools.js';
import {
  ServerRequestError,
  type ServerRequestChannel,
  type ServerRequestOptions,
} from './server-requests.js';
import { readSetting } from './settings.js';

/** The one change log of this module. */
export const changeLog = new ChangeLog();

/** The one registry of tools of other modules. */
export const extensionTools = new ExtensionTools({
  readSetting,
  writeSetting: (key, value) => game.settings.set(MODULE_ID, key, value),
  isGM: () => game.user?.isGM === true,
  callHook: (name, register) => {
    Hooks.callAll(name, register);
  },
});

/** Tools of released modules that are registered right now, as the server sees them. */
export function registeredExtensionTools(): ListedExtensionTool[] {
  return extensionTools.list();
}

let serverRequests: ServerRequestChannel | null = null;

/**
 * Put the bridge behind `requestServer`. main.ts does it at ready for a
 * Gamemaster; the test harness does it for its fake server. Returns the
 * previous channel so a test can restore it.
 */
export function useServerRequests(
  channel: ServerRequestChannel | null
): ServerRequestChannel | null {
  const previous = serverRequests;
  serverRequests = channel;
  return previous;
}

/**
 * Send a request to the server and wait for its answer. `method` is
 * the short name an area registered on the server. Fails with a
 * ServerRequestError (server-requests.ts); `isServerTooOld(error)` says the
 * server needs an update.
 */
export function requestServer(
  method: string,
  data: unknown = {},
  options: ServerRequestOptions = {}
): Promise<unknown> {
  if (!serverRequests) {
    return Promise.reject(
      new ServerRequestError(
        'NOT_CONNECTED',
        `The MCP bridge does not run in this browser, so the request "${method}" cannot reach the server. ` +
          "Only a Gamemaster's browser connects."
      )
    );
  }
  return serverRequests.request(method, data, options);
}

/** Whether a request can be sent right now: connected to a server that accepts them. */
export function serverRequestsAvailable(): boolean {
  return serverRequests?.available() === true;
}
