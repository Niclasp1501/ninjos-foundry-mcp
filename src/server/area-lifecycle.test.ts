import { describe, expect, it } from 'vitest';
import { AreaLifecycle } from './area-lifecycle.js';
import type { BridgeConnectionEvent } from './bridge/foundry-bridge.js';
import { readConfig } from './config.js';
import type { Logger } from './logger.js';
import type { ServerArea } from './tools/areas.js';

function recordingLogger(lines: string[]): Logger {
  const write = (level: string) => (message: string) => void lines.push(`${level} ${message}`);
  return { debug: write('debug'), info: write('info'), warn: write('warn'), error: write('error') };
}

function lifecycle(areas: ServerArea[], lines: string[] = [], stopTimeoutMs = 1000) {
  return new AreaLifecycle({
    areas,
    logger: recordingLogger(lines),
    config: readConfig({}).config,
    env: { SOME_VARIABLE: 'x' },
    query: async name => `answer to ${name}`,
    isModuleConnected: () => false,
    stopTimeoutMs,
  });
}

const event = (type: BridgeConnectionEvent['type']): BridgeConnectionEvent => ({
  type,
  connection: { id: 'conn-1', role: 'active', transport: 'websocket', protocol: 2 },
  moduleConnected: type !== 'disconnected',
});

describe('AreaLifecycle', () => {
  it('starts every area with its context and stops them in reverse order', async () => {
    const calls: string[] = [];
    const area = (id: string): ServerArea => ({
      id,
      start: async context => {
        calls.push(`start ${id} ${context.areaId} ${context.env['SOME_VARIABLE']}`);
        calls.push(String(await context.query('getMapSettings')));
        context.logger.info('ready');
      },
      stop: () => void calls.push(`stop ${id}`),
    });
    const lines: string[] = [];
    const areas = lifecycle([area('a'), area('b'), { id: 'c' }], lines);
    await areas.start();
    await areas.stop();
    expect(calls).toEqual([
      'start a a x',
      'start b b x',
      'answer to getMapSettings',
      'answer to getMapSettings',
      'stop b',
      'stop a',
    ]);
    expect(lines).toEqual(['info [area:a] ready', 'info [area:b] ready']);
    expect(areas.state).toBe('stopped');
  });

  it('keeps the other areas going when one fails, and logs the failure with its id', async () => {
    const calls: string[] = [];
    const lines: string[] = [];
    const areas = lifecycle(
      [
        {
          id: 'broken',
          start: () => {
            throw new Error('no python');
          },
          stop: () => void calls.push('stop broken'),
        },
        {
          id: 'fine',
          start: () => void calls.push('start fine'),
          stop: async () => {
            throw new Error('stuck');
          },
        },
      ],
      lines
    );
    await areas.start();
    await areas.stop();
    expect(calls).toEqual(['start fine', 'stop broken']);
    expect(lines).toEqual([
      'error [area:broken] start failed: no python',
      'error [area:fine] stop failed: stuck',
    ]);
  });

  it('gives up on a stop that hangs and ends anyway', async () => {
    const lines: string[] = [];
    const areas = lifecycle(
      [
        {
          id: 'hang',
          start: () => undefined,
          stop: () => new Promise(() => undefined),
        },
      ],
      lines,
      30
    );
    await areas.start();
    await areas.stop();
    expect(lines).toEqual([
      'warn Gave up stopping area "hang" after 30 ms; the backend shuts down anyway',
    ]);
  });

  it('aborts the signal at stop, and runs start and stop only once', async () => {
    let starts = 0;
    let aborted = false;
    const areas = lifecycle([
      {
        id: 'a',
        start: context => {
          starts += 1;
          context.signal.addEventListener('abort', () => (aborted = true));
        },
      },
    ]);
    await Promise.all([areas.start(), areas.start()]);
    await Promise.all([areas.stop(), areas.stop()]);
    await areas.start();
    expect([starts, aborted]).toEqual([1, true]);
  });

  it('hands connection events to the areas only between start and stop', async () => {
    const seen: string[] = [];
    const areas = lifecycle([
      { id: 'maps', onModuleConnection: e => void seen.push(e.type) },
      {
        id: 'broken',
        onModuleConnection: () => {
          throw new Error('x');
        },
      },
    ]);
    areas.connectionEvent(event('connected'));
    await areas.start();
    areas.connectionEvent(event('connected'));
    areas.connectionEvent(event('disconnected'));
    await areas.stop();
    areas.connectionEvent(event('connected'));
    expect(seen).toEqual(['connected', 'disconnected']);
  });

  it('does not call stop of areas that never started', async () => {
    let stopped = false;
    const areas = lifecycle([{ id: 'a', stop: () => void (stopped = true) }]);
    await areas.stop();
    expect(stopped).toBe(false);
  });
});
