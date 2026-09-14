/**
 * Where tokens go when actors are dropped into a scene. Pure arithmetic, so it
 * is tested without Foundry.
 *
 * Fixes two faults of the previous generation when placing tokens: the grid layout
 * computes its columns once for the whole group, so no token lands on another,
 * and every position lies inside the scene rectangle (padding excluded) and on
 * the grid.
 */

export type PlacementKind = 'random' | 'grid' | 'center' | 'coordinates';

export const PLACEMENT_KINDS: readonly PlacementKind[] = [
  'random',
  'grid',
  'center',
  'coordinates',
];

/** The part of the canvas that belongs to the scene, in pixels. */
export interface SceneRect {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Size of one grid cell in pixels. */
  grid: number;
}

export interface Point {
  x: number;
  y: number;
}

export class PlacementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlacementError';
  }
}

function snap(value: number, origin: number, grid: number): number {
  return origin + Math.round((value - origin) / grid) * grid;
}

function clampInto(point: Point, rect: SceneRect): Point {
  const maxX = rect.x + Math.max(0, rect.width - rect.grid);
  const maxY = rect.y + Math.max(0, rect.height - rect.grid);
  return {
    x: Math.min(maxX, Math.max(rect.x, snap(point.x, rect.x, rect.grid))),
    y: Math.min(maxY, Math.max(rect.y, snap(point.y, rect.y, rect.grid))),
  };
}

/**
 * One position per token.
 * - `grid`: a block around the centre, two cells apart, columns fixed for the group
 * - `center`: from the centre one cell to the right per token, next row when the scene ends
 * - `random`: distinct random cells while there are enough of them
 * - `coordinates`: the given points, one per token, snapped and kept inside the scene
 */
export function tokenPositions(
  kind: PlacementKind,
  count: number,
  rect: SceneRect,
  options: { coordinates?: readonly Point[]; random?: () => number } = {}
): Point[] {
  if (count <= 0) return [];
  const grid = rect.grid > 0 ? rect.grid : 100;
  const area = { ...rect, grid };
  const centre = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };

  if (kind === 'coordinates') {
    const given = options.coordinates ?? [];
    if (given.length < count) {
      throw new PlacementError(
        `Placement "coordinates" needs one point per token: ${count} token(s), ${given.length} point(s).`
      );
    }
    return given.slice(0, count).map(point => clampInto(point, area));
  }

  if (kind === 'grid') {
    const columns = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / columns);
    const step = grid * 2;
    const left = centre.x - ((columns - 1) * step) / 2;
    const top = centre.y - ((rows - 1) * step) / 2;
    return Array.from({ length: count }, (_, index) =>
      clampInto(
        { x: left + (index % columns) * step, y: top + Math.floor(index / columns) * step },
        area
      )
    );
  }

  if (kind === 'center') {
    const start = clampInto(centre, area);
    const perRow = Math.max(1, Math.floor((rect.x + rect.width - start.x) / grid));
    return Array.from({ length: count }, (_, index) =>
      clampInto(
        { x: start.x + (index % perRow) * grid, y: start.y + Math.floor(index / perRow) * grid },
        area
      )
    );
  }

  const random = options.random ?? Math.random;
  const columns = Math.max(1, Math.floor(rect.width / grid));
  const rows = Math.max(1, Math.floor(rect.height / grid));
  const cells = columns * rows;
  const taken = new Set<number>();
  return Array.from({ length: count }, () => {
    let cell = Math.floor(random() * cells) % cells;
    if (taken.size < cells) {
      while (taken.has(cell)) cell = (cell + 1) % cells;
    }
    taken.add(cell);
    return { x: rect.x + (cell % columns) * grid, y: rect.y + Math.floor(cell / columns) * grid };
  });
}
