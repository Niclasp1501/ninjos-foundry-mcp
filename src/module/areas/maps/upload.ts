/**
 * A generated image arrives in pieces and is stored in Foundry's data folder.
 *
 * The server sends the image as base64 in pieces of 256 KiB (`uploadMapChunk`),
 * so no single message comes near a limit of the bridge. The module keeps the
 * pieces in memory, checks the whole, and stores it with Foundry's FilePicker
 * in the directory the call names, or under worlds/<world>/ai-generated-maps.
 * Missing folders are created one level at a time. An existing file is never
 * replaced: the name gets "-2", "-3" and so on. The directory is read back
 * before the path is reported.
 *
 * Rights: storing the image is the first half of creating a scene, so it is
 * declared as creating scenes (switch and matrix). Foundry's own permission
 * to upload files is checked as well.
 */
import {
  IMAGE_MIME,
  imageTypeOf,
  MAP_UPLOAD_DIRECTORY,
  safeDataDirectory,
  UPLOAD_CHUNK_CHARS,
  UPLOAD_MAX_BYTES,
  withImageExtension,
} from '../../../common/areas/maps/constants.js';
import type { Access } from '../../../common/permissions.js';
import { QueryError, type QueryHandler } from '../../dispatcher.js';
import { requireWorld } from '../../world-ready.js';

export const UPLOAD_ACCESS: Access = { kind: 'write', document: 'Scenes', action: 'create' };

/** Pieces of an upload that stopped arriving are dropped after this long. */
export const UPLOAD_IDLE_MS = 5 * 60 * 1000;

interface PendingUpload {
  filename: string;
  directory: string | null;
  total: number;
  parts: Array<string | undefined>;
  touched: number;
}

const uploads = new Map<string, PendingUpload>();

/** For tests. */
export function clearUploads(): void {
  uploads.clear();
}

export function pendingUploadCount(): number {
  return uploads.size;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return 'unknown cause';
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const MAX_PARTS = Math.ceil((UPLOAD_MAX_BYTES * 4) / 3 / UPLOAD_CHUNK_CHARS) + 1;

function decodeBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function filePicker(): FoundryMapsFilePicker {
  const scope = globalThis as {
    foundry?: FoundryMapsNamespace;
    FilePicker?: FoundryMapsFilePicker;
  };
  const picker = scope.foundry?.applications?.apps?.FilePicker?.implementation ?? scope.FilePicker;
  if (!picker || typeof picker.upload !== 'function')
    throw new QueryError('NOT_AVAILABLE', "Foundry's FilePicker is not available in this browser");
  return picker;
}

function filesOf(listing: unknown): string[] {
  const files = isRecord(listing) ? listing['files'] : undefined;
  return Array.isArray(files)
    ? files.filter((file): file is string => typeof file === 'string')
    : [];
}

function decoded(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function requireUploadPermission(): void {
  const user = game.user as FoundryMapsUser | null;
  if (typeof user?.can === 'function' && !user.can('FILES_UPLOAD')) {
    throw new QueryError(
      'PERMISSION_DENIED',
      `The Foundry user "${user.name}" may not upload files (permission "Upload New Files"), so the image cannot be stored.`
    );
  }
}

/** Create every missing level of a directory in the data folder. */
async function ensureDirectory(picker: FoundryMapsFilePicker, directory: string): Promise<void> {
  const segments = directory.split('/');
  for (let depth = 1; depth <= segments.length; depth += 1) {
    const level = segments.slice(0, depth).join('/');
    try {
      await picker.browse('data', level);
      continue;
    } catch {
      // Not there yet.
    }
    try {
      await picker.createDirectory('data', level, {});
    } catch (error) {
      if (!/EEXIST|exists/i.test(messageOf(error)))
        throw new QueryError(
          'DIRECTORY_FAILED',
          `The folder ${level} could not be created: ${messageOf(error)}`
        );
    }
  }
}

/** The first of name, name-2, name-3 … that is not yet in the listing. */
function freeName(filename: string, taken: readonly string[]): string {
  const names = new Set(taken.map(file => decoded(file).slice(decoded(file).lastIndexOf('/') + 1)));
  if (!names.has(filename)) return filename;
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const extension = dot > 0 ? filename.slice(dot) : '';
  for (let counter = 2; counter < 1000; counter += 1) {
    const candidate = `${base}-${counter}${extension}`;
    if (!names.has(candidate)) return candidate;
  }
  throw new QueryError('NAME_TAKEN', `Every name from ${filename} to ${base}-999 is taken`);
}

/**
 * Store an image in the data folder and confirm it is there. Returns its path.
 * Without a directory it goes to worlds/<world>/ai-generated-maps.
 */
export async function storeMapImage(
  name: string,
  bytes: Uint8Array,
  targetDirectory: string | null = null
): Promise<string> {
  requireWorld();
  requireUploadPermission();
  if (bytes.byteLength > UPLOAD_MAX_BYTES)
    throw new QueryError(
      'TOO_LARGE',
      `The image has ${bytes.byteLength} bytes; at most ${UPLOAD_MAX_BYTES} are accepted`
    );
  const type = imageTypeOf(bytes);
  if (!type)
    throw new QueryError('UNSUPPORTED_IMAGE', 'Only PNG, JPEG and WebP images are supported');

  const picker = filePicker();
  const world = game.world?.id as string;
  const directory = targetDirectory ?? `worlds/${world}/${MAP_UPLOAD_DIRECTORY}`;
  await ensureDirectory(picker, directory);
  let before: unknown;
  try {
    before = await picker.browse('data', directory);
  } catch (error) {
    throw new QueryError(
      'DIRECTORY_FAILED',
      `The folder ${directory} could not be read: ${messageOf(error)}`
    );
  }
  const filename = freeName(withImageExtension(name, type), filesOf(before));

  const file = new File([bytes as BlobPart], filename, { type: IMAGE_MIME[type] });
  let response: unknown;
  try {
    response = await picker.upload('data', directory, file, {}, { notify: false });
  } catch (error) {
    throw new QueryError(
      'UPLOAD_FAILED',
      `Foundry refused the upload of ${filename}: ${messageOf(error)}`
    );
  }
  if (isRecord(response) && response['status'] === 'error') {
    throw new QueryError(
      'UPLOAD_FAILED',
      `Foundry refused the upload of ${filename}: ${String(response['message'] ?? 'no reason')}`
    );
  }
  const path =
    isRecord(response) && typeof response['path'] === 'string' && response['path']
      ? response['path']
      : `${directory}/${filename}`;

  let listing: unknown;
  try {
    listing = await picker.browse('data', directory);
  } catch (error) {
    throw new QueryError(
      'NOT_STORED',
      `The upload of ${filename} could not be checked: ${messageOf(error)}`
    );
  }
  const wanted = decoded(path);
  if (!filesOf(listing).some(file => decoded(file) === wanted)) {
    throw new QueryError(
      'NOT_STORED',
      `Foundry reported the upload of ${filename}, but ${path} is not in ${directory} afterwards`
    );
  }
  return path;
}

function dropStale(now: number): void {
  for (const [id, upload] of uploads) if (now - upload.touched > UPLOAD_IDLE_MS) uploads.delete(id);
}

export const uploadMapChunk: QueryHandler = {
  access: UPLOAD_ACCESS,
  run: async raw => {
    requireWorld();
    requireUploadPermission();
    const data = isRecord(raw) ? raw : {};
    const { uploadId, filename, index, total, data: part, directory: rawDirectory } = data;
    let directory: string | null = null;
    if (rawDirectory !== undefined && rawDirectory !== null && rawDirectory !== '') {
      directory = typeof rawDirectory === 'string' ? safeDataDirectory(rawDirectory) : null;
      if (!directory)
        throw new QueryError(
          'INVALID_ARGUMENT',
          `directory must be a folder inside Foundry's data folder, like "Maps/Harbour", got ${JSON.stringify(rawDirectory)}`
        );
    }
    if (typeof uploadId !== 'string' || !uploadId || uploadId.length > 200)
      throw new QueryError('INVALID_ARGUMENT', 'uploadId must be a text of at most 200 characters');
    if (typeof filename !== 'string' || !filename.trim())
      throw new QueryError('INVALID_ARGUMENT', 'filename is required');
    if (typeof total !== 'number' || !Number.isInteger(total) || total < 1 || total > MAX_PARTS)
      throw new QueryError(
        'INVALID_ARGUMENT',
        `total must be a whole number from 1 to ${MAX_PARTS}`
      );
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= total)
      throw new QueryError(
        'INVALID_ARGUMENT',
        `index must be a whole number from 0 to ${total - 1}`
      );
    if (typeof part !== 'string' || part.length > UPLOAD_CHUNK_CHARS || !BASE64.test(part))
      throw new QueryError(
        'INVALID_ARGUMENT',
        `data must be base64 of at most ${UPLOAD_CHUNK_CHARS} characters`
      );

    const now = Date.now();
    dropStale(now);
    let upload = uploads.get(uploadId);
    if (
      upload &&
      (upload.total !== total || upload.filename !== filename || upload.directory !== directory)
    ) {
      uploads.delete(uploadId);
      throw new QueryError(
        'INVALID_ARGUMENT',
        `Piece ${index} of ${uploadId} does not belong to the upload started before; it was dropped`
      );
    }
    if (!upload) {
      upload = {
        filename,
        directory,
        total,
        parts: new Array<string | undefined>(total).fill(undefined),
        touched: now,
      };
      uploads.set(uploadId, upload);
    }
    upload.parts[index] = part;
    upload.touched = now;

    const received = upload.parts.filter(entry => entry !== undefined).length;
    if (index < total - 1) return { received, total };

    const missing = upload.parts.flatMap((entry, position) =>
      entry === undefined ? [position] : []
    );
    uploads.delete(uploadId);
    if (missing.length)
      throw new QueryError(
        'INCOMPLETE',
        `The upload ${uploadId} is missing the pieces ${missing.join(', ')}`
      );
    let bytes: Uint8Array;
    try {
      bytes = decodeBase64(upload.parts.join(''));
    } catch (error) {
      throw new QueryError(
        'INVALID_ARGUMENT',
        `The image data is not valid base64: ${messageOf(error)}`
      );
    }
    const path = await storeMapImage(filename, bytes, upload.directory);
    return { path, bytes: bytes.byteLength };
  },
};
