/**
 * What every canvas handler shares. The scene, the drawn canvas
 * of the Gamemaster's browser, the grid, tokens and points.
 *
 * Which scene: `sceneIdentifier` (id or name, the lookup rule of the scenes area),
 * otherwise the scene that is active for everyone, as in the tokens-dice area. View
 * actions (pan, ping, targets) work on the scene the Gamemaster's canvas shows
 * and fail when another one is named.
 */
import {
  ELEMENT_KINDS,
  ELEMENT_TYPES,
  finite,
  isRecord,
  type ElementType,
} from '../../../common/areas/canvas/elements.js';
import type { GridInfo, Point, WallLike } from '../../../common/areas/canvas/geometry.js';
import { lookup, lookupFailure } from '../../../common/areas/scenes/lookup.js';
import type { Access } from '../../../common/permissions.js';
import {
  argsOf,
  fail,
  messageOf,
  operation,
  optionalBoolean,
  optionalText,
} from '../tokens-dice/support.js';

export { argsOf, fail, finite, isRecord, messageOf, operation, optionalBoolean, optionalText };

export const READ: Access = { kind: 'read' };
export const SCENE_UPDATE: Access = { kind: 'write', document: 'Scenes', action: 'update' };
export const SCENE_DELETE: Access = { kind: 'write', document: 'Scenes', action: 'delete' };

export interface ChosenScene {
  scene: FoundryCanvasScene;
  by: 'active' | 'parameter' | 'viewed';
}

export function sceneList(): FoundryCanvasScene[] {
  return game.scenes.contents as FoundryCanvasScene[];
}

export function chooseScene(args: Record<string, unknown>): ChosenScene {
  const identifier = optionalText(args, 'sceneIdentifier')?.trim();
  const scenes = sceneList();
  if (identifier) {
    const result = lookup(
      scenes.map(scene => ({ id: scene.id, name: scene.name ?? '', scene })),
      identifier
    );
    if (result.found) return { scene: result.entry.scene, by: 'parameter' };
    fail(
      result.reason === 'ambiguous' ? 'AMBIGUOUS' : 'SCENE_NOT_FOUND',
      lookupFailure('scene', identifier, result)
    );
  }
  const active = scenes.find(scene => scene.active === true);
  if (!active)
    fail(
      'NO_ACTIVE_SCENE',
      'No scene is active. Activate a scene for everyone, or pass sceneIdentifier.'
    );
  return { scene: active, by: 'active' };
}

export function sceneInfo(chosen: ChosenScene): Record<string, unknown> {
  return {
    id: chosen.scene.id,
    name: chosen.scene.name ?? '',
    active: chosen.scene.active === true,
    chosenBy:
      chosen.by === 'active'
        ? 'active scene'
        : chosen.by === 'viewed'
          ? 'viewed scene'
          : 'sceneIdentifier',
  };
}

/** The scene as the world collection holds it now, for reading back. */
export function freshScene(id: string): FoundryCanvasScene {
  const scene = game.scenes.get(id) as FoundryCanvasScene | undefined;
  if (!scene) fail('SCENE_NOT_FOUND', `The scene [${id}] is gone from the world.`);
  return scene;
}

export function board(): FoundryCanvasBoard | undefined {
  return (globalThis as { canvas?: FoundryCanvasBoard }).canvas;
}

export function polygonBackend(type: string): FoundryCanvasPolygonBackend | undefined {
  return (globalThis as { CONFIG?: FoundryCanvasConfig }).CONFIG?.Canvas?.polygonBackends?.[type];
}

/**
 * The drawn canvas and the scene it shows, or a failure that says why not.
 * `what` starts the sentence ("Panning the camera").
 */
export function requireBoard(
  what: string,
  args: Record<string, unknown>
): { canvas: FoundryCanvasBoard; chosen: ChosenScene } {
  const canvas = board();
  if (!canvas || canvas.ready !== true || !canvas.scene) {
    fail(
      'CANVAS_REQUIRED',
      `${what} needs the drawn canvas in the Gamemaster's browser, and there is none (canvas.ready is not true). ` +
        'Foundry does not draw it when "Disable Game Canvas" is on for this browser in the core settings, ' +
        'or while a scene is still loading. Nothing was done.'
    );
  }
  const viewed = game.scenes.get(canvas.scene.id) as FoundryCanvasScene | undefined;
  if (!viewed)
    fail(
      'SCENE_NOT_FOUND',
      `The canvas shows the scene [${canvas.scene.id}], which is not in the world.`
    );
  if (optionalText(args, 'sceneIdentifier')?.trim()) {
    const named = chooseScene(args);
    if (named.scene.id !== viewed.id) {
      fail(
        'NOT_VIEWED',
        `${what} works on the scene the Gamemaster views, which is "${viewed.name ?? ''}" [${viewed.id}], ` +
          `not "${named.scene.name ?? ''}" [${named.scene.id}]. View that scene first; switch-scene activates it for everyone. Nothing was done.`
      );
    }
  }
  return { canvas, chosen: { scene: viewed, by: 'viewed' } };
}

export function elementTypeOf(args: Record<string, unknown>, key = 'elementType'): ElementType {
  const value = args[key];
  if (typeof value !== 'string' || !(ELEMENT_TYPES as readonly string[]).includes(value))
    fail('INVALID_ARGUMENT', `${key} must be one of ${ELEMENT_TYPES.join(', ')}`);
  return value as ElementType;
}

export function elementsOf(
  scene: FoundryCanvasScene,
  type: ElementType
): FoundryCollection<FoundryCanvasElement> {
  const { documentName } = ELEMENT_KINDS[type];
  try {
    return scene.getEmbeddedCollection(documentName) as FoundryCollection<FoundryCanvasElement>;
  } catch (error) {
    return fail(
      'UNSUPPORTED',
      `The scene "${scene.name ?? ''}" has no ${documentName} documents in this Foundry version: ${messageOf(error)}`
    );
  }
}

export function gridOf(
  scene: FoundryCanvasScene
): GridInfo & { measurePath?: FoundryCanvasGrid['measurePath'] } {
  const grid = isRecord(scene.grid) ? (scene.grid as FoundryCanvasGrid) : {};
  const info: GridInfo & { measurePath?: FoundryCanvasGrid['measurePath'] } = {
    type: finite(grid.type) ? grid.type : 1,
    size: finite(grid.size) && grid.size > 0 ? grid.size : 100,
    distance: finite(grid.distance) && grid.distance > 0 ? grid.distance : 1,
    units: typeof grid.units === 'string' ? grid.units : '',
  };
  if (typeof grid.measurePath === 'function') info.measurePath = grid.measurePath.bind(grid);
  return info;
}

/** Foundry's core setting "gridDiagonals"; 0 (equidistant) when it cannot be read. */
export function diagonalRule(): number {
  try {
    const value = game.settings.get('core', 'gridDiagonals');
    return finite(value) ? value : 0;
  } catch {
    return 0;
  }
}

export function wallsOf(scene: FoundryCanvasScene): WallLike[] {
  return elementsOf(scene, 'wall').map(wall => {
    const data = wall.toObject();
    return {
      ...data,
      id: wall.id,
      c: Array.isArray(data['c']) ? (data['c'] as number[]) : [],
    } as WallLike;
  });
}

export function tokensOf(scene: FoundryCanvasScene): FoundryCanvasToken[] {
  return scene.tokens?.contents ?? [];
}

/** A token of the scene by id, exact name or name in any case; several are an error. */
export function tokenOn(scene: FoundryCanvasScene, identifier: string): FoundryCanvasToken {
  const result = lookup(
    tokensOf(scene).map(token => ({ id: token.id, name: token.name ?? '', token })),
    identifier
  );
  if (result.found) return result.entry.token;
  return fail(
    result.reason === 'ambiguous' ? 'AMBIGUOUS' : 'TOKEN_NOT_FOUND',
    lookupFailure('token', identifier, result, `the scene "${scene.name ?? ''}" [${scene.id}]`)
  );
}

export function tokenCenter(token: FoundryCanvasToken, grid: GridInfo): Point {
  const width = finite(token.width) ? token.width : 1;
  const height = finite(token.height) ? token.height : 1;
  return { x: token.x + (width * grid.size) / 2, y: token.y + (height * grid.size) / 2 };
}

export interface Located {
  point: Point;
  token?: { id: string; name: string };
}

/** A place given as `{ tokenId }` or `{ x, y }` under `key`. */
export function placeOf(
  args: Record<string, unknown>,
  key: string,
  scene: FoundryCanvasScene,
  grid: GridInfo
): Located {
  const value = args[key];
  if (!isRecord(value))
    fail('INVALID_ARGUMENT', `${key} must be an object with tokenId, or with x and y in pixels`);
  if (typeof value['tokenId'] === 'string' && value['tokenId'].trim()) {
    const token = tokenOn(scene, value['tokenId'].trim());
    return { point: tokenCenter(token, grid), token: { id: token.id, name: token.name ?? '' } };
  }
  if (finite(value['x']) && finite(value['y'])) return { point: { x: value['x'], y: value['y'] } };
  return fail('INVALID_ARGUMENT', `${key} must name a tokenId, or give both x and y as numbers`);
}

/** An optional number within limits. */
export function numberIn(
  args: Record<string, unknown>,
  key: string,
  limits: { min: number; max: number; integer?: boolean }
): number | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (
    !finite(value) ||
    value < limits.min ||
    value > limits.max ||
    (limits.integer && !Number.isInteger(value))
  )
    fail(
      'INVALID_ARGUMENT',
      `${key} must be ${limits.integer ? 'a whole number' : 'a number'} from ${limits.min} to ${limits.max}`
    );
  return value;
}

export function listIn(
  args: Record<string, unknown>,
  key: string,
  max: number,
  min = 1
): unknown[] {
  const value = args[key];
  if (!Array.isArray(value)) fail('INVALID_ARGUMENT', `${key} must be a list`);
  if (value.length < min) fail('INVALID_ARGUMENT', `${key} needs at least ${min} entry`);
  if (value.length > max)
    fail(
      'INVALID_ARGUMENT',
      `${key} has ${value.length} entries; one call takes at most ${max}. Split it into several calls.`
    );
  return value;
}

/** Ids given as a list of texts, each once. */
export function idsIn(args: Record<string, unknown>, key: string, max: number, min = 1): string[] {
  const list = listIn(args, key, max, min);
  if (!list.every(entry => typeof entry === 'string' && entry.trim()))
    fail('INVALID_ARGUMENT', `${key} must be a list of ids`);
  const ids = (list as string[]).map(id => id.trim());
  const twice = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (twice.length)
    fail(
      'INVALID_ARGUMENT',
      `${key} names the same id more than once: ${[...new Set(twice)].join(', ')}`
    );
  return ids;
}
