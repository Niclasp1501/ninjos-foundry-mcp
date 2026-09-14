/**
 * What happens in the browser around a scene's artwork.
 *
 * - Measuring: a scene has to match its map, or the grid lies askew. With no
 *   size given, the file is loaded as an image or a video, for at most eight
 *   seconds. A failed measurement never stops the work; it is reported.
 * - Thumbnails: Foundry does not create one for scenes created by code, and
 *   keeps the old one after a background swap.
 */
import { isVideoPath } from '../../../common/areas/scenes/names.js';
import { messageOf, route } from './support.js';

export const MEASURE_TIMEOUT_MS = 8000;

export type Measurement = { width: number; height: number } | { failed: string };

interface MediaElement {
  onload?: (() => void) | null;
  onerror?: (() => void) | null;
  onloadedmetadata?: (() => void) | null;
  src: string;
  naturalWidth?: number;
  naturalHeight?: number;
  videoWidth?: number;
  videoHeight?: number;
  preload?: string;
  muted?: boolean;
}

function createElement(video: boolean): MediaElement | null {
  const scope = globalThis as {
    Image?: new () => MediaElement;
    document?: { createElement(tag: string): MediaElement };
  };
  if (video) return scope.document ? scope.document.createElement('video') : null;
  if (scope.Image) return new scope.Image();
  return scope.document ? scope.document.createElement('img') : null;
}

export function measureMedia(src: string, timeoutMs = MEASURE_TIMEOUT_MS): Promise<Measurement> {
  const video = isVideoPath(src);
  const element = createElement(video);
  if (!element) return Promise.resolve({ failed: 'no browser media element is available' });

  return new Promise(resolve => {
    let settled = false;
    const finish = (result: Measurement) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      element.onload = null;
      element.onerror = null;
      element.onloadedmetadata = null;
      resolve(result);
    };
    const timer = setTimeout(
      () => finish({ failed: `the file did not load within ${timeoutMs / 1000} seconds` }),
      timeoutMs
    );
    const done = () => {
      const width = video ? element.videoWidth : element.naturalWidth;
      const height = video ? element.videoHeight : element.naturalHeight;
      if (typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0)
        finish({ width, height });
      else finish({ failed: 'the file loaded but reported no size' });
    };
    element.onerror = () => finish({ failed: 'the file could not be loaded' });
    if (video) {
      element.preload = 'metadata';
      element.muted = true;
      element.onloadedmetadata = done;
    } else {
      element.onload = done;
    }
    element.src = route(src);
  });
}

export type ThumbnailOutcome =
  { updated: true } | { updated: false; reason: string; threw: boolean };

/** Create the thumbnail and store it; the stored value is read back. */
export async function renewThumbnail(scene: FoundryScenesScene): Promise<ThumbnailOutcome> {
  if (typeof scene.createThumbnail !== 'function')
    return {
      updated: false,
      reason: 'Foundry offers no thumbnail function for scenes here',
      threw: false,
    };
  try {
    const created = await scene.createThumbnail();
    const thumb = created?.thumb;
    if (typeof thumb !== 'string' || !thumb)
      return { updated: false, reason: 'Foundry returned no image', threw: false };
    await scene.update({ thumb });
    if (typeof scene.thumb !== 'string' || !scene.thumb)
      return {
        updated: false,
        reason: 'the thumbnail is not stored on the scene afterwards',
        threw: false,
      };
    return { updated: true };
  } catch (error) {
    return { updated: false, reason: messageOf(error), threw: true };
  }
}

export function thumbnailReport(outcome: ThumbnailOutcome): { updated: boolean; reason?: string } {
  return outcome.updated ? { updated: true } : { updated: false, reason: outcome.reason };
}
