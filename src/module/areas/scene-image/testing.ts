/**
 * What the scene-image area needs beyond the default fake: a document that makes
 * canvas elements (built on FakeElement of fake-dom.ts) with a recording 2D
 * context and an encoder whose size follows pixels and quality, images and
 * videos that load from a list of files, and a Foundry canvas whose renderer
 * can capture, fail, or lack the extract API.
 */
import { FakeElement } from '../../../testing/fake-dom.js';
import type { FakeFoundry } from '../../../testing/fake-foundry.js';

export interface SceneImageFakeOptions {
  /** Files the browser can load, by path, with their size. */
  media?: Record<string, { width: number; height: number }>;
  /** Encoded bytes per pixel at quality 1. Default 0.25. */
  bytesPerPixel?: number;
  /** Whether toDataURL can write WebP. Default true. */
  webp?: boolean;
  /** The GM's canvas. Without it there is no canvas global. */
  canvas?: {
    sceneId?: string | null;
    ready?: boolean;
    capture?: 'ok' | 'throws' | 'no-extract' | 'frame-only';
    controlled?: number;
  };
}

export interface DrawCall {
  op: string;
  args: unknown[];
}

export class FakeContext2D {
  readonly calls: DrawCall[] = [];
  fillStyle = '#000000';
  strokeStyle = '#000000';
  lineWidth = 1;
  font = '10px sans-serif';
  globalAlpha = 1;

  #record(op: string, args: unknown[]): void {
    this.calls.push({ op, args });
  }
  fillRect(...args: number[]): void {
    this.#record('fillRect', [...args, this.fillStyle]);
  }
  drawImage(...args: unknown[]): void {
    this.#record('drawImage', args);
  }
  beginPath(): void {
    this.#record('beginPath', []);
  }
  moveTo(...args: number[]): void {
    this.#record('moveTo', args);
  }
  lineTo(...args: number[]): void {
    this.#record('lineTo', args);
  }
  stroke(): void {
    this.#record('stroke', [this.strokeStyle]);
  }
  arc(...args: number[]): void {
    this.#record('arc', args);
  }
  fill(): void {
    this.#record('fill', [this.fillStyle]);
  }
  setLineDash(segments: number[]): void {
    this.#record('setLineDash', [segments]);
  }
  fillText(text: string, x: number, y: number): void {
    this.#record('fillText', [text, x, y]);
  }
  texts(): string[] {
    return this.calls.filter(call => call.op === 'fillText').map(call => String(call.args[0]));
  }
}

export class FakeCanvasElement extends FakeElement {
  width = 300;
  height = 150;
  readonly context = new FakeContext2D();
  readonly encodings: Array<{ type: string; quality: number | undefined; bytes: number }> = [];

  constructor(
    private readonly bytesPerPixel: number,
    private readonly webp: boolean
  ) {
    super('canvas');
  }

  getContext(kind: string): FakeContext2D | null {
    return kind === '2d' ? this.context : null;
  }

  toDataURL(type = 'image/png', quality?: number): string {
    const written = type === 'image/webp' && !this.webp ? 'image/png' : type;
    const bytes = Math.max(
      3,
      Math.round(this.width * this.height * this.bytesPerPixel * (quality ?? 0.92))
    );
    this.encodings.push({ type: written, quality, bytes });
    return `data:${written};base64,${'A'.repeat(Math.ceil(bytes / 3) * 4)}`;
  }
}

class FakeLoadable extends FakeElement {
  onload: (() => void) | null = null;
  onloadeddata: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 0;
  naturalHeight = 0;
  videoWidth = 0;
  videoHeight = 0;
  muted = false;
  preload = '';
  loadedFrom = '';

  constructor(
    tag: string,
    private readonly media: Record<string, { width: number; height: number }>
  ) {
    super(tag);
  }

  set src(value: string) {
    this.loadedFrom = value;
    setTimeout(() => {
      const size = this.media[decodeURI(value)];
      if (!size) return this.onerror?.();
      this.naturalWidth = this.videoWidth = size.width;
      this.naturalHeight = this.videoHeight = size.height;
      if (this.tagName === 'VIDEO') this.onloadeddata?.();
      else this.onload?.();
    }, 0);
  }
}

export interface FakeTexture {
  target: unknown;
  region: { x: number; y: number; width: number; height: number };
  resolution: number;
  destroyed: boolean;
  destroy(): void;
}

export interface SceneImageFake {
  foundry: FakeFoundry;
  /** Every canvas element made, in order. */
  canvases: FakeCanvasElement[];
  textures: FakeTexture[];
  extractCalls: Array<{ target: unknown; frame: unknown }>;
  canvas: Record<string, unknown> | null;
}

export function withSceneImage(
  foundry: FakeFoundry,
  options: SceneImageFakeOptions = {}
): SceneImageFake {
  const media = options.media ?? {};
  const bytesPerPixel = options.bytesPerPixel ?? 0.25;
  const webp = options.webp ?? true;
  const fake: SceneImageFake = {
    foundry,
    canvases: [],
    textures: [],
    extractCalls: [],
    canvas: null,
  };

  const makeCanvas = (width: number, height: number) => {
    const element = new FakeCanvasElement(bytesPerPixel, webp);
    element.width = width;
    element.height = height;
    fake.canvases.push(element);
    return element;
  };

  foundry.setGlobal('document', {
    createElement: (tag: string) => {
      const name = tag.toLowerCase();
      if (name === 'canvas') return makeCanvas(300, 150);
      if (name === 'video') return new FakeLoadable('video', media);
      return new FakeElement(tag);
    },
  });
  foundry.setGlobal(
    'Image',
    class extends FakeLoadable {
      constructor() {
        super('img', media);
      }
    }
  );

  if (options.canvas) {
    const setup = options.canvas;
    const capture = setup.capture ?? 'ok';
    const fail = () => {
      throw new Error('WebGL context lost');
    };
    const renderer: Record<string, unknown> = {};
    if (capture !== 'frame-only') {
      renderer['generateTexture'] = (
        target: unknown,
        opts: { region: FakeTexture['region']; resolution: number }
      ) => {
        if (capture === 'throws') fail();
        const texture: FakeTexture = {
          target,
          region: opts.region,
          resolution: opts.resolution,
          destroyed: false,
          destroy() {
            this.destroyed = true;
          },
        };
        fake.textures.push(texture);
        return texture;
      };
    }
    if (capture !== 'no-extract') {
      renderer['extract'] = {
        canvas: (target: unknown, frame?: FakeTexture['region']) => {
          fake.extractCalls.push({ target, frame });
          if (capture === 'throws') fail();
          const texture = fake.textures.find(entry => entry === target);
          if (texture)
            return makeCanvas(
              Math.round(texture.region.width * texture.resolution),
              Math.round(texture.region.height * texture.resolution)
            );
          return makeCanvas(frame?.width ?? 0, frame?.height ?? 0);
        },
      };
    }
    fake.canvas = {
      ready: setup.ready ?? true,
      scene: setup.sceneId ? { id: setup.sceneId } : null,
      primary: { name: 'primary' },
      stage: { name: 'stage' },
      app: { renderer },
      tokens: { controlled: new Array(setup.controlled ?? 0).fill({}) },
    };
    foundry.setGlobal('canvas', fake.canvas);
  }
  return fake;
}
