/**
 * Entry of the Foundry module ninjos-foundry-mcp.
 *
 * init: settings, query handlers, registration of tools of other modules, API.
 * ready: for a Gamemaster only, the bridge and its status readout.
 */
import type { ChangeLog } from '../common/change-log.js';
import { BRIDGE_PROTOCOL, DEFAULT_BRIDGE_PORT, MODULE_ID } from '../common/constants.js';
import type { HelloData } from '../common/protocol.js';
import { MODULE_AREAS } from './areas/index.js';
import { areaSettings, installAreaAdapters, installAreaQueries } from './areas.js';
import { BridgeClient, PREVIOUS_SERVER_HOOK, type SocketLike } from './bridge-client.js';
import { changeLog, extensionTools, useServerRequests } from './core-services.js';
import { QueryDispatcher } from './dispatcher.js';
import type { ExtensionToolDefinition } from './extension-tools.js';
import { notify } from './notify.js';
import { readSetting, registerSettings, SETTING } from './settings.js';
import { installStatusIndicator, refreshStatusIndicator } from './status-indicator.js';

const isGM = () => game.user?.isGM === true;

const dispatcher = new QueryDispatcher({ isGM, readSetting, changeLog });

let client: BridgeClient | null = null;

const notificationsOn = () => readSetting(SETTING.enableNotifications) !== false;

function hello(): HelloData {
  const data: HelloData = { protocol: BRIDGE_PROTOCOL };
  const version = game.modules.get(MODULE_ID)?.version;
  if (version) data.moduleVersion = version;
  if (game.world) {
    data.worldId = game.world.id;
    data.worldTitle = game.world.title;
  }
  if (game.user) {
    data.userId = game.user.id;
    data.userName = game.user.name;
  }
  return data;
}

function createClient(): BridgeClient {
  return new BridgeClient({
    createSocket: url => new WebSocket(url) as unknown as SocketLike,
    settings: {
      enabled: () => readSetting(SETTING.enabled) !== false,
      host: () => String(readSetting(SETTING.serverHost) || 'localhost'),
      port: () => Number(readSetting(SETTING.serverPort)) || DEFAULT_BRIDGE_PORT,
      autoReconnect: () => readSetting(SETTING.autoReconnectEnabled) !== false,
      heartbeatSeconds: () => Number(readSetting(SETTING.heartbeatInterval)) || 30,
    },
    dispatch: (method, data, progress) => dispatcher.dispatch(method, data, progress),
    hello,
    events: {
      connected: () => {
        if (notificationsOn()) notify.info('connected', 'MCP bridge connected.');
        refreshStatusIndicator();
      },
      disconnected: () => {
        if (notificationsOn())
          notify.info('disconnected', 'MCP bridge disconnected. It reconnects on its own.');
        refreshStatusIndicator();
      },
      unreachable: url =>
        notify.warn(
          'serverUnreachable',
          'The MCP server on the PC is not reachable at {url}. Start it there; the bridge connects on its own as soon as it runs.',
          { url }
        ),
      stillDown: () => {
        if (notificationsOn()) {
          notify.warn(
            'lostConnection',
            'The MCP bridge has been down for a minute. It keeps trying every 30 seconds.'
          );
        }
      },
      rejected: reason =>
        notify.warn('rejected', 'The MCP server on the PC refused this page: {reason}', {
          reason: reason || window.location.origin,
        }),
      changed: () => refreshStatusIndicator(),
      previousServer: () => {
        refreshStatusIndicator();
        Hooks.callAll(PREVIOUS_SERVER_HOOK);
      },
    },
    pageProtocol: () => window.location.protocol,
    pageOrigin: () => window.location.origin,
  });
}

const BRIDGE_KEYS: ReadonlySet<string> = new Set([
  SETTING.enabled,
  SETTING.serverHost,
  SETTING.serverPort,
  SETTING.connectionType,
]);

function onSettingChange(key: string): void {
  if (client && isGM() && BRIDGE_KEYS.has(key)) client.start();
  refreshStatusIndicator();
}

/** The queries of the bridge itself. Everything a package answers comes from its area. */
function registerCoreQueries(): void {
  dispatcher.register('ping', {
    access: { kind: 'read' },
    run: () => ({ pong: true, timestamp: Date.now() }),
  });
  // The German aliases stay one version: they may have shipped with 14.2609.3.
  dispatcher.register(['listExtensionTools', 'listFremdwerkzeuge'], {
    access: { kind: 'read' },
    run: () => extensionTools.listForServer(),
  });
  dispatcher.register(['callExtensionTool', 'callFremdwerkzeug'], {
    // The gate for these runs inside ExtensionTools.call, because only the tool
    // itself says whether it writes. It is the same checkAccess decision.
    access: { kind: 'read' },
    run: (data, context) => extensionTools.call(data, context.progress),
  });
  dispatcher.register('getChangeLog', {
    access: { kind: 'read' },
    run: data => {
      const limit = Number((data as { limit?: unknown } | null)?.limit);
      return changeLog.list(Number.isInteger(limit) && limit > 0 ? { limit } : {});
    },
  });
}

Hooks.once('init', () => {
  registerSettings(onSettingChange, areaSettings(MODULE_AREAS));
  registerCoreQueries();
  installAreaQueries(MODULE_AREAS, dispatcher);
  installAreaAdapters(MODULE_AREAS);
  for (const area of MODULE_AREAS) area.init?.();
  extensionTools.collect({ clear: true });

  const module = game.modules.get(MODULE_ID);
  if (module) {
    module.api = {
      registerTool: (moduleId: string, definition: ExtensionToolDefinition) =>
        extensionTools.registerTool(moduleId, definition),
      listTools: () => extensionTools.list(),
      changes: { list: (filter?: Parameters<ChangeLog['list']>[0]) => changeLog.list(filter) },
      getStatus: () => client?.getStatus() ?? null,
    };
  }
});

Hooks.once('ready', async () => {
  // One area failing at ready must not keep the others or the bridge from starting.
  for (const area of MODULE_AREAS) {
    try {
      await area.ready?.();
    } catch (error) {
      console.error(`ninjos-foundry-mcp | ready of area "${area.id}" failed`, error);
    }
  }
  if (!isGM()) return;

  await extensionTools.migrateLegacySetting();
  // Second call of the registration hook, for modules that subscribed after init.
  extensionTools.collect({ clear: false });

  client = createClient();
  const handle = client;
  // Requests of the areas to the server go through this bridge.
  useServerRequests({
    request: (method, data, options) => handle.request(method, data, options),
    available: () => handle.supportsServerRequests(),
  });
  (window as unknown as { foundryMCPBridge: unknown }).foundryMCPBridge = {
    getStatus: () => handle.getStatus(),
    start: () => handle.start(),
    stop: () => handle.stop(),
  };

  installStatusIndicator();
  handle.start();
});
