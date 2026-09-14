import { afterEach, describe, expect, it } from 'vitest';
import { areaLogger, scopedLogger, setAreaLogTarget, silentLogger, type Logger } from './logger.js';

function recording(lines: string[]): Logger {
  const write = (level: string) => (message: string, meta?: unknown) =>
    void lines.push(`${level} ${message}${meta === undefined ? '' : ` ${JSON.stringify(meta)}`}`);
  return { debug: write('debug'), info: write('info'), warn: write('warn'), error: write('error') };
}

afterEach(() => {
  setAreaLogTarget(silentLogger);
});

describe('loggers for areas', () => {
  it('puts the scope in front of every line and keeps the details', () => {
    const lines: string[] = [];
    const log = scopedLogger(recording(lines), 'area:maps');
    log.warn('ComfyUI is slow', { seconds: 90 });
    log.error('failed');
    expect(lines).toEqual([
      'warn [area:maps] ComfyUI is slow {"seconds":90}',
      'error [area:maps] failed',
    ]);
  });

  it('writes nowhere before the backend runs and into its log from then on, even when taken at import', () => {
    const early = areaLogger('maps');
    early.info('before the backend');
    const lines: string[] = [];
    const previous = setAreaLogTarget(recording(lines));
    early.info('after the backend started');
    expect(previous).toBe(silentLogger);
    expect(lines).toEqual(['info [area:maps] after the backend started']);
  });
});
