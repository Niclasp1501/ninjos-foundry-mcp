import { request } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RTCPeerConnection } from 'werift';
import { splitLikePreviousModule } from '../../testing/previous-module.js';
import { silentLogger } from '../logger.js';
import { OriginGuard } from './connection-guards.js';
import { FoundryBridge } from './foundry-bridge.js';
import { startWebRtcTransport } from './webrtc-transport.js';
import type { RunningTransport } from './websocket-transport.js';

let dir: string;
let transport: RunningTransport | null = null;
let bridge: FoundryBridge;
const clients: RTCPeerConnection[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'webrtc-transport-'));
  bridge = new FoundryBridge({
    serverVersion: 'test',
    logger: silentLogger,
    defaultTimeoutMs: 5000,
  });
});

afterEach(async () => {
  bridge.closeAll('test end');
  for (const client of clients.splice(0)) await client.close().catch(() => undefined);
  await transport?.close();
  transport = null;
  rmSync(dir, { recursive: true, force: true });
});

async function start(): Promise<number> {
  transport = await startWebRtcTransport({
    port: 0,
    remoteMode: false,
    hosts: ['127.0.0.1'],
    guard: new OriginGuard({
      configured: ['https://dnd.example.org'],
      storeFile: join(dir, 'origins.json'),
    }),
    bridge,
    logger: silentLogger,
  });
  return transport.port;
}

function post(
  port: number,
  path: string,
  body: string,
  origin: string,
  method = 'POST',
  extraHeaders: Record<string, string> = {}
): Promise<{ status: number; body: string; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: { Origin: origin, 'Content-Type': 'application/json', ...extraHeaders },
      },
      res => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', chunk => (data += chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: data, headers: res.headers })
        );
      }
    );
    req.on('error', reject);
    req.end(body);
  });
}

describe('WebRTC detour', () => {
  it('refuses an offer from a page that is not allowed with 403', async () => {
    const port = await start();
    const response = await post(
      port,
      '/webrtc-offer',
      '{"offer":{"type":"offer","sdp":"x"}}',
      'https://evil.example'
    );
    expect(response.status).toBe(403);
    // Readable for the page, so the previous module shows the refusal instead of retrying.
    expect(response.headers['access-control-allow-origin']).toBe('https://evil.example');
    expect(response.headers['access-control-allow-methods']).toBe('POST, OPTIONS');
  });

  it('answers the preflight for any origin without granting anything', async () => {
    const port = await start();
    const response = await post(port, '/webrtc-offer', '', 'https://evil.example', 'OPTIONS');
    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('https://evil.example');
    expect(response.headers['access-control-allow-private-network']).toBeUndefined();
  });

  it('allows the private network request Chrome sends from HTTPS pages', async () => {
    const port = await start();
    const response = await post(port, '/webrtc-offer', '', 'https://dnd.example.org', 'OPTIONS', {
      'Access-Control-Request-Private-Network': 'true',
    });
    expect(response.headers['access-control-allow-private-network']).toBe('true');
  });

  it('answers 400 without an offer and 404 elsewhere', async () => {
    const port = await start();
    expect((await post(port, '/webrtc-offer', '{}', 'https://dnd.example.org')).status).toBe(400);
    expect((await post(port, '/other', '{}', 'https://dnd.example.org')).status).toBe(404);
  });

  it('sends queries in one piece and puts the chunked answer of a previous module together', async () => {
    const port = await start();
    const client = new RTCPeerConnection({ iceServers: [] });
    clients.push(client);
    const channel = client.createDataChannel('foundry-mcp', { ordered: true });
    const big = 'x'.repeat(120_000);

    channel.onMessage.subscribe(data => {
      // Like the previous module: no reassembly, a chunk frame would be ignored.
      const message = JSON.parse(typeof data === 'string' ? data : data.toString('utf8'));
      if (message.type === 'mcp-query') {
        const reply = JSON.stringify({
          type: 'mcp-response',
          id: message.id,
          data: { success: true, data: big },
        });
        for (const frame of splitLikePreviousModule(reply)) channel.send(frame);
      }
    });

    await client.setLocalDescription(await client.createOffer());
    if (client.iceGatheringState !== 'complete') {
      await client.iceGatheringStateChange.watch(state => state === 'complete');
    }
    const offer = client.localDescription;
    const response = await post(
      port,
      '/webrtc-offer',
      JSON.stringify({ offer: { type: offer?.type, sdp: offer?.sdp } }),
      'https://dnd.example.org'
    );
    expect(response.status).toBe(200);
    await client.setRemoteDescription(JSON.parse(response.body).answer);

    expect(await bridge.waitForModule(10_000)).toBe(true);
    await expect(bridge.query('getWorldInfo')).resolves.toBe(big);
    // Above the 51200 characters where chunking would start, still below the channel limit.
    await expect(bridge.query('journalSetPage', { content: 'y'.repeat(60_000) })).resolves.toBe(
      big
    );
  }, 30_000);
});
