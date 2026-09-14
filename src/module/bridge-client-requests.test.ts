import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BridgeClient, type BridgeEvents, type SocketLike } from './bridge-client.js';
import { isServerTooOld, ServerRequestError } from './server-requests.js';

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: Array<Record<string, any>> = [];
  onopen: SocketLike['onopen'] = null;
  onclose: SocketLike['onclose'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onerror: SocketLike['onerror'] = null;

  send(text: string): void {
    this.sent.push(JSON.parse(text));
  }

  close(): void {
    this.readyState = 3;
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  drop(code: number): void {
    this.readyState = 3;
    this.onclose?.({ code, reason: '' });
  }
}

let socket: FakeSocket;

function connectedClient(): BridgeClient {
  const events = Object.fromEntries(
    ['connected', 'disconnected', 'unreachable', 'stillDown', 'rejected', 'changed'].map(name => [
      name,
      () => undefined,
    ])
  ) as unknown as BridgeEvents;
  const client = new BridgeClient({
    createSocket: () => (socket = new FakeSocket()),
    settings: {
      enabled: () => true,
      host: () => 'localhost',
      port: () => 41415,
      autoReconnect: () => false,
      heartbeatSeconds: () => 30,
    },
    dispatch: async () => null,
    hello: () => ({ protocol: 2 }),
    events,
    pageProtocol: () => 'http:',
    pageOrigin: () => 'http://localhost:30000',
  });
  client.start();
  socket.open();
  return client;
}

const welcome = (features?: string[]) => ({
  type: 'welcome',
  data: { protocol: 2, serverVersion: '1', role: 'active', ...(features ? { features } : {}) },
});

const requestsSent = () => socket.sent.filter(message => message['type'] === 'server-request');

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('BridgeClient requests to the server', () => {
  it('sends a request to a server that announced them and resolves with the answer', async () => {
    const client = connectedClient();
    socket.receive(welcome(['server-requests']));
    expect(client.supportsServerRequests()).toBe(true);

    const answer = client.request('ninjos-foundry-mcp.mapService', { action: 'status' });
    await vi.advanceTimersByTimeAsync(0);
    expect(requestsSent()).toEqual([
      {
        type: 'server-request',
        id: 'request-1',
        data: { method: 'mapService', data: { action: 'status' } },
      },
    ]);
    socket.receive({
      type: 'server-response',
      id: 'request-1',
      data: { success: true, data: { state: 'running' } },
    });
    await expect(answer).resolves.toEqual({ state: 'running' });
  });

  it('says the server is too old and sends nothing when welcome lists no feature', async () => {
    const client = connectedClient();
    socket.receive(welcome());
    const answer = client.request('mapService');
    await expect(answer).rejects.toSatisfy(isServerTooOld);
    await expect(client.request('mapService')).rejects.toThrow(/older than this module/);
    expect(requestsSent()).toEqual([]);
  });

  it('waits a moment for welcome, then treats a server that never says it as the previous generation', async () => {
    const client = connectedClient();
    const answer = client.request('mapService').catch((error: ServerRequestError) => error);
    await vi.advanceTimersByTimeAsync(2999);
    expect(requestsSent()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(await answer).toMatchObject({ code: 'SERVER_TOO_OLD' });
    // The previous server only ever saw hello.
    expect(socket.sent.map(message => message['type'])).toEqual(['hello']);
  });

  it('sends as soon as welcome arrives during the wait', async () => {
    const client = connectedClient();
    const answer = client.request('mapService');
    await vi.advanceTimersByTimeAsync(500);
    socket.receive(welcome(['server-requests']));
    await vi.advanceTimersByTimeAsync(0);
    expect(requestsSent()).toHaveLength(1);
    socket.receive({ type: 'server-response', id: 'request-1', data: { success: true, data: 1 } });
    await expect(answer).resolves.toBe(1);
  });

  it('turns UNKNOWN_REQUEST into SERVER_TOO_OLD and keeps other server codes', async () => {
    const client = connectedClient();
    socket.receive(welcome(['server-requests']));
    const unknown = client.request('newThing');
    const refused = client.request('mapService');
    await vi.advanceTimersByTimeAsync(0);
    socket.receive({
      type: 'server-response',
      id: 'request-1',
      data: { success: false, error: 'unknown', code: 'UNKNOWN_REQUEST' },
    });
    socket.receive({
      type: 'server-response',
      id: 'request-2',
      data: { success: false, error: 'off', code: 'NOT_AVAILABLE' },
    });
    await expect(unknown).rejects.toMatchObject({
      code: 'SERVER_TOO_OLD',
      serverCode: 'UNKNOWN_REQUEST',
    });
    await expect(refused).rejects.toMatchObject({ code: 'NOT_AVAILABLE', message: 'off' });
  });

  it('times out with a hint that the server may still have done it', async () => {
    const client = connectedClient();
    socket.receive(welcome(['server-requests']));
    const answer = client
      .request('mapService', {}, { timeoutMs: 1000 })
      .catch((error: ServerRequestError) => error);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await answer).toMatchObject({
      code: 'TIMEOUT',
      message: expect.stringMatching(/may still have done it/),
    });
    // A late answer is ignored.
    socket.receive({ type: 'server-response', id: 'request-1', data: { success: true, data: 1 } });
  });

  it('fails waiting requests when the bridge closes, and refuses without a bridge', async () => {
    const client = connectedClient();
    socket.receive(welcome(['server-requests']));
    const answer = client.request('mapService').catch((error: ServerRequestError) => error);
    await vi.advanceTimersByTimeAsync(0);
    socket.drop(1006);
    expect(await answer).toMatchObject({ code: 'CONNECTION_LOST' });
    expect(client.supportsServerRequests()).toBe(false);
    await expect(client.request('mapService')).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
  });

  it('forgets the features of the previous server after reconnecting', async () => {
    const client = connectedClient();
    socket.receive(welcome(['server-requests']));
    client.start();
    socket.open();
    expect(client.supportsServerRequests()).toBe(false);
  });
});
