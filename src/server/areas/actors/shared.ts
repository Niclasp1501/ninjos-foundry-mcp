/**
 * What the tools of the actors area share on the server side. The general way to
 * ask the module comes from the world area (world/shared.ts), imported, not
 * copied.
 */
import { legacyFailure, messageOf } from '../../tools/results.js';
import type { ToolContext } from '../../tools/types.js';
import { askModule, isMissingQuery, isRecord, listIn, str, unknownShape } from '../world/shared.js';

export { askModule, isMissingQuery, isRecord, listIn, str, unknownShape };

export type Args = Record<string, unknown>;

/**
 * Ask a query of this generation; a module of the previous one, which does not
 * know it, is served by `previous` with the queries it has.
 */
export async function askOrPrevious(
  context: ToolContext,
  query: string,
  data: Args,
  operation: string,
  previous: () => Promise<unknown>
): Promise<unknown> {
  let answer: unknown;
  try {
    answer = await context.query(query, data);
  } catch (error) {
    if (isMissingQuery(error)) return previous();
    throw new Error(`Failed to ${operation}: ${messageOf(error)}`);
  }
  const failure = legacyFailure(answer);
  if (failure !== null) throw new Error(`Failed to ${operation}: ${failure}`);
  return answer;
}

/** Only the given arguments that are set, for the data of a query. */
export function pick(args: Args, keys: readonly string[]): Args {
  const out: Args = {};
  for (const key of keys) if (args[key] !== undefined) out[key] = args[key];
  return out;
}

/** Arguments that were given but mean nothing for the chosen action. */
export function unusedArguments(args: Args, used: readonly string[]): string[] {
  return Object.keys(args).filter(key => args[key] !== undefined && !used.includes(key));
}

export function records(value: unknown): Args[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}
