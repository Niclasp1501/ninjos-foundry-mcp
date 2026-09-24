/**
 * The tool list and the way into every tool.
 *
 * Own tools come first. Tools of other Foundry modules are asked from the
 * module on every listing, because they only exist once a world is loaded,
 * and a broken or missing bridge never takes the own tools away.
 */
import { RESERVED_TOOL_NAMES } from '../../common/reserved-tools.js';
import { checkArguments } from '../../common/schema-check.js';
import type { CallOptions, ListedTool, ToolAnnotations, ToolResult } from '../control/api.js';
import { errorResult } from '../control/api.js';
import { BridgeError, NOT_CONNECTED_MESSAGE, type QueryOptions } from '../bridge/foundry-bridge.js';
import type { Logger } from '../logger.js';
import { messageOf, toToolResult } from './results.js';
import { ConfirmationGate, schemaHasDryRun, splitConfirmation } from './confirmation.js';
import type { ToolCallEvent } from './notifications.js';
import type { ToolContext, ToolDefinition, ToolGroup } from './types.js';

export interface BridgeAccess {
  query(name: string, data?: unknown, options?: QueryOptions): Promise<unknown>;
  isConnected(): boolean;
  waitForModule(ms: number): Promise<boolean>;
}

export interface ToolRegistryOptions {
  bridge: BridgeAccess;
  logger: Logger;
  /** From FOUNDRY_MCP_TOOL_GROUPS. */
  groups: string[];
  /** GEMINI_API_KEY is set; without it the group `maps` is off. */
  imagesEnabled: boolean;
  maxChars: number;
  /** How much of the startup wait for the module is left, in ms. */
  startupWaitLeft: () => number;
  /** Why the bridge cannot accept connections at all, when that is the case. */
  bridgeProblem?: () => string | null;
  /** Upper bound for asking the module for its extension tools. */
  extensionListTimeoutMs?: number;
}

export interface ExtensionTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  moduleId: string;
  annotations?: ToolAnnotations;
  timeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Group switch. Empty list: all. Plain names: only those. "!name": all but those. */
export function groupEnabled(group: ToolGroup, groups: string[], imagesEnabled: boolean): boolean {
  if (group === 'maps' && !imagesEnabled) return false;
  const wanted = groups.map(g => g.toLowerCase());
  if (wanted.includes(`!${group}`)) return false;
  const positive = wanted.filter(g => !g.startsWith('!'));
  return positive.length === 0 || positive.includes('all') || positive.includes(group);
}

const ANNOTATION_KEYS = [
  'readOnlyHint',
  'destructiveHint',
  'idempotentHint',
  'openWorldHint',
] as const;

function sanitizeAnnotations(value: unknown): ToolAnnotations | undefined {
  if (!isRecord(value)) return undefined;
  const out: ToolAnnotations = {};
  for (const key of ANNOTATION_KEYS) {
    if (typeof value[key] === 'boolean') out[key] = value[key];
  }
  if (typeof value['title'] === 'string') out.title = value['title'];
  return Object.keys(out).length ? out : undefined;
}

function parseExtensionTools(raw: unknown, logger: Logger): ExtensionTool[] {
  const list = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw['tools'])
      ? raw['tools']
      : [];
  const tools: ExtensionTool[] = [];
  for (const item of list) {
    if (!isRecord(item) || typeof item['name'] !== 'string' || !item['name']) continue;
    if (typeof item['description'] !== 'string' || typeof item['moduleId'] !== 'string') {
      logger.warn('Skipping an extension tool without description or module id', {
        name: item['name'],
      });
      continue;
    }
    const tool: ExtensionTool = {
      name: item['name'],
      description: item['description'],
      moduleId: item['moduleId'],
      inputSchema: isRecord(item['inputSchema'])
        ? item['inputSchema']
        : { type: 'object', properties: {} },
    };
    const annotations = sanitizeAnnotations(item['annotations']);
    if (annotations) tool.annotations = annotations;
    if (typeof item['timeoutMs'] === 'number' && item['timeoutMs'] > 0)
      tool.timeoutMs = item['timeoutMs'];
    tools.push(tool);
  }
  return tools;
}

export class ToolRegistry {
  private readonly builtins = new Map<string, ToolDefinition>();
  private extensions = new Map<string, ExtensionTool>();
  private readonly callListeners = new Set<(event: ToolCallEvent) => void>();
  private listFilter: ((name: string) => boolean) | null = null;

  /** Preview with one-time confirmation for destructive tools, when the module asks for it. */
  private readonly confirmation = new ConfirmationGate({
    query: (name, data, queryOptions) => this.query(name, data, queryOptions),
  });

  constructor(private readonly options: ToolRegistryOptions) {}

  /** Hide own tools from the list; they stay callable. Null shows all. */
  setListFilter(filter: ((name: string) => boolean) | null): void {
    this.listFilter = filter;
  }

  /** Hear every finished call. A throwing listener never changes the result. */
  onCall(listener: (event: ToolCallEvent) => void): () => void {
    this.callListeners.add(listener);
    return () => this.callListeners.delete(listener);
  }

  private reportCall(event: ToolCallEvent): void {
    for (const listener of [...this.callListeners]) {
      try {
        listener(event);
      } catch (error) {
        this.options.logger.warn('A tool call listener failed', { reason: messageOf(error) });
      }
    }
  }

  register(tool: ToolDefinition): void {
    if (this.builtins.has(tool.name)) throw new Error(`Tool "${tool.name}" is registered twice`);
    this.builtins.set(tool.name, tool);
  }

  /** Ask the module, waiting a little right after the backend started. */
  async query(name: string, data?: unknown, options?: QueryOptions): Promise<unknown> {
    const { bridge } = this.options;
    if (!bridge.isConnected()) {
      const left = this.options.startupWaitLeft();
      if (left > 0) await bridge.waitForModule(left);
    }
    if (!bridge.isConnected()) {
      const problem = this.options.bridgeProblem?.();
      if (problem) throw new BridgeError('NOT_CONNECTED', `${NOT_CONNECTED_MESSAGE}: ${problem}`);
    }
    return bridge.query(name, data, options);
  }

  async list(): Promise<ListedTool[]> {
    const own = [...this.builtins.values()]
      .filter(tool => groupEnabled(tool.group, this.options.groups, this.options.imagesEnabled))
      .filter(tool => !this.listFilter || this.listFilter(tool.name))
      .map(tool => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      }));

    const foreign = await this.refreshExtensions();
    return [
      ...own,
      ...foreign.map(tool => {
        const listed: ListedTool = {
          name: tool.name,
          description: `${tool.description} (from the module ${tool.moduleId})`,
          inputSchema: tool.inputSchema,
        };
        if (tool.annotations) listed.annotations = tool.annotations;
        return listed;
      }),
    ];
  }

  async call(
    name: string,
    args: Record<string, unknown>,
    options: CallOptions = {}
  ): Promise<ToolResult> {
    const tool = this.builtins.get(name);
    if (tool) return this.callBuiltin(tool, args, options);

    if (RESERVED_TOOL_NAMES.has(name)) {
      return errorResult(`The tool "${name}" is not available in this version of the server.`);
    }
    if (!name) return errorResult('A tool name is required');
    return this.callExtension(name, args, options);
  }

  private async callBuiltin(
    tool: ToolDefinition,
    args: Record<string, unknown>,
    options: CallOptions
  ): Promise<ToolResult> {
    if (!groupEnabled(tool.group, this.options.groups, this.options.imagesEnabled)) {
      return errorResult(
        `The tool "${tool.name}" belongs to the group "${tool.group}", which is switched off on this server.`
      );
    }
    const split = splitConfirmation(args);
    const problems = checkArguments(tool.inputSchema, split.args);
    if (problems.length)
      return errorResult(`Invalid arguments for ${tool.name}: ${problems.join('; ')}`);
    const gate = await this.confirmation.check(
      {
        name: tool.name,
        destructive: tool.annotations.destructiveHint === true,
        hasDryRun: schemaHasDryRun(tool.inputSchema),
      },
      split.args,
      split.token,
      dry => this.callBuiltin(tool, dry, options)
    );
    if (!gate.run) return gate.result;
    args = gate.args;

    const context: ToolContext = {
      query: (queryName, data, queryOptions = {}) =>
        this.query(queryName, data, {
          ...(options.signal ? { signal: options.signal } : {}),
          ...(options.onProgress ? { onProgress: options.onProgress } : {}),
          ...queryOptions,
        }),
      progress: progress => options.onProgress?.(progress),
      ...(options.signal ? { signal: options.signal } : {}),
    };

    let result: ToolResult;
    try {
      result = toToolResult(await tool.handler(args, context), this.options.maxChars);
    } catch (error) {
      result = errorResult(messageOf(error));
    }
    this.reportCall({
      name: tool.name,
      group: tool.group,
      readOnly: tool.annotations.readOnlyHint === true,
      isError: result.isError === true,
    });
    return result;
  }

  private async callExtension(
    name: string,
    args: Record<string, unknown>,
    options: CallOptions
  ): Promise<ToolResult> {
    if (!this.options.bridge.isConnected() && this.options.startupWaitLeft() <= 0) {
      return errorResult(
        `Unknown tool "${name}". It is not a tool of this server, and no Foundry module is connected that could provide it.`
      );
    }

    const known = this.extensions.get(name);
    const split = splitConfirmation(args);
    const gate = await this.confirmation.check(
      {
        name,
        destructive: known?.annotations?.destructiveHint === true,
        hasDryRun: known ? schemaHasDryRun(known.inputSchema) : false,
      },
      split.args,
      split.token,
      dry => this.callExtension(name, dry, options)
    );
    if (!gate.run) return gate.result;
    args = gate.args;
    const queryOptions: QueryOptions = {};
    if (known?.timeoutMs) queryOptions.timeoutMs = known.timeoutMs + 5000;
    if (options.signal) queryOptions.signal = options.signal;
    if (options.onProgress) queryOptions.onProgress = options.onProgress;

    let result: ToolResult;
    try {
      // Both spellings of the argument field, so a module of either generation finds them.
      const output = await this.query(
        'callExtensionTool',
        { name, args, arguments: args },
        queryOptions
      );
      result = toToolResult(output, this.options.maxChars);
    } catch (error) {
      result = errorResult(messageOf(error));
    }
    this.reportCall({
      name,
      group: null,
      readOnly: known?.annotations?.readOnlyHint === true,
      isError: result.isError === true,
    });
    return result;
  }

  private async refreshExtensions(): Promise<ExtensionTool[]> {
    if (!this.options.bridge.isConnected()) {
      this.extensions = new Map();
      return [];
    }
    try {
      const raw = await this.options.bridge.query(
        'listExtensionTools',
        {},
        { timeoutMs: this.options.extensionListTimeoutMs ?? 5000 }
      );
      const accepted = parseExtensionTools(raw, this.options.logger).filter(tool => {
        if (this.builtins.has(tool.name) || RESERVED_TOOL_NAMES.has(tool.name)) {
          this.options.logger.warn(
            `Dropped the extension tool "${tool.name}" of "${tool.moduleId}": the name is taken`
          );
          return false;
        }
        return true;
      });
      this.extensions = new Map(accepted.map(tool => [tool.name, tool]));
      return accepted;
    } catch (error) {
      this.options.logger.warn('Could not list the tools of other modules', {
        reason: messageOf(error),
      });
      return [...this.extensions.values()];
    }
  }
}
