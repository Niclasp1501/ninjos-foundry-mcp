/**
 * The bridge over WebSocket: port 31415, path /foundry-mcp.
 *
 * Listens on loopback only (127.0.0.1 and ::1) unless remote mode is switched
 * on explicitly. Every connection passes the origin check before the bridge
 * sees it; a refused page is closed after the handshake with 4403, so the
 * module can show the reason instead of retrying forever.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { CLOSE_ORIGIN_REJECTED } from '../../common/constants.js';
import type { Logger } from '../logger.js';
import type { OriginGuard } from './connection-guards.js';
import type { FoundryBridge } from './foundry-bridge.js';

export interface WebSocketTransportOptions {
  port: number;
  path: string;
  remoteMode: boolean;
  guard: OriginGuard;
  bridge: FoundryBridge;
  logger: Logger;
  /** Overrides the interfaces, for tests. */
  hosts?: string[];
  /** How long a taken port is retried. A previous backend may still hold it briefly. */
  portRetryMs?: number;
  /** Interval of protocol level pings that find dead connections. */
  heartbeatMs?: number;
}

export interface RunningTransport {
  /** The bound addresses, such as 127.0.0.1:31415. */
  addresses: string[];
  port: number;
  close(): Promise<void>;
}

/** Close reasons are limited to 123 bytes by the protocol. */
function shortReason(text: string): string {
  const bytes = Buffer.from(text, 'utf8');
  return bytes.length <= 123 ? text : `${bytes.subarray(0, 120).toString('utf8')}...`;
}

/** Listen, retrying a taken port every 500 ms for `retryMs`. Shared with the WebRTC signaling. */
export function listenWithRetry(
  server: Server,
  port: number,
  host: string,
  retryMs: number
): Promise<number> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const onError = (error: NodeJS.ErrnoException) => {
        server.off('listening', onListening);
        if (error.code === 'EADDRINUSE' && Date.now() - started < retryMs) {
          setTimeout(attempt, 500);
          return;
        }
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        const address = server.address();
        resolve(typeof address === 'object' && address ? address.port : port);
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    };
    attempt();
  });
}

export async function startWebSocketTransport(
  options: WebSocketTransportOptions
): Promise<RunningTransport> {
  const { logger, guard, bridge } = options;
  const hosts = options.hosts ?? (options.remoteMode ? ['::'] : ['127.0.0.1', '::1']);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });
  const alive = new WeakMap<WebSocket, boolean>();
  const servers: Server[] = [];
  const addresses: string[] = [];
  let port = options.port;

  const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const pathname =
      new URL(request.url ?? '/', 'http://localhost').pathname.replace(/\/+$/, '') || '/';
    if (pathname !== options.path) {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }

    wss.handleUpgrade(request, socket, head, ws => {
      const origin = request.headers.origin;
      const decision = guard.check(origin);
      const label = `websocket ${request.socket.remoteAddress ?? '?'}${origin ? ` from ${origin}` : ''}`;

      if (!decision.allowed) {
        logger.warn(`Refused a bridge connection: ${decision.reason}`, {
          remote: request.socket.remoteAddress,
        });
        ws.close(CLOSE_ORIGIN_REJECTED, shortReason(decision.reason));
        return;
      }

      const peer = bridge.attach({
        label,
        transport: 'websocket',
        ...(origin ? { origin } : {}),
        send: text => {
          if (ws.readyState === ws.OPEN) ws.send(text);
          else throw new Error('the WebSocket is not open');
        },
        close: (code, reason) => ws.close(code, shortReason(reason)),
      });

      alive.set(ws, true);
      ws.on('pong', () => alive.set(ws, true));
      ws.on('message', (data, isBinary) => {
        if (!isBinary) peer.receive(data.toString());
      });
      ws.on('close', () => peer.detach());
      ws.on('error', error => {
        logger.warn('Bridge connection error', error);
        peer.detach();
      });
    });
  };

  for (const host of hosts) {
    const server = createServer((_request, response) => {
      response.writeHead(426, { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' });
      response.end('This port only speaks WebSocket.\n');
    });
    server.on('upgrade', onUpgrade);
    try {
      port = await listenWithRetry(server, port, host, options.portRetryMs ?? 5000);
      servers.push(server);
      addresses.push(host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // A machine without IPv6 has no ::1. That is not a reason to have no bridge.
      if (host === '::1' && (code === 'EADDRNOTAVAIL' || code === 'EAFNOSUPPORT')) {
        logger.info('No IPv6 loopback on this machine, the bridge listens on IPv4 only');
        continue;
      }
      for (const started of servers) started.close();
      throw error;
    }
  }

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) {
        logger.info('A bridge connection stopped answering pings and is closed');
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      try {
        ws.ping();
      } catch {
        ws.terminate();
      }
    }
  }, options.heartbeatMs ?? 30_000);
  heartbeat.unref();

  return {
    addresses,
    port,
    close: async () => {
      clearInterval(heartbeat);
      for (const ws of wss.clients) ws.terminate();
      await Promise.all(
        servers.map(server => new Promise<void>(resolve => server.close(() => resolve())))
      );
      wss.close();
    },
  };
}
