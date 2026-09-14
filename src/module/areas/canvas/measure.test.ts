import { afterEach, describe, expect, it } from 'vitest';
import { wallsOnLine } from '../../../common/areas/canvas/geometry.js';
import { openCanvas, type CanvasSetup } from './testing.js';

let setup: CanvasSetup | null = null;
afterEach(() => {
  setup?.harness.close();
  setup = null;
});

async function failure(promise: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await promise;
  } catch (error) {
    return {
      code: String((error as { moduleCode?: unknown }).moduleCode),
      message: (error as Error).message,
    };
  }
  throw new Error('expected a failure');
}

function diagonals(value: number): void {
  const settings = setup!.foundry.game['settings'] as {
    register(namespace: string, key: string, config: Record<string, unknown>): void;
  };
  settings.register('core', 'gridDiagonals', { default: value });
}

describe('measuring', () => {
  it('measures tokens by their centers without a canvas', async () => {
    setup = openCanvas({ board: false });
    expect(
      await setup.harness.query('measureDistance', {
        from: { tokenId: 'Hero' },
        to: { tokenId: 'Goblin' },
      })
    ).toMatchObject({
      distance: 20,
      spaces: 4,
      units: 'ft',
      method: 'geometry',
      grid: { diagonals: 'equidistant' },
    });
  });

  it('follows the diagonal rule of the world and waypoints', async () => {
    setup = openCanvas();
    const diagonal = { from: { x: 150, y: 150 }, to: { x: 450, y: 450 } };
    expect(await setup.harness.query('measureDistance', diagonal)).toMatchObject({ distance: 15 });
    diagonals(2);
    expect(await setup.harness.query('measureDistance', diagonal)).toMatchObject({
      distance: 22.5,
    });
    expect(
      await setup.harness.query('measureDistance', { ...diagonal, via: [{ x: 450, y: 150 }] })
    ).toMatchObject({ distance: 30, spaces: 6 });
  });

  it("prefers Foundry's grid and refuses hexagonal grids without it", async () => {
    setup = openCanvas();
    setup.scene['grid'] = {
      type: 1,
      size: 100,
      distance: 5,
      units: 'ft',
      measurePath: () => ({ distance: 99, spaces: 7 }),
    };
    expect(
      await setup.harness.query('measureDistance', { from: { x: 0, y: 0 }, to: { x: 1, y: 1 } })
    ).toMatchObject({
      distance: 99,
      spaces: 7,
      method: 'foundry',
    });
    setup.scene['grid'] = { type: 2, size: 100, distance: 5, units: 'ft' };
    expect(
      (
        await failure(
          setup.harness.query('measureDistance', { from: { x: 0, y: 0 }, to: { x: 1, y: 1 } })
        )
      ).code
    ).toBe('UNSUPPORTED_GRID');
  });
});

describe('walls', () => {
  it('blocks at a closed door and lets an opened one through', async () => {
    setup = openCanvas();
    const line = { from: { x: 150, y: 500 }, to: { x: 450, y: 500 } };
    expect(await setup.harness.query('checkWallCollision', line)).toMatchObject({
      blocked: true,
      method: 'stored walls',
      walls: [{ id: 'd1', door: 'door', blocks: true }],
    });
    await setup.harness.query('setDoorState', { wallIds: ['d1'], state: 'open' });
    expect(await setup.harness.query('checkWallCollision', line)).toMatchObject({
      blocked: false,
      walls: [],
    });
  });

  it('sees through one window but not movement', async () => {
    setup = openCanvas();
    const through = { from: { x: 650, y: 150 }, to: { x: 750, y: 150 } };
    expect(
      await setup.harness.query('checkWallCollision', { ...through, type: 'sight' })
    ).toMatchObject({
      blocked: false,
      walls: [{ id: 'win', restriction: 'limited' }],
    });
    expect(await setup.harness.query('checkWallCollision', through)).toMatchObject({
      blocked: true,
    });
  });

  it("uses Foundry's test when the canvas shows the scene and names a disagreement", async () => {
    setup = openCanvas();
    setup.foundry.setGlobal('CONFIG', {
      Canvas: { polygonBackends: { move: { testCollision: () => false } } },
    });
    const answer = (await setup.harness.query('checkWallCollision', {
      from: { tokenId: 'Hero' },
      to: { tokenId: 'Goblin' },
    })) as Record<string, unknown>;
    expect(answer).toMatchObject({ blocked: false, method: 'foundry', walls: [{ id: 'w1' }] });
    expect(answer['warnings']).toEqual([expect.stringContaining("Foundry's test says clear")]);
  });
});

describe('paths and range', () => {
  it('finds a way around the wall that never crosses one', async () => {
    setup = openCanvas({ board: false });
    const answer = (await setup.harness.query('findPath', {
      from: { tokenId: 'Hero' },
      to: { tokenId: 'Goblin' },
    })) as {
      method: string;
      waypoints: Array<{ x: number; y: number }>;
      distance: number;
    };
    expect(answer.method).toBe('grid search');
    expect(answer.waypoints[0]).toEqual({ x: 150, y: 150 });
    expect(answer.waypoints.at(-1)).toEqual({ x: 550, y: 150 });
    const walls = setup.scene
      .getEmbeddedCollection('Wall')
      .map(w => ({ ...w.toObject(), id: w.id }) as never);
    for (let index = 1; index < answer.waypoints.length; index += 1) {
      expect(
        wallsOnLine(answer.waypoints[index - 1]!, answer.waypoints[index]!, walls, 'move', 20)
          .blocked
      ).toBe(false);
    }
    expect(answer.distance).toBeGreaterThan(20);
    expect(
      await setup.harness.query('findPath', { from: { tokenId: 'Hero' }, to: { tokenId: 'Ghost' } })
    ).toMatchObject({
      method: 'straight line',
      distance: 20,
    });
  });

  it('says when there is no way', async () => {
    setup = openCanvas();
    const none = await failure(
      setup.harness.query('findPath', { from: { tokenId: 'Hero' }, to: { x: 850, y: 150 } })
    );
    expect(none.code).toBe('NO_PATH');
    expect(none.message).toContain('no way around the walls');
  });

  it('lists tokens in range, hidden and behind walls on request', async () => {
    setup = openCanvas();
    const all = (await setup.harness.query('findTokensInRange', {
      from: { tokenId: 'Hero' },
      distance: 20,
    })) as {
      tokens: Array<{ id: string; distance: number }>;
    };
    expect(all.tokens.map(t => [t.id, t.distance])).toEqual([
      ['gob', 20],
      ['ghost', 20],
    ]);
    expect(
      await setup.harness.query('findTokensInRange', {
        from: { tokenId: 'Hero' },
        distance: 20,
        includeHidden: false,
      })
    ).toMatchObject({ tokens: [{ id: 'gob' }] });
    expect(
      await setup.harness.query('findTokensInRange', {
        from: { tokenId: 'Hero' },
        distance: 20,
        requireLineOfSight: true,
      })
    ).toMatchObject({
      tokens: [{ id: 'ghost', hidden: true }],
      outOfSight: [{ id: 'gob', name: 'Goblin' }],
    });
  });
});
