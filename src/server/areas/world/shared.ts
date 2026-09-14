/**
 * What the tools of the world area share on the server side.
 */
import { legacyFailure, messageOf } from '../../tools/results.js';
import type { ToolContext } from '../../tools/types.js';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One parameter of an input schema: its JSON type and what it means. */
export function param(type: string, description: string, extra: Record<string, unknown> = {}) {
  return { type, description, ...extra };
}

/** An input schema; the parameter names and types are the ones in the tool directory. */
export function schema(properties: Record<string, unknown>, required: string[] = []) {
  return required.length
    ? { type: 'object', properties, required }
    : { type: 'object', properties };
}

export function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** Whether a failed query means the connected module has no handler for it. */
export function isMissingQuery(error: unknown): boolean {
  const code = isRecord(error) ? error['moduleCode'] : undefined;
  return code === 'UNKNOWN_QUERY' || /no handler found/i.test(messageOf(error));
}

/**
 * Ask the module and turn every failure into "Failed to <operation>: <cause>".
 * An old module answers some refusals as a normal `{ success: false, error }`;
 * that is a failure too and is never formatted as a result. A module without
 * a handler for the query is named as too old, with the original message.
 */
export async function askModule(
  context: ToolContext,
  query: string,
  data: Record<string, unknown>,
  operation: string
): Promise<unknown> {
  let answer: unknown;
  try {
    answer = await context.query(query, data);
  } catch (error) {
    if (isMissingQuery(error)) {
      throw new Error(
        `Failed to ${operation}: the connected Foundry module does not know the query "${query}" ` +
          `(${messageOf(error)}). It is older or newer than this server; update both to the same version.`
      );
    }
    throw new Error(`Failed to ${operation}: ${messageOf(error)}`);
  }
  const failure = legacyFailure(answer);
  if (failure !== null) throw new Error(`Failed to ${operation}: ${failure}`);
  return answer;
}

/**
 * The list inside an answer: the answer itself, or the named field.
 * Null when neither is a list, so the caller passes the answer on unchanged
 * instead of guessing (the raw answers of a previous generation module are
 * not described).
 */
export function listIn(answer: unknown, field: string): unknown[] | null {
  if (Array.isArray(answer)) return answer;
  if (isRecord(answer) && Array.isArray(answer[field])) return answer[field];
  return null;
}

export function unknownShape(answer: unknown): string {
  return `The module answered in a form this server does not know; passed on unchanged:\n${JSON.stringify(answer, null, 2)}`;
}
