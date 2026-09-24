import { afterEach, describe, expect, it } from 'vitest';
import { requestServer, serverRequestsAvailable } from '../module/core-services.js';
import { isServerTooOld } from '../module/server-requests.js';
import type { ServerArea } from '../server/tools/areas.js';
import { ServerRequestError } from '../server/tools/requests.js';
import { createAreaHarness, type AreaHarness } from './area-harness.js';

let harness: AreaHarness | null = null;
afterEach(() => {
  harness?.close();
  harness = null;
});

describe('area harness with requests to the server', () => {
  it('carries requestServer of an area to the handler of its server area, through JSON', async () => {
    const calls: string[] = [];
    const sample: ServerArea = {
      id: 'sample',
      requests: [
        {
          names: 'sampleService',
          run: data => {
            const action = (data as { action?: unknown }).action;
            if (action === 'off')
              throw new ServerRequestError('NOT_AVAILABLE', 'switched off on the server');
            return { action, at: new Date(0) };
          },
        },
      ],
      start: context => void calls.push(`start ${context.config.imagesEnabled}`),
      stop: () => void calls.push('stop'),
      onModuleConnection: event => void calls.push(event.type),
    };
    harness = createAreaHarness({ moduleAreas: [], serverAreas: [sample] });

    expect(serverRequestsAvailable()).toBe(true);
    await expect(requestServer('sampleService', { action: 'status' })).resolves.toEqual({
      action: 'status',
      at: '1970-01-01T00:00:00.000Z',
    });
    await expect(requestServer('sampleService', { action: 'off' })).rejects.toMatchObject({
      code: 'NOT_AVAILABLE',
      message: 'switched off on the server',
    });
    await expect(harness.request('unknownThing')).rejects.toSatisfy(isServerTooOld);

    await harness.startServerAreas();
    harness.moduleConnection('connected');
    await harness.stopServerAreas();
    expect(calls).toEqual(['start true', 'connected', 'stop']);
  });

  it('gives requestServer back its previous state when closed', async () => {
    harness = createAreaHarness({ moduleAreas: [], serverAreas: [] });
    harness.close();
    harness = null;
    expect(serverRequestsAvailable()).toBe(false);
    await expect(requestServer('anything')).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
  });
});
