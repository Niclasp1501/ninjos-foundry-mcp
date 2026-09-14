/**
 * Painting the picture and encoding it within a byte limit.
 *
 * One paint function draws everything for a given output size: ground colour,
 * the source (canvas capture or background), grid lines, cell labels and
 * numbered token markers. Encoding tries the quality steps first and only then
 * a smaller size, repainting at each size, so lines and labels stay sharp.
 */
import {
  MAX_DIMENSION,
  MIME_OF,
  QUALITY_STEPS,
  base64Bytes,
  dataUrlParts,
  labelEvery,
  shrink,
  type ImageFormat,
  type Rect,
} from '../../../common/areas/scene-image/geometry.js';
import { fail } from '../scenes/support.js';

export interface Surface {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
}

export function createSurface(width: number, height: number): Surface {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function')
    fail('NO_DOCUMENT', 'this browser offers no document to draw the picture in');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) fail('NO_2D_CONTEXT', 'the browser refused a 2D drawing context for the picture');
  return { canvas, context };
}

export interface Marker {
  /** The number drawn, the same as `index` in the token list. */
  index: number;
  /** Canvas pixels of the token's box. */
  x: number;
  y: number;
  width: number;
  height: number;
  disposition: number;
  hidden: boolean;
}

export interface Overlay {
  /** Canvas rectangle the picture shows. */
  rect: Rect;
  /** The scene rectangle, where cell 0, 0 starts. */
  scene: Rect;
  gridSize: number;
  /** Lines only on a square grid. */
  squareGrid: boolean;
  gridLines: boolean;
  gridLabels: boolean;
  markers: readonly Marker[];
  /** A disc over the token where nothing shows it, a small badge at its corner where the canvas does. */
  markerStyle: 'disc' | 'badge';
}

const DISPOSITION_COLOURS: Readonly<Record<number, string>> = {
  [-2]: '#7d3c98',
  [-1]: '#c0392b',
  0: '#d4a017',
  1: '#2e8b57',
};

function colourOf(disposition: number): string {
  return DISPOSITION_COLOURS[disposition] ?? '#5d6d7e';
}

function label(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number
): void {
  const width = Math.ceil(text.length * size * 0.62) + 4;
  context.fillStyle = 'rgba(255, 255, 255, 0.85)';
  context.fillRect(x, y, width, size + 4);
  context.fillStyle = '#111111';
  context.fillText(text, x + 2, y + size + 1);
}

export function paintOverlay(
  context: CanvasRenderingContext2D,
  overlay: Overlay,
  width: number
): void {
  const scale = width / overlay.rect.width;
  const cell = overlay.gridSize * scale;
  const firstColumn = Math.round((overlay.rect.x - overlay.scene.x) / overlay.gridSize);
  const firstRow = Math.round((overlay.rect.y - overlay.scene.y) / overlay.gridSize);
  const columns = Math.ceil(overlay.rect.width / overlay.gridSize);
  const rows = Math.ceil(overlay.rect.height / overlay.gridSize);
  const height = Math.round(overlay.rect.height * scale);

  if (overlay.squareGrid && overlay.gridLines && cell >= 3) {
    context.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    context.lineWidth = 1;
    context.beginPath();
    for (let c = 1; c < columns; c++) {
      const x = Math.round(c * cell) + 0.5;
      context.moveTo(x, 0);
      context.lineTo(x, height);
    }
    for (let r = 1; r < rows; r++) {
      const y = Math.round(r * cell) + 0.5;
      context.moveTo(0, y);
      context.lineTo(width, y);
    }
    context.stroke();
  }

  if (overlay.squareGrid && overlay.gridLabels) {
    const size = Math.max(9, Math.min(14, Math.floor(cell * 0.4)));
    context.font = `bold ${size}px sans-serif`;
    const step = labelEvery(cell, size * 2.4);
    for (let c = 0; c < columns; c++) {
      const column = firstColumn + c;
      if (column % step === 0) label(context, String(column), Math.round(c * cell) + 2, 2, size);
    }
    for (let r = 0; r < rows; r++) {
      const row = firstRow + r;
      if (row % step === 0 && r > 0) label(context, String(row), 2, Math.round(r * cell) + 2, size);
    }
  }

  for (const marker of overlay.markers) {
    const x = (marker.x - overlay.rect.x) * scale;
    const y = (marker.y - overlay.rect.y) * scale;
    const w = marker.width * scale;
    const h = marker.height * scale;
    const text = String(marker.index);
    const radius =
      overlay.markerStyle === 'disc'
        ? Math.max(7, Math.min(w, h) * 0.38)
        : Math.max(7, Math.min(11, Math.min(w, h) * 0.22));
    const cx = overlay.markerStyle === 'disc' ? x + w / 2 : x + radius;
    const cy = overlay.markerStyle === 'disc' ? y + h / 2 : y + radius;
    context.globalAlpha = marker.hidden ? 0.6 : 1;
    context.beginPath();
    context.arc(cx, cy, radius, 0, Math.PI * 2);
    context.fillStyle = colourOf(marker.disposition);
    context.fill();
    context.lineWidth = 2;
    context.strokeStyle = '#ffffff';
    context.setLineDash(marker.hidden ? [3, 2] : []);
    context.stroke();
    context.setLineDash([]);
    const font = Math.max(8, Math.round(radius * (text.length > 2 ? 0.8 : 1.05)));
    context.font = `bold ${font}px sans-serif`;
    context.fillStyle = '#ffffff';
    context.fillText(text, cx - text.length * font * 0.31, cy + font * 0.36);
    context.globalAlpha = 1;
  }
}

export interface Encoded {
  data: string;
  mimeType: string;
  bytes: number;
  quality: number;
  width: number;
  height: number;
  /** How many encodings were tried. */
  attempts: number;
}

/**
 * Paint at the start size and encode; lower the quality, then the size, until
 * the bytes fit. A browser that cannot write WebP answers with PNG; then JPEG
 * is used and the note says so.
 */
export function encodeWithin(
  paint: (surface: Surface, width: number, height: number) => void,
  start: { width: number; height: number },
  format: ImageFormat,
  maxBytes: number,
  notes: string[]
): Encoded {
  let mimeType = MIME_OF[format];
  let size: { width: number; height: number } | null = start;
  let attempts = 0;
  let smallest: { bytes: number; width: number; height: number } | null = null;

  while (size) {
    const surface = createSurface(size.width, size.height);
    paint(surface, size.width, size.height);
    for (const quality of QUALITY_STEPS) {
      attempts++;
      const parts = dataUrlParts(surface.canvas.toDataURL(mimeType, quality));
      if (!parts) fail('ENCODE_FAILED', 'the browser did not return the picture as a data URL');
      if (parts.mimeType !== mimeType) {
        if (mimeType === MIME_OF.jpeg)
          fail(
            'ENCODE_FAILED',
            `the browser cannot write JPEG (it answered with ${parts.mimeType})`
          );
        notes.push(`This browser cannot write ${mimeType}; the picture is JPEG instead.`);
        mimeType = MIME_OF.jpeg;
        return encodeWithin(paint, size, 'jpeg', maxBytes, notes);
      }
      const bytes = base64Bytes(parts.data);
      if (!smallest || bytes < smallest.bytes) smallest = { bytes, ...size };
      if (bytes <= maxBytes) {
        if (size.width !== start.width || size.height !== start.height)
          notes.push(
            `The picture was made smaller than asked (${size.width} x ${size.height} instead of ${start.width} x ${start.height}) to stay within maxBytes ${maxBytes}.`
          );
        return {
          data: parts.data,
          mimeType,
          bytes,
          quality,
          width: size.width,
          height: size.height,
          attempts,
        };
      }
    }
    size = shrink(size.width, size.height);
  }
  return fail(
    'IMAGE_TOO_LARGE',
    `even at ${MAX_DIMENSION.min} pixels on the long edge and the lowest quality the picture needs ` +
      `${smallest?.bytes ?? 'unknown'} bytes, more than maxBytes ${maxBytes}. Raise maxBytes or ask for a smaller region.`
  );
}
