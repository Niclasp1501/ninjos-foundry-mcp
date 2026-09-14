import { describe, expect, it } from 'vitest';
import { silentLogger, type Logger } from '../logger.js';
import { installServerAreas, type ServerArea } from './areas.js';
import { PromptRegistry, ResourceRegistry } from './resources.js';
import { ServerRequestError, ServerRequestRegistry } from './requests.js';

const connection = { id: 'conn-1', role: 'active' as const, protocol: 2 };

const targets = (requests?: ServerRequestRegistry) => ({
  tools: { register: () => undefined },
  resources: new ResourceRegistry(),
  prompts: new PromptRegistry(),
  ...(requests ? { requests } : {}),
});

describe('ServerRequestRegistry', () => {
  it('runs the handler of a name with the logger of its area', async () => {
    const loggers: string[] = [];
    const registry = new ServerRequestRegistry(area => {
      loggers.push(area);
      return silentLogger as Logger;
    });
    registry.register(
      {
        names: ['mapService', 'mapServiceLegacy'],
        run: (data, context) => ({ data, from: context.connection.id }),
      },
      'maps'
    );
    await expect(
      registry.handle('mapServiceLegacy', { action: 'stop' }, connection)
    ).resolves.toEqual({
      data: { action: 'stop' },
      from: 'conn-1',
    });
    expect(loggers).toEqual(['maps']);
    expect(registry.names()).toEqual(['mapService', 'mapServiceLegacy']);
  });

  it('fails an unknown name with UNKNOWN_REQUEST and says the server is older', async () => {
    const registry = new ServerRequestRegistry(() => silentLogger);
    await expect(registry.handle('nothing', {}, connection)).rejects.toSatisfy(
      (error: ServerRequestError) =>
        error.code === 'UNKNOWN_REQUEST' && /older than the Foundry module/.test(error.message)
    );
  });

  it('refuses a name twice with both areas named', () => {
    const registry = new ServerRequestRegistry(() => silentLogger);
    registry.register({ names: 'x', run: () => 1 }, 'maps');
    expect(() => registry.register({ names: 'x', run: () => 2 }, 'canvas')).toThrow(
      'The server request "x" of area "canvas" is already registered by area "maps"'
    );
  });
});

describe('installServerAreas with requests', () => {
  it('registers the requests of an area and names both owners of a conflict, even without a target', () => {
    const registry = new ServerRequestRegistry(() => silentLogger);
    installServerAreas(
      [{ id: 'maps', requests: [{ names: 'mapService', run: () => 1 }] }],
      targets(registry)
    );
    expect(registry.has('mapService')).toBe(true);

    const clash: ServerArea[] = [
      { id: 'maps', requests: [{ names: 'x', run: () => 1 }] },
      { id: 'canvas', requests: [{ names: ['y', 'x'], run: () => 2 }] },
    ];
    expect(() => installServerAreas(clash, targets())).toThrow(
      'The server request "x" of area "canvas" is already registered by area "maps"'
    );
  });
});
