import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { silentLogger } from '../logger.js';
import { OriginGuard } from './connection-guards.js';
import { FoundryBridge } from './foundry-bridge.js';
import { startWebSocketTransport, type RunningTransport } from './websocket-transport.js';

let dir: string;
let transport: RunningTransport | null = null;
let bridge: FoundryBridge;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ws-transport-'));
  bridge = new FoundryBridge({
    serverVersion: 'test',
    logger: silentLogger,
    defaultTimeoutMs: 2000,
  });
});

afterEach(async () => {
  await transport?.close();
  transport = null;
  rmSync(dir, { recursive: true, force: true });
});

async function start(configured: string[] = []): Promise<number> {
  transport = await startWebSocketTransport({
    port: 0,
    path: '/foundry-mcp',
    remoteMode: false,
    hosts: ['127.0.0.1'],
    guard: new OriginGuard({ configured, storeFile: join(dir, 'allowed-origins.json') }),
    bridge,
    logger: silentLogger,
  });
  return transport.port;
}

function open(port: number, path: string, origin?: string): WebSocket {
  return new WebSocket(`ws://127.0.0.1:${port}${path}`, origin ? { origin } : {});
}

describe('WebSocket transport', () => {
  it('carries a query to the module and its answer back', async () => {
    const port = await start(['http://localhost:30000']);
    const ws = open(port, '/foundry-mcp', 'http://localhost:30000');
    ws.on('message', raw => {
      const message = JSON.parse(raw.toString());
      if (message.type === 'mcp-query') {
        ws.send(
          JSON.stringify({
            type: 'mcp-response',
            id: message.id,
            data: { success: true, data: { ok: 1 } },
          })
        );
      }
    });
    await new Promise(resolve => ws.once('open', resolve));
    await bridge.waitForModule(1000);
    await expect(bridge.query('getWorldInfo')).resolves.toEqual({ ok: 1 });
    ws.close();
  });

  it('closes a refused origin with 4403 after the handshake', async () => {
    const port = await start(['http://localhost:30000']);
    const ws = open(port, '/foundry-mcp', 'https://evil.example');
    const code = await new Promise<number>(resolve => ws.once('close', c => resolve(c)));
    expect(code).toBe(4403);
    expect(bridge.isConnected()).toBe(false);
  });

  it('refuses other paths', async () => {
    const port = await start();
    const ws = open(port, '/elsewhere', 'http://localhost:30000');
    const failed = await new Promise<boolean>(resolve => {
      ws.once('error', () => resolve(true));
      ws.once('open', () => resolve(false));
    });
    expect(failed).toBe(true);
  });

  it('learns the first origin and refuses a second one', async () => {
    const port = await start();
    const first = open(port, '/foundry-mcp', 'https://dnd.example.org');
    await new Promise(resolve => first.once('open', resolve));
    const second = open(port, '/foundry-mcp', 'https://other.example.org');
    const code = await new Promise<number>(resolve => second.once('close', c => resolve(c)));
    expect(code).toBe(4403);
    first.close();
  });

  it('detaches a closed connection from the bridge', async () => {
    const port = await start();
    const ws = open(port, '/foundry-mcp', 'http://localhost:30000');
    await new Promise(resolve => ws.once('open', resolve));
    await bridge.waitForModule(1000);
    const gone = new Promise<void>(resolve =>
      bridge.onConnectionCountChange(n => n === 0 && resolve())
    );
    ws.close();
    await gone;
    expect(bridge.isConnected()).toBe(false);
  });
});
