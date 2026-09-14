import { afterEach, describe, expect, it } from 'vitest';
import { afterWriteWarning, canvasDrawn, errorText, settleWrite } from './client-errors.js';

const global = globalThis as { canvas?: unknown };
afterEach(() => {
  delete global.canvas;
});

describe('writes whose client half throws', () => {
  it('keeps the value or the error instead of throwing', async () => {
    expect(await settleWrite(async () => 3)).toEqual({ value: 3, error: undefined, threw: false });
    const failure = new TypeError("Cannot read properties of null (reading 'clipboard')");
    const settled = await settleWrite(async () => {
      throw failure;
    });
    expect(settled).toMatchObject({ value: undefined, threw: true });
    expect(settled.error).toBe(failure);
  });

  it('names the error with its class, and the missing canvas only when there is none', () => {
    const failure = new TypeError("Cannot read properties of null (reading 'clipboard')");
    expect(errorText(failure)).toBe(
      "TypeError: Cannot read properties of null (reading 'clipboard')"
    );
    expect(errorText(new Error('disk full'))).toBe('disk full');
    expect(errorText('plain')).toBe('plain');
    expect(errorText(undefined)).toBe('unknown cause');

    expect(canvasDrawn()).toBe(false);
    expect(afterWriteWarning(failure, 'Read back, it is gone.')).toBe(
      "Foundry's client code threw after the server had written: TypeError: Cannot read properties of null " +
        '(reading \'clipboard\'). This Gamemaster browser draws no canvas ("Disable Game Canvas" or a scene still ' +
        "loading), and Foundry's client code for scene elements expects one. Read back, it is gone."
    );
    global.canvas = { ready: true };
    expect(canvasDrawn()).toBe(true);
    expect(afterWriteWarning(new Error('x'), 'Done.')).toBe(
      "Foundry's client code threw after the server had written: x. Done."
    );
  });
});
