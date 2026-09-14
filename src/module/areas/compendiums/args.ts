/**
 * Reading the data of a query. A server of either generation sends the tool
 * arguments as they are. Wrong types are refused with the parameter named,
 * never guessed at: the previous generation took the first text parameter as
 * the query when `query` was missing.
 */
import { QueryError } from '../../dispatcher.js';

export type Data = Record<string, unknown>;

export function asData(data: unknown): Data {
  return typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as Data) : {};
}

export function invalid(message: string): QueryError {
  return new QueryError('INVALID_ARGUMENT', message);
}

function absent(value: unknown): boolean {
  return value === undefined || value === null;
}

export function requiredString(data: Data, key: string): string {
  const value = data[key];
  if (typeof value !== 'string' || value.trim() === '')
    throw invalid(`${key} is required and must be a non-empty text`);
  return value;
}

export function optionalString(data: Data, key: string): string | undefined {
  const value = data[key];
  if (absent(value)) return undefined;
  if (typeof value !== 'string') throw invalid(`${key} must be a text, got ${typeof value}`);
  return value;
}

/** A boolean; the texts "true" and "false" are accepted, models often send them. */
export function optionalBoolean(data: Data, key: string): boolean | undefined {
  const value = data[key];
  if (absent(value)) return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw invalid(`${key} must be true or false, got ${JSON.stringify(value)}`);
}

export function optionalStringList(data: Data, key: string): string[] | undefined {
  const value = data[key];
  if (absent(value)) return undefined;
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string'))
    throw invalid(`${key} must be a list of texts`);
  return value as string[];
}

/** A whole number within bounds; a number in a text is accepted. */
export function integerInRange(
  data: Data,
  key: string,
  bounds: { min: number; max: number; fallback: number }
): number {
  const value = data[key];
  if (absent(value)) return bounds.fallback;
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(number))
    throw invalid(`${key} must be a number, got ${JSON.stringify(value)}`);
  const whole = Math.trunc(number);
  if (whole < bounds.min || whole > bounds.max)
    throw invalid(`${key} must be between ${bounds.min} and ${bounds.max}, got ${whole}`);
  return whole;
}

export function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return 'unknown error';
}
