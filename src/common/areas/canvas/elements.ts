/**
 * What the scene contents tools know about each kind of
 * placeable, without Foundry. Walls, lights, sounds, regions, tiles and
 * drawings are embedded documents of a scene; this file names them, turns the
 * readable words for walls into Foundry's numbers, checks what a create or an
 * update carries before anything is sent, and compares what was asked with
 * what Foundry stored.
 *
 * Numbers of walls as Foundry 13 and 14 define them (CONST.WALL_SENSE_TYPES,
 * WALL_MOVEMENT_TYPES, WALL_DOOR_TYPES, WALL_DOOR_STATES, WALL_DIRECTIONS).
 */

export const ELEMENT_TYPES = ['wall', 'light', 'sound', 'region', 'tile', 'drawing'] as const;
export type ElementType = (typeof ELEMENT_TYPES)[number];

export interface ElementKind {
  /** Foundry's embedded document name. */
  documentName: string;
  /** The field of the scene that holds them. */
  field: string;
  plural: string;
}

export const ELEMENT_KINDS: Readonly<Record<ElementType, ElementKind>> = {
  wall: { documentName: 'Wall', field: 'walls', plural: 'walls' },
  light: { documentName: 'AmbientLight', field: 'lights', plural: 'lights' },
  sound: { documentName: 'AmbientSound', field: 'sounds', plural: 'sounds' },
  region: { documentName: 'Region', field: 'regions', plural: 'regions' },
  tile: { documentName: 'Tile', field: 'tiles', plural: 'tiles' },
  drawing: { documentName: 'Drawing', field: 'drawings', plural: 'drawings' },
};

/** Largest number of elements one create, update or delete call takes. */
export const MAX_BATCH = 200;
export const LIST_DEFAULT_LIMIT = 100;
export const LIST_MAX_LIMIT = 500;

export const WALL_SENSE: Readonly<Record<string, number>> = {
  none: 0,
  limited: 10,
  normal: 20,
  proximity: 30,
  distance: 40,
};
export const WALL_MOVE: Readonly<Record<string, number>> = { none: 0, normal: 20 };
export const DOOR_TYPES: Readonly<Record<string, number>> = { none: 0, door: 1, secret: 2 };
export const DOOR_STATES: Readonly<Record<string, number>> = { closed: 0, open: 1, locked: 2 };
export const WALL_DIRECTIONS: Readonly<Record<string, number>> = { both: 0, left: 1, right: 2 };

const WALL_FIELDS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  move: WALL_MOVE,
  sight: WALL_SENSE,
  light: WALL_SENSE,
  sound: WALL_SENSE,
  door: DOOR_TYPES,
  ds: DOOR_STATES,
  dir: WALL_DIRECTIONS,
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** The word for a number of one of the tables above, or the number as text. */
export function wordOf(table: Readonly<Record<string, number>>, value: unknown): string {
  const hit = Object.entries(table).find(([, number]) => number === value);
  return hit ? hit[0] : value === undefined || value === null ? 'default' : String(value);
}

/** The module's own flags must not be written by a caller: they mark what the MCP created. */
const OWN_FLAGS = 'ninjos-foundry-mcp';

function forbiddenKey(key: string): string | null {
  const parts = key.split('.');
  if (parts.some(part => part.startsWith('-=') || part.startsWith('=='))) {
    return `"${key}" uses one of Foundry's operators "-=" or "==", which this tool does not send; set the field to null instead`;
  }
  if (parts[0] === '_id' || parts[0] === '_stats')
    return `"${key}" is managed by Foundry and cannot be set`;
  if (parts[0] === 'flags' && parts[1] === OWN_FLAGS)
    return `"${key}" holds the markers of Ninjo's Foundry MCP and cannot be set`;
  return null;
}

/** Every problem with keys anywhere in a value: operators, _id, _stats, the module's flags. */
function keyProblems(value: unknown, prefix = ''): string[] {
  if (!isRecord(value)) return [];
  const problems: string[] = [];
  for (const [key, inner] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const problem = forbiddenKey(path);
    if (problem) {
      problems.push(problem);
      continue;
    }
    // Arrays (region shapes and behaviors) may carry their own ids; only objects are walked.
    problems.push(...keyProblems(inner, path));
  }
  return problems;
}

function translateWallField(key: string, value: unknown, problems: string[]): unknown {
  const table = WALL_FIELDS[key];
  if (!table) return value;
  if (typeof value === 'string') {
    const number = table[value.trim().toLowerCase()];
    if (number === undefined) {
      problems.push(`${key} "${value}" is not one of ${Object.keys(table).join(', ')}`);
      return value;
    }
    return number;
  }
  if (!finite(value) || !Object.values(table).includes(value)) {
    problems.push(
      `${key} must be one of ${Object.keys(table).join(', ')} (or its number ${Object.values(table).join(', ')})`
    );
  }
  return value;
}

function checkCoordinates(c: unknown, problems: string[]): void {
  if (!Array.isArray(c) || c.length !== 4 || !c.every(finite)) {
    problems.push('c must be four numbers [x0, y0, x1, y1] in pixels');
    return;
  }
  if (c[0] === c[2] && c[1] === c[3]) problems.push('c describes a wall of length 0');
}

function requireFinite(data: Record<string, unknown>, keys: string[], problems: string[]): void {
  for (const key of keys) if (!finite(data[key])) problems.push(`${key} must be a number`);
}

function textAt(data: Record<string, unknown>, path: string): unknown {
  let node: unknown = data;
  for (const part of path.split('.')) node = isRecord(node) ? node[part] : undefined;
  return node;
}

export interface Prepared {
  data: Record<string, unknown>;
  problems: string[];
}

/**
 * Check one element for create or the changes of one update, and translate
 * the words of walls. `doorState` is accepted for `ds`. Nothing here decides
 * what Foundry's data model will do with the rest; the read back does.
 */
export function prepareElement(
  type: ElementType,
  input: unknown,
  mode: 'create' | 'update'
): Prepared {
  const problems: string[] = [];
  if (!isRecord(input)) return { data: {}, problems: ['must be an object of fields'] };
  const data: Record<string, unknown> = { ...input };
  if (mode === 'update' && '_id' in data) {
    problems.push('the id goes into "id" next to "changes", not into the changes');
    delete data['_id'];
  }
  problems.push(...keyProblems(data));

  if (type === 'wall') {
    if ('doorState' in data) {
      if ('ds' in data) problems.push('give either doorState or ds, not both');
      data['ds'] = data['doorState'];
      delete data['doorState'];
    }
    for (const key of Object.keys(WALL_FIELDS)) {
      if (key in data) data[key] = translateWallField(key, data[key], problems);
    }
    if (mode === 'create' || 'c' in data) checkCoordinates(data['c'], problems);
    if (finite(data['ds']) && data['ds'] !== 0 && data['door'] === 0)
      problems.push('a door state needs door "door" or "secret"; door is "none"');
  }

  if (mode === 'create') {
    if (type === 'light') requireFinite(data, ['x', 'y'], problems);
    if (type === 'sound') {
      requireFinite(data, ['x', 'y', 'radius'], problems);
      if (finite(data['radius']) && data['radius'] <= 0)
        problems.push('radius must be larger than 0');
      if (typeof data['path'] !== 'string' || !data['path'].trim())
        problems.push('path must be the audio file, e.g. "sounds/rain.ogg"');
    }
    if (type === 'tile') {
      requireFinite(data, ['x', 'y', 'width', 'height'], problems);
      const src = textAt(data, 'texture.src');
      if (typeof src !== 'string' || !src.trim())
        problems.push('texture.src must be the image file of the tile');
    }
    if (type === 'drawing') {
      requireFinite(data, ['x', 'y'], problems);
      if (!isRecord(data['shape']) || typeof data['shape']['type'] !== 'string')
        problems.push(
          'shape must be an object with type "r" (rectangle), "e" (ellipse), "p" (polygon) and its size'
        );
    }
    if (type === 'region') {
      if (!Array.isArray(data['shapes']) || data['shapes'].length === 0)
        problems.push(
          'shapes must be a list with at least one shape, e.g. { type: "rectangle", x, y, width, height }'
        );
      if ('behaviors' in data && !Array.isArray(data['behaviors']))
        problems.push(
          'behaviors must be a list of behaviors, e.g. { type: "teleportToken", system: {...} }'
        );
    }
  } else if (Object.keys(data).length === 0) {
    problems.push('changes is empty');
  }
  return { data, problems };
}

/** Whether a stored value holds what was asked: objects by their given keys, lists entry by entry. */
export function holds(requested: unknown, stored: unknown): boolean {
  if (finite(requested)) return finite(stored) && Math.abs(requested - stored) < 1e-6;
  if (Array.isArray(requested)) {
    return (
      Array.isArray(stored) &&
      requested.length === stored.length &&
      requested.every((entry, index) => holds(entry, stored[index]))
    );
  }
  if (isRecord(requested)) {
    return (
      isRecord(stored) &&
      Object.entries(requested).every(([key, value]) => holds(value, stored[key]))
    );
  }
  if (requested === null) return stored === null || stored === undefined;
  return requested === stored;
}

/** Read a dotted path, as Foundry's update keys use it. */
export function valueAt(data: unknown, path: string): unknown {
  return textAt(isRecord(data) ? data : {}, path);
}

export interface Difference {
  path: string;
  requested: unknown;
  stored: unknown;
}

/** The requested top level or dotted keys whose stored value differs. */
export function differences(requested: Record<string, unknown>, stored: unknown): Difference[] {
  const out: Difference[] = [];
  for (const [path, value] of Object.entries(requested)) {
    const now = valueAt(stored, path);
    if (!holds(value, now)) out.push({ path, requested: value, stored: now ?? null });
  }
  return out;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function boxOfPoints(points: number[]): Box | null {
  if (points.length < 2) return null;
  const xs = points.filter((_, index) => index % 2 === 0);
  const ys = points.filter((_, index) => index % 2 === 1);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** Where an element lies, roughly, for the bounds filter. Null when it cannot be told. */
export function boxOf(type: ElementType, data: Record<string, unknown>): Box | null {
  if (type === 'wall') {
    const c = data['c'];
    return Array.isArray(c) && c.every(finite) ? boxOfPoints(c) : null;
  }
  if (type === 'light' || type === 'sound') {
    return finite(data['x']) && finite(data['y'])
      ? { x: data['x'], y: data['y'], width: 0, height: 0 }
      : null;
  }
  if (type === 'tile') {
    return finite(data['x']) && finite(data['y'])
      ? {
          x: data['x'],
          y: data['y'],
          width: finite(data['width']) ? data['width'] : 0,
          height: finite(data['height']) ? data['height'] : 0,
        }
      : null;
  }
  if (type === 'drawing') {
    const shape = isRecord(data['shape']) ? data['shape'] : {};
    return finite(data['x']) && finite(data['y'])
      ? {
          x: data['x'],
          y: data['y'],
          width: finite(shape['width']) ? shape['width'] : 0,
          height: finite(shape['height']) ? shape['height'] : 0,
        }
      : null;
  }
  const points: number[] = [];
  for (const shape of Array.isArray(data['shapes']) ? data['shapes'] : []) {
    if (!isRecord(shape)) continue;
    if (Array.isArray(shape['points'])) points.push(...shape['points'].filter(finite));
    if (finite(shape['x']) && finite(shape['y'])) {
      const w = finite(shape['width']) ? shape['width'] : 0;
      const h = finite(shape['height']) ? shape['height'] : 0;
      const r = finite(shape['radiusX'])
        ? shape['radiusX']
        : finite(shape['radius'])
          ? shape['radius']
          : 0;
      const ry = finite(shape['radiusY']) ? shape['radiusY'] : r;
      points.push(shape['x'] - r, shape['y'] - ry, shape['x'] + w + r, shape['y'] + h + ry);
    }
  }
  return boxOfPoints(points);
}

export function boxesTouch(a: Box, b: Box): boolean {
  return (
    a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height
  );
}

function pick(data: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const value = valueAt(data, key);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** A short description of one element for lists and answers. */
export function summarize(
  type: ElementType,
  data: Record<string, unknown>
): Record<string, unknown> {
  const id = data['_id'] ?? data['id'];
  if (type === 'wall') {
    const door = data['door'] ?? 0;
    return {
      id,
      c: data['c'],
      door: wordOf(DOOR_TYPES, door),
      ...(door !== 0 ? { doorState: wordOf(DOOR_STATES, data['ds'] ?? 0) } : {}),
      move: wordOf(WALL_MOVE, data['move']),
      sight: wordOf(WALL_SENSE, data['sight']),
      light: wordOf(WALL_SENSE, data['light']),
      sound: wordOf(WALL_SENSE, data['sound']),
      direction: wordOf(WALL_DIRECTIONS, data['dir'] ?? 0),
    };
  }
  if (type === 'light') {
    return {
      id,
      ...pick(data, [
        'x',
        'y',
        'elevation',
        'config.dim',
        'config.bright',
        'config.color',
        'config.angle',
        'walls',
        'hidden',
      ]),
    };
  }
  if (type === 'sound') {
    return {
      id,
      ...pick(data, ['x', 'y', 'elevation', 'radius', 'path', 'volume', 'walls', 'hidden']),
    };
  }
  if (type === 'tile') {
    return {
      id,
      ...pick(data, [
        'x',
        'y',
        'width',
        'height',
        'elevation',
        'rotation',
        'texture.src',
        'hidden',
      ]),
    };
  }
  if (type === 'drawing') {
    return {
      id,
      ...pick(data, ['x', 'y', 'shape.type', 'shape.width', 'shape.height', 'text', 'hidden']),
    };
  }
  const shapes = Array.isArray(data['shapes']) ? data['shapes'].filter(isRecord) : [];
  const behaviors = Array.isArray(data['behaviors']) ? data['behaviors'].filter(isRecord) : [];
  return {
    id,
    name: data['name'] ?? '',
    shapes: shapes.map(shape => shape['type'] ?? 'unknown'),
    behaviors: behaviors.map(behavior => ({
      type: behavior['type'] ?? 'unknown',
      ...(behavior['name'] ? { name: behavior['name'] } : {}),
      ...(behavior['disabled'] === true ? { disabled: true } : {}),
    })),
    ...pick(data, ['color', 'visibility', 'elevation']),
  };
}
