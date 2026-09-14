/**
 * Distance, walls on a line, a path around walls and tokens in
 * range. All four only read and work without a drawn canvas.
 *
 * Distance uses Foundry's own `scene.grid.measurePath` where the grid object
 * offers it (Foundry 12 and later, prepared scenes), otherwise the rules in
 * geometry.ts for square and gridless scenes. Walls use Foundry's collision
 * test when the canvas shows the scene, otherwise the stored walls; the answer
 * says which.
 */
import {
  COLLISION_TYPES,
  DIAGONAL_RULES,
  findGridPath,
  GRID_GRIDLESS,
  GRID_SQUARE,
  measureWaypoints,
  round,
  wallsOnLine,
  type CollisionType,
  type GridInfo,
  type Measured,
  type Point,
  type WallLike,
} from '../../../common/areas/canvas/geometry.js';
import type { QueryHandler } from '../../dispatcher.js';
import { requireWorld } from '../../world-ready.js';
import {
  argsOf,
  board,
  chooseScene,
  diagonalRule,
  fail,
  finite,
  gridOf,
  isRecord,
  listIn,
  messageOf,
  numberIn,
  operation,
  optionalBoolean,
  placeOf,
  polygonBackend,
  READ,
  sceneInfo,
  tokenCenter,
  tokensOf,
  wallsOf,
  type Located,
} from './support.js';

type Grid = ReturnType<typeof gridOf>;

interface Measure extends Measured {
  method: 'foundry' | 'geometry';
}

function measure(points: Point[], grid: Grid, rule: number, warnings: string[]): Measure {
  if (grid.measurePath) {
    try {
      const result = grid.measurePath(points);
      if (finite(result.distance)) {
        let pixels = 0;
        for (let index = 1; index < points.length; index += 1) {
          const a = points[index - 1] as Point;
          const b = points[index] as Point;
          pixels += Math.hypot(b.x - a.x, b.y - a.y);
        }
        return {
          distance: round(result.distance),
          spaces: finite(result.spaces) ? result.spaces : null,
          pixels: round(pixels),
          method: 'foundry',
        };
      }
      warnings.push('Foundry measured no distance; measured from the stored grid instead.');
    } catch (error) {
      warnings.push(
        `Foundry's measuring failed (${messageOf(error)}); measured from the stored grid instead.`
      );
    }
  }
  if (grid.type !== GRID_SQUARE && grid.type !== GRID_GRIDLESS)
    fail(
      'UNSUPPORTED_GRID',
      `The scene has a hexagonal grid (type ${grid.type}), and Foundry's grid object to measure it is not available.`
    );
  return { ...measureWaypoints(points, grid, rule), method: 'geometry' };
}

function label(place: Located): Record<string, unknown> {
  return { ...place.point, ...(place.token ? { token: place.token } : {}) };
}

function collisionType(args: Record<string, unknown>, key = 'type'): CollisionType {
  const value = args[key] ?? 'move';
  if (typeof value !== 'string' || !(COLLISION_TYPES as readonly string[]).includes(value))
    fail('INVALID_ARGUMENT', `${key} must be one of ${COLLISION_TYPES.join(', ')}`);
  return value as CollisionType;
}

function gridText(grid: GridInfo, rule: number): Record<string, unknown> {
  return {
    type:
      grid.type === GRID_SQUARE
        ? 'square'
        : grid.type === GRID_GRIDLESS
          ? 'gridless'
          : `hexagonal (${grid.type})`,
    size: grid.size,
    distance: grid.distance,
    units: grid.units,
    ...(grid.type === GRID_SQUARE ? { diagonals: DIAGONAL_RULES[rule] ?? String(rule) } : {}),
  };
}

export const measureDistance: QueryHandler = {
  access: READ,
  run: data =>
    operation('measure the distance', () => {
      requireWorld();
      const args = argsOf(data);
      const chosen = chooseScene(args);
      const grid = gridOf(chosen.scene);
      const rule = diagonalRule();
      const from = placeOf(args, 'from', chosen.scene, grid);
      const to = placeOf(args, 'to', chosen.scene, grid);
      const via = args['via'] === undefined ? [] : listIn(args, 'via', 50, 0);
      const stops = via.map((entry, index) => {
        if (!isRecord(entry) || !finite(entry['x']) || !finite(entry['y']))
          fail('INVALID_ARGUMENT', `via[${index}] must have x and y as numbers`);
        return { x: entry['x'], y: entry['y'] };
      });
      const warnings: string[] = [];
      const measured = measure([from.point, ...stops, to.point], grid, rule, warnings);
      return {
        scene: sceneInfo(chosen),
        from: label(from),
        to: label(to),
        via: stops,
        ...measured,
        units: grid.units,
        grid: gridText(grid, rule),
        note: 'Tokens are measured from their centers.',
        warnings,
      };
    }),
};

function lineCheck(
  walls: WallLike[],
  grid: GridInfo,
  type: CollisionType
): (from: Point, to: Point) => boolean {
  const pixelsPerUnit = grid.size / grid.distance;
  return (from, to) => wallsOnLine(from, to, walls, type, pixelsPerUnit).blocked;
}

function foundryCollision(
  scene: FoundryCanvasScene,
  from: Point,
  to: Point,
  type: CollisionType
): boolean | null {
  const canvas = board();
  if (canvas?.ready !== true || canvas.scene?.id !== scene.id) return null;
  const backend = polygonBackend(type);
  if (typeof backend?.testCollision !== 'function') return null;
  return Boolean(backend.testCollision(from, to, { type, mode: 'any' }));
}

export const checkWallCollision: QueryHandler = {
  access: READ,
  run: data =>
    operation('check the walls', () => {
      requireWorld();
      const args = argsOf(data);
      const chosen = chooseScene(args);
      const grid = gridOf(chosen.scene);
      const type = collisionType(args);
      const from = placeOf(args, 'from', chosen.scene, grid);
      const to = placeOf(args, 'to', chosen.scene, grid);
      const walls = wallsOf(chosen.scene);
      const geometry = wallsOnLine(from.point, to.point, walls, type, grid.size / grid.distance);
      const warnings: string[] = [];
      let foundry: boolean | null = null;
      try {
        foundry = foundryCollision(chosen.scene, from.point, to.point, type);
      } catch (error) {
        warnings.push(
          `Foundry's collision test failed (${messageOf(error)}); the stored walls decided.`
        );
      }
      if (foundry !== null && foundry !== geometry.blocked)
        warnings.push(
          `Foundry's test says ${foundry ? 'blocked' : 'clear'}, the stored walls alone say ${geometry.blocked ? 'blocked' : 'clear'}; Foundry's answer counts (it also knows modules and wall thresholds of the source).`
        );
      return {
        scene: sceneInfo(chosen),
        type,
        from: label(from),
        to: label(to),
        blocked: foundry ?? geometry.blocked,
        method: foundry === null ? 'stored walls' : 'foundry',
        walls: geometry.hits,
        warnings,
      };
    }),
};

function sceneBounds(
  scene: FoundryCanvasScene,
  grid: GridInfo
): { x: number; y: number; width: number; height: number } {
  const dimensions = scene.dimensions;
  if (dimensions && finite(dimensions.width) && finite(dimensions.height))
    return { x: 0, y: 0, width: dimensions.width, height: dimensions.height };
  const width = finite(scene.width) ? scene.width : 4000;
  const height = finite(scene.height) ? scene.height : 3000;
  const padding = finite(scene.padding) ? scene.padding : 0.25;
  const padX = Math.ceil((width * padding) / grid.size) * grid.size;
  const padY = Math.ceil((height * padding) / grid.size) * grid.size;
  return { x: 0, y: 0, width: width + 2 * padX, height: height + 2 * padY };
}

export const findPath: QueryHandler = {
  access: READ,
  run: data =>
    operation('find a path', () => {
      requireWorld();
      const args = argsOf(data);
      const chosen = chooseScene(args);
      const grid = gridOf(chosen.scene);
      const rule = diagonalRule();
      const type = collisionType(args);
      const maxNodes =
        numberIn(args, 'maxCells', { min: 100, max: 200_000, integer: true }) ?? 50_000;
      const from = placeOf(args, 'from', chosen.scene, grid);
      const to = placeOf(args, 'to', chosen.scene, grid);
      if (grid.type !== GRID_SQUARE && grid.type !== GRID_GRIDLESS)
        fail(
          'UNSUPPORTED_GRID',
          `Paths are found on square and gridless scenes; this scene has a hexagonal grid (type ${grid.type}).`
        );
      const blocked = lineCheck(wallsOf(chosen.scene), grid, type);
      const warnings: string[] = [];
      let waypoints: Point[];
      let explored = 0;
      let method: string;
      if (!blocked(from.point, to.point)) {
        waypoints = [from.point, to.point];
        method = 'straight line';
      } else {
        const result = findGridPath({
          start: from.point,
          goal: to.point,
          size: grid.size,
          bounds: sceneBounds(chosen.scene, grid),
          rule: grid.type === GRID_SQUARE ? rule : 1,
          blocked,
          maxNodes,
        });
        explored = result.explored;
        if (!result.found) {
          const why = {
            unreachable: 'there is no way around the walls inside the scene',
            limit: `the search stopped after ${result.explored} cells (maxCells); raise maxCells for a large scene`,
            outside: 'the start or the goal lies outside the scene',
          }[result.reason];
          return fail('NO_PATH', `No path for ${type} from the start to the goal: ${why}.`);
        }
        waypoints = result.waypoints;
        method = 'grid search';
        warnings.push(
          'The path runs from cell center to cell center; a start or goal inside a cell is taken as its center.'
        );
      }
      const measured = measure(waypoints, grid, rule, warnings);
      return {
        scene: sceneInfo(chosen),
        type,
        from: label(from),
        to: label(to),
        method,
        waypoints,
        distance: measured.distance,
        spaces: measured.spaces,
        units: grid.units,
        explored,
        note: 'Nothing was moved; move-token moves a token along a path.',
        warnings,
      };
    }),
};

export const findTokensInRange: QueryHandler = {
  access: READ,
  run: data =>
    operation('find tokens in range', () => {
      requireWorld();
      const args = argsOf(data);
      const chosen = chooseScene(args);
      const grid = gridOf(chosen.scene);
      const rule = diagonalRule();
      const from = placeOf(args, 'from', chosen.scene, grid);
      const range = numberIn(args, 'distance', { min: 0, max: 1_000_000 });
      if (range === undefined)
        fail('INVALID_ARGUMENT', 'distance is required, in the units of the scene');
      const sight = optionalBoolean(args, 'requireLineOfSight') === true;
      const includeHidden = optionalBoolean(args, 'includeHidden') !== false;
      const walls = sight ? wallsOf(chosen.scene) : [];
      const warnings: string[] = [];
      const inRange: Array<Record<string, unknown>> = [];
      const outOfSight: Array<{ id: string; name: string }> = [];
      let method: Measure['method'] = 'geometry';
      for (const token of tokensOf(chosen.scene)) {
        if (token.id === from.token?.id) continue;
        if (!includeHidden && token.hidden === true) continue;
        const center = tokenCenter(token, grid);
        const measured = measure([from.point, center], grid, rule, warnings);
        method = measured.method;
        if (measured.distance > range) continue;
        if (sight) {
          const foundry = foundryCollision(chosen.scene, from.point, center, 'sight');
          const blocked =
            foundry ??
            wallsOnLine(from.point, center, walls, 'sight', grid.size / grid.distance).blocked;
          if (blocked) {
            outOfSight.push({ id: token.id, name: token.name ?? '' });
            continue;
          }
        }
        inRange.push({
          id: token.id,
          name: token.name ?? '',
          distance: measured.distance,
          ...(token.hidden === true ? { hidden: true } : {}),
          ...(finite(token.disposition) ? { disposition: token.disposition } : {}),
          ...(token.actorId ? { actorId: token.actorId } : {}),
        });
      }
      inRange.sort((a, b) => (a['distance'] as number) - (b['distance'] as number));
      return {
        scene: sceneInfo(chosen),
        from: label(from),
        distance: range,
        units: grid.units,
        method,
        tokens: inRange,
        ...(sight ? { outOfSight } : {}),
        note: 'Measured from token centers.',
        warnings: [...new Set(warnings)],
      };
    }),
};
