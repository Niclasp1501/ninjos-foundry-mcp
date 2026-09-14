import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { silentLogger } from '../logger.js';
import { BridgeError, FoundryBridge, type BridgePeer } from './foundry-bridge.js';

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

let bridge: FoundryBridge;

beforeEach(() => {
  bridge = new FoundryBridge({
    serverVersion: '1.0.0',
    logger: silentLogger,
    defaultTimeoutMs: 1000,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('FoundryBridge queries', () => {
  it('fails at once without a module', async () => {
    await expect(bridge.query('getWorldInfo')).rejects.toMatchObject({
      code: 'NOT_CONNECTED',
      message: 'Foundry VTT module not connected',
    });
  });

  it('sends the query in the documented form and resolves with the answer', async () => {
    const peer = fakePeer();
    const attached = bridge.attach(peer);
    const result = bridge.query('getWorldInfo', { a: 1 });
    expect(peer.sent[0]).toEqual({
      type: 'mcp-query',
      id: 'query-1',
      data: { method: 'ninjos-foundry-mcp.getWorldInfo', data: { a: 1 } },
    });
    attached.receive(
      JSON.stringify({ type: 'mcp-response', id: 'query-1', data: { success: true, data: 42 } })
    );
    await expect(result).resolves.toBe(42);
  });

  it('turns a failed answer into an error that keeps the cause', async () => {
    const peer = fakePeer();
    const attached = bridge.attach(peer);
    const result = bridge.query('x');
    attached.receive(
      JSON.stringify({
        type: 'mcp-response',
        id: 'query-1',
        data: { success: false, error: 'No handler found for query: x' },
      })
    );
    await expect(result).rejects.toMatchObject({
      code: 'MODULE_ERROR',
      message: 'No handler found for query: x',
    });
  });

  it('reports a timeout as silence, not as failed work', async () => {
    vi.useFakeTimers();
    bridge.attach(fakePeer());
    const result = bridge.query('exportToCompendium', {}, { timeoutMs: 500 });
    vi.advanceTimersByTime(501);
    await expect(result).rejects.toSatisfy(
      (error: BridgeError) =>
        error.code === 'TIMEOUT' && /does NOT mean the work failed/.test(error.message)
    );
  });

  it('restarts the time limit with every progress message', async () => {
    vi.useFakeTimers();
    const attached = bridge.attach(fakePeer());
    const seen: number[] = [];
    const result = bridge.query(
      'exportToCompendium',
      {},
      { timeoutMs: 500, onProgress: p => seen.push(p.progress) }
    );
    for (let step = 1; step <= 4; step += 1) {
      vi.advanceTimersByTime(400);
      attached.receive(
        JSON.stringify({ type: 'mcp-progress', id: 'query-1', data: { progress: step, total: 4 } })
      );
    }
    attached.receive(
      JSON.stringify({ type: 'mcp-response', id: 'query-1', data: { success: true, data: 'done' } })
    );
    await expect(result).resolves.toBe('done');
    expect(seen).toEqual([1, 2, 3, 4]);
  });

  it('says the work may have finished when the connection drops mid query', async () => {
    const attached = bridge.attach(fakePeer());
    const result = bridge.query('rewriteWorldPaths');
    attached.detach();
    await expect(result).rejects.toSatisfy(
      (error: BridgeError) =>
        error.code === 'CONNECTION_LOST' && /may have finished/.test(error.message)
    );
  });

  it('stops waiting when the client cancels', async () => {
    bridge.attach(fakePeer());
    const controller = new AbortController();
    const result = bridge.query('slow', {}, { signal: controller.signal });
    controller.abort();
    await expect(result).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('answers a ping of the module with a pong', () => {
    const peer = fakePeer();
    bridge.attach(peer).receive('{"type":"ping","id":"beat-1","timestamp":1}');
    expect(peer.sent[0]).toMatchObject({
      type: 'pong',
      id: 'beat-1',
      data: { status: 'ok', timestamp: expect.any(Number) },
    });
  });

  it('treats a connection that never says hello as the module and sends it queries at once', async () => {
    const old = fakePeer('previous module');
    const attached = bridge.attach(old);
    const result = bridge.query('getWorldInfo');
    expect(old.sent).toEqual([
      {
        type: 'mcp-query',
        id: 'query-1',
        data: { method: 'ninjos-foundry-mcp.getWorldInfo', data: {} },
      },
    ]);
    attached.receive(
      JSON.stringify({ type: 'mcp-response', id: 'query-1', data: { success: true, data: 1 } })
    );
    await expect(result).resolves.toBe(1);
  });
});

describe('FoundryBridge with several connections', () => {
  it('treats the newest connection as the module and keeps older ones on standby', async () => {
    const first = fakePeer('first');
    const second = fakePeer('second');
    const a = bridge.attach(first);
    a.receive(JSON.stringify({ type: 'hello', data: { protocol: 2, worldTitle: 'World A' } }));
    const b = bridge.attach(second);

    expect(first.sent.map(m => m['type'])).toEqual(['welcome', 'bridge-role']);
    expect(first.sent[1]).toMatchObject({ data: { role: 'standby' } });

    const pending = bridge.query('getWorldInfo').catch((error: BridgeError) => error.code);
    expect(second.sent[0]?.['type']).toBe('mcp-query');
    expect(first.sent).toHaveLength(2);

    b.detach();
    await expect(pending).resolves.toBe('CONNECTION_LOST');
    expect(first.sent[2]).toMatchObject({ type: 'bridge-role', data: { role: 'active' } });
    expect(bridge.status().connections).toMatchObject([{ role: 'active', world: 'World A' }]);
  });

  it('never sends generation 2 messages to a module that did not say hello', () => {
    const old = fakePeer('old');
    bridge.attach(old);
    bridge.attach(fakePeer('new'));
    expect(old.sent).toEqual([]);
  });

  it('lets a waiting call continue as soon as a module connects', async () => {
    const waiting = bridge.waitForModule(1000);
    bridge.attach(fakePeer());
    await expect(waiting).resolves.toBe(true);
    await expect(
      new FoundryBridge({
        serverVersion: '1',
        logger: silentLogger,
        defaultTimeoutMs: 1,
      }).waitForModule(10)
    ).resolves.toBe(false);
  });
});
