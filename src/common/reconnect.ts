/**
 * When the module tries again after the bridge closed.
 *
 * One mechanism only. The previous generation had a reconnect loop and a
 * heartbeat that both restarted a lost bridge, and the heartbeat switched
 * automatic reconnecting off in the world settings when it failed once.
 */
import { CLOSE_ORIGIN_REJECTED } from './constants.js';

/** Fast at first, since the usual cause is a backend that is just restarting. */
const EARLY_DELAYS_MS = [1000, 2000, 5000, 10000, 20000] as const;

/**
 * Afterwards every 10 seconds, without ever giving up. A failed attempt at a
 * server on the same PC costs next to nothing, and a longer wait only delays
 * the bridge after the server was started.
 */
export const STEADY_DELAY_MS = 10000;

/** Delay before attempt number `attempt` (1 based). */
export function reconnectDelay(attempt: number): number {
  if (attempt < 1) return EARLY_DELAYS_MS[0];
  return EARLY_DELAYS_MS[attempt - 1] ?? STEADY_DELAY_MS;
}

export type CloseVerdict = 'retry' | 'stop-rejected' | 'stop-requested';

/**
 * What to do after a close.
 *
 * - Refused origin: retrying cannot change the answer, so stop and show why.
 * - A close the module asked for itself: stop.
 * - Everything else, a clean close by the server included: try again.
 */
export function judgeClose(code: number, requestedByUs: boolean): CloseVerdict {
  if (requestedByUs) return 'stop-requested';
  if (code === CLOSE_ORIGIN_REJECTED) return 'stop-rejected';
  return 'retry';
}
