/**
 * The module's end of the bridge: connects the GM's browser to the backend on
 * the PC, answers queries, and brings a lost connection back.
 *
 * Decisions taken here:
 *
 * - **WebSocket only, also on HTTPS pages.** This is the first of the two steps
 *   that retire the WebRTC detour: `auto` now means WebSocket. Chrome allows
 *   ws://localhost from an HTTPS page. The stored values `webrtc` and
 *   `websocket` stay valid and both connect over WebSocket.
 * - **One mechanism brings the bridge back**: the reconnect schedule. The
 *   heartbeat only detects a connection that is silently dead and closes it;
 *   it never restarts anything and never changes a setting.
 * - **Nothing new is sent to an old server**: progress and pings only after
 *   the server answered hello with welcome. The previous server hands every
 *   type it does not know to a handler that writes two log lines each time,
 *   and answers with an error when the message has a `requestId`.
 * So `hello` is the only
 *   new message it ever sees, once per connection, without `requestId`.
 * - **Queries are answered from the first moment**, not only after welcome,
 *   because the previous server never says welcome.
 */
import { BRIDGE_PATH, BRIDGE_PROTOCOL, shortQueryName } from '../common/constants.js';
import {
  BRIDGE_FEATURE,
  describeUnknownError,
  parseBridgeMessage,
  pongFor,
  type BridgeRole,
  type HelloData,
  type ProgressPayload,
} from '../common/protocol.js';
import { judgeClose, reconnectDelay } from '../common/reconnect.js';
import {
  ServerRequestError,
  serverFailure,
  serverRequestTimeout,
  serverTooOld,
  type ServerRequestOptions,
} from './server-requests.js';

export interface SocketLike {
  readonly readyState: number;
  send(text: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type ConnectionState =
  'disabled' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'rejected';

export interface BridgeSettings {
  enabled(): boolean;
  host(): string;
  port(): number;
  autoReconnect(): boolean;
  heartbeatSeconds(): number;
}

export interface BridgeEvents {
  connected(url: string): void;
  disconnected(): void;
  /** No server answered. Called once per outage, not on every attempt. */
  unreachable(url: string): void;
  /** Still without a bridge a minute after losing it. Called once per outage. */
  stillDown(): void;
  rejected(reason: string): void;
  changed(): void;
}

export interface Timers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface BridgeClientOptions {
  createSocket(url: string): SocketLike;
  settings: BridgeSettings;
  dispatch(method: string, data: unknown, progress: (p: ProgressPayload) => void): Promise<unknown>;
  hello(): HelloData;
  events: BridgeEvents;
  pageProtocol(): string;
  pageOrigin(): string;
  timers?: Timers;
  now?: () => number;
}

export interface BridgeStatus {
  enabled: boolean;
  connected: boolean;
  connectionState: ConnectionState;
  connectionInfo: {
    type: 'websocket';
    config: { host: string; port: number };
    url: string;
    reconnectAttempts: number;
    pageOrigin: string;
    rejection?: 'origin';
    rejectionReason?: string;
    role?: BridgeRole;
    activeWorld?: string;
    serverVersion?: string;
    serverProtocol: number;
  };
}

const OPEN = 1;
const STILL_DOWN_AFTER_MS = 60_000;
/** How long a request right after connecting waits for welcome before it counts the server as old. */
const WELCOME_WAIT_MS = 3000;

interface PendingRequest {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: unknown;
}

const defaultTimers: Timers = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: handle => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (callback, ms) => globalThis.setInterval(callback, ms),
  clearInterval: handle => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
};

export function isLoopbackHost(host: string): boolean {
  const bare = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  return bare === 'localhost' || bare === '::1' || /^127\.\d+\.\d+\.\d+$/.test(bare);
}

/**
 * ws:// for loopback, always: the server speaks no TLS, and browsers allow
 * ws://localhost from HTTPS pages. wss:// only for a remote host on an HTTPS
 * page, where a plain connection would be blocked as mixed content.
 */
export function bridgeUrl(host: string, port: number, pageProtocol: string): string {
  const bare = host.trim() || 'localhost';
  const scheme = pageProtocol === 'https:' && !isLoopbackHost(bare) ? 'wss' : 'ws';
  const hostPart = bare.includes(':') && !bare.startsWith('[') ? `[${bare}]` : bare;
  return `${scheme}://${hostPart}:${port}${BRIDGE_PATH}`;
}

export class BridgeClient {
  private socket: SocketLike | null = null;
  private state: ConnectionState = 'disconnected';
  private attempts = 0;
  private reconnectTimer: unknown = null;
  private heartbeatTimer: unknown = null;
  private requestedClose = false;
  private everOpened = false;
  private disconnectedSince: number | null = null;
  private warnedUnreachable = false;
  private warnedStillDown = false;
  private lastPongAt: number | null = null;
  private serverAnswersPings = false;
  private serverProtocol = 1;
  private serverVersion: string | undefined;
  private role: BridgeRole | undefined;
  private activeWorld: string | undefined;
  private rejectionReason: string | undefined;
  private welcomed = false;
  private serverFeatures: ReadonlySet<string> = new Set();
  private openedAt = 0;
  private nextRequest = 1;
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly welcomeWaiters = new Set<() => void>();
  private readonly timers: Timers;
  private readonly now: () => number;

  constructor(private readonly options: BridgeClientOptions) {
    this.timers = options.timers ?? defaultTimers;
    this.now = options.now ?? Date.now;
  }

  /** Connect now. Also the way out of a refusal, after the server was reconfigured. */
  start(): void {
    this.clearReconnect();
    if (!this.options.settings.enabled()) {
      this.shutdownSocket();
      this.setState('disabled');
      return;
    }
    this.rejectionReason = undefined;
    this.attempts = 0;
    this.requestedClose = false;
    this.open();
  }

  /** Close on purpose. No reconnect follows. */
  stop(): void {
    this.clearReconnect();
    this.shutdownSocket();
    this.setState(this.options.settings.enabled() ? 'disconnected' : 'disabled');
  }

  getStatus(): BridgeStatus {
    const { settings } = this.options;
    const info: BridgeStatus['connectionInfo'] = {
      type: 'websocket',
      config: { host: settings.host(), port: settings.port() },
      url: this.url(),
      reconnectAttempts: this.attempts,
      pageOrigin: this.options.pageOrigin(),
      serverProtocol: this.serverProtocol,
    };
    if (this.state === 'rejected') {
      info.rejection = 'origin';
      if (this.rejectionReason) info.rejectionReason = this.rejectionReason;
    }
    if (this.role) info.role = this.role;
    if (this.activeWorld) info.activeWorld = this.activeWorld;
    if (this.serverVersion) info.serverVersion = this.serverVersion;
    return {
      enabled: settings.enabled(),
      connected: this.state === 'connected',
      connectionState: this.state,
      connectionInfo: info,
    };
  }

  /** Connected to a server that announced requests from the module in welcome. */
  supportsServerRequests(): boolean {
    return this.isOpen() && this.welcomed && this.serverFeatures.has(BRIDGE_FEATURE.serverRequests);
  }

  /**
   * Send a request to the server and wait for its answer.
   *
   * Nothing is sent to a server that did not list the feature in welcome: the
   * previous server logs every unknown message, and an earlier server of this generation would
   * leave it unanswered. Right after connecting, the request waits up to three
   * seconds for welcome; a server that never says welcome is the previous one.
   */
  async request(
    rawMethod: string,
    data: unknown = {},
    options: ServerRequestOptions = {}
  ): Promise<unknown> {
    const method = shortQueryName(rawMethod);
    if (!method) throw new ServerRequestError('INVALID_REQUEST', 'A server request needs a name.');
    if (this.isOpen() && !this.welcomed) await this.waitForWelcome();
    if (!this.isOpen()) {
      throw new ServerRequestError(
        'NOT_CONNECTED',
        `The MCP bridge is not connected, so the request "${method}" cannot reach the server.`
      );
    }
    if (!this.supportsServerRequests()) throw serverTooOld(method);

    const timeoutMs = serverRequestTimeout(options);
    const id = `request-${this.nextRequest++}`;
    return new Promise((resolve, reject) => {
      const timer = this.timers.setTimeout(() => {
        if (!this.pendingRequests.delete(id)) return;
        reject(
          new ServerRequestError(
            'TIMEOUT',
            `The MCP server did not answer the request "${method}" within ${timeoutMs} ms. It may still have done it.`
          )
        );
      }, timeoutMs);
      this.pendingRequests.set(id, { method, resolve, reject, timer });
      this.send({ type: 'server-request', id, data: { method, data } });
    });
  }

  private isOpen(): boolean {
    return this.state === 'connected' && this.socket?.readyState === OPEN;
  }

  private waitForWelcome(): Promise<void> {
    const left = WELCOME_WAIT_MS - (this.now() - this.openedAt);
    if (left <= 0) return Promise.resolve();
    return new Promise(resolve => {
      const done = () => {
        this.timers.clearTimeout(timer);
        this.welcomeWaiters.delete(done);
        resolve();
      };
      const timer = this.timers.setTimeout(done, left);
      this.welcomeWaiters.add(done);
    });
  }

  private wakeWelcomeWaiters(): void {
    for (const wake of [...this.welcomeWaiters]) wake();
  }

  private failRequests(): void {
    this.wakeWelcomeWaiters();
    for (const pending of this.pendingRequests.values()) {
      this.timers.clearTimeout(pending.timer);
      pending.reject(
        new ServerRequestError(
          'CONNECTION_LOST',
          `The bridge to the MCP server closed before it answered the request "${pending.method}". ` +
            'The server may have done it anyway.'
        )
      );
    }
    this.pendingRequests.clear();
  }

  private url(): string {
    const { settings } = this.options;
    return bridgeUrl(settings.host(), settings.port(), this.options.pageProtocol());
  }

  private open(): void {
    this.shutdownSocket();
    this.requestedClose = false;
    this.everOpened = false;
    this.setState(this.attempts === 0 ? 'connecting' : 'reconnecting');

    const url = this.url();
    let socket: SocketLike;
    try {
      socket = this.options.createSocket(url);
    } catch {
      this.handleClose(1006, '');
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.everOpened = true;
      this.attempts = 0;
      this.disconnectedSince = null;
      this.warnedUnreachable = false;
      this.warnedStillDown = false;
      this.serverProtocol = 1;
      this.serverAnswersPings = false;
      this.lastPongAt = null;
      this.role = undefined;
      this.welcomed = false;
      this.serverFeatures = new Set();
      this.openedAt = this.now();
      this.setState('connected');
      this.send({ type: 'hello', data: this.options.hello() });
      this.startHeartbeat();
      this.options.events.connected(url);
    };
    socket.onmessage = event => {
      if (this.socket === socket && typeof event.data === 'string')
        void this.handleMessage(event.data);
    };
    socket.onerror = () => undefined; // The close event that follows carries what matters.
    socket.onclose = event => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.handleClose(event.code, event.reason);
    };
  }

  private async handleMessage(raw: string): Promise<void> {
    const message = parseBridgeMessage(raw);
    if (!message) return;

    switch (message.type) {
      case 'mcp-query': {
        const { id } = message;
        const progress = (payload: ProgressPayload) => {
          if (this.serverProtocol >= 2) this.send({ type: 'mcp-progress', id, data: payload });
        };
        try {
          const data = await this.options.dispatch(
            message.data.method,
            message.data.data,
            progress
          );
          // `data` is always present: JSON drops undefined, and the previous server
          // cannot handle a response without it.
          this.send({ type: 'mcp-response', id, data: { success: true, data: data ?? null } });
        } catch (error) {
          const payload: Record<string, unknown> = {
            success: false,
            error: describeUnknownError(error),
          };
          const code = (error as { code?: unknown } | null)?.code;
          if (typeof code === 'string') payload['code'] = code;
          this.send({ type: 'mcp-response', id, data: payload });
        }
        return;
      }
      case 'ping':
        this.send(pongFor(message, this.now()));
        return;
      case 'pong':
        this.serverAnswersPings = true;
        this.lastPongAt = this.now();
        return;
      case 'welcome':
        this.serverProtocol = Math.min(message.data.protocol, BRIDGE_PROTOCOL);
        this.serverVersion = message.data.serverVersion;
        this.role = message.data.role;
        this.activeWorld = message.data.activeWorld;
        this.welcomed = true;
        this.serverFeatures = new Set(message.data.features ?? []);
        this.wakeWelcomeWaiters();
        this.options.events.changed();
        return;
      case 'server-response': {
        const pending = this.pendingRequests.get(message.id);
        if (!pending) return; // Late answer after a timeout.
        this.pendingRequests.delete(message.id);
        this.timers.clearTimeout(pending.timer);
        if (message.data.success) pending.resolve(message.data.data);
        else pending.reject(serverFailure(message.data.error, message.data.code));
        return;
      }
      case 'bridge-role':
        this.role = message.data.role;
        this.activeWorld = message.data.activeWorld;
        this.options.events.changed();
        return;
      default:
        return;
    }
  }

  private handleClose(code: number, reason: string): void {
    this.stopHeartbeat();
    this.failRequests();
    const wasConnected = this.state === 'connected';
    const verdict = judgeClose(code, this.requestedClose);

    if (verdict === 'stop-rejected') {
      this.rejectionReason = reason || undefined;
      this.setState('rejected');
      this.options.events.rejected(reason);
      return;
    }
    if (verdict === 'stop-requested') {
      this.setState(this.options.settings.enabled() ? 'disconnected' : 'disabled');
      return;
    }

    if (wasConnected) this.options.events.disconnected();
    this.disconnectedSince ??= this.now();
    if (!this.everOpened && !this.warnedUnreachable) {
      this.warnedUnreachable = true;
      this.options.events.unreachable(this.url());
    }
    if (!this.warnedStillDown && this.now() - this.disconnectedSince >= STILL_DOWN_AFTER_MS) {
      this.warnedStillDown = true;
      this.options.events.stillDown();
    }

    if (!this.options.settings.enabled() || !this.options.settings.autoReconnect()) {
      this.setState(this.options.settings.enabled() ? 'disconnected' : 'disabled');
      return;
    }
    this.attempts += 1;
    this.setState('reconnecting');
    this.reconnectTimer = this.timers.setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, reconnectDelay(this.attempts));
  }

  /**
   * Finds a connection that is open on paper but dead in fact, such as after
   * the PC went to sleep. Only closes it; the reconnect schedule does the rest.
   * A server that never answered a ping is not judged, so an old server that
   * ignores pings keeps its connection. Pings go only to a server that said
   * welcome; the previous server would log each one as an unknown message.
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    const intervalMs = Math.max(5, this.options.settings.heartbeatSeconds() || 30) * 1000;
    this.heartbeatTimer = this.timers.setInterval(() => {
      const socket = this.socket;
      if (!socket || socket.readyState !== OPEN) return;
      if (
        this.serverAnswersPings &&
        this.lastPongAt !== null &&
        this.now() - this.lastPongAt > 2 * intervalMs
      ) {
        socket.close(4000, 'no answer to pings');
        return;
      }
      if (this.serverProtocol >= 2) this.send({ type: 'ping', timestamp: this.now() });
    }, intervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) this.timers.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) this.timers.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private shutdownSocket(): void {
    this.stopHeartbeat();
    const socket = this.socket;
    if (!socket) return;
    this.requestedClose = true;
    this.socket = null;
    this.failRequests();
    try {
      socket.close(1000, 'closed by the module');
    } catch {
      // Already closed.
    }
  }

  private send(message: unknown): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== OPEN) return;
    try {
      socket.send(JSON.stringify(message));
    } catch {
      // The close event follows.
    }
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.options.events.changed();
  }
}
