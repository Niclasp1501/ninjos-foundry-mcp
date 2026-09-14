/**
 * Area scene-image: the arithmetic behind a picture of a scene, free
 * of Foundry and of the DOM, so server and module agree and tests need neither.
 *
 * Coordinates: Foundry stores token positions in canvas pixels, which include
 * the padding around the scene. The picture shows the scene rectangle (or a
 * crop of it). Grid cells are counted from the top left full cell of the scene
 * rectangle, starting at 0, in the list and in the labels drawn on the picture.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CellRegion {
  column: number;
  row: number;
  columns: number;
  rows: number;
}

export type ImageFormat = 'jpeg' | 'webp';
export type ImageMode = 'auto' | 'canvas' | 'composed';

export const IMAGE_FORMATS: readonly ImageFormat[] = ['jpeg', 'webp'];
export const IMAGE_MODES: readonly ImageMode[] = ['auto', 'canvas', 'composed'];

/**
 * Long edge in pixels. 1568 is where Claude stops scaling an image down, so a
 * larger default costs bytes without showing the model more.
 */
export const MAX_DIMENSION = { default: 1568, min: 256, max: 4096 } as const;

/**
 * Bytes of the encoded image. The upper bound keeps the Base64 text under 5 MB,
 * the image limit of the Claude API; the bridge itself would carry 64 MB.
 */
export const MAX_BYTES = { default: 1_000_000, min: 50_000, max: 3_750_000 } as const;

/** Qualities tried in order before the picture is made smaller. */
export const QUALITY_STEPS: readonly number[] = [0.85, 0.72, 0.6, 0.48, 0.36];

/** Each size step keeps this share of the edge. */
export const SHRINK_FACTOR = 0.75;

export const MIME_OF: Readonly<Record<ImageFormat, string>> = {
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/** Foundry's grid types by number. */
export const GRID_TYPES: Readonly<Record<number, string>> = {
  0: 'gridless',
  1: 'square',
  2: 'hexagonal-odd-rows',
  3: 'hexagonal-even-rows',
  4: 'hexagonal-odd-columns',
  5: 'hexagonal-even-columns',
};

export function gridTypeWord(type: unknown): string {
  return typeof type === 'number' ? (GRID_TYPES[type] ?? 'unknown') : 'square';
}

export function isSquareGrid(type: unknown): boolean {
  return type === undefined || type === null || type === 1;
}

/**
 * The scene rectangle inside the canvas: padding is rounded up to whole grid
 * cells on each side, the way Foundry lays out a scene.
 */
export function sceneRect(width: number, height: number, padding: number, size: number): Rect {
  const cell = size > 0 ? size : 100;
  const pad = Number.isFinite(padding) && padding > 0 ? padding : 0;
  return {
    x: Math.ceil((width * pad) / cell) * cell,
    y: Math.ceil((height * pad) / cell) * cell,
    width,
    height,
  };
}

/** Whole and partial cells of the scene rectangle. */
export function cellCount(rect: Rect, size: number): { columns: number; rows: number } {
  const cell = size > 0 ? size : 100;
  return { columns: Math.ceil(rect.width / cell), rows: Math.ceil(rect.height / cell) };
}

export function readRegion(raw: unknown): { region?: CellRegion; problems: string[] } {
  if (raw === undefined || raw === null) return { problems: [] };
  if (typeof raw !== 'object' || Array.isArray(raw))
    return { problems: ['region must be an object with column, row, columns and rows'] };
  const data = raw as Record<string, unknown>;
  const problems: string[] = [];
  const whole = (key: keyof CellRegion, least: number): number => {
    const value = data[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < least) {
      problems.push(`region.${key} must be a whole number of at least ${least}`);
      return least;
    }
    return value;
  };
  const region: CellRegion = {
    column: whole('column', 0),
    row: whole('row', 0),
    columns: whole('columns', 1),
    rows: whole('rows', 1),
  };
  return problems.length ? { problems } : { region, problems };
}

/**
 * The canvas rectangle of a cell region, clipped to the scene. A region that
 * lies completely outside is a problem; a clipped one gives a note.
 */
export function cropRect(
  scene: Rect,
  size: number,
  region: CellRegion | undefined
): { rect: Rect; region: CellRegion; note?: string; problem?: string } {
  const cell = size > 0 ? size : 100;
  const all = cellCount(scene, cell);
  if (!region) return { rect: { ...scene }, region: { column: 0, row: 0, ...all } };
  if (region.column >= all.columns || region.row >= all.rows) {
    return {
      rect: { ...scene },
      region,
      problem:
        `region starts at column ${region.column}, row ${region.row}, outside the scene, which has ` +
        `columns 0 to ${all.columns - 1} and rows 0 to ${all.rows - 1}`,
    };
  }
  const columns = Math.min(region.columns, all.columns - region.column);
  const rows = Math.min(region.rows, all.rows - region.row);
  const x = scene.x + region.column * cell;
  const y = scene.y + region.row * cell;
  const rect = {
    x,
    y,
    width: Math.min(columns * cell, scene.x + scene.width - x),
    height: Math.min(rows * cell, scene.y + scene.height - y),
  };
  const clipped = columns !== region.columns || rows !== region.rows;
  const result: { rect: Rect; region: CellRegion; note?: string } = {
    rect,
    region: { column: region.column, row: region.row, columns, rows },
  };
  if (clipped)
    result.note = `region was clipped to the scene: ${columns} columns and ${rows} rows instead of ${region.columns} and ${region.rows}`;
  return result;
}

/** The cell of a canvas point on a square grid, counted from the scene rectangle. */
export function cellOf(
  scene: Rect,
  size: number,
  x: number,
  y: number
): { column: number; row: number } {
  const cell = size > 0 ? size : 100;
  return { column: Math.floor((x - scene.x) / cell), row: Math.floor((y - scene.y) / cell) };
}

/** Output size for a source rectangle: the long edge at most `maxDimension`, never enlarged. */
export function outputSize(
  width: number,
  height: number,
  maxDimension: number
): { width: number; height: number; scale: number } {
  const long = Math.max(width, height, 1);
  const scale = Math.min(1, maxDimension / long);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

/** The next smaller size, or null below the smallest long edge. */
export function shrink(width: number, height: number): { width: number; height: number } | null {
  const next = {
    width: Math.round(width * SHRINK_FACTOR),
    height: Math.round(height * SHRINK_FACTOR),
  };
  return Math.max(next.width, next.height) < MAX_DIMENSION.min ? null : next;
}

export function dataUrlParts(dataUrl: string): { mimeType: string; data: string } | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  return match && match[1] !== undefined && match[2] !== undefined
    ? { mimeType: match[1], data: match[2] }
    : null;
}

/** Decoded length of a Base64 text. */
export function base64Bytes(data: string): number {
  const clean = data.replace(/\s/g, '');
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - padding;
}

/** Every how many cells a label is drawn, so labels stay at least `minPixels` apart. */
export function labelEvery(cellPixels: number, minPixels = 22): number {
  if (!(cellPixels > 0)) return 1;
  for (const step of [1, 2, 5, 10, 20, 50, 100]) if (cellPixels * step >= minPixels) return step;
  return 100;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** A whole number within bounds, the default when absent, or a problem. */
export function boundedInteger(
  value: unknown,
  name: string,
  bounds: { default: number; min: number; max: number },
  problems: string[]
): number {
  if (value === undefined || value === null) return bounds.default;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < bounds.min ||
    value > bounds.max
  ) {
    problems.push(`${name} must be a whole number from ${bounds.min} to ${bounds.max}`);
    return bounds.default;
  }
  return value;
}
