/**
 * Width and height of a PNG, JPEG or WebP from its bytes, without an image
 * library, and the aspect ratio Gemini offers that comes closest. An edit
 * keeps the shape of the image it changes.
 */
import {
  ASPECT_RATIOS,
  DEFAULT_ASPECT_RATIO,
  type AspectRatio,
} from '../../../common/areas/maps/constants.js';

export interface Size {
  width: number;
  height: number;
}

function pngSize(bytes: Uint8Array): Size | null {
  if (bytes.length < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function jpegSize(bytes: Uint8Array): Size | null {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1] ?? 0;
    const length = ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0);
    const isFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      const height = ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0);
      const width = ((bytes[offset + 7] ?? 0) << 8) | (bytes[offset + 8] ?? 0);
      return { width, height };
    }
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

function webpSize(bytes: Uint8Array): Size | null {
  if (bytes.length < 30) return null;
  const chunk = String.fromCharCode(...bytes.subarray(12, 16));
  const at = (index: number) => bytes[index] ?? 0;
  if (chunk === 'VP8X')
    return {
      width: 1 + (at(24) | (at(25) << 8) | (at(26) << 16)),
      height: 1 + (at(27) | (at(28) << 8) | (at(29) << 16)),
    };
  if (chunk === 'VP8 ')
    return { width: (at(26) | (at(27) << 8)) & 0x3fff, height: (at(28) | (at(29) << 8)) & 0x3fff };
  if (chunk === 'VP8L') {
    const bits = at(21) | (at(22) << 8) | (at(23) << 16) | (at(24) << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

export function imageSize(bytes: Uint8Array, mimeType: string): Size | null {
  const size =
    mimeType === 'image/png'
      ? pngSize(bytes)
      : mimeType === 'image/jpeg'
        ? jpegSize(bytes)
        : mimeType === 'image/webp'
          ? webpSize(bytes)
          : null;
  return size && size.width > 0 && size.height > 0 ? size : null;
}

/** The offered ratio closest to width / height, compared on a logarithmic scale. */
export function nearestAspectRatio(size: Size | null): AspectRatio {
  if (!size) return DEFAULT_ASPECT_RATIO;
  const wanted = Math.log(size.width / size.height);
  let best: AspectRatio = DEFAULT_ASPECT_RATIO;
  let distance = Infinity;
  for (const ratio of ASPECT_RATIOS) {
    const [w, h] = ratio.split(':').map(Number) as [number, number];
    const gap = Math.abs(Math.log(w / h) - wanted);
    if (gap < distance) {
      distance = gap;
      best = ratio;
    }
  }
  return best;
}
