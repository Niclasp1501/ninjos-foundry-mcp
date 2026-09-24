/**
 * This module against a server of the previous generation, through the real
 * bridge client: the server never sends `welcome`, so it has no requests from
 * the module. Every request this module sends (`mcpListsChanged` from the
 * change reporter) must end with a clear answer in the module, and the old
 * server must see nothing but `hello`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ListsChangedReporter } from './areas/mcp-extras/lists-changed.js';
import { BridgeClient, type BridgeEvents, type SocketLike } from './bridge-client.js';
import { useServerRequests } from './core-services.js';

type ServerRequestChannel = ReturnType<typeof useServerRequests>;

class OldServerSocket implements SocketLike {
  readyState = 0;
  sent: Array<Record<string, unknown>> = [];
  onopen: SocketLike['onopen'] = null;
  onclose: SocketLike['onclose'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onerror: SocketLike['onerror'] = null;

  send(text: string): void {
    this.sent.push(JSON.parse(text) as Record<string, unknown>);
  }

  close(): void {
    this.readyState = 3;
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
}

let socket: OldServerSocket;
let previous: ServerRequestChannel = null;

/** The module's bridge as main.ts wires it, connected to a server that never says welcome. */
function connectToOldServer(): BridgeClient {
  const events = Object.fromEntries(
    ['connected', 'disconnected', 'unreachable', 'stillDown', 'rejected', 'changed'].map(name => [
      name,
      () => undefined,
    ])
  ) as unknown as BridgeEvents;
  const client = new BridgeClient({
    createSocket: () => (socket = new OldServerSocket()),
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
  previous = useServerRequests({
    request: (method, data, options) => client.request(method, data, options),
    available: () => client.supportsServerRequests(),
  });
  return client;
}

afterEach(() => {
  useServerRequests(previous);
  previous = null;
  vi.useRealTimers();
});

describe('every request of this module against a server without welcome', () => {
  it('mcpListsChanged: a change made by hand is not sent and warns nobody', async () => {
    connectToOldServer();
    const warnings: string[] = [];
    const reporter = new ListsChangedReporter({
      gatherMs: 1,
      warn: message => void warnings.push(message),
    });
    reporter.note({ tools: true, resources: ['foundry://journal/'] });
    await reporter.settled();
    expect(warnings).toEqual([]);
    expect(socket.sent.map(message => message['type'])).toEqual(['hello']);
  });
});
