/**
 * Area maps: what server and module of the map generator agree on.
 *
 * Pure values and functions without Foundry and without Node, so both sides
 * and their tests read the same sizes, qualities, query names and file rules.
 */

/** Edge length in pixels per size. */
export const MAP_SIZES = { small: 1024, medium: 1536, large: 2048 } as const;
export type MapSize = keyof typeof MAP_SIZES;

/** Sampling steps per quality, the world setting mapGenQuality. */
export const MAP_QUALITY_STEPS = { low: 8, medium: 20, high: 35 } as const;
export type MapQuality = keyof typeof MAP_QUALITY_STEPS;
export const MAP_QUALITIES = Object.keys(MAP_QUALITY_STEPS) as MapQuality[];

export const DEFAULT_MAP_SIZE: MapSize = 'medium';
export const DEFAULT_MAP_QUALITY: MapQuality = 'low';

/** Pixels per 5 ft square. */
export const DEFAULT_GRID_SIZE = 70;
export const MIN_GRID_SIZE = 20;
export const MAX_GRID_SIZE = 400;

/** Scene folder the maps go into, and the directory under the world for the images. */
export const MAP_FOLDER_NAME = 'AI Generated Maps';
export const MAP_UPLOAD_DIRECTORY = 'ai-generated-maps';

/**
 * Base64 characters per upload query. 256 KiB keeps every message far below
 * any limit on the way (the WebSocket server accepts 64 MB, a data channel
 * of the previous detour about 64 KB per message would still need pieces,
 * but no module of this generation uses it).
 */
export const UPLOAD_CHUNK_CHARS = 256 * 1024;

/** Largest image accepted, in bytes. A 2048 pixel PNG is usually 5 to 10 MB. */
export const UPLOAD_MAX_BYTES = 40 * 1024 * 1024;

/** Version of the map queries between server and module; the module reports it. */
export const MAPS_PROTOCOL = 1;

/**
 * Settings keys, exactly as stored in existing worlds.
 */
export const MAP_SETTING = {
  autoStart: 'mapGenAutoStart',
  quality: 'mapGenQuality',
} as const;

/**
 * Queries the server of this generation sends for maps. `mapServiceRequests`
 * and `mapServiceReply` of the open service channel are gone since the
 * window sends the request `mapService` instead, and no released server ever
 * sent them.
 */
export const MAP_QUERY = {
  settings: 'getMapSettings',
  uploadChunk: 'uploadMapChunk',
  createScene: 'createMapScene',
  jobFailed: 'mapJobFailed',
} as const;

/**
 * Queries a server of the previous generation sends. The first
 * three were relayed by the old module back to its server; the upload is
 * answered as before.
 */
export const LEGACY_MAP_QUERY = {
  generate: 'generate-map',
  status: 'check-map-status',
  cancel: 'cancel-map-job',
  upload: 'upload-generated-map',
} as const;

/** What the service window asks the server for, with the request `mapService`. */
export type MapServiceAction = 'status' | 'start' | 'stop';

export interface MapServiceAnswer {
  state: 'running' | 'stopped' | 'error';
  detail?: string;
  alreadyRunning?: boolean;
}

/**
 * A file name that cannot leave its directory: everything but letters,
 * digits, underscore, hyphen and dot becomes an underscore, leading dots go,
 * and the length is capped. Never empty.
 */
export function safeFileName(name: string, maxLength = 120): string {
  const replaced = name.replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^\.+/, '');
  const capped = replaced.slice(0, maxLength);
  return capped || 'map';
}

export type ImageType = 'png' | 'jpeg';

/** The image type by its first bytes, or null when it is neither PNG nor JPEG. */
export function imageTypeOf(bytes: Uint8Array): ImageType | null {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= png.length && png.every((value, index) => bytes[index] === value))
    return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'jpeg';
  return null;
}

export const IMAGE_MIME: Readonly<Record<ImageType, string>> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
};

/** File name with the extension that belongs to the content, replacing any other. */
export function withImageExtension(name: string, type: ImageType): string {
  const base = safeFileName(name).replace(/\.(png|jpe?g|webp|gif)$/i, '');
  return `${base || 'map'}.${type === 'png' ? 'png' : 'jpg'}`;
}

export function isMapQuality(value: unknown): value is MapQuality {
  return typeof value === 'string' && value in MAP_QUALITY_STEPS;
}

export function isMapSize(value: unknown): value is MapSize {
  return typeof value === 'string' && value in MAP_SIZES;
}
