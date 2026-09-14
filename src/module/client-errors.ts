/**
 * A write to Foundry has two halves: the server stores it, then Foundry's
 * client code reacts in this browser (`_onCreateOperation`,
 * `_onUpdateOperation`, `_onDeleteOperation`). The second half can throw
 * although the first one worked. Observed on 14.09.2026 with Foundry 14.367 in
 * a Gamemaster browser without a drawn canvas: deleting a drawing, a light or a
 * token threw "Cannot read properties of null (reading 'clipboard')" after the
 * server had deleted them.
 *
 * So a throw says nothing about what the world holds. A write path runs its
 * write through `settleWrite`, reads back either way, counts what it finds and
 * reports the error with `afterWriteWarning` where the write took effect.
 */

export interface SettledWrite<T> {
  value: T | undefined;
  /** What the write threw, or undefined. */
  error: unknown;
  threw: boolean;
}

/** Run a write and keep what it threw instead of throwing. */
export async function settleWrite<T>(write: () => Promise<T>): Promise<SettledWrite<T>> {
  try {
    return { value: await write(), error: undefined, threw: false };
  } catch (error) {
    return { value: undefined, error, threw: true };
  }
}

/** The error as Foundry shows it in the console, with its class when it is not a plain Error. */
export function errorText(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message || 'no message';
    return error.name && error.name !== 'Error' ? `${error.name}: ${message}` : message;
  }
  return typeof error === 'string' && error ? error : 'unknown cause';
}

/** Whether this browser has a drawn canvas. */
export function canvasDrawn(): boolean {
  const board = (globalThis as { canvas?: { ready?: unknown } | null }).canvas;
  return board?.ready === true;
}

/**
 * The warning for a write that threw but took effect when read back.
 * `outcome` says what reading back found, as a sentence.
 */
export function afterWriteWarning(error: unknown, outcome: string): string {
  return (
    `Foundry's client code threw after the server had written: ${errorText(error)}.` +
    (canvasDrawn()
      ? ''
      : ' This Gamemaster browser draws no canvas ("Disable Game Canvas" or a scene still loading), and ' +
        "Foundry's client code for scene elements expects one.") +
    ` ${outcome}`
  );
}
