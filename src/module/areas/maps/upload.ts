/**
 * The map image arrives in pieces and is stored in the world.
 *
 * The server sends the image as base64 in pieces of 256 KiB (`uploadMapChunk`),
 * so no single message comes near a limit of the bridge (the
 * previous generation sent several megabytes in one message). The module keeps the pieces in memory,
 * checks the whole, and stores it with Foundry's FilePicker under
 * worlds/<world>/ai-generated-maps. It reads the directory back before it
 * reports the path.
 *
 * Rights: storing the image is the first half of creating a scene, so it is
 * declared as creating scenes (switch and matrix). Foundry's own permission
 * to upload files is checked as well.
 */
import {
  IMAGE_MIME,
  imageTypeOf,
  MAP_UPLOAD_DIRECTORY,
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
      `The Foundry user "${user.name}" may not upload files (permission "Upload New Files"), so the map cannot be stored in the world.`
    );
  }
}

/** Store an image under worlds/<world>/ai-generated-maps and confirm it is there. Returns its path. */
export async function storeMapImage(name: string, bytes: Uint8Array): Promise<string> {
  requireWorld();
  requireUploadPermission();
  if (bytes.byteLength > UPLOAD_MAX_BYTES)
    throw new QueryError(
      'TOO_LARGE',
      `The image has ${bytes.byteLength} bytes; at most ${UPLOAD_MAX_BYTES} are accepted`
    );
  const type = imageTypeOf(bytes);
  if (!type) throw new QueryError('UNSUPPORTED_IMAGE', 'Only PNG and JPEG images are supported');

  const picker = filePicker();
  const world = game.world?.id as string;
  const directory = `worlds/${world}/${MAP_UPLOAD_DIRECTORY}`;
  const filename = withImageExtension(name, type);

  try {
    await picker.browse('data', directory);
  } catch {
    try {
      await picker.createDirectory('data', directory, {});
    } catch (error) {
      if (!/EEXIST|exists/i.test(messageOf(error)))
        throw new QueryError(
          'DIRECTORY_FAILED',
          `The folder ${directory} could not be created: ${messageOf(error)}`
        );
    }
  }

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
    const { uploadId, filename, index, total, data: part } = data;
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
    if (upload && (upload.total !== total || upload.filename !== filename)) {
      uploads.delete(uploadId);
      throw new QueryError(
        'INVALID_ARGUMENT',
        `Piece ${index} of ${uploadId} does not belong to the upload started before; it was dropped`
      );
    }
    if (!upload) {
      upload = {
        filename,
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
    const path = await storeMapImage(filename, bytes);
    return { path, bytes: bytes.byteLength };
  },
};

/**
 * The upload of a server of the previous generation: the whole image in one
 * query, as base64 or data URL. Answered in the form that server reads.
 */
export const uploadGeneratedMap: QueryHandler = {
  access: UPLOAD_ACCESS,
  run: async raw => {
    const data = isRecord(raw) ? raw : {};
    const filename = typeof data['filename'] === 'string' ? data['filename'] : '';
    const imageData = typeof data['imageData'] === 'string' ? data['imageData'] : '';
    if (!filename.trim()) throw new QueryError('INVALID_ARGUMENT', 'filename is required');
    if (!imageData) throw new QueryError('INVALID_ARGUMENT', 'imageData is required');
    const base64 = imageData.replace(/^data:image\/[a-z+.-]+;base64,/i, '');
    if (!BASE64.test(base64)) throw new QueryError('INVALID_ARGUMENT', 'imageData is not base64');
    const path = await storeMapImage(filename, decodeBase64(base64));
    return { success: true, path, message: `Map uploaded successfully to ${path}` };
  },
};
