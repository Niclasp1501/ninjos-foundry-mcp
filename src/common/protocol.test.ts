import { describe, expect, it } from 'vitest';
import { fullQueryName, shortQueryName } from './constants.js';
import { describeUnknownError, parseBridgeMessage, pongFor } from './protocol.js';

describe('parseBridgeMessage', () => {
  it('reads a query as the previous server sends it', () => {
    const raw = JSON.stringify({
      type: 'mcp-query',
      id: 'query-1',
      data: { method: 'ninjos-foundry-mcp.getWorldInfo', data: {} },
    });
    expect(parseBridgeMessage(raw)).toEqual({
      type: 'mcp-query',
      id: 'query-1',
      data: { method: 'ninjos-foundry-mcp.getWorldInfo', data: {} },
    });
  });

  it('reads success and failure responses', () => {
    expect(
      parseBridgeMessage(
        JSON.stringify({ type: 'mcp-response', id: 'q', data: { success: true, data: 5 } })
      )
    ).toEqual({ type: 'mcp-response', id: 'q', data: { success: true, data: 5 } });
    expect(
      parseBridgeMessage(
        JSON.stringify({
          type: 'mcp-response',
          id: 'q',
          data: { success: false, error: 'nope', code: 'X' },
        })
      )
    ).toEqual({
      type: 'mcp-response',
      id: 'q',
      data: { success: false, error: 'nope', code: 'X' },
    });
  });

  it('never loses the reason of a failure, even when it is not a string', () => {
    const parsed = parseBridgeMessage(
      JSON.stringify({
        type: 'mcp-response',
        id: 'q',
        data: { success: false, error: { message: 'deep' } },
      })
    );
    expect(parsed).toEqual({
      type: 'mcp-response',
      id: 'q',
      data: { success: false, error: 'deep' },
    });
  });

  it('accepts a ping with the timestamp on top or inside data', () => {
    expect(parseBridgeMessage('{"type":"ping","timestamp":7}')).toEqual({
      type: 'ping',
      timestamp: 7,
    });
    expect(parseBridgeMessage('{"type":"pong","data":{"timestamp":8}}')).toEqual({
      type: 'pong',
      timestamp: 8,
    });
    expect(parseBridgeMessage('{"type":"ping"}')).toEqual({ type: 'ping' });
  });

  it('reads the pong of the previous module and answers pings in a shape both generations read', () => {
    expect(
      parseBridgeMessage(
        JSON.stringify({ type: 'pong', id: 'p1', data: { timestamp: 9, status: 'ok' } })
      )
    ).toEqual({ type: 'pong', id: 'p1', timestamp: 9 });
    expect(pongFor({ type: 'ping', id: 'p2' }, 5)).toEqual({
      type: 'pong',
      id: 'p2',
      timestamp: 5,
      data: { timestamp: 5, status: 'ok' },
    });
    expect(pongFor({ type: 'ping' }, 5)).not.toHaveProperty('id');
  });

  it('reads generation 2 messages', () => {
    expect(
      parseBridgeMessage(
        JSON.stringify({ type: 'hello', data: { protocol: 2, worldId: 'w', extra: 1 } })
      )
    ).toEqual({ type: 'hello', data: { protocol: 2, worldId: 'w' } });
    expect(
      parseBridgeMessage(
        JSON.stringify({ type: 'mcp-progress', id: 'q', data: { progress: 3, total: 9 } })
      )
    ).toEqual({ type: 'mcp-progress', id: 'q', data: { progress: 3, total: 9 } });
    expect(
      parseBridgeMessage(JSON.stringify({ type: 'bridge-role', data: { role: 'standby' } }))
    ).toEqual({
      type: 'bridge-role',
      data: { role: 'standby' },
    });
  });

  it('refuses malformed frames and unknown types', () => {
    expect(parseBridgeMessage('not json')).toBeNull();
    expect(parseBridgeMessage('[]')).toBeNull();
    expect(parseBridgeMessage('{"type":"mcp-query","id":1,"data":{}}')).toBeNull();
    expect(parseBridgeMessage('{"type":"webrtc-offer"}')).toBeNull();
  });
});

describe('query names', () => {
  it('adds and removes the module prefix exactly once', () => {
    expect(fullQueryName('getWorldInfo')).toBe('ninjos-foundry-mcp.getWorldInfo');
    expect(fullQueryName('ninjos-foundry-mcp.getWorldInfo')).toBe(
      'ninjos-foundry-mcp.getWorldInfo'
    );
    expect(shortQueryName('ninjos-foundry-mcp.list-scenes')).toBe('list-scenes');
  });
});

it('describes unknown errors without inventing a cause', () => {
  expect(describeUnknownError(undefined)).toMatch(/no reason/);
  expect(describeUnknownError(new Error('boom'))).toBe('boom');
});
