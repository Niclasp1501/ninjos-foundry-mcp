import { beforeEach, describe, expect, it } from 'vitest';
import { silentLogger } from '../logger.js';
import { FoundryBridge, type BridgeConnectionEvent, type BridgePeer } from './foundry-bridge.js';

interface FakePeer extends BridgePeer {
  sent: Array<Record<string, any>>;
}

function fakePeer(label = 'peer'): FakePeer {
  const sent: Array<Record<string, any>> = [];
  return {
    label,
    transport: 'websocket',
    sent,
    send: text => sent.push(JSON.parse(text)),
    close: () => undefined,
  };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

let bridge: FoundryBridge;

beforeEach(() => {
  bridge = new FoundryBridge({
    serverVersion: '1.0.0',
    logger: silentLogger,
    defaultTimeoutMs: 1000,
  });
});

describe('FoundryBridge requests from the module', () => {
  it('announces the feature in welcome', () => {
    const peer = fakePeer();
    bridge.attach(peer).receive(JSON.stringify({ type: 'hello', data: { protocol: 2 } }));
    expect(peer.sent[0]).toMatchObject({
      type: 'welcome',
      data: { features: ['server-requests'] },
    });
  });

  it('answers a request with the handler result, stripping the module prefix', async () => {
    const seen: unknown[] = [];
    bridge.setRequestHandler(async (method, data, connection) => {
      seen.push([method, data, connection.role, connection.world]);
      return { state: 'running' };
    });
    const peer = fakePeer();
    const attached = bridge.attach(peer);
    attached.receive(JSON.stringify({ type: 'hello', data: { protocol: 2, worldTitle: 'W' } }));
    attached.receive(
      JSON.stringify({
        type: 'server-request',
        id: 'request-1',
        data: { method: 'ninjos-foundry-mcp.mapService', data: { action: 'status' } },
      })
    );
    await settle();
    expect(seen).toEqual([['mapService', { action: 'status' }, 'active', 'W']]);
    expect(peer.sent[1]).toEqual({
      type: 'server-response',
      id: 'request-1',
      data: { success: true, data: { state: 'running' } },
    });
  });

  it('sends the code a handler threw, SERVER_ERROR without one, and null for no result', async () => {
    const peer = fakePeer();
    const attached = bridge.attach(peer);
    bridge.setRequestHandler(async method => {
      if (method === 'coded')
        throw Object.assign(new Error('switched off'), { code: 'NOT_AVAILABLE' });
      if (method === 'plain') throw new Error('broken');
      return undefined;
    });
    for (const [id, method] of [
      ['r1', 'coded'],
      ['r2', 'plain'],
      ['r3', 'empty'],
    ] as const)
      attached.receive(JSON.stringify({ type: 'server-request', id, data: { method } }));
    await settle();
    expect(peer.sent).toEqual([
      {
        type: 'server-response',
        id: 'r1',
        data: { success: false, error: 'switched off', code: 'NOT_AVAILABLE' },
      },
      {
        type: 'server-response',
        id: 'r2',
        data: { success: false, error: 'broken', code: 'SERVER_ERROR' },
      },
      { type: 'server-response', id: 'r3', data: { success: true, data: null } },
    ]);
  });

  it('answers UNKNOWN_REQUEST without a handler', async () => {
    const peer = fakePeer();
    bridge
      .attach(peer)
      .receive(JSON.stringify({ type: 'server-request', id: 'r', data: { method: 'x' } }));
    await settle();
    expect(peer.sent[0]).toMatchObject({ data: { success: false, code: 'UNKNOWN_REQUEST' } });
  });

  it('drops the answer when the connection is gone meanwhile', async () => {
    let finish: (value: unknown) => void = () => undefined;
    bridge.setRequestHandler(() => new Promise(resolve => (finish = resolve)));
    const peer = fakePeer();
    const attached = bridge.attach(peer);
    attached.receive(JSON.stringify({ type: 'server-request', id: 'r', data: { method: 'slow' } }));
    attached.detach();
    finish('late');
    await settle();
    expect(peer.sent).toEqual([]);
  });
});

describe('FoundryBridge connection events', () => {
  it('reports connect, hello and disconnect with the role and whether a module is left', () => {
    const events: BridgeConnectionEvent[] = [];
    bridge.onConnectionEvent(event => events.push(event));
    bridge.onConnectionEvent(() => {
      throw new Error('a broken listener');
    });
    const first = bridge.attach(fakePeer('first'));
    first.receive(
      JSON.stringify({ type: 'hello', data: { protocol: 2, worldTitle: 'A', userName: 'GM' } })
    );
    const second = bridge.attach(fakePeer('second'));
    second.detach();
    first.detach();

    expect(
      events.map(e => [e.type, e.connection.id, e.connection.role, e.moduleConnected])
    ).toEqual([
      ['connected', 'conn-1', 'active', true],
      ['introduced', 'conn-1', 'active', true],
      ['connected', 'conn-2', 'active', true],
      ['disconnected', 'conn-2', 'active', true],
      ['disconnected', 'conn-1', 'active', false],
    ]);
    expect(events[1]?.connection).toMatchObject({ world: 'A', user: 'GM', protocol: 2 });
    expect(events[0]?.connection.protocol).toBe(1);
  });
});
