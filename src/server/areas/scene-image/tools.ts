/**
 * Get-scene-image on the server side.
 *
 * A new tool; no tool
 * of the previous generation took a picture, so the name is our own. The
 * module paints and encodes; the server checks what arrives and hands the
 * model one image block plus the token list and grid as JSON text, so the
 * coordinates in the picture can be used with the token tools.
 */
import {
  IMAGE_FORMATS,
  IMAGE_MODES,
  MAX_BYTES,
  MAX_DIMENSION,
  base64Bytes,
} from '../../../common/areas/scene-image/geometry.js';
import { legacyFailure, messageOf, moduleTooOld } from '../../tools/results.js';
import { readOnlyTool, type ToolDefinition, type ToolOutput } from '../../tools/types.js';

export const SCENE_IMAGE_QUERY = 'getSceneImage';

/** Loading a large background and several encodings may take a while; progress restarts it. */
export const SCENE_IMAGE_TIMEOUT_MS = 120_000;

const OPERATION = 'get the scene image';
const MIME_TYPES = new Set(['image/jpeg', 'image/webp']);

type Json = Record<string, unknown>;

/** One parameter: its JSON type, what it means, and extras such as enum or default. */
const kind = (jsonType: string, meaning: string, extra: Json = {}): Json => ({
  type: jsonType,
  description: meaning,
  ...extra,
});
/** An object of parameters. */
const shape = (fields: Json, extra: Json = {}): Json => ({
  type: 'object',
  properties: fields,
  ...extra,
});
const ON = { default: true };

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function withPrefix(reason: string): string {
  return reason.toLowerCase().includes(`failed to ${OPERATION}`)
    ? reason
    : `Failed to ${OPERATION}: ${reason}`;
}

const DESCRIPTION =
  'Take a picture of a scene so you can look at the map. Returns one image and, as JSON, every token with ' +
  'its number on the picture, name, grid cell, canvas position, size, disposition and hidden flag, plus the ' +
  'grid (type, cell size, distance) and how canvas pixels map to picture pixels. Grid labels on the picture ' +
  'count cells from 0 at the top left of the scene, the same numbers as the token list. When the GM views the ' +
  'scene, the rendered canvas is captured (background, tiles, drawings, token art; no lighting, fog or ' +
  'vision). Otherwise, or with mode "composed", the picture is the background with grid and numbered token ' +
  'markers. Read only.';

export const getSceneImageTool: ToolDefinition = {
  name: 'get-scene-image',
  title: 'Scene image',
  group: 'scenes',
  description: DESCRIPTION,
  annotations: readOnlyTool('Scene image'),
  inputSchema: shape(
    {
      sceneIdentifier: kind(
        'string',
        'Scene by id or name. Without it the scene that is active for everyone.'
      ),
      mode: kind(
        'string',
        'auto: capture the canvas when the GM views this scene, otherwise compose. canvas: only a capture, an error when the scene is not on the canvas. composed: always background plus markers.',
        { enum: [...IMAGE_MODES], default: 'auto' }
      ),
      grid: kind('boolean', 'Draw grid lines (square grids).', ON),
      gridLabels: kind(
        'boolean',
        'Write column numbers along the top and row numbers along the left edge.',
        ON
      ),
      tokenMarkers: kind(
        'boolean',
        'Draw the token numbers of the list on the picture, coloured by disposition.',
        ON
      ),
      region: shape(
        {
          column: kind('integer', 'First column, from 0.'),
          row: kind('integer', 'First row, from 0.'),
          columns: kind('integer', 'Number of columns, at least 1.'),
          rows: kind('integer', 'Number of rows, at least 1.'),
        },
        {
          description: 'Only this part of the scene, in grid cells counted from 0 at the top left.',
          required: ['column', 'row', 'columns', 'rows'],
        }
      ),
      maxDimension: kind(
        'integer',
        `Long edge of the picture in pixels, ${MAX_DIMENSION.min} to ${MAX_DIMENSION.max}. Never enlarged beyond the scene.`,
        { default: MAX_DIMENSION.default }
      ),
      maxBytes: kind(
        'integer',
        `Largest encoded size in bytes, ${MAX_BYTES.min} to ${MAX_BYTES.max}. Quality is lowered first, then the size.`,
        { default: MAX_BYTES.default }
      ),
      format: kind('string', 'jpeg (every client) or webp (smaller).', {
        enum: [...IMAGE_FORMATS],
        default: 'jpeg',
      }),
    },
    { additionalProperties: false }
  ),
  handler: async (args, context) => {
    const maxBytes = typeof args['maxBytes'] === 'number' ? args['maxBytes'] : MAX_BYTES.default;
    const data: Json = {
      mode: args['mode'] ?? 'auto',
      grid: args['grid'] ?? true,
      gridLabels: args['gridLabels'] ?? true,
      tokenMarkers: args['tokenMarkers'] ?? true,
      maxDimension: args['maxDimension'] ?? MAX_DIMENSION.default,
      maxBytes,
      format: args['format'] ?? 'jpeg',
    };
    if (typeof args['sceneIdentifier'] === 'string' && args['sceneIdentifier'].trim())
      data['sceneIdentifier'] = args['sceneIdentifier'].trim();
    if (args['region'] !== undefined) data['region'] = args['region'];

    let answer: unknown;
    try {
      answer = await context.query(SCENE_IMAGE_QUERY, data, { timeoutMs: SCENE_IMAGE_TIMEOUT_MS });
    } catch (error) {
      throw (
        moduleTooOld(SCENE_IMAGE_QUERY, error, OPERATION) ?? new Error(withPrefix(messageOf(error)))
      );
    }
    return sceneImageResult(answer, maxBytes);
  },
};

/** The module's answer as one image block and the details as JSON text; anything else is an error with the answer's fault. */
export function sceneImageResult(answer: unknown, maxBytes: number): ToolOutput {
  const refusal = legacyFailure(answer);
  if (refusal !== null) throw new Error(withPrefix(refusal));
  if (!isRecord(answer) || !isRecord(answer['image']))
    throw new Error(withPrefix('the module answered without an image'));

  const { data, mimeType, ...imageInfo } = answer['image'];
  if (typeof data !== 'string' || !data)
    throw new Error(withPrefix('the module sent an empty image'));
  if (typeof mimeType !== 'string' || !MIME_TYPES.has(mimeType))
    throw new Error(
      withPrefix(`the module sent the image type "${String(mimeType)}", expected JPEG or WebP`)
    );
  const bytes = base64Bytes(data);
  if (bytes > maxBytes)
    throw new Error(withPrefix(`the module sent ${bytes} bytes, more than maxBytes ${maxBytes}`));

  const details: Json = { ...answer, image: { ...imageInfo, mimeType, bytes } };
  const scene = isRecord(answer['scene']) ? answer['scene'] : {};
  const tokens = Array.isArray(answer['tokens']) ? answer['tokens'].length : 0;
  const summary =
    `Scene image of "${String(scene['name'] ?? '')}" [${String(scene['id'] ?? '')}] via the ${String(answer['path'] ?? 'unknown')} path: ` +
    `${String(imageInfo['width'])} x ${String(imageInfo['height'])} pixels, ${bytes} bytes, ${tokens} tokens listed.`;

  return {
    content: [
      { type: 'text', text: summary },
      { type: 'image', data, mimeType },
      { type: 'text', text: JSON.stringify(details, null, 2) },
    ],
  };
}
