/**
 * The whole path without Foundry: an MCP client talks to the wrapper's MCP
 * server, which uses the control channel to reach a real backend, which asks
 * a fake module over a real WebSocket. Only free ports are used, never 31414
 * to 31416: the production backend runs on this PC.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startBackend, type RunningBackend } from './backend.js';
import { readConfig } from './config.js';
import { BackendClient } from './control/backend-client.js';
import { silentLogger } from './logger.js';
import { createMcpServer } from './mcp-facade.js';

let dir: string;
let backend: RunningBackend | null = null;
let backendClient: BackendClient | null = null;
let module: WebSocket | null = null;
let mcpClient: Client | null = null;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'e2e-'));
});

afterEach(async () => {
  await mcpClient?.close().catch(() => undefined);
  module?.close();
  backendClient?.close();
  await backend?.close();
  mcpClient = null;
  module = null;
  backendClient = null;
  backend = null;
  rmSync(dir, { recursive: true, force: true });
});

async function setup(): Promise<void> {
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
  });

  backendClient = new BackendClient({
    host: '127.0.0.1',
    port: backend.controlPort,
    logger: silentLogger,
    spawnBackend: () => {
      throw new Error('the test backend is already running');
    },
  });

  const server = createMcpServer({
    name: 'ninjos-foundry-mcp',
    version: '9.9.9',
    api: backendClient,
    logger: silentLogger,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  mcpClient = new Client({ name: 'test-client', version: '1.0.0' });
  await mcpClient.connect(clientTransport);
}

/** A fake module that answers like the module of this rewrite. */
async function connectModule(
  onQuery: (method: string, data: unknown, reply: (payload: unknown) => void, id: string) => void
) {
  module = new WebSocket(`ws://127.0.0.1:${backend?.bridgePort}/foundry-mcp`, {
    origin: 'http://localhost:30000',
  });
  module.on('message', raw => {
    const message = JSON.parse(raw.toString());
    if (message.type !== 'mcp-query') return;
    onQuery(
      message.data.method,
      message.data.data,
      payload => module?.send(JSON.stringify(payload)),
      message.id
    );
  });
  await new Promise(resolve => module?.once('open', resolve));
  module.send(JSON.stringify({ type: 'hello', data: { protocol: 2, worldTitle: 'Test World' } }));
  await backend?.bridge.waitForModule(2000);
}

const worldInfo = {
  id: 'test-world',
  title: 'Test World',
  system: { id: 'dnd5e', version: '5.1.0' },
  foundry: { version: '14.350' },
  users: { total: 3, active: 1, gms: 1, players: 2 },
  activeUsers: [{ id: 'gm', name: 'Gamemaster', isGM: true }],
};

describe('end to end', () => {
  it('lists get-world-info with its annotations', async () => {
    await setup();
    const { tools } = await mcpClient!.listTools();
    const tool = tools.find(t => t.name === 'get-world-info');
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
  });

  it('carries get-world-info from the model to the world and back, wrapped once', async () => {
    await setup();
    await connectModule((method, _data, reply, id) => {
      if (method === 'ninjos-foundry-mcp.getWorldInfo') {
        reply({ type: 'mcp-response', id, data: { success: true, data: worldInfo } });
      } else if (method === 'ninjos-foundry-mcp.listExtensionTools') {
        reply({ type: 'mcp-response', id, data: { success: true, data: [] } });
      }
    });

    const result = await mcpClient!.callTool({ name: 'get-world-info', arguments: {} });
    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content).toHaveLength(1);
    expect(JSON.parse(content[0]!.text)).toEqual(worldInfo);
  });

  it('reports a missing module as a tool error, not as a protocol failure', async () => {
    await setup();
    const result = await mcpClient!.callTool({ name: 'get-world-info', arguments: {} });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0]?.text).toBe(
      'Error: Foundry VTT module not connected'
    );
  });

  it('passes progress from the module on to the client', async () => {
    await setup();
    await connectModule((method, _data, reply, id) => {
      if (method !== 'ninjos-foundry-mcp.callExtensionTool') {
        reply({ type: 'mcp-response', id, data: { success: true, data: [] } });
        return;
      }
      reply({ type: 'mcp-progress', id, data: { progress: 1, total: 2, message: 'half' } });
      reply({ type: 'mcp-progress', id, data: { progress: 2, total: 2 } });
      reply({ type: 'mcp-response', id, data: { success: true, data: 'Stocked.' } });
    });

    const seen: Array<{ progress: number; message?: string | undefined }> = [];
    const result = await mcpClient!.callTool(
      { name: 'shop-stock', arguments: { item: 'rope' } },
      {
        onprogress: progress =>
          void seen.push({ progress: progress.progress, message: progress.message }),
      }
    );
    expect((result.content as Array<{ text: string }>)[0]?.text).toBe('Stocked.');
    expect(seen.map(p => p.progress)).toEqual([1, 2]);
    expect(seen[0]?.message).toBe('half');
  });

  it('offers the world information as a resource', async () => {
    await setup();
    await connectModule((method, _data, reply, id) => {
      reply({
        type: 'mcp-response',
        id,
        data: { success: true, data: method.endsWith('getWorldInfo') ? worldInfo : [] },
      });
    });
    const { resources } = await mcpClient!.listResources();
    expect(resources.map(r => r.uri)).toContain('foundry://world/info');
    const read = await mcpClient!.readResource({ uri: 'foundry://world/info' });
    const first = read.contents[0] as { text: string };
    expect(JSON.parse(first.text).title).toBe('Test World');
  });
});
