/**
 * What an MCP front end needs from the backend.
 *
 * The wrapper implements this over the control channel, and a later
 * Streamable HTTP front end inside the backend implements it directly. The MCP
 * layer (mcp-facade.ts) only ever sees this interface, which is why HTTP can be
 * added without touching it.
 */
import type { ProgressPayload } from '../../common/protocol.js';

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ListedTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: ToolAnnotations;
}

export interface TextContent {
  type: 'text';
  text: string;
}

/**
 * An image a tool shows the model (the scene-image area), base64 without a data URL
 * prefix. `text` is declared as never present, so code that reads the text of
 * a block keeps compiling and gets `undefined` for an image.
 */
export interface ImageContent {
  type: 'image';
  data: string;
  mimeType: string;
  text?: never;
}

export type ToolContent = TextContent | ImageContent;

export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

export interface ListedResource {
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
}

export interface ResourceContents {
  contents: Array<{ uri: string; mimeType?: string; text: string }>;
}

export interface ListedPrompt {
  name: string;
  title?: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

export interface PromptResult {
  description?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: TextContent }>;
}

export interface CallOptions {
  onProgress?: (progress: ProgressPayload) => void;
  signal?: AbortSignal;
}

/** A resource whose URI carries ids, e.g. `foundry://actor/{actorId}`. */
export interface ListedResourceTemplate {
  uriTemplate: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
}

/** What `completion/complete` asks about. */
export interface CompletionRequest {
  ref: { type: 'ref/prompt'; name: string } | { type: 'ref/resource'; uri: string };
  argument: { name: string; value: string };
  /** Arguments already given, e.g. the journal id when completing a page id. */
  arguments?: Record<string, string>;
}

export interface CompletionValues {
  values: string[];
  total?: number;
  hasMore?: boolean;
}

/**
 * Something every MCP session should hear about. `resources_updated`
 * names URI prefixes; a session tells its client about each subscribed URI
 * that equals one or starts with one.
 */
export type BackendEvent =
  | { type: 'tools_changed' }
  | { type: 'resources_changed' }
  | { type: 'prompts_changed' }
  | { type: 'resources_updated'; prefixes: string[] };

export interface BackendApi {
  listTools(): Promise<ListedTool[]>;
  callTool(name: string, args: Record<string, unknown>, options?: CallOptions): Promise<ToolResult>;
  listResources(): Promise<ListedResource[]>;
  readResource(uri: string, options?: CallOptions): Promise<ResourceContents>;
  listPrompts(): Promise<ListedPrompt[]>;
  getPrompt(name: string, args: Record<string, string>): Promise<PromptResult>;
  /** Optional: a backend of an earlier state has none. */
  listResourceTemplates?(): Promise<ListedResourceTemplate[]>;
  /** Values for an id argument of a prompt or resource template. */
  complete?(request: CompletionRequest): Promise<CompletionValues>;
  /** Hear every BackendEvent until the returned function is called. */
  watch?(listener: (event: BackendEvent) => void): () => void;
}

/** The documented error form of a tool: the cause, marked as an error. */
export function errorResult(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: `Error: ${message || 'Backend unavailable'}` }],
    isError: true,
  };
}
