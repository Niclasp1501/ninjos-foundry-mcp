import { afterEach, describe, expect, it } from 'vitest';
import { requestServer, serverRequestsAvailable, useServerRequests } from './core-services.js';
import { serverRequestTimeout } from './server-requests.js';

afterEach(() => {
  useServerRequests(null);
});

describe('requestServer', () => {
  it('refuses with NOT_CONNECTED while no bridge runs in this browser', async () => {
    expect(serverRequestsAvailable()).toBe(false);
    await expect(requestServer('mapService')).rejects.toMatchObject({
      code: 'NOT_CONNECTED',
      message: expect.stringMatching(/Only a Gamemaster's browser connects/),
    });
  });

  it('goes through the channel main.ts puts in place', async () => {
    const sent: unknown[] = [];
    useServerRequests({
      request: async (method, data, options) => {
        sent.push([method, data, options]);
        return 'ok';
      },
      available: () => true,
    });
    await expect(
      requestServer('mapService', { action: 'stop' }, { timeoutMs: 20_000 })
    ).resolves.toBe('ok');
    expect(sent).toEqual([['mapService', { action: 'stop' }, { timeoutMs: 20_000 }]]);
    expect(serverRequestsAvailable()).toBe(true);
  });

  it('bounds the time limit between a default and ten minutes', () => {
    expect(serverRequestTimeout()).toBe(15_000);
    expect(serverRequestTimeout({ timeoutMs: -1 })).toBe(15_000);
    expect(serverRequestTimeout({ timeoutMs: 150_000 })).toBe(150_000);
    expect(serverRequestTimeout({ timeoutMs: 3_600_000 })).toBe(600_000);
  });
});
