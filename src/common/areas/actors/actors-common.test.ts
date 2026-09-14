import { describe, expect, it } from 'vitest';
import { levelName, levelNumber, phrase } from './ownership.js';
import { tokenPositions } from './placement.js';
import { CIRCULAR, MAX_DEPTH, TOO_DEEP, plainText, sanitize } from './sanitize.js';

describe('sanitize', () => {
  it('drops credentials and internal keys but keeps game data called save, key or token', () => {
    const clean = sanitize({
      _id: 'a1',
      _stats: { createdTime: 1 },
      apiKey: 'sk-123',
      password: 'hunter2',
      session_id: 42,
      system: {
        activities: { x: { save: { ability: ['dex'], dc: { value: 13 } } } },
        key: 'fire',
        token: { width: 2 },
        advancement: [{ type: 'HitPoints' }],
      },
      run: () => 1,
    });
    expect(clean).toEqual({
      _id: 'a1',
      system: {
        activities: { x: { save: { ability: ['dex'], dc: { value: 13 } } } },
        key: 'fire',
        token: { width: 2 },
        advancement: [{ type: 'HitPoints' }],
      },
    });
  });

  it('marks cycles and depth, and copies shared objects', () => {
    const shared = { a: 1 };
    const cyclic: Record<string, unknown> = { shared, again: shared };
    cyclic['self'] = cyclic;
    expect(sanitize(cyclic)).toEqual({ shared: { a: 1 }, again: { a: 1 }, self: CIRCULAR });

    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let i = 0; i < MAX_DEPTH + 5; i += 1) {
      const next = {};
      deep['n'] = next;
      deep = next;
    }
    expect(JSON.stringify(sanitize(root))).toContain(TOO_DEEP);
  });

  it('turns markup into short plain text', () => {
    expect(plainText('<p>Fire&nbsp;<b>bolt</b></p>', 6)).toBe('Fire b...');
  });
});

describe('ownership levels', () => {
  it('reads names and numbers', () => {
    expect(levelNumber('observer')).toBe(2);
    expect(levelNumber(3)).toBe(3);
    expect(levelNumber('ADMIN')).toBeNull();
    expect(levelName(1)).toBe('LIMITED');
    expect(phrase('  All   Friendly NPCs ')).toBe('all friendly npcs');
  });
});

describe('token positions', () => {
  const rect = { x: 200, y: 200, width: 1000, height: 800, grid: 100 };

  it('lays out a grid without two tokens on one cell, inside the scene', () => {
    const points = tokenPositions('grid', 9, rect);
    expect(new Set(points.map(p => `${p.x},${p.y}`)).size).toBe(9);
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(200);
      expect(p.x).toBeLessThanOrEqual(1100);
      expect((p.x - 200) % 100).toBe(0);
    }
  });

  it('keeps random cells distinct and refuses too few coordinates', () => {
    const points = tokenPositions('random', 5, rect, { random: () => 0 });
    expect(new Set(points.map(p => `${p.x},${p.y}`)).size).toBe(5);
    expect(() => tokenPositions('coordinates', 2, rect, { coordinates: [{ x: 1, y: 1 }] })).toThrow(
      /one point per token: 2 token\(s\), 1 point/
    );
    expect(tokenPositions('coordinates', 1, rect, { coordinates: [{ x: 5000, y: 0 }] })).toEqual([
      { x: 1100, y: 200 },
    ]);
  });
});
