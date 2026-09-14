/**
 * What the canvas area needs beyond the default fake: region behaviors, a scene
 * with walls, a door, a window, a light, a tile, a region and three tokens, and
 * a drawn canvas that pans, pings and can be switched off (noCanvas).
 *
 * The scene "Keep" (1000 by 1000 pixels, grid 100 px = 5 ft, no padding):
 *
 * - token "Hero" at cell (1, 1), "Goblin" at (5, 1), hidden "Ghost" at (1, 5)
 * - wall w1 from (300, 0) to (300, 400), closed door d1 from (300, 400) to
 *   (300, 600): Hero and Goblin are separated, the way round leads below y 600
 * - window win from (700, 0) to (700, 1000): blocks movement, limited for sight
 */
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import {
  FakeFoundry,
  type FakeDocument,
  type FakeFoundryOptions,
} from '../../../testing/fake-foundry.js';

export interface CanvasBoardFake {
  ready: boolean;
  scene: FakeDocument | null;
  stage: { pivot: { x: number; y: number }; scale: { x: number; y: number } };
  pans: Array<Record<string, unknown>>;
  pings: Array<{ origin: { x: number; y: number }; options: Record<string, unknown> }>;
  /** What ping resolves to. */
  pingAnswer: unknown;
  /** Zoom Foundry allows at most; animatePan clamps to it. */
  maxZoom: number;
  animatePan(view: { x?: number; y?: number; scale?: number }): Promise<boolean>;
  ping(origin: { x: number; y: number }, options?: Record<string, unknown>): Promise<unknown>;
}

/** Regions with behaviors, as in Foundry 13 and 14. Call before seeding. */
export function withCanvasTypes(foundry: FakeFoundry): FakeFoundry {
  foundry.defineDocumentType('RegionBehavior', {});
  foundry.defineDocumentType('Region', { embedded: { RegionBehavior: 'behaviors' } });
  return foundry;
}

export function seedKeep(foundry: FakeFoundry, extra: Record<string, unknown> = {}): FakeDocument {
  return foundry.seed('Scene', {
    _id: 'keep',
    name: 'Keep',
    active: true,
    width: 1000,
    height: 1000,
    padding: 0,
    grid: { type: 1, size: 100, distance: 5, units: 'ft' },
    tokens: [
      {
        _id: 'hero',
        name: 'Hero',
        x: 100,
        y: 100,
        width: 1,
        height: 1,
        actorId: 'a1',
        disposition: 1,
      },
      { _id: 'gob', name: 'Goblin', x: 500, y: 100, width: 1, height: 1, disposition: -1 },
      { _id: 'ghost', name: 'Ghost', x: 100, y: 500, width: 1, height: 1, hidden: true },
    ],
    walls: [
      {
        _id: 'w1',
        c: [300, 0, 300, 400],
        move: 20,
        sight: 20,
        light: 20,
        sound: 20,
        door: 0,
        ds: 0,
        dir: 0,
      },
      {
        _id: 'd1',
        c: [300, 400, 300, 600],
        move: 20,
        sight: 20,
        light: 20,
        sound: 20,
        door: 1,
        ds: 0,
        dir: 0,
      },
      {
        _id: 'win',
        c: [700, 0, 700, 1000],
        move: 20,
        sight: 10,
        light: 10,
        sound: 20,
        door: 0,
        ds: 0,
        dir: 0,
      },
    ],
    lights: [
      { _id: 'l1', x: 200, y: 200, config: { dim: 30, bright: 15 }, walls: true, hidden: false },
    ],
    tiles: [
      { _id: 't1', x: 800, y: 800, width: 100, height: 100, texture: { src: 'tiles/crate.webp' } },
    ],
    regions: [
      {
        _id: 'r1',
        name: 'Trap',
        shapes: [{ type: 'rectangle', x: 400, y: 400, width: 200, height: 200 }],
        behaviors: [{ _id: 'b1', type: 'executeMacro', name: 'Spikes' }],
      },
    ],
    ...extra,
  });
}

/** A drawn canvas showing `scene`. Set it after the harness installed the fake. */
export function installBoard(
  foundry: FakeFoundry,
  scene: FakeDocument | null,
  ready = true
): CanvasBoardFake {
  const board: CanvasBoardFake = {
    ready,
    scene,
    stage: { pivot: { x: 500, y: 500 }, scale: { x: 1, y: 1 } },
    pans: [],
    pings: [],
    pingAnswer: true,
    maxZoom: 3,
    async animatePan(view) {
      board.pans.push({ ...view });
      if (view.x !== undefined) board.stage.pivot.x = Math.max(0, Math.min(1000, view.x));
      if (view.y !== undefined) board.stage.pivot.y = Math.max(0, Math.min(1000, view.y));
      if (view.scale !== undefined) {
        const scale = Math.min(board.maxZoom, view.scale);
        board.stage.scale = { x: scale, y: scale };
      }
      return true;
    },
    async ping(origin, options = {}) {
      board.pings.push({ origin: { ...origin }, options: { ...options } });
      return board.pingAnswer;
    },
  };
  foundry.setGlobal('canvas', board);
  return board;
}

export interface CanvasSetup {
  harness: AreaHarness;
  foundry: FakeFoundry;
  scene: FakeDocument;
  board: CanvasBoardFake | null;
}

/** A harness with the Keep scene; `board: false` is a Gamemaster browser with noCanvas. */
export function openCanvas(options: FakeFoundryOptions & { board?: boolean } = {}): CanvasSetup {
  const { board: withBoard = true, ...fakeOptions } = options;
  const foundry = withCanvasTypes(new FakeFoundry(fakeOptions));
  const harness = createAreaHarness({ foundry });
  const scene = seedKeep(foundry);
  const board = withBoard ? installBoard(foundry, scene) : null;
  return { harness, foundry, scene, board };
}
