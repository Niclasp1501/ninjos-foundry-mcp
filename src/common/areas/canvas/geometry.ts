/**
 * Lines, walls, distances and paths on a scene, from stored data
 * alone. The Gamemaster's browser may run without a drawn canvas (noCanvas),
 * and Foundry's own collision test (CONFIG.Canvas.polygonBackends) needs one.
 * These functions give the same answers for the common cases without it; the
 * module prefers Foundry's test when the canvas shows the scene.
 *
 * Rules taken from Foundry 13 and 14 as the package understands them:
 * - an open door never blocks; a closed or locked door or a secret door does
 * - a one-way wall (dir 1 left, 2 right) is ignored when the origin lies on
 *   the side it names, as seen along the wall from its first to its second point
 * - sight, light, sound: "normal" blocks, two "limited" walls block, "proximity"
 *   blocks unless the origin is within the wall's threshold, "distance" blocks
 *   only within it; without a threshold both act as "normal"
 * - movement: every restriction other than "none" blocks
 */
import { finite, isRecord } from './elements.js';

export interface Point {
  x: number;
  y: number;
}

export type CollisionType = 'move' | 'sight' | 'light' | 'sound';
export const COLLISION_TYPES: readonly CollisionType[] = ['move', 'sight', 'light', 'sound'];

export interface WallLike {
  id: string;
  c: number[];
  move?: number;
  sight?: number;
  light?: number;
  sound?: number;
  door?: number;
  ds?: number;
  dir?: number;
  threshold?: Record<string, unknown> | null;
}

/** Where segment p→q crosses segment a→b: t along p→q, u along a→b; null when they do not. */
export function crossing(p: Point, q: Point, a: Point, b: Point): { t: number; u: number } | null {
  const rx = q.x - p.x;
  const ry = q.y - p.y;
  const sx = b.x - a.x;
  const sy = b.y - a.y;
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) < 1e-9) return null;
  const t = ((a.x - p.x) * sy - (a.y - p.y) * sx) / denominator;
  const u = ((a.x - p.x) * ry - (a.y - p.y) * rx) / denominator;
  const eps = 1e-9;
  if (t <= eps || t > 1 + eps || u < -eps || u > 1 + eps) return null;
  return { t, u };
}

/** Foundry's orientation test: positive, negative or 0 for collinear. */
export function orientation(a: Point, b: Point, point: Point): number {
  return (a.y - point.y) * (b.x - point.x) - (a.x - point.x) * (b.y - point.y);
}

export function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t =
    length === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

export interface WallHit {
  id: string;
  /** How far along the line, 0 to 1. */
  at: number;
  restriction: 'normal' | 'limited' | 'proximity' | 'distance';
  blocks: boolean;
  door?: 'door' | 'secret';
}

export interface CollisionResult {
  blocked: boolean;
  hits: WallHit[];
}

/**
 * The walls on the line from `origin` to `destination` that count for this
 * type, nearest first, and whether they block. `pixelsPerUnit` turns pixels
 * into the scene's distance units for thresholds.
 */
export function wallsOnLine(
  origin: Point,
  destination: Point,
  walls: readonly WallLike[],
  type: CollisionType,
  pixelsPerUnit: number
): CollisionResult {
  const hits: WallHit[] = [];
  for (const wall of walls) {
    if (!Array.isArray(wall.c) || wall.c.length !== 4 || !wall.c.every(finite)) continue;
    const restriction = wall[type] ?? 20;
    if (restriction === 0) continue;
    const door = wall.door ?? 0;
    if (door > 0 && wall.ds === 1) continue;
    const a = { x: wall.c[0] as number, y: wall.c[1] as number };
    const b = { x: wall.c[2] as number, y: wall.c[3] as number };
    if (wall.dir) {
      const side = orientation(a, b, origin);
      const sideDirection = side === 0 ? 0 : side < 0 ? 1 : 2;
      if (sideDirection === wall.dir) continue;
    }
    const hit = crossing(origin, destination, a, b);
    if (!hit) continue;

    let kind: WallHit['restriction'] = 'normal';
    let blocks = true;
    if (type !== 'move') {
      if (restriction === 10) {
        kind = 'limited';
        blocks = false;
      } else if (restriction === 30 || restriction === 40) {
        kind = restriction === 30 ? 'proximity' : 'distance';
        const threshold = isRecord(wall.threshold) ? wall.threshold[type] : undefined;
        if (finite(threshold)) {
          const units = distanceToSegment(origin, a, b) / (pixelsPerUnit > 0 ? pixelsPerUnit : 1);
          blocks = restriction === 30 ? units > threshold : units <= threshold;
        }
      }
    }
    hits.push({
      id: wall.id,
      at: hit.t,
      restriction: kind,
      blocks,
      ...(door === 1 ? { door: 'door' as const } : door === 2 ? { door: 'secret' as const } : {}),
    });
  }
  hits.sort((left, right) => left.at - right.at);
  const limited = hits.filter(hit => hit.restriction === 'limited');
  if (limited.length >= 2) for (const hit of limited) hit.blocks = true;
  return { blocked: hits.some(hit => hit.blocks), hits };
}

/** Foundry's grid types (CONST.GRID_TYPES) and diagonal rules (CONST.GRID_DIAGONALS). */
export const GRID_GRIDLESS = 0;
export const GRID_SQUARE = 1;
export const DIAGONAL_RULES = [
  'equidistant',
  'exact',
  'approximate',
  'rectilinear',
  'alternating 1-2-1',
  'alternating 2-1-2',
  'illegal',
] as const;

export interface GridInfo {
  type: number;
  size: number;
  distance: number;
  units: string;
}

function diagonalAllowed(rule: number): boolean {
  return rule !== 3 && rule !== 6;
}

/**
 * The cost in grid spaces of a move of `dx` and `dy` cells, with `before`
 * diagonal steps already taken on the path (the alternating rules count on).
 */
export function squareCost(
  dx: number,
  dy: number,
  rule: number,
  before = 0
): { cost: number; diagonals: number } {
  const x = Math.abs(dx);
  const y = Math.abs(dy);
  if (!diagonalAllowed(rule)) return { cost: x + y, diagonals: 0 };
  const diagonal = Math.min(x, y);
  const straight = Math.max(x, y) - diagonal;
  let cost: number;
  switch (rule) {
    case 1:
      cost = straight + diagonal * Math.SQRT2;
      break;
    case 2:
      cost = straight + diagonal * 1.5;
      break;
    case 4:
      cost = straight + diagonal + (Math.floor((before + diagonal) / 2) - Math.floor(before / 2));
      break;
    case 5:
      cost = straight + diagonal + (Math.ceil((before + diagonal) / 2) - Math.ceil(before / 2));
      break;
    default:
      cost = straight + diagonal;
  }
  return { cost, diagonals: diagonal };
}

export interface Measured {
  distance: number;
  /** Grid spaces moved; null on a gridless scene. */
  spaces: number | null;
  pixels: number;
}

/** The length of a path of points in scene units, cell by cell on a square grid, straight on a gridless one. */
export function measureWaypoints(points: readonly Point[], grid: GridInfo, rule: number): Measured {
  let pixels = 0;
  let spaces = 0;
  let cost = 0;
  let diagonals = 0;
  const cell = (value: number) => Math.floor(value / grid.size);
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1] as Point;
    const to = points[index] as Point;
    pixels += Math.hypot(to.x - from.x, to.y - from.y);
    if (grid.type === GRID_SQUARE) {
      const dx = cell(to.x) - cell(from.x);
      const dy = cell(to.y) - cell(from.y);
      const step = squareCost(dx, dy, rule, diagonals);
      cost += step.cost;
      diagonals += step.diagonals;
      spaces += diagonalAllowed(rule)
        ? Math.max(Math.abs(dx), Math.abs(dy))
        : Math.abs(dx) + Math.abs(dy);
    }
  }
  if (grid.type === GRID_SQUARE) {
    return { distance: round(cost * grid.distance), spaces, pixels: round(pixels) };
  }
  if (grid.type === GRID_GRIDLESS) {
    return {
      distance: round((pixels / grid.size) * grid.distance),
      spaces: null,
      pixels: round(pixels),
    };
  }
  throw new Error(
    `Measuring on this grid type (${grid.type}, hexagonal) needs Foundry's grid of the scene, which is not available`
  );
}

export function round(value: number): number {
  return Math.round(value * 100) / 100;
}

class Heap {
  private readonly items: Array<{ key: string; score: number }> = [];

  get size(): number {
    return this.items.length;
  }

  push(key: string, score: number): void {
    const items = this.items;
    items.push({ key, score });
    let index = items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if ((items[parent] as { score: number }).score <= score) break;
      [items[parent], items[index]] = [
        items[index] as { key: string; score: number },
        items[parent] as { key: string; score: number },
      ];
      index = parent;
    }
  }

  pop(): string | undefined {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (!top || !last) return undefined;
    if (items.length) {
      items[0] = last;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (
          left < items.length &&
          (items[left] as { score: number }).score < (items[smallest] as { score: number }).score
        )
          smallest = left;
        if (
          right < items.length &&
          (items[right] as { score: number }).score < (items[smallest] as { score: number }).score
        )
          smallest = right;
        if (smallest === index) break;
        [items[smallest], items[index]] = [
          items[index] as { key: string; score: number },
          items[smallest] as { key: string; score: number },
        ];
        index = smallest;
      }
    }
    return top.key;
  }
}

export interface PathRequest {
  start: Point;
  goal: Point;
  /** Cell size in pixels. */
  size: number;
  /** The area the path may use, in pixels. */
  bounds: { x: number; y: number; width: number; height: number };
  rule: number;
  /** Whether the straight step between two cell centers is blocked. */
  blocked: (from: Point, to: Point) => boolean;
  maxNodes: number;
}

export type PathResult =
  | { found: true; waypoints: Point[]; cells: number; explored: number }
  | { found: false; reason: 'unreachable' | 'limit' | 'outside'; explored: number };

/**
 * A* over the centers of grid cells. Diagonal steps follow the diagonal rule
 * (none for rectilinear and illegal). The path is returned as the cell
 * centers where it turns, first and last included.
 */
export function findGridPath(request: PathRequest): PathResult {
  const { size, bounds } = request;
  const minI = Math.floor(bounds.x / size);
  const minJ = Math.floor(bounds.y / size);
  const maxI = Math.ceil((bounds.x + bounds.width) / size) - 1;
  const maxJ = Math.ceil((bounds.y + bounds.height) / size) - 1;
  const cellOf = (point: Point) => ({
    i: Math.floor(point.x / size),
    j: Math.floor(point.y / size),
  });
  const inside = (i: number, j: number) => i >= minI && i <= maxI && j >= minJ && j <= maxJ;
  const center = (i: number, j: number): Point => ({ x: (i + 0.5) * size, y: (j + 0.5) * size });
  const start = cellOf(request.start);
  const goal = cellOf(request.goal);
  if (!inside(start.i, start.j) || !inside(goal.i, goal.j))
    return { found: false, reason: 'outside', explored: 0 };

  const diagonal = diagonalAllowed(request.rule);
  const diagonalStep = request.rule === 1 ? Math.SQRT2 : request.rule === 0 ? 1 : 1.5;
  const steps = diagonal
    ? [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ]
    : [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
  const heuristic = (i: number, j: number) =>
    diagonal
      ? Math.max(Math.abs(goal.i - i), Math.abs(goal.j - j))
      : Math.abs(goal.i - i) + Math.abs(goal.j - j);

  const key = (i: number, j: number) => `${i},${j}`;
  const cost = new Map<string, number>([[key(start.i, start.j), 0]]);
  const previous = new Map<string, string>();
  const closed = new Set<string>();
  const open = new Heap();
  open.push(key(start.i, start.j), heuristic(start.i, start.j));
  let explored = 0;

  while (open.size) {
    const current = open.pop() as string;
    if (closed.has(current)) continue;
    closed.add(current);
    explored += 1;
    const [ci, cj] = current.split(',').map(Number) as [number, number];
    if (ci === goal.i && cj === goal.j) {
      const cells: Array<[number, number]> = [];
      let walk: string | undefined = current;
      while (walk) {
        cells.unshift(walk.split(',').map(Number) as [number, number]);
        walk = previous.get(walk);
      }
      const waypoints: Point[] = [];
      for (let index = 0; index < cells.length; index += 1) {
        const [i, j] = cells[index] as [number, number];
        const before = cells[index - 1];
        const after = cells[index + 1];
        const straight =
          before && after && i - before[0] === after[0] - i && j - before[1] === after[1] - j;
        if (!straight) waypoints.push(center(i, j));
      }
      return { found: true, waypoints, cells: cells.length, explored };
    }
    if (explored >= request.maxNodes) return { found: false, reason: 'limit', explored };
    const here = cost.get(current) as number;
    for (const [di, dj] of steps as Array<[number, number]>) {
      const ni = ci + di;
      const nj = cj + dj;
      const next = key(ni, nj);
      if (!inside(ni, nj) || closed.has(next)) continue;
      if (request.blocked(center(ci, cj), center(ni, nj))) continue;
      const total = here + (di !== 0 && dj !== 0 ? diagonalStep : 1);
      if (total >= (cost.get(next) ?? Number.POSITIVE_INFINITY)) continue;
      cost.set(next, total);
      previous.set(next, current);
      open.push(next, total + heuristic(ni, nj));
    }
  }
  return { found: false, reason: 'unreachable', explored };
}
