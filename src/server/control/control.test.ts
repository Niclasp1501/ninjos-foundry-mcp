import { connect } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { silentLogger } from '../logger.js';
import type { BackendApi, ToolResult } from './api.js';
import { BackendClient } from './backend-client.js';
import { ControlServer } from './control-server.js';

const servers: ControlServer[] = [];
const clients: BackendClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  for (const server of servers.splice(0)) await server.close();
});

function fakeApi(overrides: Partial<BackendApi> = {}): BackendApi {
  return {
    listTools: async () => [
      { name: 'get-world-info', description: 'World', inputSchema: { type: 'object' } },
    ],
    callTool: async (name, args) => ({
      content: [{ type: 'text', text: `${name}:${JSON.stringify(args)}` }],
    }),
    listResources: async () => [],
    readResource: async uri => ({ contents: [{ uri, text: 'x' }] }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    ...overrides,
  };
}

async function startServer(
  api: BackendApi,
  onClientsChanged?: (n: number) => void
): Promise<number> {
  const options = { host: '127.0.0.1', port: 0, api, logger: silentLogger };
  const server = new ControlServer(onClientsChanged ? { ...options, onClientsChanged } : options);
  servers.push(server);
  return server.listen();
}

function rawExchange(
  port: number,
  payload: string
): Promise<{ lines: string[]; closedEarly: boolean }> {
  return new Promise(resolve => {
    const socket = connect({ host: '127.0.0.1', port });
    let data = '';
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(payload));
    socket.on('data', chunk => {
      data += chunk;
    });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve({ lines: data.split('\n').filter(Boolean), closedEarly: false });
    }, 300);
    socket.on('close', () => {
      clearTimeout(timer);
      resolve({ lines: data.split('\n').filter(Boolean), closedEarly: true });
    });
  });
}

describe('ControlServer', () => {
  it('answers ping, lists tools and runs calls', async () => {
    const port = await startServer(fakeApi());
    const { lines } = await rawExchange(
      port,
      '{"id":1,"method":"ping"}\n{"id":2,"method":"list_tools"}\n{"id":3,"method":"call_tool","params":{"name":"t"}}\n'
    );
    const parsed = lines.map(line => JSON.parse(line));
    expect(parsed).toContainEqual({ id: 1, result: { ok: true } });
    expect(parsed.find(p => p.id === 2).result.tools[0].name).toBe('get-world-info');
    expect(parsed.find(p => p.id === 3).result.content[0].text).toBe('t:{}');
  });

  it('answers an unknown method and a line that is not JSON the documented way', async () => {
    const port = await startServer(fakeApi());
    const { lines } = await rawExchange(port, '{"id":"a","method":"nope"}\nnot json\n');
    const parsed = lines.map(line => JSON.parse(line));
    expect(parsed).toContainEqual({ id: 'a', error: { message: 'Unknown method' } });
    const withoutId = parsed.find(p => !('id' in p));
    expect(withoutId.error.message).toMatch(/Invalid JSON/);
  });

  it('drops a connection that opens like an HTTP request before running anything', async () => {
    let called = false;
    const port = await startServer(
      fakeApi({
        callTool: async () => {
          called = true;
          return { content: [] };
        },
      })
    );
    const { lines, closedEarly } = await rawExchange(
      port,
      'POST / HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: text/plain\r\n\r\n{"id":1,"method":"call_tool","params":{"name":"x"}}\n'
    );
    expect(closedEarly).toBe(true);
    expect(lines).toEqual([]);
    expect(called).toBe(false);
  });

  it('counts clients for the idle shutdown', async () => {
    const counts: number[] = [];
    const port = await startServer(fakeApi(), n => counts.push(n));
    await rawExchange(port, '{"id":1,"method":"ping"}\n');
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(counts).toEqual([1, 0]);
  });
});

describe('BackendClient', () => {
  it('passes progress through and resolves with the result', async () => {
    const api = fakeApi({
      callTool: async (_name, _args, options): Promise<ToolResult> => {
        options?.onProgress?.({ progress: 1, total: 2 });
        options?.onProgress?.({ progress: 2, total: 2, message: 'done' });
        return { content: [{ type: 'text', text: 'ok' }] };
      },
    });
    const port = await startServer(api);
    const client = new BackendClient({
      host: '127.0.0.1',
      port,
      logger: silentLogger,
      spawnBackend: () => undefined,
    });
    clients.push(client);

    const seen: number[] = [];
    const result = await client.callTool('x', {}, { onProgress: p => seen.push(p.progress) });
    expect(result.content[0]?.text).toBe('ok');
    expect(seen).toEqual([1, 2]);
  });

  it('does not ask for progress when nobody listens', async () => {
    let sawProgressFlag: boolean | undefined;
    const api = fakeApi({
      callTool: async (_name, _args, options) => {
        sawProgressFlag = Boolean(options?.onProgress);
        return { content: [] };
      },
    });
    const port = await startServer(api);
    const client = new BackendClient({
      host: '127.0.0.1',
      port,
      logger: silentLogger,
      spawnBackend: () => undefined,
    });
    clients.push(client);
    await client.callTool('x', {});
    expect(sawProgressFlag).toBe(false);
  });

  it('starts a backend once when none answers, then connects', async () => {
    const holder = new ControlServer({
      host: '127.0.0.1',
      port: 0,
      api: fakeApi(),
      logger: silentLogger,
    });
    const port = await holder.listen();
    await holder.close();

    let spawns = 0;
    const client = new BackendClient({
      host: '127.0.0.1',
      port,
      logger: silentLogger,
      firstDelayMs: 20,
      spawnBackend: () => {
        spawns += 1;
        const server = new ControlServer({
          host: '127.0.0.1',
          port,
          api: fakeApi(),
          logger: silentLogger,
        });
        servers.push(server);
        void server.listen();
      },
    });
    clients.push(client);
    await expect(client.request('ping')).resolves.toEqual({ ok: true });
    expect(spawns).toBe(1);
  });

  it('gives up with a message after the attempts are used', async () => {
    const holder = new ControlServer({
      host: '127.0.0.1',
      port: 0,
      api: fakeApi(),
      logger: silentLogger,
    });
    const port = await holder.listen();
    await holder.close();
    const client = new BackendClient({
      host: '127.0.0.1',
      port,
      logger: silentLogger,
      maxAttempts: 3,
      firstDelayMs: 5,
      spawnBackend: () => undefined,
    });
    clients.push(client);
    await expect(client.request('ping')).rejects.toThrow(/No backend .* after 3 attempts/);
  });

  it('cancels a running call on the backend when the client aborts', async () => {
    let aborted = false;
    const api = fakeApi({
      callTool: (_name, _args, options) =>
        new Promise(resolve => {
          options?.signal?.addEventListener('abort', () => {
            aborted = true;
            resolve({ content: [] });
          });
        }),
    });
    const port = await startServer(api);
    const client = new BackendClient({
      host: '127.0.0.1',
      port,
      logger: silentLogger,
      spawnBackend: () => undefined,
    });
    clients.push(client);
    const controller = new AbortController();
    const call = client.callTool('slow', {}, { signal: controller.signal });
    await new Promise(resolve => setTimeout(resolve, 50));
    controller.abort();
    await expect(call).rejects.toThrow(/Cancelled/);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(aborted).toBe(true);
  });
});
