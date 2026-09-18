import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BridgeClient,
  browserWakeSignals,
  bridgeUrl,
  type BridgeEvents,
  type SocketLike,
  type WakeSignals,
} from './bridge-client.js';

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: Array<Record<string, any>> = [];
  closedWith: { code?: number; reason?: string } | null = null;
  onopen: SocketLike['onopen'] = null;
  onclose: SocketLike['onclose'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onerror: SocketLike['onerror'] = null;

  constructor(readonly url: string) {}

  send(text: string): void {
    this.sent.push(JSON.parse(text));
  }

  close(code?: number, reason?: string): void {
    this.closedWith = {
      ...(code !== undefined ? { code } : {}),
      ...(reason !== undefined ? { reason } : {}),
    };
    this.readyState = 3;
  }

  // Helpers that play the server.
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  drop(code: number, reason = ''): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

let sockets: FakeSocket[];
let events: Record<keyof BridgeEvents, ReturnType<typeof vi.fn>>;
let settings: { enabled: boolean; autoReconnect: boolean };

type Dispatch = ConstructorParameters<typeof BridgeClient>[0]['dispatch'];

function makeClient(dispatch: Dispatch = vi.fn(async () => 'ok'), wakeSignals?: WakeSignals) {
  return new BridgeClient({
    ...(wakeSignals ? { wakeSignals } : {}),
    createSocket: url => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    settings: {
      enabled: () => settings.enabled,
      host: () => 'localhost',
      port: () => 41415,
      autoReconnect: () => settings.autoReconnect,
      heartbeatSeconds: () => 10,
    },
    dispatch,
    hello: () => ({ protocol: 2, worldTitle: 'World' }),
    events: events as unknown as BridgeEvents,
    pageProtocol: () => 'https:',
    pageOrigin: () => 'https://dnd.example.org',
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  sockets = [];
  settings = { enabled: true, autoReconnect: true };
  events = {
    connected: vi.fn(),
    disconnected: vi.fn(),
    unreachable: vi.fn(),
    stillDown: vi.fn(),
    rejected: vi.fn(),
    changed: vi.fn(),
    previousServer: vi.fn(),
  };
});

afterEach(() => {
  vi.useRealTimers();
});

const last = () => sockets[sockets.length - 1] as FakeSocket;

describe('bridgeUrl', () => {
  it('uses ws:// for loopback even on HTTPS pages, and wss:// only for remote hosts there', () => {
    expect(bridgeUrl('localhost', 31415, 'https:')).toBe('ws://localhost:31415/foundry-mcp');
    expect(bridgeUrl('127.0.0.1', 31415, 'https:')).toBe('ws://127.0.0.1:31415/foundry-mcp');
    expect(bridgeUrl('::1', 31415, 'https:')).toBe('ws://[::1]:31415/foundry-mcp');
    expect(bridgeUrl('pc.lan', 31415, 'https:')).toBe('wss://pc.lan:31415/foundry-mcp');
    expect(bridgeUrl('pc.lan', 31415, 'http:')).toBe('ws://pc.lan:31415/foundry-mcp');
  });
});

describe('BridgeClient', () => {
  it('connects over WebSocket, introduces itself and reports connected', () => {
    const client = makeClient();
    client.start();
    last().open();
    expect(last().url).toBe('ws://localhost:41415/foundry-mcp');
    expect(last().sent[0]).toEqual({ type: 'hello', data: { protocol: 2, worldTitle: 'World' } });
    expect(client.getStatus()).toMatchObject({ connected: true, connectionState: 'connected' });
    expect(events.connected).toHaveBeenCalledOnce();
  });

  it('answers a query with the handler result, and a failure with its cause and code', async () => {
    const dispatch = vi.fn(async (method: string) => {
      if (method.endsWith('fail'))
        throw Object.assign(new Error('Access denied'), { code: 'ACCESS_DENIED' });
      return { ok: true };
    });
    const client = makeClient(dispatch);
    client.start();
    last().open();
    last().receive({
      type: 'mcp-query',
      id: 'query-1',
      data: { method: 'ninjos-foundry-mcp.getWorldInfo', data: {} },
    });
    last().receive({
      type: 'mcp-query',
      id: 'query-2',
      data: { method: 'ninjos-foundry-mcp.fail', data: {} },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(last().sent).toContainEqual({
      type: 'mcp-response',
      id: 'query-1',
      data: { success: true, data: { ok: true } },
    });
    expect(last().sent).toContainEqual({
      type: 'mcp-response',
      id: 'query-2',
      data: { success: false, error: 'Access denied', code: 'ACCESS_DENIED' },
    });
  });

  it('sends progress only to a server that answered hello', async () => {
    let report: ((p: { progress: number }) => void) | undefined;
    const client = makeClient(
      vi.fn(
        async (_method: string, _data: unknown, progress: (p: { progress: number }) => void) => {
          report = progress;
          progress({ progress: 1 });
          return 'done';
        }
      )
    );
    client.start();
    last().open();
    last().receive({ type: 'mcp-query', id: 'q1', data: { method: 'x', data: {} } });
    await vi.advanceTimersByTimeAsync(0);
    expect(last().sent.some(m => m['type'] === 'mcp-progress')).toBe(false);

    last().receive({ type: 'welcome', data: { protocol: 2, serverVersion: '1', role: 'active' } });
    last().receive({ type: 'mcp-query', id: 'q2', data: { method: 'x', data: {} } });
    await vi.advanceTimersByTimeAsync(0);
    expect(report).toBeDefined();
    expect(last().sent).toContainEqual({ type: 'mcp-progress', id: 'q2', data: { progress: 1 } });
  });

  it('reconnects after any unrequested close, fast at first and then every 10 seconds', () => {
    const client = makeClient();
    client.start();
    last().open();
    last().drop(1000);
    expect(events.disconnected).toHaveBeenCalledOnce();
    expect(client.getStatus().connectionState).toBe('reconnecting');

    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(2);
    for (const delay of [2000, 5000, 10000, 20000, 10000, 10000]) {
      last().drop(1006);
      vi.advanceTimersByTime(delay - 1);
      const before = sockets.length;
      vi.advanceTimersByTime(1);
      expect(sockets.length).toBe(before + 1);
    }
  });

  it('warns once that the server is unreachable, and once more after a minute down', () => {
    const client = makeClient();
    client.start();
    for (let i = 0; i < 6; i += 1) {
      last().drop(1006);
      vi.advanceTimersByTime(30_000);
    }
    expect(events.unreachable).toHaveBeenCalledOnce();
    expect(events.stillDown).toHaveBeenCalledOnce();
  });

  it('stops retrying after a refused origin and shows the reason', () => {
    const client = makeClient();
    client.start();
    last().drop(4403, 'https://dnd.example.org is not in FOUNDRY_ALLOWED_ORIGINS');
    vi.advanceTimersByTime(120_000);
    expect(sockets).toHaveLength(1);
    expect(events.rejected).toHaveBeenCalledWith(
      'https://dnd.example.org is not in FOUNDRY_ALLOWED_ORIGINS'
    );
    expect(client.getStatus().connectionInfo).toMatchObject({ rejection: 'origin' });
  });

  it('does not reconnect after it closed the connection itself', () => {
    const client = makeClient();
    client.start();
    last().open();
    const socket = last();
    client.stop();
    socket.drop(1000);
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
    expect(client.getStatus().connectionState).toBe('disconnected');
  });

  it('never touches a setting and never reconnects when automatic reconnecting is off', () => {
    settings.autoReconnect = false;
    const client = makeClient();
    client.start();
    last().open();
    last().drop(1006);
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
    expect(client.getStatus().connectionState).toBe('disconnected');
  });

  it('sends nothing but hello to a server that never said welcome, and answers its queries', async () => {
    const client = makeClient(vi.fn(async () => undefined));
    client.start();
    last().open();
    vi.advanceTimersByTime(120_000);
    expect(last().sent).toHaveLength(1);
    expect(last().sent[0]).toEqual({ type: 'hello', data: { protocol: 2, worldTitle: 'World' } });
    expect(last().sent[0]).not.toHaveProperty('requestId');

    last().receive({ type: 'mcp-query', id: 'query-1', data: { method: 'x', data: {} } });
    await vi.advanceTimersByTimeAsync(0);
    expect(last().sent[1]).toEqual({
      type: 'mcp-response',
      id: 'query-1',
      data: { success: true, data: null },
    });
    expect(client.getStatus().connectionState).toBe('connected');
  });

  it('answers a ping in the shape of the previous module', () => {
    const client = makeClient();
    client.start();
    last().open();
    last().receive({ type: 'ping', id: 'beat-3' });
    expect(last().sent[1]).toMatchObject({
      type: 'pong',
      id: 'beat-3',
      data: { status: 'ok', timestamp: expect.any(Number) },
    });
  });

  it('closes a connection whose server stopped answering pings, and only then', () => {
    const client = makeClient();
    client.start();
    last().open();
    last().receive({ type: 'welcome', data: { protocol: 2, serverVersion: '1', role: 'active' } });
    // A server that never answers a ping is not judged.
    vi.advanceTimersByTime(60_000);
    expect(last().closedWith).toBeNull();
    expect(last().sent.some(m => m['type'] === 'ping')).toBe(true);

    last().receive({ type: 'pong' });
    vi.advanceTimersByTime(30_001);
    expect(last().closedWith).toEqual({ code: 4000, reason: 'no answer to pings' });
    expect(client.getStatus().connectionState).toBe('connected');
  });

  it('shows standby when the server says another connection holds the bridge', () => {
    const client = makeClient();
    client.start();
    last().open();
    last().receive({ type: 'bridge-role', data: { role: 'standby', activeWorld: 'Other World' } });
    expect(client.getStatus().connectionInfo).toMatchObject({
      role: 'standby',
      activeWorld: 'Other World',
    });
  });

  it('stays off while the bridge is switched off', () => {
    settings.enabled = false;
    const client = makeClient();
    client.start();
    expect(sockets).toHaveLength(0);
    expect(client.getStatus()).toMatchObject({ enabled: false, connectionState: 'disabled' });
  });

  it('reports a server without welcome as the previous generation after three seconds, once per connection', () => {
    const client = makeClient();
    client.start();
    last().open();
    vi.advanceTimersByTime(2999);
    expect(events.previousServer).not.toHaveBeenCalled();
    expect(client.getStatus().connectionInfo.previousServer).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(events.previousServer).toHaveBeenCalledOnce();
    expect(client.getStatus().connectionInfo.previousServer).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(events.previousServer).toHaveBeenCalledOnce();
  });

  it('does not report a server that says welcome, nor a connection that closed before the wait', () => {
    const client = makeClient();
    client.start();
    last().open();
    last().receive({ type: 'welcome', data: { protocol: 2, serverVersion: '1', role: 'active' } });
    vi.advanceTimersByTime(5000);
    expect(events.previousServer).not.toHaveBeenCalled();
    expect(client.getStatus().connectionInfo.previousServer).toBeUndefined();

    client.stop();
    client.start();
    last().open();
    client.stop();
    vi.advanceTimersByTime(5000);
    expect(events.previousServer).not.toHaveBeenCalled();
  });
});

/** A page with a document and a window, as far as the wake signals need it. */
class FakePage {
  readonly window = new EventTarget();
  readonly document = Object.assign(new EventTarget(), { visibilityState: 'visible' });

  hide(): void {
    this.document.visibilityState = 'hidden';
    this.document.dispatchEvent(new Event('visibilitychange'));
  }

  show(): void {
    this.document.visibilityState = 'visible';
    this.document.dispatchEvent(new Event('visibilitychange'));
  }

  fire(type: 'focus' | 'online'): void {
    this.window.dispatchEvent(new Event(type));
  }

  signals(): WakeSignals {
    return browserWakeSignals(this.window, this.document);
  }
}

describe('BridgeClient when the page wakes up', () => {
  /** A bridge that found no server and waits for its steady attempt. */
  function waitingClient(page: FakePage) {
    const client = makeClient(undefined, page.signals());
    client.start();
    for (let i = 0; i < 6; i += 1) {
      last().drop(1006);
      vi.advanceTimersByTime(20_000);
    }
    last().drop(1006);
    expect(client.getStatus().connectionState).toBe('reconnecting');
    return client;
  }

  it('tries at once when a hidden tab becomes visible again', () => {
    const page = new FakePage();
    const client = waitingClient(page);
    const before = sockets.length;

    page.hide();
    expect(sockets).toHaveLength(before);

    page.show();
    expect(sockets).toHaveLength(before + 1);
    last().open();
    expect(client.getStatus().connectionState).toBe('connected');
  });

  it.each(['focus', 'online'] as const)('tries at once on %s', type => {
    const page = new FakePage();
    waitingClient(page);
    const before = sockets.length;
    page.fire(type);
    expect(sockets).toHaveLength(before + 1);
  });

  it('replaces the scheduled attempt instead of adding one, and keeps the schedule going', () => {
    const page = new FakePage();
    const client = waitingClient(page);
    const before = sockets.length;
    page.fire('focus');
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(before + 1);

    last().drop(1006);
    vi.advanceTimersByTime(10_000);
    expect(sockets).toHaveLength(before + 2);
    expect(client.getStatus().connectionInfo.reconnectAttempts).toBeGreaterThan(6);
  });

  it('never opens a second socket while one is being opened', () => {
    const page = new FakePage();
    waitingClient(page);
    page.fire('focus');
    const before = sockets.length;
    page.show();
    page.fire('online');
    page.fire('focus');
    expect(sockets).toHaveLength(before);
    expect(last().closedWith).toBeNull();
  });

  it('warns about the unreachable server only once, however often the page wakes', () => {
    const page = new FakePage();
    waitingClient(page);
    for (let i = 0; i < 5; i += 1) {
      page.fire('focus');
      last().drop(1006);
    }
    expect(events.unreachable).toHaveBeenCalledOnce();
  });

  it('leaves a connected bridge alone', () => {
    const page = new FakePage();
    const client = makeClient(undefined, page.signals());
    client.start();
    last().open();
    page.hide();
    page.show();
    page.fire('focus');
    page.fire('online');
    expect(sockets).toHaveLength(1);
    expect(last().closedWith).toBeNull();
    expect(client.getStatus().connectionState).toBe('connected');
  });

  it('leaves a refused, a stopped and a switched off bridge alone', () => {
    const page = new FakePage();
    const client = makeClient(undefined, page.signals());
    client.start();
    last().drop(4403, 'origin not allowed');
    page.fire('focus');
    expect(sockets).toHaveLength(1);
    expect(client.getStatus().connectionState).toBe('rejected');

    client.start();
    last().drop(1006);
    client.stop();
    page.fire('focus');
    page.show();
    expect(sockets).toHaveLength(2);
    expect(client.getStatus().connectionState).toBe('disconnected');

    settings.enabled = false;
    client.start();
    page.fire('online');
    expect(sockets).toHaveLength(2);
    expect(client.getStatus().connectionState).toBe('disabled');
  });

  it('removes its listeners on stop and adds them only once on repeated starts', () => {
    const subscribe = vi.fn((_listener: () => void) => vi.fn());
    const client = makeClient(undefined, { subscribe });
    client.start();
    client.start();
    expect(subscribe).toHaveBeenCalledOnce();
    const unsubscribe = subscribe.mock.results[0]?.value as ReturnType<typeof vi.fn>;
    client.stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
    client.start();
    expect(subscribe).toHaveBeenCalledTimes(2);
  });
});
