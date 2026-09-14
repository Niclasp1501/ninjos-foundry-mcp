import { describe, expect, it } from 'vitest';
import { BRIDGE_FEATURE, parseBridgeMessage } from './protocol.js';

describe('requests from the module to the server', () => {
  it('reads a request and both kinds of answer', () => {
    expect(
      parseBridgeMessage(
        JSON.stringify({
          type: 'server-request',
          id: 'request-1',
          data: { method: 'x', data: { a: 1 } },
        })
      )
    ).toEqual({ type: 'server-request', id: 'request-1', data: { method: 'x', data: { a: 1 } } });
    expect(
      parseBridgeMessage(
        JSON.stringify({
          type: 'server-response',
          id: 'request-1',
          data: { success: true, data: 2 },
        })
      )
    ).toEqual({ type: 'server-response', id: 'request-1', data: { success: true, data: 2 } });
    expect(
      parseBridgeMessage(
        JSON.stringify({
          type: 'server-response',
          id: 'request-1',
          data: { success: false, error: 'no', code: 'UNKNOWN_REQUEST' },
        })
      )
    ).toEqual({
      type: 'server-response',
      id: 'request-1',
      data: { success: false, error: 'no', code: 'UNKNOWN_REQUEST' },
    });
  });

  it('drops a request without id or method', () => {
    expect(parseBridgeMessage('{"type":"server-request","data":{"method":"x"}}')).toBeNull();
    expect(parseBridgeMessage('{"type":"server-request","id":"r","data":{}}')).toBeNull();
  });

  it('reads the features of welcome and keeps an older welcome without them', () => {
    expect(
      parseBridgeMessage(
        JSON.stringify({
          type: 'welcome',
          data: { protocol: 2, role: 'active', features: [BRIDGE_FEATURE.serverRequests, 7] },
        })
      )
    ).toMatchObject({ data: { features: ['server-requests'] } });
    const older = parseBridgeMessage(JSON.stringify({ type: 'welcome', data: { protocol: 2 } }));
    expect(older?.type === 'welcome' && older.data.features).toBeUndefined();
  });
});
