/**
 * Errors of the map generator, and which of them a retry can fix.
 */
import { BridgeError } from '../../bridge/foundry-bridge.js';

export class MapsError extends Error {
  constructor(
    readonly code: string,
    message: string,
    /** false: trying again gives the same result (a missing model, a refusal). */
    readonly retryable = true
  ) {
    super(message);
    this.name = 'MapsError';
  }
}

/** Codes of the module that a second attempt would only repeat. */
const FINAL_MODULE_CODES = new Set([
  'ACCESS_DENIED',
  'WRITE_DISABLED',
  'PERMISSION_DENIED',
  'UNKNOWN_QUERY',
  'INVALID_ARGUMENT',
  'NOT_AVAILABLE',
  'NO_WORLD',
  'UNSUPPORTED_IMAGE',
  'TOO_LARGE',
]);

export function isRetryable(error: unknown): boolean {
  if (error instanceof MapsError) return error.retryable;
  if (error instanceof BridgeError) {
    if (error.code === 'CANCELLED') return false;
    if (error.moduleCode && FINAL_MODULE_CODES.has(error.moduleCode)) return false;
    return true;
  }
  return true;
}

export function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return 'unknown cause';
}

/**
 * A module too old for the map queries: the core's check, which also knows
 * the message of a module of the previous generation that sends no code.
 */
export { isUnknownQuery as isMissingQuery, moduleTooOldMessage } from '../../tools/results.js';
