/**
 * The mcp-extras area in the control channel: events only for a client that asked,
 * a backend without events, reconnecting, templates and completion.
 */
import { connect } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { silentLogger } from '../logger.js';
import { BackendEvents } from '../tools/notifications.js';
import type { BackendApi, BackendEvent } from './api.js';
import { BackendClient } from './backend-client.js';
import { ControlServer } from './control-server.js';

const servers: ControlServer[] = [];
const clients: BackendClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  for (const server of servers.splice(0)) await server.close();
});

function baseApi(): BackendApi {
  return {
    listTools: async () => [],
    callTool: async () => ({ content: [] }),
    listResources: async () => [],
    readResource: async uri => ({ contents: [{ uri, text: '' }] }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
  };
}

async function serve(api: BackendApi, port = 0): Promise<number> {
  const server = new ControlServer({ host: '127.0.0.1', port, api, logger: silentLogger });
  servers.push(server);
  return server.listen();
}

function client(port: number): BackendClient {
  const created = new BackendClient({
    host: '127.0.0.1',
    port,
    logger: silentLogger,
    spawnBackend: () => undefined,
    maxAttempts: 30,
    firstDelayMs: 50,
    maxDelayMs: 100,
  });
  clients.push(created);
  return created;
}

const settle = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms));

describe('control channel events', () => {
  it('sends event lines only to a client that called watch', async () => {
    const events = new BackendEvents();
    const port = await serve({ ...baseApi(), watch: listener => events.watch(listener) });

    const lines = await new Promise<string[]>(resolve => {
      const socket = connect({ host: '127.0.0.1', port });
      let data = '';
      socket.setEncoding('utf8');
      socket.on('data', chunk => (data += chunk));
      socket.on('connect', () => socket.write('{"id":1,"method":"ping"}\n'));
      setTimeout(() => {
        events.emit({ type: 'tools_changed' });
        setTimeout(() => {
          socket.destroy();
          resolve(data.split('\n').filter(Boolean));
        }, 150);
      }, 150);
    });
    expect(lines.map(line => JSON.parse(line))).toEqual([{ id: 1, result: { ok: true } }]);
    expect(events.watchers).toBe(0);
  });

  it('delivers events to a watching wrapper and stops when it leaves', async () => {
    const events = new BackendEvents();
    const port = await serve({ ...baseApi(), watch: listener => events.watch(listener) });
    const wrapper = client(port);
    const seen: BackendEvent[] = [];
    wrapper.watch(event => seen.push(event));
    await wrapper.ensureConnected();
    await settle();
    expect(events.watchers).toBe(1);

    events.emit({ type: 'resources_updated', prefixes: ['foundry://journal/'] });
    await settle();
    expect(seen).toEqual([{ type: 'resources_updated', prefixes: ['foundry://journal/'] }]);

    wrapper.close();
    await settle();
    expect(events.watchers).toBe(0);
  });

  it('keeps working with a backend that has no events, templates or completion', async () => {
    const port = await serve(baseApi());
    const wrapper = client(port);
    const seen: BackendEvent[] = [];
    wrapper.watch(event => seen.push(event));
    await wrapper.ensureConnected();
    expect(await wrapper.listResourceTemplates()).toEqual([]);
    expect(
      await wrapper.complete({
        ref: { type: 'ref/prompt', name: 'p' },
        argument: { name: 'a', value: '' },
      })
    ).toEqual({ values: [] });
    expect(await wrapper.listTools()).toEqual([]);
    expect(seen).toEqual([]);
  });

  it('counts every list as changed after reconnecting, because the backend may be another', async () => {
    const port = await serve({ ...baseApi(), watch: () => () => undefined });
    const wrapper = client(port);
    const seen: string[] = [];
    wrapper.watch(event => seen.push(event.type));
    await wrapper.ensureConnected();
    expect(seen).toEqual([]);
    // Close only once the server counts the wrapper: a connection that has sent nothing yet
    // is not in its client list, and closing would wait for it (see the package sheet).
    for (let i = 0; i < 40 && servers[0]!.clientCount === 0; i += 1) await settle(25);

    await servers.shift()?.close();
    await serve({ ...baseApi(), watch: () => () => undefined }, port);
    for (let i = 0; i < 40 && seen.length < 3; i += 1) await settle(50);
    expect(seen).toEqual(['tools_changed', 'resources_changed', 'prompts_changed']);
  });

  it('passes templates and a completion request through', async () => {
    let asked: unknown = null;
    const port = await serve({
      ...baseApi(),
      listResourceTemplates: async () => [
        { uriTemplate: 'foundry://actor/{actorId}', name: 'actor' },
      ],
      complete: async request => {
        asked = request;
        return { values: ['a1'], total: 1, hasMore: false };
      },
    });
    const wrapper = client(port);
    expect(await wrapper.listResourceTemplates()).toEqual([
      { uriTemplate: 'foundry://actor/{actorId}', name: 'actor' },
    ]);
    expect(
      await wrapper.complete({
        ref: { type: 'ref/resource', uri: 'foundry://actor/{actorId}' },
        argument: { name: 'actorId', value: 'a' },
        arguments: { other: 'x' },
      })
    ).toEqual({ values: ['a1'], total: 1, hasMore: false });
    expect(asked).toEqual({
      ref: { type: 'ref/resource', uri: 'foundry://actor/{actorId}' },
      argument: { name: 'actorId', value: 'a' },
      arguments: { other: 'x' },
    });
  });
});
