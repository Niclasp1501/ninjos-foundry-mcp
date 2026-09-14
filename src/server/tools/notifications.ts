/**
 * The one place where the backend says that a list or a
 * resource changed.
 *
 * The backend holds one hub. Areas raise events through their context
 * (`context.mcp`), the control server passes them to every wrapper that asked
 * with `watch`, and each wrapper turns them into MCP notifications for its
 * client. Nothing here knows MCP or sockets, so a Streamable HTTP front end
 * inside the backend can listen to the same hub.
 */
import type { BackendEvent, ListedTool } from '../control/api.js';
import type { ToolGroup } from './types.js';

export type EventListener = (event: BackendEvent) => void;

export class BackendEvents {
  readonly #listeners = new Set<EventListener>();

  emit(event: BackendEvent): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(event);
      } catch {
        // One broken session must not keep the others from hearing it.
      }
    }
  }

  watch(listener: EventListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  get watchers(): number {
    return this.#listeners.size;
  }
}

/** One finished tool call, as the registry reports it after the handler returned. */
export interface ToolCallEvent {
  name: string;
  /** Null for a tool of another Foundry module. */
  group: ToolGroup | null;
  readOnly: boolean;
  isError: boolean;
}

/** What an area gets to take part in notifications (ServerAreaContext.mcp). */
export interface AreaMcpAccess {
  emit(event: BackendEvent): void;
  /** The tool list exactly as a client would get it now. */
  listTools(): Promise<ListedTool[]>;
  /** Hear every finished tool call of every session. */
  onToolCall(listener: (event: ToolCallEvent) => void): () => void;
  /**
   * Hide own tools from the list (they stay callable). Null shows all again.
   * Only one filter exists; a later call replaces it.
   */
  setToolFilter(filter: ((name: string) => boolean) | null): void;
}
