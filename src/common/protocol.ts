/**
 * Messages on the bridge between the backend on the PC and the module in the
 * GM's browser.
 *
 * Generation 1 (the previous server and module) knows `mcp-query`,
 * `mcp-response`, `ping` and `pong`. Everything else here is generation 2 and
 * is only sent to a peer that announced generation 2 itself: a module sends
 * `hello`, the server answers `welcome`. Neither side waits for the other to
 * say hello, so an old peer simply never sees the new types.
 */

export type BridgeRole = 'active' | 'standby';

export interface QueryMessage {
  type: 'mcp-query';
  id: string;
  data: { method: string; data: unknown };
}

export type ResponsePayload =
  { success: true; data: unknown } | { success: false; error: string; code?: string };

export interface ResponseMessage {
  type: 'mcp-response';
  id: string;
  data: ResponsePayload;
}

export interface ProgressPayload {
  progress: number;
  total?: number;
  message?: string;
}

/** Generation 2: sent by the module while a long query is still running. */
export interface ProgressMessage {
  type: 'mcp-progress';
  id: string;
  data: ProgressPayload;
}

/**
 * A ping as a message. The previous server never sends one and does not
 * answer one, so a module
 * sends it only to a server that said welcome.
 */
export interface PingMessage {
  type: 'ping';
  id?: string;
  timestamp?: number;
}

/**
 * The previous module answers `{ type: "pong", id, data: { timestamp, status } }`.
 * Both generations read the timestamp in either place.
 */
export interface PongMessage {
  type: 'pong';
  id?: string;
  timestamp?: number;
}

/** A pong both generations read: timestamp on top and under data, the ping's id echoed. */
export function pongFor(ping: PingMessage, now: number): Record<string, unknown> {
  const pong: Record<string, unknown> = {
    type: 'pong',
    timestamp: now,
    data: { timestamp: now, status: 'ok' },
  };
  if (ping.id !== undefined) pong['id'] = ping.id;
  return pong;
}

export interface HelloData {
  protocol: number;
  moduleVersion?: string;
  worldId?: string;
  worldTitle?: string;
  userId?: string;
  userName?: string;
}

/** Generation 2: the first message of a new module after the socket opened. */
export interface HelloMessage {
  type: 'hello';
  data: HelloData;
}

/**
 * What a server of generation 2 can do beyond its first set of messages, named
 * in `welcome`. A server that lists nothing is older; a module then never sends
 * the message type behind a feature, because an older server logs it as
 * unknown or leaves it unanswered.
 */
export const BRIDGE_FEATURE = {
  /** The server answers `server-request` with `server-response`. */
  serverRequests: 'server-requests',
} as const;

/** Generation 2: the server's answer to hello. */
export interface WelcomeMessage {
  type: 'welcome';
  data: {
    protocol: number;
    serverVersion: string;
    role: BridgeRole;
    activeWorld?: string;
    /** Absent from an older server, which counts as no features. */
    features?: string[];
  };
}

/**
 * A request from the module to the server. Only sent to a server whose
 * welcome lists `server-requests`. The id sits in `id`, never in `requestId`:
 * the previous server answers any unknown message that has a `requestId` with
 * an error of its own.
 */
export interface ServerRequestMessage {
  type: 'server-request';
  id: string;
  data: { method: string; data: unknown };
}

/** The server's answer to one `server-request`, in the form of a query response. */
export interface ServerResponseMessage {
  type: 'server-response';
  id: string;
  data: ResponsePayload;
}

/** Generation 2: the connection's role changed, for example a second tab took over. */
export interface RoleMessage {
  type: 'bridge-role';
  data: { role: BridgeRole; activeWorld?: string };
}

export type BridgeMessage =
  | QueryMessage
  | ResponseMessage
  | ProgressMessage
  | PingMessage
  | PongMessage
  | HelloMessage
  | WelcomeMessage
  | RoleMessage
  | ServerRequestMessage
  | ServerResponseMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function timestampOf(message: Record<string, unknown>): number | undefined {
  if (typeof message['timestamp'] === 'number') return message['timestamp'];
  const data = message['data'];
  if (isRecord(data) && typeof data['timestamp'] === 'number') return data['timestamp'];
  return undefined;
}

/**
 * Parse one text frame. Returns null for anything that is not a well formed
 * message of a known type, so a malformed frame can never reach a handler.
 */
export function parseBridgeMessage(raw: string): BridgeMessage | null {
  let message: unknown;
  try {
    message = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(message) || typeof message['type'] !== 'string') return null;

  const data = message['data'];
  const id = message['id'];

  switch (message['type']) {
    case 'mcp-query':
      if (typeof id !== 'string' || !isRecord(data) || typeof data['method'] !== 'string')
        return null;
      return { type: 'mcp-query', id, data: { method: data['method'], data: data['data'] } };

    case 'mcp-response':
    case 'server-response': {
      if (typeof id !== 'string' || !isRecord(data)) return null;
      const type = message['type'] === 'server-response' ? 'server-response' : 'mcp-response';
      if (data['success'] === true) {
        return { type, id, data: { success: true, data: data['data'] } };
      }
      const error =
        typeof data['error'] === 'string' ? data['error'] : describeUnknownError(data['error']);
      const payload: ResponsePayload = { success: false, error };
      if (typeof data['code'] === 'string') payload.code = data['code'];
      return { type, id, data: payload };
    }

    case 'server-request':
      if (typeof id !== 'string' || !isRecord(data) || typeof data['method'] !== 'string')
        return null;
      return { type: 'server-request', id, data: { method: data['method'], data: data['data'] } };

    case 'mcp-progress': {
      if (typeof id !== 'string' || !isRecord(data) || typeof data['progress'] !== 'number')
        return null;
      const progress: ProgressPayload = { progress: data['progress'] };
      if (typeof data['total'] === 'number') progress.total = data['total'];
      if (typeof data['message'] === 'string') progress.message = data['message'];
      return { type: 'mcp-progress', id, data: progress };
    }

    case 'ping':
    case 'pong': {
      const beat: PingMessage | PongMessage = { type: message['type'] };
      if (typeof id === 'string') beat.id = id;
      const timestamp = timestampOf(message);
      if (timestamp !== undefined) beat.timestamp = timestamp;
      return beat;
    }

    case 'hello': {
      if (!isRecord(data) || typeof data['protocol'] !== 'number') return null;
      const hello: HelloData = { protocol: data['protocol'] };
      for (const key of ['moduleVersion', 'worldId', 'worldTitle', 'userId', 'userName'] as const) {
        const value = data[key];
        if (typeof value === 'string') hello[key] = value;
      }
      return { type: 'hello', data: hello };
    }

    case 'welcome': {
      if (!isRecord(data) || typeof data['protocol'] !== 'number') return null;
      const role = data['role'] === 'standby' ? 'standby' : 'active';
      const welcome: WelcomeMessage['data'] = {
        protocol: data['protocol'],
        serverVersion:
          typeof data['serverVersion'] === 'string' ? data['serverVersion'] : 'unknown',
        role,
      };
      if (typeof data['activeWorld'] === 'string') welcome.activeWorld = data['activeWorld'];
      if (Array.isArray(data['features']))
        welcome.features = data['features'].filter((f): f is string => typeof f === 'string');
      return { type: 'welcome', data: welcome };
    }

    case 'bridge-role': {
      if (!isRecord(data)) return null;
      const roleData: RoleMessage['data'] = {
        role: data['role'] === 'standby' ? 'standby' : 'active',
      };
      if (typeof data['activeWorld'] === 'string') roleData.activeWorld = data['activeWorld'];
      return { type: 'bridge-role', data: roleData };
    }

    default:
      return null;
  }
}

/** A readable text for whatever a peer put into an error field. */
export function describeUnknownError(error: unknown): string {
  if (typeof error === 'string' && error) return error;
  if (error instanceof Error && error.message) return error.message;
  if (isRecord(error) && typeof error['message'] === 'string') return error['message'];
  if (error === undefined || error === null) return 'Unknown error (the module sent no reason)';
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
