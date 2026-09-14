/**
 * Server and module of the areas in one process, on a fake Foundry.
 *
 * A tool call goes the real way: ToolRegistry with argument check and group
 * switch, a bridge that serialises like the socket does, the module
 * dispatcher with the GM check and the permission gate, the handler, and the
 * same way back. Only the socket and Foundry itself are replaced.
 *
 * By default every area of both lists is installed, so a test also notices a
 * name another package already took. Area `init` and `ready` do not run;
 * call them in the test when a package needs them.
 */
import { ChangeLog } from '../common/change-log.js';
import { shortQueryName } from '../common/constants.js';
import { MODULE_AREAS } from '../module/areas/index.js';
import { useServerRequests } from '../module/core-services.js';
import { serverFailure } from '../module/server-requests.js';
import { AreaLifecycle } from '../server/area-lifecycle.js';
import type { BridgeConnectionEvent } from '../server/bridge/foundry-bridge.js';
import { readConfig } from '../server/config.js';
import { ServerRequestRegistry } from '../server/tools/requests.js';
import {
  areaSettings,
  installAreaAdapters,
  installAreaQueries,
  type ModuleArea,
} from '../module/areas.js';
import { QueryDispatcher, QueryError } from '../module/dispatcher.js';
import { readSetting, registerSettings } from '../module/settings.js';
import { SERVER_AREAS } from '../server/areas/index.js';
import { BridgeError, type QueryOptions } from '../server/bridge/foundry-bridge.js';
import type { ResourceContents, ToolResult } from '../server/control/api.js';
import { silentLogger } from '../server/logger.js';
import { installServerAreas, type ServerArea } from '../server/tools/areas.js';
import { ToolRegistry, type BridgeAccess } from '../server/tools/registry.js';
import { PromptRegistry, ResourceRegistry } from '../server/tools/resources.js';
import { FakeFoundry } from './fake-foundry.js';

export interface AreaHarnessOptions {
  /** Default: a new FakeFoundry with one Gamemaster. */
  foundry?: FakeFoundry;
  /** Default: every module area. */
  moduleAreas?: readonly ModuleArea[];
  /** Default: every server area. */
  serverAreas?: readonly ServerArea[];
  /** FOUNDRY_MCP_TOOL_GROUPS. Default: all. */
  groups?: string[];
  /** Default true, so the maps group is not switched off in tests. */
  comfyuiEnabled?: boolean;
  /** TOOL_RESPONSE_MAX_CHARS. Default 0, no limit. */
  maxChars?: number;
}

export interface AreaHarness {
  foundry: FakeFoundry;
  dispatcher: QueryDispatcher;
  changeLog: ChangeLog;
  tools: ToolRegistry;
  resources: ResourceRegistry;
  prompts: PromptRegistry;
  /** Call a tool as the model would. */
  call(name: string, args?: Record<string, unknown>): Promise<ToolResult>;
  /** Send a query as the server would; module errors arrive as BridgeError with moduleCode. */
  query(name: string, data?: unknown, options?: QueryOptions): Promise<unknown>;
  readResource(uri: string): Promise<ResourceContents>;
  /** Handlers of the requests the module sends to the server. */
  requests: ServerRequestRegistry;
  /** Start, stop and connection events of the server areas. */
  lifecycle: AreaLifecycle;
  /**
   * Send a request as the module would, through JSON, with the errors
   * `requestServer` gives. `requestServer` of core-services.ts takes the same way.
   */
  request(name: string, data?: unknown): Promise<unknown>;
  /** Run `start` of every server area; not done by default, like `init` and `ready`. */
  startServerAreas(): Promise<void>;
  /** Run `stop` of every server area. */
  stopServerAreas(): Promise<void>;
  /** Tell the started areas that a module connected, introduced itself or left. */
  moduleConnection(type: BridgeConnectionEvent['type']): void;
  /** Remove the fake globals again. Call it in afterEach. */
  close(): void;
}

/** What crosses the socket is JSON: no functions, no documents, no undefined in arrays. */
function overTheWire(value: unknown): unknown {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function createAreaHarness(options: AreaHarnessOptions = {}): AreaHarness {
  const foundry = (options.foundry ?? new FakeFoundry()).install();
  const moduleAreas = options.moduleAreas ?? MODULE_AREAS;

  try {
    registerSettings(() => undefined, areaSettings(moduleAreas));
    const changeLog = new ChangeLog();
    const dispatcher = new QueryDispatcher({
      isGM: () => foundry.game.user?.isGM === true,
      readSetting,
      changeLog,
    });
    installAreaQueries(moduleAreas, dispatcher);
    installAreaAdapters(moduleAreas);

    const bridge: BridgeAccess = {
      isConnected: () => true,
      waitForModule: async () => true,
      query: async (name, data, queryOptions = {}) => {
        try {
          const answer = await dispatcher.dispatch(name, overTheWire(data), progress =>
            queryOptions.onProgress?.(progress)
          );
          return overTheWire(answer);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new BridgeError(
            'MODULE_ERROR',
            message,
            error instanceof QueryError ? error.code : undefined
          );
        }
      },
    };

    const tools = new ToolRegistry({
      bridge,
      logger: silentLogger,
      groups: options.groups ?? [],
      comfyuiEnabled: options.comfyuiEnabled ?? true,
      maxChars: options.maxChars ?? 0,
      startupWaitLeft: () => 0,
    });
    const resources = new ResourceRegistry();
    const prompts = new PromptRegistry();
    const requests = new ServerRequestRegistry(() => silentLogger);
    const serverAreas = options.serverAreas ?? SERVER_AREAS;
    installServerAreas(serverAreas, { tools, resources, prompts, requests });

    const connection = {
      id: 'harness',
      role: 'active' as const,
      transport: 'websocket' as const,
      protocol: 2,
    };
    const lifecycle = new AreaLifecycle({
      areas: serverAreas,
      logger: silentLogger,
      config: readConfig(options.comfyuiEnabled === false ? {} : { COMFYUI_ENABLED: 'true' })
        .config,
      env: {},
      query: (name, data, queryOptions) => tools.query(name, data, queryOptions),
      isModuleConnected: () => true,
    });

    const request = async (name: string, data: unknown = {}): Promise<unknown> => {
      try {
        const answer = await requests.handle(shortQueryName(name), overTheWire(data), connection);
        return overTheWire(answer ?? null);
      } catch (error) {
        const code = (error as { code?: unknown } | null)?.code;
        throw serverFailure(
          error instanceof Error ? error.message : String(error),
          typeof code === 'string' ? code : 'SERVER_ERROR'
        );
      }
    };
    const previousRequests = useServerRequests({
      request: (name, data) => request(name, data),
      available: () => true,
    });

    return {
      foundry,
      dispatcher,
      changeLog,
      tools,
      resources,
      prompts,
      requests,
      lifecycle,
      call: (name, args = {}) => tools.call(name, args),
      query: (name, data = {}, queryOptions) => bridge.query(name, data, queryOptions),
      readResource: uri =>
        resources.read(uri, {
          query: (name, data, queryOptions) => tools.query(name, data, queryOptions),
        }),
      request,
      startServerAreas: () => lifecycle.start(),
      stopServerAreas: () => lifecycle.stop(),
      moduleConnection: type =>
        lifecycle.connectionEvent({
          type,
          connection,
          moduleConnected: type !== 'disconnected',
        }),
      close: () => {
        useServerRequests(previousRequests);
        void lifecycle.stop();
        foundry.uninstall();
      },
    };
  } catch (error) {
    foundry.uninstall();
    throw error;
  }
}
