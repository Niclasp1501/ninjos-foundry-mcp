import { connect, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { silentLogger } from '../logger.js';
import type { BackendApi } from './api.js';
import { ControlServer } from './control-server.js';

const api: BackendApi = {
  listTools: async () => [],
  callTool: async () => ({ content: [] }),
  listResources: async () => [],
  readResource: async uri => ({ contents: [{ uri, text: '' }] }),
  listPrompts: async () => [],
  getPrompt: async () => ({ messages: [] }),
};

const sockets: Socket[] = [];

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.destroy();
});

function openSilent(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port });
    sockets.push(socket);
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

describe('ControlServer.close', () => {
  it('ends a connection that never sent anything instead of waiting for it', async () => {
    const server = new ControlServer({ host: '127.0.0.1', port: 0, api, logger: silentLogger });
    const port = await server.listen();
    const socket = await openSilent(port);
    const closedByServer = new Promise<void>(resolve => socket.once('close', () => resolve()));
    // Let the server accept it before closing.
    await new Promise(resolve => setTimeout(resolve, 20));

    const outcome = await Promise.race([
      server.close().then(() => 'closed'),
      new Promise(resolve => setTimeout(() => resolve('hanging'), 2000)),
    ]);

    expect(outcome).toBe('closed');
    await closedByServer;
    expect(server.clientCount).toBe(0);
  });

  it('never counted the silent connection as a client', async () => {
    const counts: number[] = [];
    const server = new ControlServer({
      host: '127.0.0.1',
      port: 0,
      api,
      logger: silentLogger,
      onClientsChanged: count => counts.push(count),
    });
    const port = await server.listen();
    await openSilent(port);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(server.clientCount).toBe(0);
    await server.close();
    expect(counts).toEqual([]);
  });
});
