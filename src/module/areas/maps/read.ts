/**
 * Images the server needs from Foundry: references and previews.
 *
 * - `readMapImage` reads an image from the data folder, or the background of a
 *   scene, and sends it as base64. The server hands it to the image model as a
 *   reference, so a battle map matches the location pictures it belongs to.
 * - `previewMapImage` draws an image smaller in the browser and sends it as
 *   JPEG, so the MCP client can look at a result without receiving several
 *   megabytes. The server has no image library; the browser has a canvas.
 *
 * Both only read. The browser loads the file from its own Foundry, with the
 * rights of the logged in Gamemaster, so nothing outside the data folder and
 * nothing of another server can be reached.
 */
import {
  IMAGE_MIME,
  imageTypeOf,
  PREVIEW_MAX_EDGE,
  READ_MAX_BYTES,
  safeDataFile,
} from '../../../common/areas/maps/constants.js';
import { decodeMediaPath, encodeMediaPath } from '../../../common/areas/scenes/names.js';
import type { Access } from '../../../common/permissions.js';
import { QueryError, type QueryHandler } from '../../dispatcher.js';
import { requireWorld } from '../../world-ready.js';
import { mainLevel } from '../scenes/level.js';
import { findScene, route } from '../scenes/support.js';

export const READ_ACCESS: Access = { kind: 'read' };

export interface LoadedPicture {
  width: number;
  height: number;
  /** Draw the picture into a canvas of this size and return it as a JPEG data URL. */
  toJpegDataUrl(width: number, height: number, quality: number): string;
}

/** What the browser does; tests replace it. */
export interface ImageTools {
  fetchBytes(url: string): Promise<{ ok: boolean; status: number; bytes: Uint8Array }>;
  loadPicture(url: string): Promise<LoadedPicture>;
}

const LOAD_TIMEOUT_MS = 20_000;

const browserTools: ImageTools = {
  async fetchBytes(url) {
    const response = await fetch(url, { credentials: 'same-origin' });
    const bytes = response.ok ? new Uint8Array(await response.arrayBuffer()) : new Uint8Array();
    return { ok: response.ok, status: response.status, bytes };
  },
  loadPicture(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const timer = setTimeout(
        () => reject(new Error(`the image did not load within ${LOAD_TIMEOUT_MS / 1000} seconds`)),
        LOAD_TIMEOUT_MS
      );
      image.onload = () => {
        clearTimeout(timer);
        resolve({
          width: image.naturalWidth,
          height: image.naturalHeight,
          toJpegDataUrl(width, height, quality) {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext('2d');
            if (!context) throw new Error('the browser offers no 2D canvas');
            context.imageSmoothingQuality = 'high';
            context.drawImage(image, 0, 0, width, height);
            return canvas.toDataURL('image/jpeg', quality);
          },
        });
      };
      image.onerror = () => {
        clearTimeout(timer);
        reject(new Error('the image could not be loaded'));
      };
      image.src = url;
    });
  },
};

let tools: ImageTools = browserTools;

/** For tests: replace the browser, or put it back with no argument. */
export function useImageTools(replacement?: ImageTools): void {
  tools = replacement ?? browserTools;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return 'unknown cause';
}

/** The drawn background of a scene: its main level since Foundry 14, the scene field before. */
function sceneBackground(identifier: string): { path: string; scene: string } {
  const scene = findScene(identifier);
  const src = mainLevel(scene)?.background?.src ?? scene.background?.src ?? '';
  if (!src)
    throw new QueryError('NO_BACKGROUND', `The scene "${scene.name}" has no background image`);
  return { path: decodeMediaPath(src), scene: scene.name };
}

/** The file a call names, by `path` or `scene`, checked and decoded. */
function target(data: Record<string, unknown>): { path: string; scene?: string } {
  const path = typeof data['path'] === 'string' ? data['path'].trim() : '';
  const scene = typeof data['scene'] === 'string' ? data['scene'].trim() : '';
  if (!path === !scene)
    throw new QueryError('INVALID_ARGUMENT', 'Give exactly one of path or scene');
  const chosen = scene ? sceneBackground(scene) : { path: decodeMediaPath(path) };
  const safe = safeDataFile(chosen.path);
  if (!safe)
    throw new QueryError(
      'INVALID_ARGUMENT',
      `"${chosen.path}" is not a file inside Foundry's data folder; only relative paths like "Maps/Harbour/map.jpg" can be read`
    );
  return scene ? { path: safe, scene: 'scene' in chosen ? chosen.scene : scene } : { path: safe };
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let index = 0; index < bytes.length; index += step)
    binary += String.fromCharCode(...bytes.subarray(index, index + step));
  return btoa(binary);
}

export const readMapImage: QueryHandler = {
  access: READ_ACCESS,
  run: async raw => {
    requireWorld();
    const file = target(isRecord(raw) ? raw : {});
    let answer: Awaited<ReturnType<ImageTools['fetchBytes']>>;
    try {
      answer = await tools.fetchBytes(route(encodeMediaPath(file.path)));
    } catch (error) {
      throw new QueryError('READ_FAILED', `${file.path} could not be read: ${messageOf(error)}`);
    }
    if (!answer.ok)
      throw new QueryError(
        answer.status === 404 ? 'FILE_NOT_FOUND' : 'READ_FAILED',
        `${file.path} could not be read (HTTP ${answer.status})`
      );
    if (answer.bytes.byteLength > READ_MAX_BYTES)
      throw new QueryError(
        'TOO_LARGE',
        `${file.path} has ${answer.bytes.byteLength} bytes, more than the ${READ_MAX_BYTES} a reference may have`
      );
    const type = imageTypeOf(answer.bytes);
    if (!type)
      throw new QueryError(
        'UNSUPPORTED_IMAGE',
        `${file.path} is not a PNG, JPEG or WebP image; only those can serve as a reference`
      );
    return {
      path: file.path,
      ...(file.scene ? { scene: file.scene } : {}),
      mimeType: IMAGE_MIME[type],
      bytes: answer.bytes.byteLength,
      data: toBase64(answer.bytes),
    };
  },
};

export const previewMapImage: QueryHandler = {
  access: READ_ACCESS,
  run: async raw => {
    requireWorld();
    const data = isRecord(raw) ? raw : {};
    const file = target(data);
    const wanted = Number(data['maxEdge']);
    const maxEdge =
      Number.isInteger(wanted) && wanted >= 128 && wanted <= 2048 ? wanted : PREVIEW_MAX_EDGE;
    let picture: LoadedPicture;
    try {
      picture = await tools.loadPicture(route(encodeMediaPath(file.path)));
    } catch (error) {
      throw new QueryError('READ_FAILED', `${file.path} could not be shown: ${messageOf(error)}`);
    }
    if (!(picture.width > 0 && picture.height > 0))
      throw new QueryError('READ_FAILED', `${file.path} loaded but reported no size`);
    const scale = Math.min(1, maxEdge / Math.max(picture.width, picture.height));
    const width = Math.max(1, Math.round(picture.width * scale));
    const height = Math.max(1, Math.round(picture.height * scale));
    const url = picture.toJpegDataUrl(width, height, 0.85);
    const match = /^data:(image\/[a-z]+);base64,(.*)$/s.exec(url);
    if (!match || match[1] !== 'image/jpeg')
      throw new QueryError('ENCODE_FAILED', 'the browser did not return the preview as a JPEG');
    return {
      path: file.path,
      ...(file.scene ? { scene: file.scene } : {}),
      mimeType: 'image/jpeg',
      width,
      height,
      originalWidth: picture.width,
      originalHeight: picture.height,
      data: match[2],
    };
  },
};
