/**
 * The query getSceneImage. Reads only; declares `read` access.
 *
 * Chooses the scene (sceneIdentifier by the lookup rule of the scenes area, otherwise the
 * active one), the path (canvas capture when the GM views that scene, else the
 * composed picture), paints grid, labels and token numbers, encodes within the
 * byte limit, and lists every token with the numbers drawn on the picture.
 */
import {
  IMAGE_FORMATS,
  IMAGE_MODES,
  MAX_BYTES,
  MAX_DIMENSION,
  boundedInteger,
  cellCount,
  cellOf,
  cropRect,
  gridTypeWord,
  isSquareGrid,
  outputSize,
  readRegion,
  rectsOverlap,
  sceneRect,
  type CellRegion,
  type ImageFormat,
  type ImageMode,
  type Rect,
} from '../../../common/areas/scene-image/geometry.js';
import { dispositionWord } from '../../../common/areas/tokens-dice/tokens.js';
import type { QueryHandler } from '../../dispatcher.js';
import { defineAnnouncements } from '../../notify.js';
import { requireWorld } from '../../world-ready.js';
import { backgroundOf } from '../scenes/read.js';
import {
  activeScene,
  booleanArg,
  dataOf,
  fail,
  findScene,
  messageOf,
  operation,
  textArg,
} from '../scenes/support.js';
import {
  canvasShows,
  captureCanvas,
  foundryCanvas,
  loadBackground,
  type Pixels,
} from './capture.js';
import { encodeWithin, paintOverlay, type Marker } from './drawing.js';

export const sceneImageNotes = defineAnnouncements('scene-image', {
  captureFailed: {
    level: 'warn',
    en: 'The canvas could not be captured for the scene image. The picture was composed from the background instead: {reason}',
  },
});

interface Options {
  sceneIdentifier?: string;
  mode: ImageMode;
  grid: boolean;
  gridLabels: boolean;
  tokenMarkers: boolean;
  region?: CellRegion;
  maxDimension: number;
  maxBytes: number;
  format: ImageFormat;
}

function choice<T extends string>(
  data: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  fallback: T,
  problems: string[]
): T {
  const value = data[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value))
    return value as T;
  problems.push(`${key} must be one of ${allowed.join(', ')}`);
  return fallback;
}

export function readOptions(raw: unknown): Options {
  const data = dataOf(raw);
  const problems: string[] = [];
  const flag = (key: string): boolean => {
    try {
      return booleanArg(data, key) ?? true;
    } catch (error) {
      problems.push(messageOf(error));
      return true;
    }
  };
  const { region, problems: regionProblems } = readRegion(data['region']);
  problems.push(...regionProblems);
  const options: Options = {
    mode: choice(data, 'mode', IMAGE_MODES, 'auto', problems),
    grid: flag('grid'),
    gridLabels: flag('gridLabels'),
    tokenMarkers: flag('tokenMarkers'),
    maxDimension: boundedInteger(data['maxDimension'], 'maxDimension', MAX_DIMENSION, problems),
    maxBytes: boundedInteger(data['maxBytes'], 'maxBytes', MAX_BYTES, problems),
    format: choice(data, 'format', IMAGE_FORMATS, 'jpeg', problems),
  };
  const identifier = textArg(data, 'sceneIdentifier');
  if (identifier) options.sceneIdentifier = identifier;
  if (region) options.region = region;
  if (problems.length) fail('INVALID_ARGUMENT', problems.join('; '));
  return options;
}

/** Scene rectangle and cell size: Foundry's computed layout when present, otherwise the same rule by hand. */
export function layoutOf(scene: FoundrySceneImageScene): { rect: Rect; size: number } {
  const d = scene.dimensions;
  const size = scene.grid?.size ?? d?.size ?? 100;
  if (
    d &&
    [d.sceneX, d.sceneY, d.sceneWidth, d.sceneHeight].every(value => typeof value === 'number')
  ) {
    return {
      rect: {
        x: d.sceneX ?? 0,
        y: d.sceneY ?? 0,
        width: d.sceneWidth ?? 0,
        height: d.sceneHeight ?? 0,
      },
      size,
    };
  }
  return { rect: sceneRect(scene.width, scene.height, scene.padding ?? 0, size), size };
}

/** The cell of a token, counted from the scene rectangle; null where no cell rule applies. */
function cellOfToken(
  scene: FoundrySceneImageScene,
  rect: Rect,
  size: number,
  token: FoundrySceneImageToken,
  box: { width: number; height: number }
): { column: number; row: number } | null {
  const type = scene.grid?.type;
  if (type === 0) return null;
  if (isSquareGrid(type)) return cellOf(rect, size, token.x, token.y);
  const offset = scene.grid?.getOffset;
  if (typeof offset !== 'function') return null;
  const at = offset.call(scene.grid, { x: token.x + box.width / 2, y: token.y + box.height / 2 });
  const origin = offset.call(scene.grid, { x: rect.x + size / 2, y: rect.y + size / 2 });
  return { column: at.j - origin.j, row: at.i - origin.i };
}

function groundColour(value: unknown): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : '#999999';
}

function whyNoCanvas(sceneId: string): string {
  const current = foundryCanvas();
  if (!current) return 'Foundry runs without a canvas on this client (noCanvas or no WebGL)';
  if (current.ready !== true) return 'the canvas is not ready yet';
  if (current.scene?.id !== sceneId)
    return `the GM's canvas shows ${current.scene ? `another scene [${current.scene.id}]` : 'no scene'}`;
  return 'the canvas does not show this scene';
}

const OPERATION = 'get the scene image';

export const getSceneImage: QueryHandler = {
  access: { kind: 'read' },
  run: (raw, context) =>
    operation(OPERATION, async () => {
      requireWorld();
      const options = readOptions(raw);
      const found = options.sceneIdentifier ? findScene(options.sceneIdentifier) : activeScene();
      if (!found) fail('SCENE_NOT_FOUND', 'no scene is active; pass sceneIdentifier to name one');
      const scene = found as unknown as FoundrySceneImageScene;

      const warnings: string[] = [];
      const notes: string[] = [];
      const { rect: sceneArea, size } = layoutOf(scene);
      if (!(sceneArea.width > 0) || !(sceneArea.height > 0))
        fail('INVALID_SCENE', `the scene has no size (${scene.width} x ${scene.height})`);
      const crop = cropRect(sceneArea, size, options.region);
      if (crop.problem) fail('INVALID_ARGUMENT', crop.problem);
      if (crop.note) notes.push(`The ${crop.note}.`);
      const rect = crop.rect;

      const shows = canvasShows(scene.id);
      if (options.mode === 'canvas' && !shows)
        fail(
          'CANVAS_UNAVAILABLE',
          `mode "canvas" needs the scene on the GM's canvas, but ${whyNoCanvas(scene.id)}`
        );
      let path: 'canvas' | 'composed' =
        options.mode !== 'composed' && shows ? 'canvas' : 'composed';
      if (options.mode === 'auto' && !shows)
        notes.push(`Composed from the background because ${whyNoCanvas(scene.id)}.`);

      const target = outputSize(rect.width, rect.height, options.maxDimension);
      context.progress({ progress: 1, total: 3, message: `Drawing ${scene.name} (${path})` });

      let pixels: Pixels | null = null;
      if (path === 'canvas') {
        try {
          pixels = captureCanvas(rect, target.scale);
        } catch (error) {
          if (options.mode === 'canvas') throw error;
          warnings.push(
            `The canvas could not be captured, so the picture is composed instead: ${messageOf(error)}`
          );
          sceneImageNotes.announce('captureFailed', { reason: messageOf(error) });
          path = 'composed';
        }
        if (path === 'canvas' && (foundryCanvas()?.tokens?.controlled?.length ?? 0) > 0)
          warnings.push(
            'The GM has tokens selected; tokens outside their vision may be missing from the picture. The token list is complete.'
          );
      }

      let background: string | null = null;
      if (path === 'composed') {
        background = backgroundOf(scene as unknown as FoundryScenesScene);
        if (!background)
          notes.push('The scene has no background file; the picture shows its background colour.');
        else {
          try {
            pixels = await loadBackground(background);
          } catch (error) {
            warnings.push(
              `The background could not be drawn, only colour, grid and markers are: ${messageOf(error)}`
            );
          }
        }
        notes.push(
          'Composed picture: only the background is drawn, no tiles, drawings, walls, lighting or fog.'
        );
      } else {
        notes.push(
          'Canvas picture: background, tiles, drawings and token art, without lighting, fog of war or vision.'
        );
      }

      const gridType = scene.grid?.type;
      const square = isSquareGrid(gridType);
      if (!square && (options.grid || options.gridLabels))
        notes.push(
          `The grid is ${gridTypeWord(gridType)}: no lines or labels are drawn. Token cells ${gridType === 0 ? 'do not apply' : "come from Foundry's grid"}.`
        );

      const tokens = scene.tokens?.contents ?? [];
      const listed = tokens.map((token, i) => {
        const box = { width: (token.width ?? 1) * size, height: (token.height ?? 1) * size };
        return {
          token,
          index: i + 1,
          box,
          cell: cellOfToken(scene, sceneArea, size, token, box),
          inImage: rectsOverlap({ x: token.x, y: token.y, ...box }, rect),
        };
      });
      const markers: Marker[] = options.tokenMarkers
        ? listed
            .filter(entry => entry.inImage)
            .map(entry => ({
              index: entry.index,
              x: entry.token.x,
              y: entry.token.y,
              width: entry.box.width,
              height: entry.box.height,
              disposition:
                typeof entry.token.disposition === 'number' ? entry.token.disposition : 0,
              hidden: entry.token.hidden === true,
            }))
        : [];

      const overlay = {
        rect,
        scene: sceneArea,
        gridSize: size,
        squareGrid: square,
        gridLines: options.grid,
        gridLabels: options.gridLabels,
        markers,
        markerStyle: path === 'canvas' ? ('badge' as const) : ('disc' as const),
      };
      const source = pixels;
      const drawnPath = path;
      context.progress({ progress: 2, total: 3, message: 'Encoding the picture' });
      const encoded = encodeWithin(
        (surface, width, height) => {
          const draw = surface.context;
          draw.fillStyle = groundColour(scene.backgroundColor);
          draw.fillRect(0, 0, width, height);
          if (source && drawnPath === 'canvas') {
            draw.drawImage(source.source, 0, 0, source.width, source.height, 0, 0, width, height);
          } else if (source) {
            const sx = ((rect.x - sceneArea.x) / sceneArea.width) * source.width;
            const sy = ((rect.y - sceneArea.y) / sceneArea.height) * source.height;
            const sw = (rect.width / sceneArea.width) * source.width;
            const sh = (rect.height / sceneArea.height) * source.height;
            draw.drawImage(source.source, sx, sy, sw, sh, 0, 0, width, height);
          }
          paintOverlay(draw, overlay, width);
        },
        { width: target.width, height: target.height },
        options.format,
        options.maxBytes,
        notes
      );
      const scale = encoded.width / rect.width;
      const all = cellCount(sceneArea, size);

      return {
        scene: {
          id: scene.id,
          name: scene.name,
          active: scene.active === true,
          viewedOnCanvas: shows,
        },
        path: drawnPath,
        mode: options.mode,
        image: {
          data: encoded.data,
          mimeType: encoded.mimeType,
          width: encoded.width,
          height: encoded.height,
          bytes: encoded.bytes,
          quality: encoded.quality,
          attempts: encoded.attempts,
        },
        mapping: {
          canvasRect: rect,
          scale,
          rule: 'pictureX = (canvasX - canvasRect.x) * scale, pictureY = (canvasY - canvasRect.y) * scale',
        },
        grid: {
          type: gridTypeWord(gridType),
          size,
          distance: scene.grid?.distance ?? null,
          units: scene.grid?.units ?? null,
          sceneRect: sceneArea,
          columns: all.columns,
          rows: all.rows,
          region: crop.region,
          linesDrawn: square && options.grid,
          labelsDrawn: square && options.gridLabels,
        },
        background,
        tokens: listed.map(entry => ({
          index: entry.index,
          id: entry.token.id,
          name: entry.token.name ?? '',
          actorId: entry.token.actorId ?? null,
          cell: entry.cell,
          x: entry.token.x,
          y: entry.token.y,
          width: entry.token.width ?? 1,
          height: entry.token.height ?? 1,
          elevation: entry.token.elevation ?? 0,
          disposition: dispositionWord(
            typeof entry.token.disposition === 'number' ? entry.token.disposition : 0
          ),
          hidden: entry.token.hidden === true,
          inImage: entry.inImage,
          markerDrawn: entry.inImage && options.tokenMarkers,
          pictureCenter: entry.inImage
            ? {
                x: Math.round((entry.token.x + entry.box.width / 2 - rect.x) * scale),
                y: Math.round((entry.token.y + entry.box.height / 2 - rect.y) * scale),
              }
            : null,
        })),
        tokenSummary: {
          total: listed.length,
          inImage: listed.filter(entry => entry.inImage).length,
          hidden: listed.filter(entry => entry.token.hidden === true).length,
        },
        warnings,
        notes,
      };
    }),
};
