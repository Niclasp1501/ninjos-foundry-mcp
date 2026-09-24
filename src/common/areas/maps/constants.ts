/**
 * Area maps: what server and module of the image generator agree on.
 *
 * Pure values and functions without Foundry and without Node, so both sides
 * and their tests read the same query names, limits and path rules.
 */

/** Default directory under the world for images when the call names none. */
export const MAP_UPLOAD_DIRECTORY = 'ai-generated-maps';

/**
 * Base64 characters per upload query. 256 KiB keeps every message far below
 * any limit on the way (the WebSocket server accepts 64 MB).
 */
export const UPLOAD_CHUNK_CHARS = 256 * 1024;

/** Largest image accepted, in bytes. A 4K image from Gemini is usually well below 20 MB. */
export const UPLOAD_MAX_BYTES = 40 * 1024 * 1024;

/** Largest image the module reads back from Foundry as a reference, in bytes. */
export const READ_MAX_BYTES = 20 * 1024 * 1024;

/** Longest edge of a preview the module draws for the MCP client, in pixels. */
export const PREVIEW_MAX_EDGE = 1024;

/**
 * Queries the server sends for images. `uploadMapChunk` keeps the name of the
 * previous release, so a module of 14.2609.5 still stores the image (in the
 * default directory, since it ignores `directory`).
 */
export const MAP_QUERY = {
  uploadChunk: 'uploadMapChunk',
  readImage: 'readMapImage',
  previewImage: 'previewMapImage',
} as const;

/** Aspect ratios Gemini accepts as a real parameter. */
export const ASPECT_RATIOS = [
  '1:1',
  '3:2',
  '2:3',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9',
] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];
export const DEFAULT_ASPECT_RATIO: AspectRatio = '16:9';

export function isAspectRatio(value: unknown): value is AspectRatio {
  return typeof value === 'string' && (ASPECT_RATIOS as readonly string[]).includes(value);
}

/** Characters no file or folder name may hold on any system Foundry runs on. */
const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f]/gu;

/**
 * A file name that cannot leave its directory. Letters of every language stay
 * (a folder may be called "Grünau"), spaces become underscores, and
 * everything Windows or a URL cannot hold becomes an underscore. Leading dots
 * go, the length is capped. Never empty.
 */
export function safeFileName(name: string, maxLength = 120): string {
  const replaced = name
    .normalize('NFC')
    .replace(FORBIDDEN, '_')
    .replace(/\s+/gu, '_')
    .replace(/[^\p{L}\p{N}_.()-]/gu, '_')
    .replace(/^\.+/, '');
  const capped = replaced.slice(0, maxLength);
  return capped || 'map';
}

/**
 * A directory relative to Foundry's data folder, or null when it is not one:
 * empty, absolute, with a drive letter, with "." or ".." segments, or with a
 * character a file name cannot hold. Slashes in either direction separate the
 * segments; the answer always uses "/".
 */
export function safeDataDirectory(path: string): string | null {
  const trimmed = path.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  if (!trimmed || trimmed.startsWith('/') || /^[A-Za-z]:/.test(trimmed)) return null;
  const segments = trimmed.split('/');
  if (segments.length > 12) return null;
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..' || segment.trim() !== segment) return null;
    if (new RegExp(FORBIDDEN.source, 'u').test(segment)) return null;
  }
  return segments.map(segment => segment.normalize('NFC')).join('/');
}

/**
 * A path of an existing file relative to Foundry's data folder, as scenes
 * store their background, or null. A leading slash is dropped, a URL is not
 * accepted, and ".." never leaves the data folder.
 */
export function safeDataFile(path: string): string | null {
  const trimmed = path.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!trimmed || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null;
  const cut = trimmed.lastIndexOf('/');
  const file = trimmed.slice(cut + 1);
  if (!file || file === '.' || file === '..') return null;
  if (cut < 0) return file;
  const directory = safeDataDirectory(trimmed.slice(0, cut));
  return directory ? `${directory}/${file}` : null;
}

export type ImageType = 'png' | 'jpeg' | 'webp';

/** The image type by its first bytes, or null when it is none of PNG, JPEG and WebP. */
export function imageTypeOf(bytes: Uint8Array): ImageType | null {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= png.length && png.every((value, index) => bytes[index] === value))
    return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'jpeg';
  const riff = [0x52, 0x49, 0x46, 0x46];
  const webp = [0x57, 0x45, 0x42, 0x50];
  if (
    bytes.length >= 12 &&
    riff.every((value, index) => bytes[index] === value) &&
    webp.every((value, index) => bytes[index + 8] === value)
  )
    return 'webp';
  return null;
}

export const IMAGE_MIME: Readonly<Record<ImageType, string>> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

const EXTENSION: Readonly<Record<ImageType, string>> = { png: 'png', jpeg: 'jpg', webp: 'webp' };

/** File name with the extension that belongs to the content, replacing any other. */
export function withImageExtension(name: string, type: ImageType): string {
  const base = safeFileName(name).replace(/\.(png|jpe?g|webp|gif)$/i, '');
  return `${base || 'map'}.${EXTENSION[type]}`;
}
