/**
 * What one area contributes to the server.
 *
 * Every area owns one folder under src/server/areas/<id>/ and exports one
 * ServerArea from its index.ts. The list of all areas (areas/index.ts) and
 * the backend never change when an area adds a tool, so work on one area
 * never touches a file of another.
 */
import type { SystemAdapter, SystemAdapterRegistry } from '../../common/game-systems.js';
import type { BridgeConnectionEvent, QueryOptions } from '../bridge/foundry-bridge.js';
import type { ServerConfig } from '../config.js';
import { serverSystemAdapters } from '../game-systems.js';
import type { Logger } from '../logger.js';
import type { AreaMcpAccess } from './notifications.js';
import type { ServerRequestDefinition, ServerRequestRegistry } from './requests.js';
import type {
  PromptDefinition,
  PromptRegistry,
  ResourceDefinition,
  ResourceRegistry,
  ResourceTemplateDefinition,
} from './resources.js';
import type { ToolRegistry } from './registry.js';
import type { ToolDefinition } from './types.js';

export interface ServerArea {
  /** Folder name of the area, the same on the module side. */
  id: string;
  tools?: readonly ToolDefinition[];
  resources?: readonly ResourceDefinition[];
  /** Resources with ids in the URI, e.g. `foundry://actor/{actorId}`. */
  resourceTemplates?: readonly ResourceTemplateDefinition[];
  prompts?: readonly PromptDefinition[];
  /** Game system adapters this area brings (src/common/game-systems.ts). */
  adapters?: readonly SystemAdapter[];
  /**
   * Handlers for requests the module sends to the server
   * (src/server/tools/requests.ts). Registered whatever the tool groups say,
   * so an area that is switched off can still answer "switched off".
   */
  requests?: readonly ServerRequestDefinition[];
  /**
   * Runs once when the backend has started, after the bridge port
   * opened. Return quickly and do long work in the background; the backend
   * does not wait for it. A failure is logged and stops nothing else.
   */
  start?(context: ServerAreaContext): void | Promise<void>;
  /**
   * Runs once when the backend shuts down, also after a failed start,
   * in reverse order of the list, each bounded in time. Close child processes
   * and timers here.
   */
  stop?(context: ServerAreaContext): void | Promise<void>;
  /** A module connected, introduced itself or went away. Between start and stop only. */
  onModuleConnection?(
    event: BridgeConnectionEvent,
    context: ServerAreaContext
  ): void | Promise<void>;
}

/** What `start`, `stop` and `onModuleConnection` of an area get. */
export interface ServerAreaContext {
  areaId: string;
  /** Writes into the backend log, each line with `[area:<id>]`. */
  logger: Logger;
  config: Readonly<ServerConfig>;
  /** The environment of the backend process (process.env), for variables only the area reads. */
  env: Readonly<Record<string, string | undefined>>;
  /** Ask the module, as a tool handler does. Fails with NOT_CONNECTED without a module. */
  query(name: string, data?: unknown, options?: QueryOptions): Promise<unknown>;
  isModuleConnected(): boolean;
  /** Aborted when the backend begins to shut down. */
  signal: AbortSignal;
  /** Notifications to every MCP session. Absent where no backend runs (area tests). */
  mcp?: AreaMcpAccess;
}

export interface AreaTargets {
  tools: Pick<ToolRegistry, 'register'>;
  /** `registerTemplate` since the mcp-extras area; a target without it cannot take templates. */
  resources: Pick<ResourceRegistry, 'register'> &
    Partial<Pick<ResourceRegistry, 'registerTemplate'>>;
  prompts: Pick<PromptRegistry, 'register'>;
  /** Default: the server's registry (src/server/game-systems.ts). */
  adapters?: Pick<SystemAdapterRegistry, 'register'>;
  /** Without it, request names are still checked for conflicts but not registered. */
  requests?: Pick<ServerRequestRegistry, 'register'>;
}

/**
 * Register every contribution. A name taken twice, within one area or across
 * two, stops the start with both owners named, instead of one silently
 * replacing the other.
 */
export function installServerAreas(areas: readonly ServerArea[], targets: AreaTargets): void {
  const ids = new Set<string>();
  const owners = new Map<string, string>();
  const claim = (kind: string, name: string, area: ServerArea) => {
    const key = `${kind}:${name}`;
    const owner = owners.get(key);
    if (owner) {
      throw new Error(
        `The ${kind} "${name}" of area "${area.id}" is already registered by area "${owner}"`
      );
    }
    owners.set(key, area.id);
  };

  for (const area of areas) {
    if (ids.has(area.id)) throw new Error(`The area "${area.id}" is listed twice`);
    ids.add(area.id);
    for (const tool of area.tools ?? []) {
      claim('tool', tool.name, area);
      targets.tools.register(tool);
    }
    for (const resource of area.resources ?? []) {
      claim('resource', resource.uri, area);
      targets.resources.register(resource);
    }
    for (const template of area.resourceTemplates ?? []) {
      claim('resource template', template.uriTemplate, area);
      if (!targets.resources.registerTemplate) {
        throw new Error(
          `The resource template "${template.uriTemplate}" of area "${area.id}" has no registry to go to`
        );
      }
      targets.resources.registerTemplate(template);
    }
    for (const prompt of area.prompts ?? []) {
      claim('prompt', prompt.name, area);
      targets.prompts.register(prompt);
    }
    for (const adapter of area.adapters ?? []) {
      (targets.adapters ?? serverSystemAdapters).register(adapter, area.id);
    }
    for (const request of area.requests ?? []) {
      const names = typeof request.names === 'string' ? [request.names] : [...request.names];
      for (const name of names) claim('server request', name, area);
      targets.requests?.register(request, area.id);
    }
  }
}
