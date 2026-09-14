/**
 * No window larger than the screen.
 *
 * Grown from fensterpassen.js, the in-house file every Ninjo module carries,
 * brought into the TypeScript build. The module block is the only part that
 * differs per module; the rest follows the in-house file.
 *
 * The rule: a window is at most as large as the visible area minus a margin,
 * and it always lies completely inside it. What does not fit scrolls. Checked
 * after every render and whenever the visible area changes: turning a tablet,
 * an on-screen keyboard, a split screen.
 *
 * Deviations from the in-house file, both deliberate:
 * - The visible area comes from `visualViewport` where there is one. On a
 *   tablet `innerHeight` stays the same while the keyboard covers half of it.
 * - Only ApplicationV2 windows are watched. This module has no window of the
 *   old kind any more.
 */
import { MODULE_ID } from '../../../common/constants.js';
import { foundryNamespace } from './foundry-access.js';

/* ── The only part that differs per module ────────────────────────── */

const MODULE = {
  /** Classes by which this module recognises its own windows. One of them suffices. */
  classes: [MODULE_ID],
  /** Parts that scroll on their own, besides .window-content. */
  scrollParts: ['.mcp-release__groups'],
};

/* ── The same in every module from here on ────────────────────────── */

/** Distance to the edge. Enough to still grab the border. */
export const MARGIN = 8;

/** Smaller than this a window stops being one. */
const MINIMUM = { width: 280, height: 200 };

/** How much a window may grow when it first opens: its width fits its content, half again stays in proportion. */
const GROWTH = 1.5;

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface FitElement {
  isConnected: boolean;
  classList: { contains(name: string): boolean };
  style: { maxHeight: string };
  getBoundingClientRect(): Box;
  querySelector(selector: string): { scrollHeight: number; clientHeight: number } | null;
  querySelectorAll(selector: string): ArrayLike<{ scrollHeight: number; clientHeight: number }>;
}

export interface FitApp {
  element?: unknown;
  position?: { width?: unknown };
  setPosition(position: { width?: number; height?: number; left?: number; top?: number }): unknown;
}

export interface Viewport {
  width: number;
  height: number;
}

/** What we set last, per window. Only an untouched window is changed again. */
const lastSet = new WeakMap<object, { wish: number; width: number; height: number }>();
/** Windows that grew once. Growing happens exactly once. */
const grown = new WeakSet<object>();

function elementOf(app: FitApp | null | undefined): FitElement | null {
  const element = app?.element as FitElement | ArrayLike<FitElement> | null | undefined;
  if (!element) return null;
  if ('getBoundingClientRect' in element) return element;
  return (element as ArrayLike<FitElement>)[0] ?? null;
}

/** Does the window belong to this module? */
export function isOurs(app: unknown): boolean {
  const classes = elementOf(app as FitApp)?.classList;
  return classes ? MODULE.classes.some(name => classes.contains(name)) : false;
}

export function viewportSize(): Viewport {
  const visual = window.visualViewport;
  return visual
    ? { width: visual.width, height: visual.height }
    : { width: window.innerWidth, height: window.innerHeight };
}

/** Start of a box of `size` on an axis of `total`, inside the margins; the top or left edge wins when it cannot fit. */
export function clampStart(start: number, size: number, total: number): number {
  return Math.min(Math.max(MARGIN, start), Math.max(MARGIN, total - size - MARGIN));
}

/** How much height the scrolling parts are missing: the largest shortfall. */
function missingHeight(element: FitElement): number {
  const parts = [element.querySelector('.window-content')];
  for (const selector of MODULE.scrollParts)
    parts.push(...Array.from(element.querySelectorAll(selector)));
  let missing = 0;
  for (const part of parts)
    if (part) missing = Math.max(missing, part.scrollHeight - part.clientHeight);
  return missing;
}

/**
 * Move a window into view and give it the room it needs. Width first (it
 * changes the line breaks), then the position (it frees the room), then the
 * height.
 */
export function fitWindow(app: FitApp, viewport: Viewport = viewportSize()): void {
  const element = elementOf(app);
  if (!element || !element.isConnected) return;

  const maxHeight = viewport.height - 2 * MARGIN;
  const maxWidth = viewport.width - 2 * MARGIN;
  const box = element.getBoundingClientRect();

  // Asked, not measured: during the render hook the frame is still being built.
  const asked = app.position?.width;
  const wantedWidth = typeof asked === 'number' && Number.isFinite(asked) ? asked : box.width;

  // Untouched means: as large as we made it last. Whoever resized it by hand has the last word.
  const ours = lastSet.get(app);
  const untouched =
    ours === undefined ||
    (Math.abs(ours.width - wantedWidth) <= 1 && Math.abs(ours.height - box.height) <= 2);

  let targetWidth = wantedWidth;
  if (!grown.has(app)) {
    grown.add(app);
    targetWidth = Math.min(wantedWidth * GROWTH, maxWidth);
  } else if (untouched && ours?.wish) {
    // Back to the wished width as far as the screen allows, so a turned tablet gets its windows back.
    targetWidth = Math.min(ours.wish * GROWTH, maxWidth);
  }
  const width = Math.max(MINIMUM.width, Math.min(targetWidth, maxWidth));
  if (Math.abs(width - wantedWidth) > 1) app.setPosition({ width: Math.round(width) });

  const after = element.getBoundingClientRect();
  let height = after.height;
  if (untouched) {
    const missing = missingHeight(element);
    if (missing > 1) {
      height =
        missing > viewport.height * 0.15 ? maxHeight : Math.min(after.height + missing, maxHeight);
    }
  }
  height = Math.max(MINIMUM.height, Math.min(height, maxHeight));

  const left = clampStart(after.left, width, viewport.width);
  const top = clampStart(after.top, height, viewport.height);

  // Move up before growing: Foundry caps the height by the top edge it has at that moment.
  if (Math.abs(top - after.top) > 1) app.setPosition({ top: Math.round(top) });
  if (Math.abs(left - after.left) > 1) app.setPosition({ left: Math.round(left) });

  if (Math.abs(height - after.height) > 1) {
    // Foundry writes a max-height from the first top edge and never recomputes it.
    element.style.maxHeight = `${Math.round(maxHeight)}px`;
    app.setPosition({ height: Math.round(height) });
  }

  lastSet.set(app, {
    wish: ours?.wish ?? wantedWidth,
    width: Math.round(width),
    height: Math.round(element.getBoundingClientRect().height),
  });
}

function fitAll(): void {
  const instances = foundryNamespace()?.applications?.instances;
  for (const app of instances?.values() ?? []) {
    if (isOurs(app)) fitWindow(app as unknown as FitApp);
  }
}

let installed = false;

/** Install once, at ready. */
export function installWindowFit(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  Hooks.on('renderApplicationV2', (app: unknown) => {
    if (!isOurs(app)) return;
    // setTimeout, not requestAnimationFrame: a hidden browser window never runs animation frames.
    setTimeout(() => fitWindow(app as FitApp), 0);
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const refit = () => {
    clearTimeout(timer);
    timer = setTimeout(fitAll, 120);
  };
  window.addEventListener('resize', refit);
  window.visualViewport?.addEventListener('resize', refit);
}
