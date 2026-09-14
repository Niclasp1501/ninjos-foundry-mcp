/**
 * This server against the previous generation, beyond single areas:
 *
 * 1. every tool of the directory against a module that knows none of this
 *    generation's queries,
 * 2. a wrapper of the previous generation against this backend,
 * 3. this wrapper against a backend of the previous generation.
 *
 * The previous side is built from a description of its behaviour, not from its
 * code. Only free ports, never 31414 to 31416.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, connect, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
import { MODULE_ID } from '../common/constants.js';
import { readToolDirectory } from '../testing/tool-directory.js';
import { SERVER_AREAS } from './areas/index.js';
import { startBackend, type RunningBackend } from './backend.js';
import { BridgeError } from './bridge/foundry-bridge.js';
import { readConfig } from './config.js';
import type { ToolResult } from './control/api.js';
import { BackendClient } from './control/backend-client.js';
import { systemDetector } from './game-systems.js';
import { silentLogger } from './logger.js';
import { createMcpServer } from './mcp-facade.js';
import { installServerAreas } from './tools/areas.js';
import { ToolRegistry, type BridgeAccess } from './tools/registry.js';
import { ServerRequestRegistry } from './tools/requests.js';
import { PromptRegistry, ResourceRegistry } from './tools/resources.js';

const directory = readToolDirectory();
const MAP_TOOLS = ['generate-map', 'check-map-status', 'cancel-map-job'];

/**
 * Where the first enum value needs more than the required parameters, a call a
 * caller of the directory would really make, so it reaches the module.
 */
const OVERRIDES: Record<string, Record<string, unknown>> = {
  'manage-actors': { action: 'describe' },
  'manage-world-items': { action: 'list' },
  'dnd5e-add-feature': { featureName: 'x' },
};

type Schema = Record<string, unknown>;

/** The smallest value a caller of the directory could send for a schema. */
function sample(schema: Schema | undefined): unknown {
  if (!schema) return 'x';
  if (Array.isArray(schema['enum'])) return schema['enum'][0];
  if (Array.isArray(schema['oneOf'])) return sample(schema['oneOf'][0] as Schema);
  const type = Array.isArray(schema['type']) ? schema['type'][0] : schema['type'];
  switch (type) {
    case 'number':
    case 'integer': {
      if (typeof schema['minimum'] === 'number') return schema['minimum'];
      if (typeof schema['exclusiveMinimum'] === 'number') return schema['exclusiveMinimum'] + 1;
      return 1;
    }
    case 'boolean':
      return false;
    case 'array': {
      const count = Math.max(1, typeof schema['minItems'] === 'number' ? schema['minItems'] : 1);
      return Array.from({ length: count }, () => sample(schema['items'] as Schema | undefined));
    }
    case 'object':
      return requiredArguments(schema);
    default:
      return 'x';
  }
}

function requiredArguments(schema: Schema): Record<string, unknown> {
  const properties = (schema['properties'] ?? {}) as Record<string, Schema>;
  const required = Array.isArray(schema['required']) ? (schema['required'] as string[]) : [];
  return Object.fromEntries(required.map(name => [name, sample(properties[name])]));
}

const text = (result: ToolResult) =>
  result.content.map(block => ('text' in block ? block.text : '')).join('\n');

describe('every tool of the directory against a module that knows no query of this generation', () => {
  const sent: string[] = [];
  const bridge: BridgeAccess = {
    isConnected: () => true,
    waitForModule: async () => true,
    query: async name => {
      sent.push(name);
      // What the previous module answers for an unknown query, as the bridge hands it on.
      const full = name.includes('.') ? name : `${MODULE_ID}.${name}`;
      throw new BridgeError('MODULE_ERROR', `No handler found for query: ${full}`);
    },
  };
  const tools = new ToolRegistry({
    bridge,
    logger: silentLogger,
    groups: [],
    comfyuiEnabled: true,
    maxChars: 0,
    startupWaitLeft: () => 0,
  });
  installServerAreas(SERVER_AREAS, {
    tools,
    resources: new ResourceRegistry(),
    prompts: new PromptRegistry(),
    requests: new ServerRequestRegistry(() => silentLogger),
  });

  it.each(directory.map(tool => [tool.name, tool] as const))(
    '%s ends with a tool error that keeps the cause, and never hangs',
    async (name, tool) => {
      sent.length = 0;
      systemDetector.invalidate();
      const args = { ...requiredArguments(tool.inputSchema), ...OVERRIDES[name] };
      const outcome = await Promise.race([
        tools.call(name, args),
        new Promise<'hung'>(resolve => setTimeout(() => resolve('hung'), 3000)),
      ]);
      expect(outcome, `${name} answered within three seconds`).not.toBe('hung');
      const result = outcome as ToolResult;
      if (name === 'manage-actors') {
        // "describe" answers on the server without the world and says why its notes are empty.
        expect(result.isError, text(result)).toBeUndefined();
        expect(text(result)).toMatch(/could not be detected.*No handler found for query/);
        return;
      }
      expect(result.isError, `${name}: ${text(result)}`).toBe(true);
      if (MAP_TOOLS.includes(name)) {
        // Maps never reach an old module: without a started generator they refuse on the server.
        expect(sent, name).toEqual([]);
        return;
      }
      expect(sent.length, `${name} asked the module: ${text(result)}`).toBeGreaterThan(0);
      // Either the module's own words, or (campaign tools) the missing query named with what to do.
      expect(text(result), name).toMatch(
        /No handler found for query|does not know the query \w+: it is older than this server/
      );
    }
  );
});

let dir: string | null = null;
let backend: RunningBackend | null = null;
let oldBackend: Server | null = null;
let mcpClient: Client | null = null;
let backendClient: BackendClient | null = null;
const sockets: Socket[] = [];

afterEach(async () => {
  await mcpClient?.close().catch(() => undefined);
  backendClient?.close();
  for (const socket of sockets.splice(0)) socket.destroy();
  await backend?.close();
  await new Promise<void>(resolve => (oldBackend ? oldBackend.close(() => resolve()) : resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true });
  mcpClient = null;
  backendClient = null;
  backend = null;
  oldBackend = null;
  dir = null;
});

describe('a wrapper of the previous generation against this backend', () => {
  async function start(): Promise<number> {
    dir = mkdtempSync(join(tmpdir(), 'previous-wrapper-'));
    const { config } = readConfig({
      FOUNDRY_MCP_CONTROL_PORT: '0',
      FOUNDRY_PORT: '0',
      FOUNDRY_WEBRTC: 'false',
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
    return backend.controlPort;
  }

  /** Writes the lines as the previous wrapper does and collects every line until each id is answered. */
  function exchange(port: number, requests: Array<Record<string, unknown>>) {
    return new Promise<Array<Record<string, any>>>((resolve, reject) => {
      const socket = connect({ host: '127.0.0.1', port });
      sockets.push(socket);
      const lines: Array<Record<string, any>> = [];
      let buffer = '';
      const timer = setTimeout(() => reject(new Error(`only ${lines.length} lines`)), 5000);
      socket.setEncoding('utf8');
      socket.on('connect', () =>
        socket.write(requests.map(request => `${JSON.stringify(request)}\n`).join(''))
      );
      socket.on('data', chunk => {
        buffer += chunk;
        const parts = buffer.split('\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) if (part) lines.push(JSON.parse(part));
        const answered = lines.filter(line => 'result' in line || 'error' in line).length;
        if (answered >= requests.length) {
          clearTimeout(timer);
          // A moment more, so a stray progress or event line would be seen.
          setTimeout(() => resolve(lines), 100);
        }
      });
    });
  }

  it('gets only the three methods it knows, in the shapes it reads, and no extra lines', async () => {
    const port = await start();
    const lines = await exchange(port, [
      { id: 1, method: 'ping' },
      { id: 2, method: 'list_tools' },
      { id: 3, method: 'call_tool', params: { name: 'get-world-info', args: {} } },
      { id: 4, method: 'call_tool', params: { name: 'list-journals' } },
      { id: 5, method: 'call_tool', params: { name: 'no-such-tool', args: {} } },
    ]);

    expect(lines.map(line => line['id']).sort()).toEqual([1, 2, 3, 4, 5]);
    for (const line of lines) {
      expect(line).not.toHaveProperty('progress');
      expect(line).not.toHaveProperty('event');
    }
    const byId = new Map(lines.map(line => [line['id'], line]));
    expect(byId.get(1)).toEqual({ id: 1, result: { ok: true } });

    const listed = (byId.get(2)?.['result']?.['tools'] as Array<{ name: string }>).map(
      tool => tool.name
    );
    // Map tools only with COMFYUI_ENABLED=true, as in the previous backend.
    const expected = directory.map(tool => tool.name).filter(name => !MAP_TOOLS.includes(name));
    expect(expected.filter(name => !listed.includes(name))).toEqual([]);

    for (const id of [3, 4, 5]) {
      const result = byId.get(id)?.['result'] as ToolResult;
      expect(result.isError, `id ${id}`).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toMatchObject({
        type: 'text',
        text: expect.stringMatching(/^Error: /),
      });
    }
    expect(text(byId.get(3)?.['result'] as ToolResult)).toBe(
      'Error: Foundry VTT module not connected'
    );
  });

  it('keeps counting the old wrapper until it leaves', async () => {
    const port = await start();
    const socket = connect({ host: '127.0.0.1', port });
    sockets.push(socket);
    await new Promise(resolve => socket.once('connect', resolve));
    socket.write('{"id":1,"method":"ping"}\n');
    await new Promise(resolve => socket.once('data', resolve));
    const status = await new BackendClient({
      host: '127.0.0.1',
      port,
      logger: silentLogger,
      spawnBackend: () => undefined,
    });
    backendClient = status;
    const answer = (await status.request('status')) as { clients: number };
    expect(answer.clients).toBe(2);
  });
});

describe('this wrapper against a backend of the previous generation', () => {
  const received: Array<{ method: string; params: Record<string, unknown> }> = [];

  /** The previous backend's control channel as described for that generation. */
  async function startOldBackend(): Promise<number> {
    received.length = 0;
    oldBackend = createServer(socket => {
      sockets.push(socket);
      let buffer = '';
      socket.setEncoding('utf8');
      socket.on('data', chunk => {
        buffer += chunk;
        const parts = buffer.split('\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          if (!part) continue;
          let request: { id?: unknown; method?: string; params?: Record<string, unknown> };
          try {
            request = JSON.parse(part);
          } catch (error) {
            socket.write(`${JSON.stringify({ error: { message: String(error) } })}\n`);
            continue;
          }
          const params = request.params ?? {};
          received.push({ method: String(request.method), params });
          const reply = (body: Record<string, unknown>) =>
            socket.write(`${JSON.stringify({ id: request.id, ...body })}\n`);
          if (request.method === 'ping') reply({ result: { ok: true } });
          else if (request.method === 'list_tools')
            reply({
              result: {
                tools: [
                  {
                    name: 'get-world-info',
                    description: 'World',
                    inputSchema: { type: 'object', properties: {} },
                  },
                ],
              },
            });
          else if (request.method === 'call_tool')
            reply({
              result: {
                content: [
                  {
                    type: 'text',
                    text: `${String(params['name'])} ${JSON.stringify(params['args'])}`,
                  },
                ],
              },
            });
          else reply({ error: { message: 'Unknown method' } });
        }
      });
    });
    await new Promise<void>(resolve => oldBackend!.listen(0, '127.0.0.1', () => resolve()));
    const address = oldBackend.address();
    return typeof address === 'object' && address ? address.port : 0;
  }

  async function connectWrapper(port: number): Promise<Client> {
    backendClient = new BackendClient({
      host: '127.0.0.1',
      port,
      logger: silentLogger,
      spawnBackend: () => {
        throw new Error('the old test backend is already running');
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
    return mcpClient;
  }

  it('lists and calls tools, with arguments under args', async () => {
    const client = await connectWrapper(await startOldBackend());
    const { tools } = await client.listTools();
    expect(tools.map(tool => tool.name)).toEqual(['get-world-info']);
    const result = await client.callTool({ name: 'get-world-info', arguments: { a: 1 } });
    expect(result.isError).toBeFalsy();
    expect((result.content as Array<{ text: string }>)[0]?.text).toBe('get-world-info {"a":1}');
    expect(received.filter(entry => entry.method === 'call_tool')).toEqual([
      { method: 'call_tool', params: { name: 'get-world-info', args: { a: 1 } } },
    ]);
  });

  it('answers resources, templates, prompts and completion with empty lists where the old backend knows no method', async () => {
    const client = await connectWrapper(await startOldBackend());
    expect((await client.listResources()).resources).toEqual([]);
    expect((await client.listResourceTemplates()).resourceTemplates).toEqual([]);
    expect((await client.listPrompts()).prompts).toEqual([]);
    const completion = await client.complete({
      ref: { type: 'ref/prompt', name: 'prepare-session' },
      argument: { name: 'x', value: '' },
    });
    expect(completion.completion.values).toEqual([]);
    // Tools still work after the refused methods.
    expect((await client.listTools()).tools).toHaveLength(1);
    const methods = new Set(received.map(entry => entry.method));
    for (const method of methods)
      expect([
        'ping',
        'list_tools',
        'call_tool',
        'watch',
        'list_resources',
        'list_resource_templates',
        'list_prompts',
        'complete',
      ]).toContain(method);
  });

  it('passes a progress request through, which the old backend ignores, and still gets the result', async () => {
    const client = await connectWrapper(await startOldBackend());
    const seen: number[] = [];
    const result = await client.callTool(
      { name: 'get-world-info', arguments: {} },
      { onprogress: progress => void seen.push(progress.progress) }
    );
    expect((result.content as Array<{ text: string }>)[0]?.text).toBe('get-world-info {}');
    expect(seen).toEqual([]);
  });
});
