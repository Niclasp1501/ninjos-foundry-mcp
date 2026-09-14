/**
 * The mcp-extras area the whole way: an MCP client on the in-memory transport, the
 * wrapper's MCP server, the control channel, a real backend and a fake module
 * on a real WebSocket. Only free ports, never 31414 to 31416.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startBackend, type RunningBackend } from '../../backend.js';
import { readConfig } from '../../config.js';
import type { BackendApi } from '../../control/api.js';
import { BackendClient } from '../../control/backend-client.js';
import { silentLogger } from '../../logger.js';
import { createMcpServer } from '../../mcp-facade.js';
import { dnd5eArea } from '../dnd5e/index.js';
import { pf2eArea } from '../pf2e/index.js';
import { scenesArea } from '../scenes/index.js';
import { mcpExtrasArea } from './index.js';

let dir: string;
let backend: RunningBackend | null = null;
let backendClient: BackendClient | null = null;
let module: WebSocket | null = null;
let mcpClient: Client | null = null;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mcp-extras-'));
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

const counts = new Map<string, number>();
const waiters: Array<{ method: string; resolve: () => void }> = [];

function heard(method: string): void {
  counts.set(method, (counts.get(method) ?? 0) + 1);
  for (const waiter of waiters.filter(w => w.method === method)) {
    waiters.splice(waiters.indexOf(waiter), 1);
    waiter.resolve();
  }
}

function next(method: string, ms = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${method} within ${ms} ms`)), ms);
    waiters.push({
      method,
      resolve: () => {
        clearTimeout(timer);
        resolve();
      },
    });
  });
}

async function connectClient(api: BackendApi): Promise<Client> {
  const server = createMcpServer({
    name: 'ninjos-foundry-mcp',
    version: '9.9.9',
    api,
    logger: silentLogger,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  for (const method of [
    'notifications/tools/list_changed',
    'notifications/resources/updated',
    'notifications/resources/list_changed',
    'notifications/prompts/list_changed',
  ] as const) {
    client.setNotificationHandler(method, notification => {
      heard(
        method === 'notifications/resources/updated'
          ? `${method} ${(notification as { params: { uri: string } }).params.uri}`
          : method
      );
    });
  }
  await client.connect(clientTransport);
  return client;
}

async function setup(): Promise<void> {
  counts.clear();
  waiters.length = 0;
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
    areas: [scenesArea, dnd5eArea, pf2eArea, mcpExtrasArea],
    env: {},
  });
  await backend.areasStarted;
  backendClient = new BackendClient({
    host: '127.0.0.1',
    port: backend.controlPort,
    logger: silentLogger,
    spawnBackend: () => {
      throw new Error('the test backend is already running');
    },
  });
  mcpClient = await connectClient(backendClient);
  // Let the wrapper register with the backend before anything changes.
  await new Promise(resolve => setTimeout(resolve, 150));
}

const EXTENSION_TOOLS = [
  {
    name: 'shop-stock',
    description: 'Stock a shop',
    moduleId: 'shops',
    annotations: { readOnlyHint: false },
  },
  {
    name: 'shop-look',
    description: 'Look at a shop',
    moduleId: 'shops',
    annotations: { readOnlyHint: true },
  },
];

async function connectModule(system: string): Promise<void> {
  module = new WebSocket(`ws://127.0.0.1:${backend?.bridgePort}/foundry-mcp`, {
    origin: 'http://localhost:30000',
  });
  module.on('message', raw => {
    const message = JSON.parse(raw.toString());
    if (message.type !== 'mcp-query') return;
    const method = String(message.data.method).replace('ninjos-foundry-mcp.', '');
    const answers: Record<string, unknown> = {
      getWorldInfo: { id: 'w', title: 'World', system, systemVersion: '1.0' },
      listExtensionTools: { tools: EXTENSION_TOOLS },
      'list-scenes': [
        { id: 's1', name: 'Cave' },
        { id: 's2', name: 'Tower' },
      ],
      callExtensionTool: 'Done.',
    };
    module?.send(
      JSON.stringify({
        type: 'mcp-response',
        id: message.id,
        data: { success: true, data: answers[method] ?? [] },
      })
    );
  });
  await new Promise(resolve => module?.once('open', resolve));
  module.send(JSON.stringify({ type: 'hello', data: { protocol: 2, worldTitle: 'World' } }));
  await backend?.bridge.waitForModule(2000);
}

const names = async () =>
  (await mcpClient!.listTools(undefined, { cacheMode: 'refresh' })).tools.map(tool => tool.name);

describe('mcp-extras end to end', () => {
  it('declares list changes, subscriptions and completion', async () => {
    await setup();
    expect(mcpClient!.getServerCapabilities()).toMatchObject({
      tools: { listChanged: true },
      resources: { subscribe: true, listChanged: true },
      prompts: { listChanged: true },
      completions: {},
    });
    const { resources } = await mcpClient!.listResources();
    expect(resources.map(r => r.uri)).toEqual(
      expect.arrayContaining([
        'foundry://world/info',
        'foundry://world/overview',
        'foundry://changes/recent',
      ])
    );
    const { resourceTemplates } = await mcpClient!.listResourceTemplates();
    expect(resourceTemplates.map(t => t.uriTemplate)).toContain(
      'foundry://journal/{journalId}/page/{pageId}'
    );
    const { prompts } = await mcpClient!.listPrompts();
    expect(prompts.map(p => p.name)).toContain('build-encounter');
  });

  it('changes the tool list when a dnd5e world connects and when it leaves, and tells the client', async () => {
    await setup();
    expect(await names()).toEqual(
      expect.arrayContaining(['dnd5e-create-npc', 'pf2e-manage-conditions'])
    );

    const changed = next('notifications/tools/list_changed');
    await connectModule('dnd5e');
    await changed;
    const connected = await names();
    expect(connected).toContain('dnd5e-create-npc');
    expect(connected).toContain('shop-stock');
    expect(connected).not.toContain('pf2e-manage-conditions');

    const left = next('notifications/tools/list_changed');
    module?.close();
    module = null;
    await left;
    const after = await names();
    expect(after).toContain('pf2e-manage-conditions');
    expect(after).not.toContain('shop-stock');
  });

  it('tells a subscriber that a resource changed after a writing call, not after a read', async () => {
    await setup();
    const connected = next('notifications/tools/list_changed');
    await connectModule('dnd5e');
    await connected;
    await names();
    await mcpClient!.subscribeResource({ uri: 'foundry://scene/active' });

    const updated = next('notifications/resources/updated foundry://scene/active');
    const read = await mcpClient!.callTool({ name: 'shop-look', arguments: {} });
    expect(read.isError).toBeFalsy();
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(counts.get('notifications/resources/updated foundry://scene/active')).toBeUndefined();

    await mcpClient!.callTool({ name: 'shop-stock', arguments: {} });
    await updated;

    await mcpClient!.unsubscribeResource({ uri: 'foundry://scene/active' });
    await mcpClient!.callTool({ name: 'shop-stock', arguments: {} });
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(counts.get('notifications/resources/updated foundry://scene/active')).toBe(1);
  });

  it('completes a scene id through the module', async () => {
    await setup();
    await connectModule('dnd5e');
    const answer = await mcpClient!.complete({
      ref: { type: 'ref/resource', uri: 'foundry://scene/{sceneId}' },
      argument: { name: 'sceneId', value: 'tow' },
    });
    expect(answer.completion.values).toEqual(['s2']);
  });

  it('answers empty instead of failing with a backend of an earlier state', async () => {
    counts.clear();
    const old: BackendApi = {
      listTools: async () => [],
      callTool: async () => ({ content: [] }),
      listResources: async () => [],
      readResource: async uri => ({ contents: [{ uri, text: '' }] }),
      listPrompts: async () => [],
      getPrompt: async () => ({ messages: [] }),
    };
    mcpClient = await connectClient(old);
    expect((await mcpClient.listResourceTemplates()).resourceTemplates).toEqual([]);
    const answer = await mcpClient.complete({
      ref: { type: 'ref/prompt', name: 'x' },
      argument: { name: 'y', value: '' },
    });
    expect(answer.completion.values).toEqual([]);
    await mcpClient.subscribeResource({ uri: 'foundry://scene/active' });
  });
});
