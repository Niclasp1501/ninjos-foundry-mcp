/**
 * What the tools of the chat-tables-macros area share on the server side. Schema helpers
 * come from the world area; asking the module uses the core's "module too old".
 */
import type { QueryOptions } from '../../bridge/foundry-bridge.js';
import { legacyFailure, messageOf, moduleTooOld } from '../../tools/results.js';
import type { ToolContext } from '../../tools/types.js';
import { isRecord, param, schema, str, unknownShape } from '../world/shared.js';

export { isRecord, param, schema, str, unknownShape };

/** Ask the module; every failure becomes "Failed to <operation>: <cause>". */
export async function ask(
  context: ToolContext,
  query: string,
  data: Record<string, unknown>,
  operation: string,
  options?: QueryOptions
): Promise<unknown> {
  let answer: unknown;
  try {
    answer = options ? await context.query(query, data, options) : await context.query(query, data);
  } catch (error) {
    throw (
      moduleTooOld(query, error, operation) ??
      new Error(`Failed to ${operation}: ${messageOf(error)}`)
    );
  }
  const failure = legacyFailure(answer);
  if (failure !== null) throw new Error(`Failed to ${operation}: ${failure}`);
  return answer;
}

/** The given arguments that are set, nothing else. */
export function pick(
  args: Record<string, unknown>,
  keys: readonly string[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) if (args[key] !== undefined) out[key] = args[key];
  return out;
}

export function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function warningLines(answer: Record<string, unknown>): string[] {
  return listOf(answer['warnings']).map(warning => `Warning: ${String(warning)}`);
}

/** The speaker parameters shared by sending a message and running a macro. */
export const SPEAKER_PARAMETERS = {
  speakerActor: param('string', 'Speak as this actor: its id or exact name'),
  speakerToken: param(
    'string',
    'Speak as this token: its uuid ("Scene.<id>.Token.<id>") or its id; never its name'
  ),
  sceneId: param(
    'string',
    'Scene id or exact name that holds speakerToken, when the id is on several scenes'
  ),
  alias: param('string', 'Name shown as the speaker; defaults to the token or actor name'),
};
