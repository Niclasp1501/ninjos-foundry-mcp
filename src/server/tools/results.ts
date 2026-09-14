/**
 * Turning what a tool produced into exactly one MCP tool result.
 *
 * The previous generation wrapped twice: tools returned `{ content: [...] }`
 * and the backend put that whole object into a text block as JSON, so the
 * model read JSON around the actual text. Here a finished result passes
 * through untouched, and only raw output is wrapped, once.
 */
import { errorResult, type TextContent, type ToolResult } from '../control/api.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isToolResult(value: unknown): value is ToolResult {
  return (
    isRecord(value) &&
    Array.isArray(value['content']) &&
    value['content'].every(block => isRecord(block) && typeof block['type'] === 'string')
  );
}

/**
 * `{ success: false, error }` returned as a normal value.
 *
 * Modules of the previous generation answer "Access denied" and a few other
 * failures this way instead of failing the query. It is an error and is
 * reported as one.
 */
export function legacyFailure(value: unknown): string | null {
  if (!isRecord(value) || value['success'] !== false) return null;
  const error = value['error'];
  if (typeof error === 'string' && error) return error;
  if (isRecord(error) && typeof error['message'] === 'string') return error['message'];
  return 'The module reported a failure without a reason';
}

function truncate(block: TextContent, maxChars: number): TextContent {
  if (maxChars <= 0 || block.text.length <= maxChars) return block;
  return {
    type: 'text',
    text:
      `${block.text.slice(0, maxChars)}\n\n[Truncated: showing ${maxChars} of ${block.text.length} characters ` +
      '(TOOL_RESPONSE_MAX_CHARS). Do not write this text back as if it were complete; narrow the request instead.]',
  };
}

export function toToolResult(output: unknown, maxChars = 0): ToolResult {
  if (isToolResult(output)) {
    if (maxChars <= 0) return output;
    return {
      ...output,
      content: output.content.map(block =>
        block.type === 'text' ? truncate(block, maxChars) : block
      ),
    };
  }

  const failure = legacyFailure(output);
  if (failure !== null) return errorResult(failure);

  const text = typeof output === 'string' ? output : JSON.stringify(output ?? null, null, 2);
  return { content: [truncate({ type: 'text', text }, maxChars)] };
}

export function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return 'Unknown error';
}

/**
 * Whether a failed query means the connected module has no handler for it.
 *
 * A module of this generation fails with the code `UNKNOWN_QUERY` (the bridge
 * keeps it as `moduleCode`); a module of the previous generation only says
 * "No handler found for query" in the message. Both mean the module is older
 * than the server, and nothing was done in the world. Read without importing
 * the bridge, so the helper also takes errors a test builds by hand.
 */
export function isUnknownQuery(error: unknown): boolean {
  const code = isRecord(error) ? error['moduleCode'] : undefined;
  return code === 'UNKNOWN_QUERY' || /no handler found for query/i.test(messageOf(error));
}

/**
 * The one sentence every package uses when the module does not know a query.
 * `operation` is what failed ("list playlists"); without it the sentence
 * starts with the module. The original message stays at the end, as the cause.
 */
export function moduleTooOldMessage(query: string, error: unknown, operation?: string): string {
  const about =
    `the connected Foundry module does not know the query "${query}", so it is older than this server. ` +
    "Nothing was changed in the world. Update the module Ninjo's Foundry MCP in Foundry and reload the world. " +
    `(${messageOf(error)})`;
  return operation
    ? `Failed to ${operation}: ${about}`
    : about.charAt(0).toUpperCase() + about.slice(1);
}

/** `moduleTooOldMessage` as an error when the module lacks the query, otherwise null. */
export function moduleTooOld(query: string, error: unknown, operation?: string): Error | null {
  return isUnknownQuery(error) ? new Error(moduleTooOldMessage(query, error, operation)) : null;
}
