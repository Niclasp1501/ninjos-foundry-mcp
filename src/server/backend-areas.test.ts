/**
 * The area lifecycle through a real backend: area start and stop, connection events and a
 * request of the module over a real WebSocket. Free ports only, never 31414 to
 * 31416: the production backend runs on this PC.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startBackend, type RunningBackend } from './backend.js';
import { readConfig } from './config.js';
import { silentLogger } from './logger.js';
import type { ServerArea } from './tools/areas.js';

let dir: string;
let backend: RunningBackend | null = null;
let socket: WebSocket | null = null;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'areas-'));
});

afterEach(async () => {
  socket?.close();
  await backend?.close();
  socket = null;
  backend = null;
  rmSync(dir, { recursive: true, force: true });
});

function nextMessage(ws: WebSocket, type: string): Promise<Record<string, any>> {
  return new Promise(resolve => {
    const listener = (raw: WebSocket.RawData) => {
      const message = JSON.parse(raw.toString());
      if (message.type !== type) return;
      ws.off('message', listener);
      resolve(message);
    };
    ws.on('message', listener);
  });
}

const waitFor = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i += 1) await new Promise(r => setTimeout(r, 10));
};

describe('backend with areas', () => {
  it('starts areas, passes connection events and requests, and stops areas on close', async () => {
    const calls: string[] = [];
    const area: ServerArea = {
      id: 'sample',
      start: context => void calls.push(`start ${context.env['AREA_SAMPLE']}`),
      stop: () => void calls.push('stop'),
      onModuleConnection: event =>
        void calls.push(`${event.type} ${event.connection.world ?? '-'}`),
      requests: [
        {
          names: 'sampleService',
          run: (data, context) => ({ echo: data, world: context.connection.world }),
        },
      ],
    };
    const { config } = readConfig({
      FOUNDRY_MCP_CONTROL_PORT: '0',
      FOUNDRY_PORT: '0',
      FOUNDRY_WEBRTC: 'false',
      FOUNDRY_ALLOWED_ORIGINS: 'http://localhost:30000',
      FOUNDRY_MCP_STARTUP_WAIT_MS: '0',
      FOUNDRY_MCP_IDLE_SHUTDOWN_MS: '0',
    });
    config.originStoreFile = join(dir, 'allowed-origins.json');
    config.lockFile = join(dir, 'backend.lock');
    backend = await startBackend({
      config,
      logger: silentLogger,
      version: '9.9.9',
      bridgeHosts: ['127.0.0.1'],
      areas: [area],
      env: { AREA_SAMPLE: 'yes' },
    });
    await backend.areasStarted;
    expect(calls).toEqual(['start yes']);

    const ws = new WebSocket(`ws://127.0.0.1:${backend.bridgePort}/foundry-mcp`, {
      origin: 'http://localhost:30000',
    });
    socket = ws;
    await new Promise(resolve => ws.once('open', resolve));
    const welcome = nextMessage(ws, 'welcome');
    ws.send(JSON.stringify({ type: 'hello', data: { protocol: 2, worldTitle: 'Test World' } }));
    expect((await welcome)['data']['features']).toEqual(['server-requests']);

    const response = nextMessage(ws, 'server-response');
    ws.send(
      JSON.stringify({
        type: 'server-request',
        id: 'request-1',
        data: { method: 'sampleService', data: { a: 1 } },
      })
    );
    expect(await response).toEqual({
      type: 'server-response',
      id: 'request-1',
      data: { success: true, data: { echo: { a: 1 }, world: 'Test World' } },
    });

    ws.close();
    await waitFor(() => calls.some(call => call.startsWith('disconnected')));
    await backend.close();
    backend = null;
    expect(calls).toEqual([
      'start yes',
      'connected -',
      'introduced Test World',
      'disconnected Test World',
      'stop',
    ]);
  });
});
