import { describe, expect, it } from 'vitest';
import { detectedFromWorldInfo, SystemDetector, systemIdFrom } from './system-detection.js';

describe('detectedFromWorldInfo', () => {
  it('reads the raw form and the prepared form of the world info', () => {
    expect(
      detectedFromWorldInfo({
        id: 'w1',
        system: 'Homebrew',
        systemVersion: '1.2',
        foundryVersion: '14.350',
      })
    ).toEqual({
      id: 'homebrew',
      rawId: 'Homebrew',
      version: '1.2',
      foundryVersion: '14.350',
      worldId: 'w1',
      source: 'module',
      problem: null,
    });
    expect(
      detectedFromWorldInfo({
        world: { id: 'w2' },
        system: { id: 'other', version: '3' },
        foundry: { version: '13' },
      })
    ).toMatchObject({ id: 'other', version: '3', foundryVersion: '13', worldId: 'w2' });
    expect(detectedFromWorldInfo({ system: '' })).toBeNull();
    expect(systemIdFrom({ id: ' x ' })).toBe('x');
  });
});

describe('SystemDetector', () => {
  it('keeps the first answer, also for a system without adapter', async () => {
    const detector = new SystemDetector();
    let asked = 0;
    const fetch = async () => {
      asked += 1;
      return { system: 'homebrew' };
    };
    await detector.detect(fetch);
    await detector.detect(fetch);
    expect(asked).toBe(1);
    expect(detector.cached()?.id).toBe('homebrew');
  });

  it('does not keep a failure and asks again next time', async () => {
    const detector = new SystemDetector();
    const failed = await detector.detect(async () => {
      throw new Error('Foundry VTT module not connected');
    });
    expect(failed).toMatchObject({ id: 'unknown', source: 'unavailable' });
    expect(failed.problem).toContain('not connected');
    expect(detector.cached()).toBeNull();
    expect((await detector.detect(async () => ({ system: 'x' }))).id).toBe('x');
    expect((await detector.detect(async () => ({ nothing: true }))).id).toBe('x');
  });

  it('forgets the answer on invalidate, also one still under way', async () => {
    const detector = new SystemDetector();
    await detector.detect(async () => ({ system: 'first' }));
    detector.invalidate();
    let release: (value: unknown) => void = () => undefined;
    const slow = detector.detect(() => new Promise(resolve => (release = resolve)));
    detector.invalidate();
    release({ system: 'stale' });
    expect((await slow).id).toBe('stale');
    expect(detector.cached()).toBeNull();
    expect((await detector.detect(async () => ({ system: 'second' }))).id).toBe('second');
  });

  it('shares one question between concurrent calls', async () => {
    const detector = new SystemDetector();
    let asked = 0;
    const fetch = async () => {
      asked += 1;
      return { system: 'x' };
    };
    await Promise.all([detector.detect(fetch), detector.detect(fetch)]);
    expect(asked).toBe(1);
  });
});
