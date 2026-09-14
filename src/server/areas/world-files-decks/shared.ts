/**
 * What the tools of the world-files-decks area share on the server side. Asking the module
 * and the schema helpers come from the chat-tables-macros and world areas (imported only).
 */
import {
  ask,
  isRecord,
  listOf,
  param,
  pick,
  schema,
  str,
  unknownShape,
} from '../chat-tables-macros/shared.js';

export { ask, isRecord, listOf, param, pick, schema, str, unknownShape };

/** Scans of the whole world and folder listings can take a while in a large world. */
export const SCAN_TIMEOUT_MS = 300_000;

/** A copy fetches and uploads up to 50 MiB in the browser. */
export const COPY_TIMEOUT_MS = 180_000;

export const DRY_RUN = param(
  'boolean',
  'Only check and report what would happen; nothing is written. Needs no write permission.'
);

export function yesNo(value: unknown, yes: string, no: string): string {
  return value === true ? yes : no;
}

export function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
