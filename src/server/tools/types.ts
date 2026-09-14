/**
 * How a built-in tool is described.
 *
 * Every tool states its group and its MCP annotations next to its handler.
 * The annotations let a client ask for confirmation only where it matters.
 * They are hints for the client, not the permission check: that runs in the
 * module, in one place, before the handler there touches the world
 * (src/common/permissions.ts).
 */
import type { ProgressPayload } from '../../common/protocol.js';
import type { ToolAnnotations } from '../control/api.js';
import type { QueryOptions } from '../bridge/foundry-bridge.js';

export const TOOL_GROUPS = [
  'world',
  'scenes',
  'journals',
  'compendiums',
  'actors',
  'tokens',
  'dice',
  'playlists',
  'rolltables',
  'folders',
  'campaign',
  'maps',
  'systems',
  // Groups of later areas, declared up front so those areas need no change here.
  'effects',
  'combat',
  'chat',
  'macros',
  'canvas',
  'files',
  'cards',
  'users',
  'documents',
  'history',
] as const;

export type ToolGroup = (typeof TOOL_GROUPS)[number];

export interface ToolContext {
  /** Ask the module. Waits briefly for it right after the backend started. */
  query(name: string, data?: unknown, options?: QueryOptions): Promise<unknown>;
  /** Report progress to the client, when it asked for it. */
  progress(progress: ProgressPayload): void;
  signal?: AbortSignal;
}

/**
 * What a handler may return. A string becomes the text, an object becomes
 * JSON text, and a finished tool result is passed on unchanged: it is never
 * wrapped a second time.
 */
export type ToolOutput = string | Record<string, unknown> | unknown[];

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  group: ToolGroup;
  inputSchema: Record<string, unknown>;
  annotations: ToolAnnotations;
  handler(args: Record<string, unknown>, context: ToolContext): Promise<ToolOutput>;
}

/** Annotations of a tool that only reads the open world. */
export function readOnlyTool(title: string): ToolAnnotations {
  return {
    title,
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
}

/** Annotations of a tool that changes the world. `destructive` for anything that removes or overwrites. */
export function writingTool(
  title: string,
  { destructive, idempotent }: { destructive: boolean; idempotent: boolean }
): ToolAnnotations {
  return {
    title,
    readOnlyHint: false,
    destructiveHint: destructive,
    idempotentHint: idempotent,
    openWorldHint: false,
  };
}
