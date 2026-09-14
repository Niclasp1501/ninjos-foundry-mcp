/**
 * When the mcp-extras area tells the MCP sessions that something changed.
 *
 * - **Tool list:** after a module connected, introduced itself or left, the
 *   list is built again as a client would get it and compared with the last
 *   one. Only a real difference sends `tools_changed`. The events arrive in
 *   bursts (connected, then introduced), so they are gathered for a moment.
 * - **System tools:** tools an adapter names as its own (`adapter.tools`) are
 *   listed only while that system runs. While the system is unknown every one
 *   is listed. A hidden tool stays callable and answers WRONG_SYSTEM.
 * - **Resources:** a successful writing tool call updates the resources its
 *   group can touch; a connection change updates all of them. Changes made by
 *   hand in Foundry are not seen (no module part yet, see the package sheet).
 */
import type { SystemAdapterRegistry } from '../../../common/game-systems.js';
import type { SystemDetector } from '../../../common/system-detection.js';
import type { BridgeConnectionEvent } from '../../bridge/foundry-bridge.js';
import { activeGameSystem, serverSystemAdapters, systemDetector } from '../../game-systems.js';
import type { ServerAreaContext } from '../../tools/areas.js';
import type { AreaMcpAccess } from '../../tools/notifications.js';
import { ServerRequestError, type ServerRequestDefinition } from '../../tools/requests.js';
import { prefixesForWrite, SCHEME } from './uris.js';

export interface PolicyOptions {
  /** How long connection events are gathered before the list is compared. Default 300 ms. */
  debounceMs?: number;
  registry?: SystemAdapterRegistry;
  detector?: SystemDetector;
}

interface State {
  context: ServerAreaContext;
  mcp: AreaMcpAccess;
  fingerprint: string | null;
  timer: NodeJS.Timeout | null;
  refreshing: Promise<void>;
  unsubscribe: () => void;
}

export class ListChangePolicy {
  readonly #options: PolicyOptions;
  readonly #states = new Map<ServerAreaContext, State>();

  constructor(options: PolicyOptions = {}) {
    this.#options = options;
  }

  get #registry(): SystemAdapterRegistry {
    return this.#options.registry ?? serverSystemAdapters;
  }

  get #detector(): SystemDetector {
    return this.#options.detector ?? systemDetector;
  }

  start(context: ServerAreaContext): void {
    const mcp = context.mcp;
    if (!mcp || this.#states.has(context)) return;
    const unsubscribe = mcp.onToolCall(event => {
      if (event.readOnly || event.isError) return;
      mcp.emit({ type: 'resources_updated', prefixes: prefixesForWrite(event.group) });
    });
    const state: State = {
      context,
      mcp,
      fingerprint: null,
      timer: null,
      refreshing: Promise.resolve(),
      unsubscribe,
    };
    this.#states.set(context, state);
    mcp.setToolFilter(name => this.visible(name));
    state.refreshing = this.#fingerprintOf(mcp).then(
      fingerprint => {
        state.fingerprint = fingerprint;
      },
      error => context.logger.warn(`Could not read the first tool list: ${String(error)}`)
    );
  }

  stop(context: ServerAreaContext): void {
    const state = this.#states.get(context);
    if (!state) return;
    if (state.timer) clearTimeout(state.timer);
    state.unsubscribe();
    state.mcp.setToolFilter(null);
    this.#states.delete(context);
  }

  connection(_event: BridgeConnectionEvent, context: ServerAreaContext): void {
    const state = this.#states.get(context);
    if (state) this.#schedule(state);
  }

  /** Resolves when the refresh under way, if any, has finished. For tests. */
  async settled(context: ServerAreaContext): Promise<void> {
    const state = this.#states.get(context);
    if (!state) return;
    while (state.timer) await new Promise(resolve => setTimeout(resolve, 5));
    await state.refreshing;
  }

  /** Whether a tool belongs in the list for the system detected now. */
  visible(name: string): boolean {
    const owner = this.#registry.list().find(adapter => adapter.tools?.includes(name));
    if (!owner) return true;
    const detected = this.#detector.cached();
    if (!detected) return true;
    return this.#registry.find(detected.id) === owner;
  }

  /** The request a module part can send when it knows of a change the server cannot see. */
  request(): ServerRequestDefinition {
    return {
      names: 'mcpListsChanged',
      run: data => {
        const input = (typeof data === 'object' && data !== null ? data : {}) as {
          tools?: unknown;
          resources?: unknown;
        };
        const prefixes = input.resources === undefined ? [] : input.resources;
        if (
          !Array.isArray(prefixes) ||
          prefixes.some(p => typeof p !== 'string' || !p.startsWith(SCHEME))
        ) {
          throw new ServerRequestError(
            'INVALID_ARGUMENT',
            `resources must be a list of URI prefixes starting with ${SCHEME}`
          );
        }
        const states = [...this.#states.values()];
        for (const state of states) {
          if (prefixes.length)
            state.mcp.emit({ type: 'resources_updated', prefixes: prefixes as string[] });
          if (input.tools === true) this.#schedule(state);
        }
        return { delivered: states.length > 0 };
      },
    };
  }

  #schedule(state: State): void {
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.timer = null;
      state.refreshing = state.refreshing.then(() => this.#refresh(state));
    }, this.#options.debounceMs ?? 300);
    state.timer.unref?.();
  }

  async #refresh(state: State): Promise<void> {
    if (!this.#states.has(state.context)) return;
    try {
      if (state.context.isModuleConnected()) {
        // Fills the cache the filter reads; a failure counts as an unknown system and shows all.
        await activeGameSystem(state.context, {
          registry: this.#registry,
          detector: this.#detector,
        });
      }
      state.mcp.emit({ type: 'resources_updated', prefixes: [SCHEME] });
      const next = await this.#fingerprintOf(state.mcp);
      if (next !== state.fingerprint) {
        state.fingerprint = next;
        state.mcp.emit({ type: 'tools_changed' });
      }
    } catch (error) {
      state.context.logger.warn(`Could not compare the tool list: ${String(error)}`);
    }
  }

  async #fingerprintOf(mcp: AreaMcpAccess): Promise<string> {
    const tools = await mcp.listTools();
    return JSON.stringify(
      tools.map(tool => [tool.name, tool.description]).sort((a, b) => a[0]!.localeCompare(b[0]!))
    );
  }
}
