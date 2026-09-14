/**
 * No window larger than the screen: the fitting caps size, clamps the
 * position and leaves a window alone that someone resized by hand.
 */
import { describe, expect, it } from 'vitest';
import { MODULE_ID } from '../../../common/constants.js';
import { clampStart, fitWindow, isOurs, MARGIN, type FitApp } from './window-fit.js';

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

function fakeWindow(
  box: Box,
  classes = [MODULE_ID],
  content = { scrollHeight: 0, clientHeight: 0 }
) {
  const state = { ...box };
  const element = {
    isConnected: true,
    classList: { contains: (name: string) => classes.includes(name) },
    style: { maxHeight: '' },
    getBoundingClientRect: () => ({ ...state }),
    querySelector: () => content,
    querySelectorAll: () => [],
  };
  const app: FitApp & { position: { width: number } } = {
    element,
    position: { width: box.width },
    setPosition(position) {
      Object.assign(state, position);
      if (position.width !== undefined) app.position.width = position.width;
    },
  };
  return { app, state, element };
}

describe('window fitting', () => {
  it('moves a window that runs off the bottom back into view', () => {
    const { app, state } = fakeWindow({ left: 900, top: 600, width: 400, height: 300 });
    fitWindow(app, { width: 1000, height: 700 });
    expect(state.width).toBe(600);
    expect(state.top).toBeGreaterThanOrEqual(MARGIN);
    expect(state.top + state.height).toBeLessThanOrEqual(700 - MARGIN);
    expect(state.left + state.width).toBeLessThanOrEqual(1000 - MARGIN);
  });

  it('caps a window taller than the screen and lets its content scroll', () => {
    const { app, state, element } = fakeWindow(
      { left: 10, top: 50, width: 560, height: 900 },
      [MODULE_ID],
      { scrollHeight: 1400, clientHeight: 850 }
    );
    fitWindow(app, { width: 1200, height: 700 });
    expect(state.height).toBe(700 - 2 * MARGIN);
    expect(state.top).toBe(MARGIN);
    expect(element.style.maxHeight).toBe(`${700 - 2 * MARGIN}px`);
  });

  it('keeps a window no wider than a phone screen', () => {
    const { app, state } = fakeWindow({ left: 0, top: 0, width: 620, height: 300 });
    fitWindow(app, { width: 360, height: 640 });
    expect(state.width).toBe(360 - 2 * MARGIN);
    expect(state.left).toBe(MARGIN);
  });

  it('leaves the width alone once someone resized the window by hand', () => {
    const { app, state } = fakeWindow({ left: 20, top: 20, width: 400, height: 300 });
    fitWindow(app, { width: 1600, height: 900 });
    app.setPosition({ width: 700 });
    fitWindow(app, { width: 1600, height: 900 });
    expect(state.width).toBe(700);
  });

  it('recognises only windows of this module', () => {
    expect(isOurs(fakeWindow({ left: 0, top: 0, width: 1, height: 1 }).app)).toBe(true);
    expect(isOurs(fakeWindow({ left: 0, top: 0, width: 1, height: 1 }, ['other']).app)).toBe(false);
    expect(isOurs(null)).toBe(false);
  });

  it('clamps a start inside the margins, the top edge winning when nothing fits', () => {
    expect(clampStart(-50, 100, 1000)).toBe(MARGIN);
    expect(clampStart(950, 100, 1000)).toBe(1000 - 100 - MARGIN);
    expect(clampStart(300, 2000, 1000)).toBe(MARGIN);
  });
});
