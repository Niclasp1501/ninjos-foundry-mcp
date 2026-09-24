/**
 * Errors of the image generator.
 */
export class MapsError extends Error {
  constructor(
    readonly code: string,
    message: string,
    /** false: trying again gives the same result (a rejected key, a refusal). */
    readonly retryable = true
  ) {
    super(message);
    this.name = 'MapsError';
  }
}

export function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return 'unknown cause';
}

/**
 * A module too old for the image queries: the core's check, which also knows
 * the message of a module of the previous generation that sends no code.
 */
export { isUnknownQuery as isMissingQuery, moduleTooOldMessage } from '../../tools/results.js';
