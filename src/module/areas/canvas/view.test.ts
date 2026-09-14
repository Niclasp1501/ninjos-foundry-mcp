import { afterEach, describe, expect, it } from 'vitest';
import { MODULE_ID } from '../../../common/constants.js';
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

describe('the view', () => {
  it('reports a missing canvas and what needs one', async () => {
    setup = openCanvas({ board: false });
    expect(await setup.harness.query('getCanvasView', {})).toMatchObject({
      canvasReady: false,
      viewedScene: null,
      activeScene: { id: 'keep', name: 'Keep' },
      needsCanvas: ['pan-camera', 'ping-canvas', 'set-targets'],
    });
    const pan = await failure(setup.harness.query('panCamera', { tokenId: 'Hero' }));
    expect(pan.code).toBe('CANVAS_REQUIRED');
    expect(pan.message).toContain('Disable Game Canvas');
    expect((await failure(setup.harness.query('setTargets', { tokenIds: [] }))).code).toBe(
      'CANVAS_REQUIRED'
    );
  });

  it('pans the Gamemaster view as a read, even with the switch off', async () => {
    setup = openCanvas({ settings: { [`${MODULE_ID}.allowWriteOperations`]: false } });
    const answer = (await setup.harness.query('panCamera', {
      tokenId: 'Goblin',
      scale: 5,
    })) as Record<string, unknown>;
    expect(answer['view']).toEqual({ x: 550, y: 150, scale: 3 });
    expect(answer['warnings']).toEqual([expect.stringContaining('zoom to 3 instead of 5')]);
    expect(setup.board!.pings).toHaveLength(0);
    expect(
      (await failure(setup.harness.query('panCamera', { x: 1, y: 1, forEveryone: true }))).code
    ).toBe('WRITE_DISABLED');
  });

  it('pulls everyone with a pull ping and tells the Gamemaster', async () => {
    setup = openCanvas();
    const answer = (await setup.harness.query('panCamera', {
      x: 400,
      y: 300,
      forEveryone: true,
    })) as Record<string, unknown>;
    expect(answer['pulled']).toBe(true);
    expect(setup.board!.pings[0]).toEqual({
      origin: { x: 400, y: 300 },
      options: { style: 'chevron', pull: true, zoom: 1 },
    });
    expect(setup.foundry.notifications).toContainEqual({
      level: 'info',
      message: 'The AI moved the view of everyone on the scene Keep.',
    });
    expect(setup.harness.changeLog.size).toBe(0);
  });

  it('refuses a scene the Gamemaster does not view', async () => {
    setup = openCanvas();
    setup.foundry.seed('Scene', { _id: 'cellar', name: 'Cellar' });
    const other = await failure(
      setup.harness.query('pingCanvas', { x: 1, y: 1, sceneIdentifier: 'Cellar' })
    );
    expect(other.code).toBe('NOT_VIEWED');
    expect(other.message).toContain('"Keep" [keep], not "Cellar" [cellar]');
    expect(setup.board!.pings).toHaveLength(0);
  });

  it('pings and fails when Foundry does not send it', async () => {
    setup = openCanvas();
    expect(
      await setup.harness.query('pingCanvas', { tokenId: 'hero', style: 'alert' })
    ).toMatchObject({
      point: { x: 150, y: 150 },
      style: 'alert',
      confirmed: true,
    });
    expect(
      (await failure(setup.harness.query('pingCanvas', { x: 1, y: 1, style: 'boom' }))).code
    ).toBe('INVALID_ARGUMENT');
    setup.board!.pingAnswer = false;
    expect((await failure(setup.harness.query('pingCanvas', { x: 1, y: 1 }))).code).toBe(
      'NOT_APPLIED'
    );
  });

  it('sets, keeps on a bad name and clears targets', async () => {
    setup = openCanvas();
    const set = (await setup.harness.query('setTargets', {
      tokenIds: ['Goblin', 'ghost'],
    })) as Record<string, unknown>;
    expect(set).toMatchObject({
      previous: [],
      targets: [
        { id: 'gob', name: 'Goblin' },
        { id: 'ghost', name: 'Ghost' },
      ],
    });
    const bad = await failure(setup.harness.query('setTargets', { tokenIds: ['Dragon'] }));
    expect(bad.code).toBe('TOKEN_NOT_FOUND');
    expect(bad.message).toContain('No target was changed');
    expect(await setup.harness.query('getCanvasView', {})).toMatchObject({
      targets: [{ id: 'gob' }, { id: 'ghost' }],
    });
    expect(await setup.harness.query('setTargets', { tokenIds: [] })).toMatchObject({
      targets: [],
    });
  });
});
