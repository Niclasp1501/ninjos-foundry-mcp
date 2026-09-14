/**
 * getSceneImage through the dispatcher, on fake-foundry with the canvas
 * elements of testing.ts (built on fake-dom).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { FakeFoundry, type FakeFoundryOptions } from '../../../testing/fake-foundry.js';
import { withSceneImage, type SceneImageFake, type SceneImageFakeOptions } from './testing.js';

let harness: AreaHarness | null = null;
afterEach(() => {
  harness?.close();
  harness = null;
});

interface Answer {
  scene: { id: string; name: string; viewedOnCanvas: boolean };
  path: string;
  image: {
    data: string;
    mimeType: string;
    width: number;
    height: number;
    bytes: number;
    quality: number;
  };
  mapping: { canvasRect: { x: number; y: number; width: number; height: number }; scale: number };
  grid: { type: string; size: number; columns: number; rows: number; linesDrawn: boolean };
  background: string | null;
  tokens: Array<{
    index: number;
    id: string;
    name: string;
    cell: { column: number; row: number } | null;
    disposition: string;
    hidden: boolean;
    inImage: boolean;
    pictureCenter: { x: number; y: number } | null;
  }>;
  warnings: string[];
  notes: string[];
}

function world(
  fakeOptions: SceneImageFakeOptions = {},
  foundryOptions: FakeFoundryOptions = {},
  scene: Record<string, unknown> = {}
): { h: AreaHarness; fake: SceneImageFake } {
  const foundry = new FakeFoundry({ version: '13.351', ...foundryOptions });
  const fake = withSceneImage(foundry, {
    media: { 'maps/cave.webp': { width: 2000, height: 1500 } },
    ...fakeOptions,
  });
  const h = (harness = createAreaHarness({ foundry }));
  const doc = foundry.seed('Scene', {
    _id: 'scene1',
    name: 'Cave',
    active: true,
    width: 2000,
    height: 1500,
    padding: 0.25,
    grid: { type: 1, size: 100, distance: 5, units: 'ft' },
    background: { src: 'maps/cave.webp' },
    backgroundColor: '#202020',
    ...scene,
  });
  foundry.seed('Scene', {
    _id: 'scene2',
    name: 'Camp',
    active: false,
    width: 1000,
    height: 1000,
    grid: { size: 100 },
  });
  foundry.seed(
    'Token',
    { _id: 't1', name: 'Goblin', x: 800, y: 500, width: 1, height: 1, disposition: -1 },
    doc
  );
  foundry.seed(
    'Token',
    { _id: 't2', name: 'Spy', x: 2300, y: 1700, width: 2, height: 2, disposition: 1, hidden: true },
    doc
  );
  return { h, fake };
}

const ask = async (h: AreaHarness, data: Record<string, unknown> = {}) =>
  (await h.query('getSceneImage', data)) as Answer;

describe('getSceneImage, composed path', () => {
  it('composes the active scene from its background when there is no canvas', async () => {
    const { h, fake } = world();
    const answer = await ask(h);
    expect(answer.path).toBe('composed');
    expect(answer.scene).toMatchObject({ id: 'scene1', name: 'Cave', viewedOnCanvas: false });
    expect(answer.background).toBe('maps/cave.webp');
    expect(answer.image).toMatchObject({ mimeType: 'image/jpeg', width: 1568, height: 1176 });
    expect(answer.image.bytes).toBeLessThanOrEqual(1_000_000);
    expect(answer.notes.join(' ')).toContain('without a canvas');

    // Scene rectangle starts after 5 cells of padding on the left and 4 on top.
    expect(answer.mapping.canvasRect).toEqual({ x: 500, y: 400, width: 2000, height: 1500 });
    expect(answer.grid).toMatchObject({
      type: 'square',
      size: 100,
      columns: 20,
      rows: 15,
      linesDrawn: true,
    });

    const drawn = fake.canvases.at(-1)?.context;
    expect(drawn?.calls.find(call => call.op === 'drawImage')?.args.slice(1, 5)).toEqual([
      0, 0, 2000, 1500,
    ]);
    expect(drawn?.texts()).toEqual(expect.arrayContaining(['0', '1', '2']));
  });

  it('lists every token with cell, disposition, hidden flag and its place on the picture', async () => {
    const { h } = world();
    const { tokens, mapping } = await ask(h);
    expect(tokens).toEqual([
      expect.objectContaining({
        index: 1,
        id: 't1',
        name: 'Goblin',
        cell: { column: 3, row: 1 },
        disposition: 'hostile',
        hidden: false,
        inImage: true,
        pictureCenter: {
          x: Math.round((850 - 500) * mapping.scale),
          y: Math.round((550 - 400) * mapping.scale),
        },
      }),
      expect.objectContaining({
        index: 2,
        cell: { column: 18, row: 13 },
        disposition: 'friendly',
        hidden: true,
      }),
    ]);
  });

  it('crops to a region of cells and leaves tokens outside unmarked', async () => {
    const { h, fake } = world();
    const answer = await ask(h, { region: { column: 2, row: 0, columns: 4, rows: 3 } });
    expect(answer.mapping.canvasRect).toEqual({ x: 700, y: 400, width: 400, height: 300 });
    expect(answer.image).toMatchObject({ width: 400, height: 300 });
    expect(answer.tokens.map(token => token.inImage)).toEqual([true, false]);
    expect(answer.tokens[1]?.pictureCenter).toBeNull();
    const draw = fake.canvases.at(-1)?.context.calls.find(call => call.op === 'drawImage');
    expect(draw?.args.slice(1, 5)).toEqual([200, 0, 400, 300]);
    expect(fake.canvases.at(-1)?.context.calls.filter(call => call.op === 'arc')).toHaveLength(1);
  });

  it('lowers quality, then size, until the bytes fit, and says so', async () => {
    const { h } = world({ bytesPerPixel: 1 });
    const answer = await ask(h, { maxBytes: 200_000 });
    expect(answer.image.bytes).toBeLessThanOrEqual(200_000);
    expect(answer.image.quality).toBeLessThan(0.85);
    expect(answer.image.width).toBeLessThan(1568);
    expect(answer.notes.join(' ')).toContain('made smaller');
  });

  it('refuses when even the smallest picture is too large', async () => {
    const { h } = world({ bytesPerPixel: 50 });
    await expect(ask(h, { maxBytes: 50_000 })).rejects.toMatchObject({
      moduleCode: 'IMAGE_TOO_LARGE',
      message: expect.stringContaining('Failed to get the scene image: even at 256 pixels'),
    });
  });

  it('falls back to JPEG when the browser cannot write WebP', async () => {
    const { h } = world({ webp: false });
    const answer = await ask(h, { format: 'webp' });
    expect(answer.image.mimeType).toBe('image/jpeg');
    expect(answer.notes.join(' ')).toContain('cannot write image/webp');
  });

  it('keeps colour, grid and markers when the background is missing, with the cause', async () => {
    const { h } = world({ media: {} });
    const answer = await ask(h);
    expect(answer.path).toBe('composed');
    expect(answer.warnings[0]).toContain('"maps/cave.webp" could not be loaded');
  });

  it('draws no grid lines on a hexagonal grid and takes the cell from Foundry', async () => {
    const { h, fake } = world({}, {}, { grid: { type: 2, size: 100 } });
    const scene = h.foundry.collection('Scene').get('scene1') as unknown as {
      grid: Record<string, unknown>;
    };
    Object.defineProperty(scene.grid, 'getOffset', {
      value: (point: { x: number; y: number }) => ({
        i: Math.floor(point.y / 100),
        j: Math.floor(point.x / 100),
      }),
      enumerable: false,
    });
    const answer = await ask(h);
    expect(answer.grid).toMatchObject({ type: 'hexagonal-odd-rows', linesDrawn: false });
    expect(answer.tokens[0]?.cell).toEqual({ column: 3, row: 1 });
    expect(fake.canvases.at(-1)?.context.calls.some(call => call.op === 'lineTo')).toBe(false);
    expect(answer.notes.join(' ')).toContain('no lines or labels');
  });

  it('finds another scene by name and refuses an unknown one with hints', async () => {
    const { h } = world();
    expect((await ask(h, { sceneIdentifier: 'camp' })).scene.id).toBe('scene2');
    await expect(ask(h, { sceneIdentifier: 'Ca' })).rejects.toMatchObject({
      moduleCode: 'SCENE_NOT_FOUND',
      message: expect.stringContaining('Names containing it'),
    });
  });

  it('collects every invalid argument in one error', async () => {
    const { h } = world();
    await expect(
      ask(h, { mode: 'photo', maxDimension: 10, format: 'gif', region: { column: 0 } })
    ).rejects.toMatchObject({
      moduleCode: 'INVALID_ARGUMENT',
      message: expect.stringMatching(
        /mode must be one of.*maxDimension must be.*format must be one of/s
      ),
    });
  });

  it('answers a player with an error', async () => {
    const { h } = world(
      {},
      {
        users: [
          { name: 'GM', isGM: true },
          { id: 'p', name: 'Player' },
        ],
      }
    );
    h.foundry.setUser('p');
    await expect(ask(h)).rejects.toMatchObject({ moduleCode: 'ACCESS_DENIED' });
  });
});

describe('getSceneImage, canvas path', () => {
  it('captures the primary group of the viewed scene at the output scale', async () => {
    const { h, fake } = world({ canvas: { sceneId: 'scene1' } });
    const answer = await ask(h);
    expect(answer.path).toBe('canvas');
    expect(answer.scene.viewedOnCanvas).toBe(true);
    expect(fake.textures).toHaveLength(1);
    expect(fake.textures[0]).toMatchObject({
      target: { name: 'primary' },
      region: { x: 500, y: 400, width: 2000, height: 1500 },
      resolution: 0.784,
      destroyed: true,
    });
    expect(answer.notes.join(' ')).toContain('without lighting, fog of war or vision');
  });

  it('uses the frame argument when the renderer has no texture route', async () => {
    const { h, fake } = world({ canvas: { sceneId: 'scene1', capture: 'frame-only' } });
    expect((await ask(h)).path).toBe('canvas');
    expect(fake.extractCalls[0]?.frame).toEqual({ x: 500, y: 400, width: 2000, height: 1500 });
  });

  it('composes with a warning and a GM notification when the capture fails in auto mode', async () => {
    const { h } = world({ canvas: { sceneId: 'scene1', capture: 'throws' } });
    const answer = await ask(h);
    expect(answer.path).toBe('composed');
    expect(answer.warnings[0]).toContain('WebGL context lost');
    expect(h.foundry.notifications.at(-1)).toMatchObject({ level: 'warn' });
  });

  it('fails with the cause in mode canvas', async () => {
    const { h } = world({ canvas: { sceneId: 'scene1', capture: 'no-extract' } });
    await expect(ask(h, { mode: 'canvas' })).rejects.toMatchObject({
      moduleCode: 'CANVAS_UNAVAILABLE',
      message: expect.stringContaining('no extract API'),
    });
    await expect(ask(h, { mode: 'canvas', sceneIdentifier: 'scene2' })).rejects.toMatchObject({
      message: expect.stringContaining('another scene [scene1]'),
    });
  });

  it('warns when selected tokens may hide others', async () => {
    const { h } = world({ canvas: { sceneId: 'scene1', controlled: 1 } });
    expect((await ask(h)).warnings.join(' ')).toContain('tokens selected');
  });

  it('composes on request even when the canvas shows the scene', async () => {
    const { h, fake } = world({ canvas: { sceneId: 'scene1' } });
    expect((await ask(h, { mode: 'composed' })).path).toBe('composed');
    expect(fake.textures).toHaveLength(0);
  });
});
