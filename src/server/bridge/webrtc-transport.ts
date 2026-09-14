/**
 * The WebRTC detour of the previous generation, as a replaceable part.
 *
 * An installed module of the previous generation picks this detour on its own
 * on HTTPS pages when its connection type is "auto". Chrome allows
 * ws://localhost from an HTTPS page, so the detour is no longer needed, but it
 * can only go in two steps: first a module that prefers WebSocket (the module
 * in this rewrite does), then, once that module has spread, a server without
 * this file. Until then the server keeps answering the signaling.
 *
 * Everything specific to the detour is in here: the signaling server on 31416,
 * the WebRTC library, putting chunks back together. The bridge sees a peer like
 * any other. Removing the detour means deleting this file, chunks.ts and one
 * call in backend.ts.
 *
 * Every peer here is a module of the previous generation, so everything
 * follows how that generation talks: the
 * answers of POST /webrtc-offer, CORS on every answer including the refusal,
 * and messages to the module in one piece, never chunked.
 *
 * It must never take the bridge down: a taken port or a library that fails to
 * load is logged and the backend runs on without it (outage of 06.09.2026).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { DATA_CHANNEL_LABEL } from '../../common/constants.js';
import { ChunkAssembler } from '../../common/chunks.js';
import type { Logger } from '../logger.js';
import type { OriginGuard } from './connection-guards.js';
import type { FoundryBridge } from './foundry-bridge.js';
import { listenWithRetry, type RunningTransport } from './websocket-transport.js';

export interface WebRtcTransportOptions {
  port: number;
  remoteMode: boolean;
  guard: OriginGuard;
  bridge: FoundryBridge;
  logger: Logger;
  hosts?: string[];
  /** Upper bound for gathering local candidates before the answer is sent. */
  gatheringTimeoutMs?: number;
  /** How long a taken port is retried, like the bridge port. */
  portRetryMs?: number;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
} as const;

const MAX_BODY_BYTES = 1024 * 1024;

type Werift = typeof import('werift');

let weriftModule: Promise<Werift> | null = null;

function loadWerift(): Promise<Werift> {
  weriftModule ??= import('werift');
  return weriftModule;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts: Buffer[] = [];
    request.on('data', (part: Buffer) => {
      size += part.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('the offer is too large'));
        request.destroy();
        return;
      }
      parts.push(part);
    });
    request.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    request.on('error', reject);
  });
}

function json(response: ServerResponse, status: number, body: unknown, origin?: string): void {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    ...CORS_HEADERS,
  };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  response.writeHead(status, headers);
  response.end(JSON.stringify(body));
}

export async function startWebRtcTransport(
  options: WebRtcTransportOptions
): Promise<RunningTransport> {
  const { logger, guard, bridge } = options;
  const peers = new Set<{ close(): Promise<void> }>();

  const answerOffer = async (offer: { type: 'offer'; sdp: string }, origin: string | undefined) => {
    const { RTCPeerConnection } = await loadWerift();
    const connection = new RTCPeerConnection({ iceServers: [] });
    peers.add(connection);

    connection.onDataChannel.subscribe(channel => {
      if (channel.label !== DATA_CHANNEL_LABEL) {
        logger.warn(`Ignoring a data channel named "${channel.label}"`);
        return;
      }
      const assembler = new ChunkAssembler();
      const attach = () => {
        const peer = bridge.attach({
          label: `webrtc${origin ? ` from ${origin}` : ''}`,
          transport: 'webrtc',
          ...(origin ? { origin } : {}),
          // In one piece, as the previous server did: that module drops chunk frames,
          // and a chunked query would stay unanswered.
          send: text => channel.send(text),
          close: () => {
            channel.close();
            void connection.close();
          },
        });
        channel.onMessage.subscribe(data => {
          const complete = assembler.accept(
            typeof data === 'string' ? data : data.toString('utf8')
          );
          if (complete !== null) peer.receive(complete);
        });
        channel.stateChanged.subscribe(state => {
          if (state === 'closed') peer.detach();
        });
        connection.connectionStateChange.subscribe(state => {
          if (state === 'closed' || state === 'failed' || state === 'disconnected') {
            peer.detach();
            peers.delete(connection);
            void connection.close();
          }
        });
      };
      if (channel.readyState === 'open') attach();
      else {
        const subscription = channel.stateChanged.subscribe(state => {
          if (state === 'open') {
            subscription.unSubscribe();
            attach();
          }
        });
      }
    });

    await connection.setRemoteDescription(offer);
    await connection.setLocalDescription(await connection.createAnswer());

    if (connection.iceGatheringState !== 'complete') {
      await Promise.race([
        connection.iceGatheringStateChange.watch(state => state === 'complete'),
        new Promise(resolve => setTimeout(resolve, options.gatheringTimeoutMs ?? 5000)),
      ]);
    }
    const local = connection.localDescription;
    if (!local) throw new Error('no local description after answering');
    return { type: local.type, sdp: local.sdp };
  };

  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    const origin = typeof request.headers.origin === 'string' ? request.headers.origin : undefined;

    if (request.method === 'OPTIONS') {
      // A preflight grants nothing by itself, so it is answered for any origin
      // and never teaches the guard an origin.
      const headers: Record<string, string> = {
        'Access-Control-Allow-Origin': origin ?? '*',
        ...CORS_HEADERS,
        'Access-Control-Max-Age': '600',
        Vary: 'Origin',
      };
      // Chrome asks before an HTTPS page may reach localhost (Private Network Access).
      if (request.headers['access-control-request-private-network'] !== undefined) {
        headers['Access-Control-Allow-Private-Network'] = 'true';
      }
      response.writeHead(204, headers);
      response.end();
      return;
    }

    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (request.method !== 'POST' || pathname !== '/webrtc-offer') {
      json(response, 404, { error: 'Not found' }, origin);
      return;
    }

    const decision = guard.check(origin);
    if (!decision.allowed) {
      logger.warn(`Refused a WebRTC offer: ${decision.reason}`);
      json(response, 403, { error: decision.reason }, origin);
      return;
    }

    try {
      const body = JSON.parse(await readBody(request)) as {
        offer?: { type?: unknown; sdp?: unknown };
      };
      const offer = body.offer;
      if (!offer || offer.type !== 'offer' || typeof offer.sdp !== 'string') {
        json(
          response,
          400,
          { error: 'Missing offer in request body (expected { offer: { type: "offer", sdp } })' },
          origin
        );
        return;
      }
      const answer = await answerOffer({ type: 'offer', sdp: offer.sdp }, origin);
      json(response, 200, { answer }, origin);
    } catch (error) {
      logger.error('Answering a WebRTC offer failed', error);
      json(response, 500, { error: `WebRTC offer failed: ${(error as Error).message}` }, origin);
    }
  };

  const hosts = options.hosts ?? (options.remoteMode ? ['::'] : ['127.0.0.1', '::1']);
  const servers: Server[] = [];
  const addresses: string[] = [];
  let port = options.port;

  for (const host of hosts) {
    const server = createServer((request, response) => void handle(request, response));
    try {
      port = await listenWithRetry(server, port, host, options.portRetryMs ?? 5000);
      servers.push(server);
      addresses.push(host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (host === '::1' && (code === 'EADDRNOTAVAIL' || code === 'EAFNOSUPPORT')) continue;
      for (const started of servers) started.close();
      throw error;
    }
  }

  return {
    addresses,
    port,
    close: async () => {
      await Promise.all([...peers].map(peer => peer.close().catch(() => undefined)));
      peers.clear();
      await Promise.all(
        servers.map(server => new Promise<void>(resolve => server.close(() => resolve())))
      );
    },
  };
}
