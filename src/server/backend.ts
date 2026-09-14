/**
 * The backend: one process per PC that holds the bridge to Foundry and
 * serves every MCP session through the control channel.
 *
 * This file puts the parts together and is free of process level concerns
 * (lock, signals, exit), so the tests can run a complete backend on free
 * ports. The executable entry is backend-main.ts.
 */
import { OriginGuard } from './bridge/connection-guards.js';
import { FoundryBridge } from './bridge/foundry-bridge.js';
import { startWebRtcTransport } from './bridge/webrtc-transport.js';
import { startWebSocketTransport, type RunningTransport } from './bridge/websocket-transport.js';
import type { ServerConfig } from './config.js';
import type {
  BackendApi,
  BackendEvent,
  CallOptions,
  CompletionRequest,
  CompletionValues,
  ListedPrompt,
  ListedResource,
  ListedResourceTemplate,
  ListedTool,
  PromptResult,
  ResourceContents,
  ToolResult,
} from './control/api.js';
import { ControlServer } from './control/control-server.js';
import { systemDetector } from './game-systems.js';
import { IdleShutdown } from './idle.js';
import { scopedLogger, setAreaLogTarget, type Logger } from './logger.js';
import { AreaLifecycle } from './area-lifecycle.js';
import { SERVER_AREAS } from './areas/index.js';
import { installServerAreas, type ServerArea } from './tools/areas.js';
import { ToolRegistry } from './tools/registry.js';
import { ServerRequestRegistry } from './tools/requests.js';
import { BackendEvents } from './tools/notifications.js';
import { PromptRegistry, ResourceRegistry, type ResourceContext } from './tools/resources.js';
import { messageOf } from './tools/results.js';

export interface BackendOptions {
  config: ServerConfig;
  logger: Logger;
  version: string;
  /** Called when the grace period ran out with nobody connected. */
  onIdle?: () => void;
  /** Interfaces for the bridge and the detour, for tests. */
  bridgeHosts?: string[];
  /** Default: every area. Tests pass their own. */
  areas?: readonly ServerArea[];
  /** The environment the areas see. Default: process.env. */
  env?: Readonly<Record<string, string | undefined>>;
}

export interface RunningBackend {
  controlPort: number;
  bridgePort: number | null;
  signalingPort: number | null;
  bridge: FoundryBridge;
  tools: ToolRegistry;
  /** Handlers of the requests the module sends. */
  requests: ServerRequestRegistry;
  /** Settles when `start` of every area has settled. The backend does not wait for it. */
  areasStarted: Promise<void>;
  /** The notifications every MCP session hears. */
  events: BackendEvents;
  close(): Promise<void>;
}

class BackendService implements BackendApi {
  constructor(
    private readonly tools: ToolRegistry,
    private readonly resources: ResourceRegistry,
    private readonly prompts: PromptRegistry,
    private readonly events: BackendEvents
  ) {}

  private context(signal?: AbortSignal): ResourceContext {
    return {
      query: (name, data, queryOptions) => this.tools.query(name, data, queryOptions),
      ...(signal ? { signal } : {}),
    };
  }

  async listResourceTemplates(): Promise<ListedResourceTemplate[]> {
    return this.resources.listTemplates();
  }

  complete(request: CompletionRequest): Promise<CompletionValues> {
    return request.ref.type === 'ref/prompt'
      ? this.prompts.complete(request.ref.name, request, this.context())
      : this.resources.complete(request.ref.uri, request, this.context());
  }

  watch(listener: (event: BackendEvent) => void): () => void {
    return this.events.watch(listener);
  }

  listTools(): Promise<ListedTool[]> {
    return this.tools.list();
  }

  callTool(
    name: string,
    args: Record<string, unknown>,
    options?: CallOptions
  ): Promise<ToolResult> {
    return this.tools.call(name, args, options);
  }

  async listResources(): Promise<ListedResource[]> {
    return this.resources.list();
  }

  readResource(uri: string, options: CallOptions = {}): Promise<ResourceContents> {
    return this.resources.read(uri, this.context(options.signal));
  }

  async listPrompts(): Promise<ListedPrompt[]> {
    return this.prompts.list();
  }

  async getPrompt(name: string, args: Record<string, string>): Promise<PromptResult> {
    return this.prompts.get(name, args, this.context());
  }
}

export async function startBackend(options: BackendOptions): Promise<RunningBackend> {
  const { config, logger } = options;
  const startedAt = Date.now();
  let bridgeProblem: string | null = null;

  const bridge = new FoundryBridge({
    serverVersion: options.version,
    logger,
    defaultTimeoutMs: config.queryTimeoutMs,
  });

  const tools = new ToolRegistry({
    bridge,
    logger,
    groups: config.toolGroups,
    comfyuiEnabled: config.comfyuiEnabled,
    maxChars: config.toolResponseMaxChars,
    startupWaitLeft: () => Math.max(0, startedAt + config.startupModuleWaitMs - Date.now()),
    bridgeProblem: () => bridgeProblem,
  });
  const resources = new ResourceRegistry();
  const prompts = new PromptRegistry();
  const events = new BackendEvents();
  const requests = new ServerRequestRegistry(area => scopedLogger(logger, `area:${area}`));
  const areas = options.areas ?? SERVER_AREAS;
  // Area loggers taken at import write into this log from now on.
  const previousAreaLog = setAreaLogTarget(logger);
  // Every package brings its own list; this line never changes for a new tool.
  installServerAreas(areas, { tools, resources, prompts, requests });
  bridge.setRequestHandler((method, data, connection) => requests.handle(method, data, connection));
  const lifecycle = new AreaLifecycle({
    areas,
    logger,
    config,
    env: options.env ?? process.env,
    query: (name, data, queryOptions) => tools.query(name, data, queryOptions),
    isModuleConnected: () => bridge.isConnected(),
    mcp: {
      emit: event => events.emit(event),
      listTools: () => tools.list(),
      onToolCall: listener => tools.onCall(listener),
      setToolFilter: filter => tools.setListFilter(filter),
    },
  });
  bridge.onConnectionEvent(event => lifecycle.connectionEvent(event));

  const idle = new IdleShutdown(config.idleShutdownMs, () => {
    logger.info('Nobody connected for the whole grace period, shutting down');
    options.onIdle?.();
  });

  const guard = new OriginGuard({
    configured: config.allowedOrigins,
    storeFile: config.originStoreFile,
    logger,
  });
  logger.info(`Origin check: ${guard.describe()}`);

  let transport: RunningTransport | null = null;
  let detour: RunningTransport | null = null;
  let retryTimer: NodeJS.Timeout | null = null;

  const control = new ControlServer({
    host: config.controlHost,
    port: config.controlPort,
    api: new BackendService(tools, resources, prompts, events),
    logger,
    onClientsChanged: count => idle.update({ wrappers: count }),
    status: () => ({
      version: options.version,
      bridge: bridge.status(),
      bridgeProblem,
      bridgeAddresses: transport?.addresses ?? [],
      webrtc: detour ? detour.addresses : null,
    }),
  });
  // Without the control port this backend is useless, and most likely another one holds it.
  const controlPort = await control.listen();
  logger.info(`Control channel on ${config.controlHost}:${controlPort}`);

  bridge.onConnectionCountChange(count => {
    idle.update({ modules: count });
    // A module that connects or leaves may belong to another world with another system.
    systemDetector.invalidate();
  });

  const openBridge = async (): Promise<void> => {
    try {
      transport = await startWebSocketTransport({
        port: config.bridgePort,
        path: config.bridgePath,
        remoteMode: config.remoteMode,
        guard,
        bridge,
        logger,
        ...(options.bridgeHosts ? { hosts: options.bridgeHosts } : {}),
      });
      bridgeProblem = null;
      logger.info(
        `Bridge listening on ${transport.addresses.join(', ')} path ${config.bridgePath}`
      );
      if (config.remoteMode)
        logger.warn('Remote mode: the bridge listens on every network interface');
    } catch (error) {
      // Not a reason to die: say it in every answer, and keep trying.
      bridgeProblem = `the bridge port ${config.bridgePort} could not be opened (${messageOf(error)})`;
      logger.error(`Bridge unavailable: ${bridgeProblem}. Retrying in 30 seconds.`);
      retryTimer = setTimeout(() => void openBridge(), 30_000);
      retryTimer.unref();
    }
  };
  await openBridge();

  if (config.webrtcEnabled) {
    try {
      detour = await startWebRtcTransport({
        port: config.signalingPort,
        remoteMode: config.remoteMode,
        guard,
        bridge,
        logger,
        ...(options.bridgeHosts ? { hosts: options.bridgeHosts } : {}),
      });
      logger.info(`WebRTC signaling on ${detour.addresses.join(', ')}`);
    } catch (error) {
      logger.warn(`WebRTC detour unavailable, the bridge runs without it: ${messageOf(error)}`);
    }
  }

  idle.update({ wrappers: 0, modules: 0 });

  // Not awaited: a slow area must not keep the control channel from answering.
  const areasStarted = lifecycle.start();

  return {
    controlPort,
    bridgePort: transport ? (transport as RunningTransport).port : null,
    signalingPort: detour ? (detour as RunningTransport).port : null,
    bridge,
    tools,
    requests,
    areasStarted,
    events,
    close: async () => {
      idle.cancel();
      if (retryTimer) clearTimeout(retryTimer);
      // Areas first, while the bridge is still there for a last word to the module.
      await lifecycle.stop();
      bridge.setRequestHandler(null);
      bridge.closeAll('The MCP backend is shutting down');
      await Promise.all([control.close(), transport?.close(), detour?.close()]);
      setAreaLogTarget(previousAreaLog);
    },
  };
}
