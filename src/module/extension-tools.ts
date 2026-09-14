/**
 * Lets other Foundry modules offer MCP tools of their own.
 *
 * A module like Ninjo's Shops knows its own rules: prices, stock, haggling.
 * Building tools for it into this server would make the model rebuild those
 * rules from outside and tie the server to a module most people do not have.
 * So the other module registers its tool here and keeps the handler.
 *
 * Two ways to register, both public and stable:
 *
 *   Hooks.on("ninjos-foundry-mcp.registerTools", register => {
 *     register("my-module", { name, description, inputSchema, handler });
 *   });
 *
 *   game.modules.get("ninjos-foundry-mcp").api.registerTool("my-module", { ... });
 *
 * Three guards that are not negotiable: only released modules may register
 * (none by default), no tool may take a name of this project, and only a
 * Gamemaster's client runs anything.
 *
 * Grown from extension-tools.ts of the production module, which was written in
 * house. Closed here, compared with that version: the name guard compares real
 * tool names; the list honours the release list like a call does; the hook is
 * sent again at `ready` for modules that subscribed late; "Allow Write
 * Operations" holds every tool that does not declare itself read only; the
 * arguments are checked against the schema; a handler has a time limit; and a
 * refused call is an error, never a normal result.
 *
 * The full guide for module authors is docs/EXTENSION-TOOLS.md.
 */
import { MODULE_ID } from '../common/constants.js';
import { checkAccess, type SettingReader } from '../common/permissions.js';
import type { ProgressPayload } from '../common/protocol.js';
import { RESERVED_TOOL_NAMES } from '../common/reserved-tools.js';
import { checkArguments } from '../common/schema-check.js';
import { QueryError } from './dispatcher.js';

export interface ExtensionToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ExtensionToolContext {
  /** Report progress of a long operation. */
  progress(progress: number, total?: number, message?: string): void;
}

export interface ExtensionToolDefinition {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  /** MCP hints. A tool without `readOnlyHint: true` counts as writing. */
  annotations?: ExtensionToolAnnotations;
  /** How long the handler may take, in ms. Default 25 seconds, at most 10 minutes. */
  timeoutMs?: number;
  handler: (args: Record<string, unknown>, context: ExtensionToolContext) => unknown;
}

export type RegistrationResult = { accepted: true } | { accepted: false; reason: string };

export interface ListedExtensionTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  moduleId: string;
  annotations?: ExtensionToolAnnotations;
  timeoutMs: number;
}

interface Entry extends ExtensionToolDefinition {
  moduleId: string;
}

export interface ExtensionToolsOptions {
  readSetting: SettingReader;
  writeSetting: (key: string, value: unknown) => Promise<unknown>;
  isGM: () => boolean;
  callHook: (
    name: string,
    register: (moduleId: string, def: ExtensionToolDefinition) => RegistrationResult
  ) => void;
  log?: Pick<Console, 'log' | 'warn'>;
}

export const TOOL_PROVIDERS_SETTING = 'toolProviderModules';
/** The name the setting had in 14.2609.2, the only release that shipped it. */
export const LEGACY_PROVIDERS_SETTING = 'werkzeugModule';
export const REGISTER_HOOK = `${MODULE_ID}.registerTools`;

export const DEFAULT_HANDLER_TIMEOUT_MS = 25_000;
const MAX_HANDLER_TIMEOUT_MS = 10 * 60_000;

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export class ExtensionTools {
  private readonly registered = new Map<string, Entry>();
  private readonly log: Pick<Console, 'log' | 'warn'>;

  constructor(private readonly options: ExtensionToolsOptions) {
    this.log = options.log ?? console;
  }

  /** Module ids on the release list. The old key is read when the new one is empty. */
  releasedModules(): string[] {
    const raw =
      asText(this.options.readSetting(TOOL_PROVIDERS_SETTING)) ||
      asText(this.options.readSetting(LEGACY_PROVIDERS_SETTING));
    return raw
      .split(/[,\n;]/)
      .map(entry => entry.trim())
      .filter(Boolean);
  }

  /** Carry the list over from the old key. Never overwrites a value set under the new key. */
  async migrateLegacySetting(): Promise<void> {
    if (!this.options.isGM()) return;
    const current = asText(this.options.readSetting(TOOL_PROVIDERS_SETTING));
    const legacy = asText(this.options.readSetting(LEGACY_PROVIDERS_SETTING));
    if (current || !legacy) return;
    try {
      await this.options.writeSetting(TOOL_PROVIDERS_SETTING, legacy);
      this.log.log(
        `[${MODULE_ID}] Carried the tool provider list over from "${LEGACY_PROVIDERS_SETTING}"`
      );
    } catch (error) {
      this.log.warn(`[${MODULE_ID}] Could not carry the tool provider list over:`, error);
    }
  }

  registerTool(moduleId: string, def: ExtensionToolDefinition): RegistrationResult {
    const refuse = (reason: string): RegistrationResult => {
      this.log.warn(`[${MODULE_ID}] Tool "${def?.name}" from "${moduleId}" refused: ${reason}`);
      return { accepted: false, reason };
    };

    if (!moduleId || typeof moduleId !== 'string')
      return refuse('the id of the registering module is missing');
    if (!def?.name || typeof def.name !== 'string') return refuse('the name is missing');
    if (typeof def.handler !== 'function') return refuse('a handler is missing');
    if (!def.description) {
      return refuse(
        'a description is missing. Without one the model cannot tell what the tool is for'
      );
    }
    if (!this.releasedModules().includes(moduleId)) {
      return refuse(
        `"${moduleId}" is not released. Add it under "Modules with their own tools" in the settings of ` +
          `Ninjo's Foundry MCP. None is released by default, because a handler of another module works around ` +
          'the permission matrix.'
      );
    }
    if (RESERVED_TOOL_NAMES.has(def.name)) {
      return refuse(`"${def.name}" is a tool of this module and must not be overridden`);
    }
    const existing = this.registered.get(def.name);
    if (existing && existing.moduleId !== moduleId) {
      return refuse(`"${def.name}" is already registered by "${existing.moduleId}"`);
    }

    this.registered.set(def.name, { ...def, moduleId });
    this.log.log(`[${MODULE_ID}] Tool "${def.name}" from "${moduleId}" registered`);
    return { accepted: true };
  }

  /**
   * Send the registration hook. At `init` the list starts empty; at `ready` it
   * is sent once more without clearing, for modules that subscribed later.
   * Re-registering the same name from the same module replaces the entry.
   */
  collect({ clear }: { clear: boolean }): void {
    if (clear) this.registered.clear();
    if (!this.releasedModules().length) {
      if (clear) {
        this.log.log(
          `[${MODULE_ID}] No module is released for tools of its own. ` +
            'Release them under "Modules with their own tools" in the module settings.'
        );
      }
      return;
    }
    this.options.callHook(REGISTER_HOOK, (moduleId, def) => this.registerTool(moduleId, def));
    this.log.log(`[${MODULE_ID}] ${this.registered.size} extension tool(s) registered`);
  }

  /** The tools as the server needs them: without handlers, and only those still released. */
  list(): ListedExtensionTool[] {
    const released = new Set(this.releasedModules());
    return [...this.registered.values()]
      .filter(entry => released.has(entry.moduleId))
      .map(entry => {
        const listed: ListedExtensionTool = {
          name: entry.name,
          description: entry.description,
          inputSchema: entry.inputSchema ?? { type: 'object', properties: {} },
          moduleId: entry.moduleId,
          timeoutMs: this.timeoutOf(entry),
        };
        if (entry.annotations) listed.annotations = entry.annotations;
        return listed;
      });
  }

  /**
   * The answer to the query `listExtensionTools`. The previous server reads
   * `tools` from an object and offers only its own tools when that field is
   * missing, so the list goes
   * out wrapped. The server of this rewrite reads both forms.
   */
  listForServer(): { tools: ListedExtensionTool[] } {
    return { tools: this.list() };
  }

  /**
   * The answer to `callExtensionTool`. Arguments are read from `args`, the field
   * every server sends; `arguments` is a fallback for nothing known today.
   */
  async call(data: unknown, progress: (p: ProgressPayload) => void): Promise<string> {
    const record =
      typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
    const name = asText(record['name']);
    if (!name) throw new QueryError('INVALID_ARGUMENTS', 'name is required');
    if (!this.options.isGM()) {
      throw new QueryError(
        'ACCESS_DENIED',
        'Access denied: only a Gamemaster can run tools of other modules'
      );
    }

    const entry = this.registered.get(name);
    if (!entry) {
      throw new QueryError(
        'UNKNOWN_TOOL',
        `No extension tool "${name}" is registered. Either the module is not active, or it is not on the release list.`
      );
    }
    if (!this.releasedModules().includes(entry.moduleId)) {
      throw new QueryError(
        'NOT_RELEASED',
        `"${entry.moduleId}" is no longer released, the tool "${name}" is blocked.`
      );
    }

    const decision = checkAccess(
      { kind: 'extension', readOnly: entry.annotations?.readOnlyHint === true },
      this.options.readSetting
    );
    if (!decision.allowed) throw new QueryError(decision.code, decision.reason);

    const rawArgs = record['args'] ?? record['arguments'] ?? {};
    const args =
      typeof rawArgs === 'object' && rawArgs !== null && !Array.isArray(rawArgs)
        ? (rawArgs as Record<string, unknown>)
        : {};
    const problems = checkArguments(entry.inputSchema ?? { type: 'object' }, args);
    if (problems.length) {
      throw new QueryError(
        'INVALID_ARGUMENTS',
        `Invalid arguments for ${name}: ${problems.join('; ')}`
      );
    }

    const timeoutMs = this.timeoutOf(entry);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const context: ExtensionToolContext = {
      progress: (value, total, message) => {
        const payload: ProgressPayload = { progress: value };
        if (total !== undefined) payload.total = total;
        if (message !== undefined) payload.message = message;
        progress(payload);
      },
    };

    try {
      const result = await Promise.race([
        Promise.resolve().then(() => entry.handler(args, context)),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new QueryError(
                  'TIMEOUT',
                  `Third-party tool "${name}" of "${entry.moduleId}" did not answer within ${Math.round(timeoutMs / 1000)} s. ` +
                    'It may still be running: check the result before retrying.'
                )
              ),
            timeoutMs
          );
        }),
      ]);
      if (typeof result === 'string') return result;
      return result === undefined
        ? '(the tool returned no result)'
        : JSON.stringify(result, null, 2);
    } catch (error) {
      if (error instanceof QueryError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new QueryError('EXTENSION_FAILED', `Third-party tool failed: ${message}`);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private timeoutOf(entry: Entry): number {
    const wanted = entry.timeoutMs;
    if (typeof wanted !== 'number' || !Number.isFinite(wanted) || wanted <= 0)
      return DEFAULT_HANDLER_TIMEOUT_MS;
    return Math.min(wanted, MAX_HANDLER_TIMEOUT_MS);
  }
}
