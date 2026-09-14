/**
 * What the scenes area needs beyond the default fake: scenes with levels
 * (Foundry 14), activate and createThumbnail on a scene, a canvas, media
 * files with a size, and files the browser can fetch.
 */
import {
  DEFAULT_DOCUMENT_TYPES,
  type FakeDocument,
  type FakeFoundry,
} from '../../../testing/fake-foundry.js';

export interface ScenesFakeOptions {
  /** Scenes carry an embedded Level collection, as in Foundry 14. Default true. */
  levels?: boolean;
  /** What createThumbnail does. Default 'ok'. */
  thumbnail?: 'ok' | 'empty' | 'throws' | 'missing';
  /** Media files the browser can load, with their size. */
  media?: Record<string, { width: number; height: number }>;
  /** Files served from the data directory, by path, as text. */
  files?: Record<string, string>;
}

export interface FakeCanvas {
  ready: boolean;
  scene: { id: string } | null;
  dimensions: { width: number; height: number } | null;
  screenDimensions: number[];
  pans: Array<{ x: number; y: number; scale: number }>;
  animatePan(view: { x: number; y: number; scale: number }): Promise<boolean>;
}

function method(target: FakeDocument, name: string, value: unknown): void {
  // Not enumerable, so toObject never tries to copy a function.
  Object.defineProperty(target, name, { value, enumerable: false, configurable: true });
}

export function withScenes(foundry: FakeFoundry, options: ScenesFakeOptions = {}): FakeFoundry {
  const levels = options.levels ?? true;
  const thumbnail = options.thumbnail ?? 'ok';

  const canvas: FakeCanvas = {
    ready: true,
    scene: null,
    dimensions: null,
    screenDimensions: [2000, 1000],
    pans: [],
    animatePan: async view => {
      canvas.pans.push({ x: view.x, y: view.y, scale: view.scale });
      return true;
    },
  };
  foundry.setGlobal('canvas', canvas);

  foundry.defineDocumentType('Level', {});
  foundry.defineDocumentType('Scene', {
    collection: 'scenes',
    embedded: {
      ...(DEFAULT_DOCUMENT_TYPES['Scene']?.embedded ?? {}),
      ...(levels ? { Level: 'levels' } : {}),
    },
    extend: scene => {
      method(scene, 'activate', async () => {
        for (const other of foundry.collection('Scene').contents) {
          if (other !== scene && other['active'] === true) await other.update({ active: false });
        }
        await scene.update({ active: true });
        const width = Number(scene['width']) || 0;
        const height = Number(scene['height']) || 0;
        canvas.scene = { id: scene.id };
        canvas.dimensions = { width: width * 1.5, height: height * 1.5 };
        return scene;
      });
      if (thumbnail !== 'missing') {
        method(scene, 'createThumbnail', async () => {
          if (thumbnail === 'throws') throw new Error('WebGL context lost');
          return { thumb: thumbnail === 'empty' ? '' : 'data:image/webp;base64,AAAA' };
        });
      }
    },
  });

  const media = options.media ?? {};
  foundry.setGlobal(
    'Image',
    class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 0;
      naturalHeight = 0;
      set src(value: string) {
        setTimeout(() => {
          const size = media[decodeURI(value)];
          if (!size) return this.onerror?.();
          this.naturalWidth = size.width;
          this.naturalHeight = size.height;
          this.onload?.();
        }, 0);
      }
    }
  );

  const files = options.files ?? {};
  foundry.setGlobal('fetch', async (url: string) => {
    const body = files[decodeURI(url)];
    return {
      ok: body !== undefined,
      status: body === undefined ? 404 : 200,
      statusText: body === undefined ? 'Not Found' : 'OK',
      text: async () => body ?? '',
    };
  });
  return foundry;
}
