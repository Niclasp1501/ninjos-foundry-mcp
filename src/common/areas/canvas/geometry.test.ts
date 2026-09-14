import { describe, expect, it } from 'vitest';
import {
  crossing,
  findGridPath,
  measureWaypoints,
  squareCost,
  wallsOnLine,
  type WallLike,
} from './geometry.js';

const wall = (id: string, c: number[], extra: Partial<WallLike> = {}): WallLike => ({
  id,
  c,
  ...extra,
});

describe('walls on a line', () => {
  it('finds a crossing and ignores touching the start', () => {
    expect(
      crossing({ x: 0, y: 50 }, { x: 100, y: 50 }, { x: 50, y: 0 }, { x: 50, y: 100 })
    ).toMatchObject({ t: 0.5 });
    expect(
      crossing({ x: 50, y: 50 }, { x: 100, y: 50 }, { x: 50, y: 0 }, { x: 50, y: 100 })
    ).toBeNull();
    expect(
      crossing({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 10 }, { x: 100, y: 10 })
    ).toBeNull();
  });

  it('lets open doors through and blocks closed, locked and secret ones', () => {
    const line = (door: Partial<WallLike>) =>
      wallsOnLine(
        { x: 0, y: 50 },
        { x: 100, y: 50 },
        [wall('d', [50, 0, 50, 100], door)],
        'move',
        20
      ).blocked;
    expect(line({ door: 1, ds: 1 })).toBe(false);
    expect(line({ door: 1, ds: 0 })).toBe(true);
    expect(line({ door: 1, ds: 2 })).toBe(true);
    expect(line({ door: 2, ds: 0 })).toBe(true);
    expect(line({ move: 0 })).toBe(false);
  });

  it('ignores a one-way wall from the side it names', () => {
    const oneWay = [wall('w', [0, 0, 100, 0], { dir: 1 })];
    expect(wallsOnLine({ x: 50, y: 50 }, { x: 50, y: -50 }, oneWay, 'sight', 20).blocked).toBe(
      false
    );
    expect(wallsOnLine({ x: 50, y: -50 }, { x: 50, y: 50 }, oneWay, 'sight', 20).blocked).toBe(
      true
    );
  });

  it('needs two limited walls to block sight, and none for movement', () => {
    const limited = [
      wall('a', [50, 0, 50, 100], { sight: 10, move: 20 }),
      wall('b', [80, 0, 80, 100], { sight: 10 }),
    ];
    const one = wallsOnLine({ x: 0, y: 50 }, { x: 60, y: 50 }, limited, 'sight', 20);
    expect(one).toMatchObject({
      blocked: false,
      hits: [{ id: 'a', restriction: 'limited', blocks: false }],
    });
    const two = wallsOnLine({ x: 0, y: 50 }, { x: 100, y: 50 }, limited, 'sight', 20);
    expect(two.blocked).toBe(true);
    expect(two.hits.map(hit => hit.id)).toEqual(['a', 'b']);
    expect(wallsOnLine({ x: 0, y: 50 }, { x: 60, y: 50 }, limited, 'move', 20).blocked).toBe(true);
  });

  it('lets a proximity wall pass sources within its threshold', () => {
    const proximity = [wall('p', [500, 0, 500, 1000], { sight: 30, threshold: { sight: 10 } })];
    expect(
      wallsOnLine({ x: 400, y: 500 }, { x: 600, y: 500 }, proximity, 'sight', 20).blocked
    ).toBe(false);
    expect(
      wallsOnLine({ x: 100, y: 500 }, { x: 600, y: 500 }, proximity, 'sight', 20).blocked
    ).toBe(true);
    const reverse = [wall('r', [500, 0, 500, 1000], { sight: 40, threshold: { sight: 10 } })];
    expect(wallsOnLine({ x: 400, y: 500 }, { x: 600, y: 500 }, reverse, 'sight', 20).blocked).toBe(
      true
    );
    expect(wallsOnLine({ x: 100, y: 500 }, { x: 600, y: 500 }, reverse, 'sight', 20).blocked).toBe(
      false
    );
  });
});

describe('measuring', () => {
  it('follows every diagonal rule of a square grid', () => {
    expect(squareCost(3, 3, 0).cost).toBe(3);
    expect(squareCost(3, 3, 1).cost).toBeCloseTo(3 * Math.SQRT2);
    expect(squareCost(3, 3, 2).cost).toBe(4.5);
    expect(squareCost(3, 3, 3).cost).toBe(6);
    expect(squareCost(3, 3, 4).cost).toBe(4);
    expect(squareCost(3, 3, 5).cost).toBe(5);
    expect(squareCost(1, 1, 4, 1).cost).toBe(2);
  });

  it('measures square, gridless and refuses hexagonal grids', () => {
    const square = { type: 1, size: 100, distance: 5, units: 'ft' };
    expect(
      measureWaypoints(
        [
          { x: 150, y: 150 },
          { x: 550, y: 150 },
        ],
        square,
        0
      )
    ).toEqual({
      distance: 20,
      spaces: 4,
      pixels: 400,
    });
    expect(
      measureWaypoints(
        [
          { x: 150, y: 150 },
          { x: 350, y: 350 },
          { x: 550, y: 550 },
        ],
        square,
        4
      ).distance
    ).toBe(30);
    expect(
      measureWaypoints(
        [
          { x: 0, y: 0 },
          { x: 300, y: 400 },
        ],
        { ...square, type: 0 },
        0
      )
    ).toEqual({
      distance: 25,
      spaces: null,
      pixels: 500,
    });
    expect(() =>
      measureWaypoints(
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        { ...square, type: 2 },
        0
      )
    ).toThrow(/hexagonal/);
  });
});

describe('path finding', () => {
  const walls = [wall('w', [300, 0, 300, 600])];
  const request = {
    size: 100,
    bounds: { x: 0, y: 0, width: 1000, height: 1000 },
    rule: 0,
    blocked: (a: { x: number; y: number }, b: { x: number; y: number }) =>
      wallsOnLine(a, b, walls, 'move', 20).blocked,
    maxNodes: 10_000,
  };

  it('goes around a wall and only turns where it has to', () => {
    const result = findGridPath({
      ...request,
      start: { x: 150, y: 150 },
      goal: { x: 550, y: 150 },
    });
    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.waypoints[0]).toEqual({ x: 150, y: 150 });
    expect(result.waypoints.at(-1)).toEqual({ x: 550, y: 150 });
    for (let index = 1; index < result.waypoints.length; index += 1) {
      expect(request.blocked(result.waypoints[index - 1]!, result.waypoints[index]!)).toBe(false);
    }
    expect(result.waypoints.some(point => point.y > 600)).toBe(true);
  });

  it('says unreachable, outside or limit', () => {
    const closed = {
      ...request,
      blocked: (a: { x: number }, b: { x: number }) => a.x < 300 !== b.x < 300,
    };
    expect(
      findGridPath({ ...closed, start: { x: 150, y: 150 }, goal: { x: 550, y: 150 } })
    ).toMatchObject({
      found: false,
      reason: 'unreachable',
    });
    expect(
      findGridPath({ ...request, start: { x: 150, y: 150 }, goal: { x: 5000, y: 150 } })
    ).toMatchObject({
      found: false,
      reason: 'outside',
    });
    expect(
      findGridPath({ ...request, maxNodes: 3, start: { x: 150, y: 150 }, goal: { x: 550, y: 150 } })
    ).toMatchObject({ found: false, reason: 'limit' });
  });
});
