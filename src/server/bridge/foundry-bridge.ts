/**
 * The backend's side of the bridge, independent of how bytes travel.
 *
 * A transport (WebSocket, or the WebRTC detour of the previous generation)
 * accepts a connection, runs the origin check, and hands the bridge a peer
 * that can send text and be closed. Everything else lives here: queries and
 * their answers, time limits, progress, and which connection counts as the
 * module.
 *
 * Several connections: the newest one is the module. A reload of the page
 * opens the new socket before the old one is gone, and the GM is looking at
 * the page that opened last. Older connections are not closed but kept on
 * standby and take over again when the newest goes away. Closing them would
 * make two tabs of a previous generation module, which reconnects after every
 * close, take the bridge from each other every few seconds.
 */
import { fullQueryName, shortQueryName, BRIDGE_PROTOCOL } from '../../common/constants.js';
import {
  BRIDGE_FEATURE,
  describeUnknownError,
  parseBridgeMessage,
  pongFor,
  type BridgeRole,
  type HelloData,
  type ProgressPayload,
} from '../../common/protocol.js';
import { queryTimeoutMs, timeoutMessage } from '../../common/timeouts.js';
import type { Logger } from '../logger.js';

export interface BridgePeer {
  /** Short text for the log, such as the transport and remote address. */
  label: string;
  transport: 'websocket' | 'webrtc';
  origin?: string;
  send(text: string): void;
  close(code: number, reason: string): void;
}

export type BridgeErrorCode =
  'NOT_CONNECTED' | 'TIMEOUT' | 'CONNECTION_LOST' | 'MODULE_ERROR' | 'CANCELLED';

export class BridgeError extends Error {
  constructor(
    readonly code: BridgeErrorCode,
    message: string,
    /** The error code the module attached, when it did. */
    readonly moduleCode?: string
  ) {
    super(message);
    this.name = 'BridgeError';
  }
}

export interface QueryOptions {
  timeoutMs?: number;
  onProgress?: (progress: ProgressPayload) => void;
  signal?: AbortSignal;
}

export interface AttachedPeer {
  receive(raw: string): void;
  detach(): void;
}

interface Connection {
  id: string;
  peer: BridgePeer;
  protocol: number;
  hello?: HelloData;
  connectedAt: number;
}

interface PendingQuery {
  connectionId: string;
  name: string;
  timeoutMs: number;
  timer: NodeJS.Timeout;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: ProgressPayload) => void;
  dispose: () => void;
}

export interface ConnectionStatus {
  id: string;
  role: BridgeRole;
  transport: BridgePeer['transport'];
  protocol: number;
  origin?: string;
  world?: string;
  user?: string;
  connectedAt: string;
}

/** A connection as an area sees it, in a connection event or a request from the module. */
export interface BridgeConnectionInfo {
  id: string;
  role: BridgeRole;
  transport: BridgePeer['transport'];
  /** 1 for a module of the previous generation, which never says hello. */
  protocol: number;
  world?: string;
  user?: string;
}

/**
 * `connected`: a socket was attached and counts as a module at once
 * (a previous generation module never says hello). `introduced`: it said
 * hello, so world and user are known. `disconnected`: it is gone; `role` is
 * the role it had.
 */
export interface BridgeConnectionEvent {
  type: 'connected' | 'introduced' | 'disconnected';
  connection: BridgeConnectionInfo;
  /** Whether any module is connected after this event. */
  moduleConnected: boolean;
}

/** Answers one `server-request` of the module. A thrown `code` reaches the module. */
export type BridgeRequestHandler = (
  method: string,
  data: unknown,
  connection: BridgeConnectionInfo
) => Promise<unknown>;

export interface FoundryBridgeOptions {
  serverVersion: string;
  logger: Logger;
  defaultTimeoutMs: number;
}

export const NOT_CONNECTED_MESSAGE = 'Foundry VTT module not connected';

export class FoundryBridge {
  /** In order of arrival; the last one is the module. */
  private readonly connections: Connection[] = [];
  private readonly pending = new Map<string, PendingQuery>();
  private readonly waiters = new Set<() => void>();
  private readonly countListeners = new Set<(count: number) => void>();
  private readonly eventListeners = new Set<(event: BridgeConnectionEvent) => void>();
  private requestHandler: BridgeRequestHandler | null = null;
  private nextConnection = 1;
  private nextQuery = 1;

  constructor(private readonly options: FoundryBridgeOptions) {}

  attach(peer: BridgePeer): AttachedPeer {
    const previous = this.active();
    const connection: Connection = {
      id: `conn-${this.nextConnection++}`,
      peer,
      protocol: 1,
      connectedAt: Date.now(),
    };
    this.connections.push(connection);
    this.options.logger.info(`Foundry connected (${peer.label})`, { connection: connection.id });

    if (previous) {
      this.options.logger.info(`${previous.id} is now on standby, ${connection.id} is the module`);
      this.sendRole(previous, 'standby');
    }
    this.notifyCount();
    for (const wake of [...this.waiters]) wake();
    this.emit({ type: 'connected', connection: this.info(connection), moduleConnected: true });

    let detached = false;
    return {
      receive: raw => {
        if (!detached) this.receive(connection, raw);
      },
      detach: () => {
        if (detached) return;
        detached = true;
        this.detach(connection);
      },
    };
  }

  isConnected(): boolean {
    return this.connections.length > 0;
  }

  get connectionCount(): number {
    return this.connections.length;
  }

  onConnectionCountChange(listener: (count: number) => void): () => void {
    this.countListeners.add(listener);
    return () => this.countListeners.delete(listener);
  }

  /** Every connect, hello and disconnect. A throwing listener is logged, never passed on. */
  onConnectionEvent(listener: (event: BridgeConnectionEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  /**
   * Who answers `server-request`. Without a handler every request
   * fails with UNKNOWN_REQUEST; the feature is announced in welcome either
   * way, because this server understands the message type.
   */
  setRequestHandler(handler: BridgeRequestHandler | null): void {
    this.requestHandler = handler;
  }

  /** Resolves true as soon as a module is connected, false after `ms`. */
  waitForModule(ms: number): Promise<boolean> {
    if (this.isConnected()) return Promise.resolve(true);
    if (ms <= 0) return Promise.resolve(false);
    return new Promise(resolve => {
      const wake = () => {
        clearTimeout(timer);
        this.waiters.delete(wake);
        resolve(true);
      };
      const timer = setTimeout(() => {
        this.waiters.delete(wake);
        resolve(false);
      }, ms);
      this.waiters.add(wake);
    });
  }

  /**
   * Send a query to the module and wait for its answer.
   *
   * The time limit counts silence: each progress message starts it again.
   */
  query(name: string, data: unknown = {}, options: QueryOptions = {}): Promise<unknown> {
    const connection = this.active();
    if (!connection) return Promise.reject(new BridgeError('NOT_CONNECTED', NOT_CONNECTED_MESSAGE));
    if (options.signal?.aborted)
      return Promise.reject(new BridgeError('CANCELLED', 'Cancelled by the client'));

    const method = fullQueryName(name);
    const id = `query-${this.nextQuery++}`;
    const timeoutMs = options.timeoutMs ?? queryTimeoutMs(method, this.options.defaultTimeoutMs);

    return new Promise((resolve, reject) => {
      const onAbort = () =>
        this.finish(id, new BridgeError('CANCELLED', 'Cancelled by the client'));
      const entry: PendingQuery = {
        connectionId: connection.id,
        name: method,
        timeoutMs,
        timer: setTimeout(() => this.expire(id), timeoutMs),
        resolve,
        reject,
        dispose: () => options.signal?.removeEventListener('abort', onAbort),
      };
      if (options.onProgress) entry.onProgress = options.onProgress;
      options.signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(id, entry);

      try {
        connection.peer.send(JSON.stringify({ type: 'mcp-query', id, data: { method, data } }));
      } catch (error) {
        this.finish(
          id,
          new BridgeError(
            'CONNECTION_LOST',
            `Could not send "${shortQueryName(method)}" to Foundry: ${(error as Error).message}`
          )
        );
      }
    });
  }

  status(): { connected: boolean; connections: ConnectionStatus[] } {
    const active = this.active();
    return {
      connected: Boolean(active),
      connections: this.connections.map(c => {
        const status: ConnectionStatus = {
          id: c.id,
          role: c === active ? 'active' : 'standby',
          transport: c.peer.transport,
          protocol: c.protocol,
          connectedAt: new Date(c.connectedAt).toISOString(),
        };
        if (c.peer.origin) status.origin = c.peer.origin;
        if (c.hello?.worldTitle ?? c.hello?.worldId)
          status.world = (c.hello.worldTitle ?? c.hello.worldId) as string;
        if (c.hello?.userName) status.user = c.hello.userName;
        return status;
      }),
    };
  }

  /** Close every connection, for shutdown. */
  closeAll(reason: string): void {
    for (const connection of [...this.connections]) {
      try {
        connection.peer.close(1001, reason);
      } catch {
        // Already gone.
      }
      this.detach(connection);
    }
  }

  private active(): Connection | undefined {
    return this.connections[this.connections.length - 1];
  }

  private receive(connection: Connection, raw: string): void {
    const message = parseBridgeMessage(raw);
    if (!message) {
      this.options.logger.debug('Ignoring a message the bridge does not understand', {
        connection: connection.id,
        start: raw.slice(0, 80),
      });
      return;
    }

    switch (message.type) {
      case 'mcp-response': {
        const entry = this.pending.get(message.id);
        if (!entry) return; // Late answer after a timeout: the work is done, nobody waits.
        if (message.data.success) {
          this.finish(message.id, null, message.data.data);
        } else {
          this.finish(
            message.id,
            new BridgeError('MODULE_ERROR', message.data.error, message.data.code)
          );
        }
        return;
      }
      case 'mcp-progress': {
        const entry = this.pending.get(message.id);
        if (!entry) return;
        clearTimeout(entry.timer);
        entry.timer = setTimeout(() => this.expire(message.id), entry.timeoutMs);
        entry.onProgress?.(message.data);
        return;
      }
      case 'ping':
        // Only a module of this generation pings; the previous one never does.
        connection.peer.send(JSON.stringify(pongFor(message, Date.now())));
        return;
      case 'hello': {
        connection.protocol = Math.min(message.data.protocol, BRIDGE_PROTOCOL);
        connection.hello = message.data;
        const role: BridgeRole = connection === this.active() ? 'active' : 'standby';
        const welcome: Record<string, unknown> = {
          protocol: BRIDGE_PROTOCOL,
          serverVersion: this.options.serverVersion,
          role,
          features: [BRIDGE_FEATURE.serverRequests],
        };
        const world = this.active()?.hello?.worldTitle;
        if (world) welcome['activeWorld'] = world;
        connection.peer.send(JSON.stringify({ type: 'welcome', data: welcome }));
        this.options.logger.info('Module introduced itself', {
          connection: connection.id,
          ...message.data,
        });
        this.emit({
          type: 'introduced',
          connection: this.info(connection),
          moduleConnected: true,
        });
        return;
      }
      case 'server-request':
        void this.answerRequest(connection, message.id, message.data.method, message.data.data);
        return;
      default:
        return;
    }
  }

  private detach(connection: Connection): void {
    const index = this.connections.indexOf(connection);
    if (index === -1) return;
    const wasActive = index === this.connections.length - 1;
    const gone = this.info(connection);
    this.connections.splice(index, 1);
    this.options.logger.info(`Foundry disconnected (${connection.peer.label})`, {
      connection: connection.id,
    });

    for (const [id, entry] of this.pending) {
      if (entry.connectionId !== connection.id) continue;
      this.finish(
        id,
        new BridgeError(
          'CONNECTION_LOST',
          `The connection to Foundry was lost while "${shortQueryName(entry.name)}" was running. ` +
            'The work may have finished anyway: check the world before retrying.'
        )
      );
    }

    const next = this.active();
    if (wasActive && next) {
      this.options.logger.info(`${next.id} takes over as the module`);
      this.sendRole(next, 'active');
    }
    this.notifyCount();
    this.emit({ type: 'disconnected', connection: gone, moduleConnected: this.isConnected() });
  }

  private info(connection: Connection): BridgeConnectionInfo {
    const info: BridgeConnectionInfo = {
      id: connection.id,
      role: connection === this.active() ? 'active' : 'standby',
      transport: connection.peer.transport,
      protocol: connection.protocol,
    };
    const world = connection.hello?.worldTitle ?? connection.hello?.worldId;
    if (world) info.world = world;
    if (connection.hello?.userName) info.user = connection.hello.userName;
    return info;
  }

  private emit(event: BridgeConnectionEvent): void {
    for (const listener of [...this.eventListeners]) {
      try {
        listener(event);
      } catch (error) {
        this.options.logger.warn(`A listener for "${event.type}" failed`, {
          connection: event.connection.id,
          reason: describeUnknownError(error),
        });
      }
    }
  }

  /** Answer one request of the module. An answer for a connection that is gone is dropped. */
  private async answerRequest(
    connection: Connection,
    id: string,
    rawMethod: string,
    data: unknown
  ): Promise<void> {
    const method = shortQueryName(rawMethod);
    let payload: Record<string, unknown>;
    try {
      const handler = this.requestHandler;
      if (!handler) {
        throw Object.assign(
          new Error(
            `The MCP server does not know the request "${method}": no part of this server answers requests from the module.`
          ),
          { code: 'UNKNOWN_REQUEST' }
        );
      }
      const result = await handler(method, data, this.info(connection));
      payload = { success: true, data: result ?? null };
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      payload = {
        success: false,
        error: describeUnknownError(error),
        code: typeof code === 'string' ? code : 'SERVER_ERROR',
      };
      this.options.logger.debug(`Request "${method}" of the module failed`, {
        connection: connection.id,
        reason: payload['error'],
      });
    }
    if (!this.connections.includes(connection)) return;
    try {
      connection.peer.send(JSON.stringify({ type: 'server-response', id, data: payload }));
    } catch {
      // The transport detaches it.
    }
  }

  private sendRole(connection: Connection, role: BridgeRole): void {
    if (connection.protocol < 2) return;
    const data: Record<string, unknown> = { role };
    const world = this.active()?.hello?.worldTitle;
    if (world) data['activeWorld'] = world;
    try {
      connection.peer.send(JSON.stringify({ type: 'bridge-role', data }));
    } catch {
      // It will be detached by its transport.
    }
  }

  private expire(id: string): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.finish(id, new BridgeError('TIMEOUT', timeoutMessage(entry.name, entry.timeoutMs)));
  }

  private finish(id: string, error: Error | null, value?: unknown): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    clearTimeout(entry.timer);
    entry.dispose();
    if (error) entry.reject(error);
    else entry.resolve(value);
  }

  private notifyCount(): void {
    for (const listener of this.countListeners) listener(this.connections.length);
  }
}
