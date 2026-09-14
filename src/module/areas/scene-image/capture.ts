/**
 * Where the pixels come from.
 *
 * Canvas path: the GM's canvas shows the scene. Foundry's primary canvas group
 * (background, tiles, drawings, token art, all in canvas coordinates and
 * without lighting, fog or vision) is rendered into a texture of just the
 * wanted rectangle at the output scale, then read back as a canvas element.
 * The stage is the fallback when a Foundry version has no primary group.
 *
 * Composed path: no canvas or another scene. The background file is loaded
 * like any image of the data directory; grid and token markers are painted
 * over it by drawing.ts.
 */
import type { Rect } from '../../../common/areas/scene-image/geometry.js';
import { fail, messageOf, route } from '../scenes/support.js';

export interface Pixels {
  source: CanvasImageSource;
  width: number;
  height: number;
}

export function foundryCanvas(): FoundrySceneImageCanvas | undefined {
  return (globalThis as { canvas?: FoundrySceneImageCanvas }).canvas;
}

/** Whether the GM's canvas currently shows this scene, ready to be captured. */
export function canvasShows(sceneId: string): boolean {
  const current = foundryCanvas();
  return current?.ready === true && current.scene?.id === sceneId;
}

function frameOf(rect: Rect): unknown {
  const pixi = (globalThis as { PIXI?: { Rectangle?: new (...args: number[]) => unknown } }).PIXI;
  return typeof pixi?.Rectangle === 'function'
    ? new pixi.Rectangle(rect.x, rect.y, rect.width, rect.height)
    : { ...rect };
}

function usable(pixels: FoundrySceneImagePixels | null | undefined, how: string): Pixels {
  if (!pixels || !(pixels.width > 0) || !(pixels.height > 0))
    fail('CAPTURE_FAILED', `${how} returned an empty picture`);
  return {
    source: pixels as unknown as CanvasImageSource,
    width: pixels.width,
    height: pixels.height,
  };
}

/**
 * Render the rectangle of the viewed scene at `scale`. Tries the texture route
 * of PixiJS 7 first, then the frame argument of extract; every failed attempt
 * is part of the final error.
 */
export function captureCanvas(rect: Rect, scale: number): Pixels {
  const current = foundryCanvas();
  const renderer = current?.app?.renderer;
  const target = current?.primary ?? current?.stage;
  if (!renderer?.extract || typeof renderer.extract.canvas !== 'function')
    fail('CANVAS_UNAVAILABLE', "Foundry's renderer offers no extract API on this client");
  if (!target) fail('CANVAS_UNAVAILABLE', 'the canvas has neither a primary group nor a stage');

  const causes: string[] = [];
  if (typeof renderer.generateTexture === 'function') {
    let texture: FoundrySceneImageTexture | undefined;
    try {
      texture = renderer.generateTexture(target, { region: frameOf(rect), resolution: scale });
      return usable(renderer.extract.canvas(texture), 'the texture capture');
    } catch (error) {
      causes.push(`texture capture: ${messageOf(error)}`);
    } finally {
      try {
        texture?.destroy?.(true);
      } catch {
        // Freeing the texture must not hide the picture or the first error.
      }
    }
  }
  try {
    const full = usable(renderer.extract.canvas(target, frameOf(rect)), 'the frame capture');
    return full;
  } catch (error) {
    causes.push(`frame capture: ${messageOf(error)}`);
  }
  return fail('CAPTURE_FAILED', `the canvas could not be captured (${causes.join('; ')})`);
}

const VIDEO = /\.(webm|mp4|m4v|ogv)$/i;
export const LOAD_TIMEOUT_MS = 20_000;

/** Load the background file of a scene; images directly, videos at their first frame. */
export function loadBackground(path: string, timeoutMs = LOAD_TIMEOUT_MS): Promise<Pixels> {
  const url = route(path);
  return new Promise<Pixels>((resolve, reject) => {
    let settled = false;
    const finish = (outcome: () => Pixels) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        resolve(outcome());
      } catch (error) {
        reject(error);
      }
    };
    const timer = setTimeout(
      () =>
        finish(() =>
          fail('BACKGROUND_UNREADABLE', `"${path}" did not load within ${timeoutMs / 1000} s`)
        ),
      timeoutMs
    );

    if (VIDEO.test(path)) {
      if (typeof document === 'undefined') {
        finish(() => fail('NO_DOCUMENT', 'this browser offers no document to load the video in'));
        return;
      }
      const video = document.createElement('video');
      video.muted = true;
      video.preload = 'auto';
      video.onloadeddata = () =>
        finish(() => {
          usable({ width: video.videoWidth, height: video.videoHeight }, `the video "${path}"`);
          return { source: video, width: video.videoWidth, height: video.videoHeight };
        });
      video.onerror = () =>
        finish(() => fail('BACKGROUND_UNREADABLE', `the video "${path}" could not be loaded`));
      video.src = url;
      return;
    }

    const Picture = (globalThis as { Image?: new () => HTMLImageElement }).Image;
    if (typeof Picture !== 'function') {
      finish(() => fail('NO_DOCUMENT', 'this browser offers no Image to load the background'));
      return;
    }
    const image = new Picture();
    image.onload = () =>
      finish(() => {
        usable({ width: image.naturalWidth, height: image.naturalHeight }, `the image "${path}"`);
        return { source: image, width: image.naturalWidth, height: image.naturalHeight };
      });
    image.onerror = () =>
      finish(() =>
        fail(
          'BACKGROUND_UNREADABLE',
          `the image "${path}" could not be loaded (missing file or not an image)`
        )
      );
    image.src = url;
  });
}
