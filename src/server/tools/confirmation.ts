/**
 * Preview with a one-time confirmation for destructive tools.
 *
 * A Gamemaster can switch on "Confirm destructive tools" in the module. From
 * then on a tool that carries `destructiveHint` does not run on its first
 * call. It answers with a preview instead: the result of its own dry run when
 * it has one, and a token. Only a second call with the same arguments and that
 * token runs it. The token is bound to the tool, a hash of the arguments and
 * the Gamemaster whose browser holds the bridge, is valid for a short time and
 * works once.
 *
 * The step lives here, in the one path every tool call takes, and not in the
 * packages: the annotation is known on the server only, and a rule each
 * package had to follow would be forgotten by one of them.
 *
 * The setting is read from the module on every destructive call, so switching
 * it takes effect at once. A module that does not know the query is older
 * than this server and has no setting: the mode is off, as before.
 */
import { createHash, randomBytes } from 'node:crypto';
import { errorResult, type ToolResult } from '../control/api.js';
import { isUnknownQuery, messageOf } from './results.js';

/** The argument that carries the token. Removed before a tool sees its arguments. */
export const CONFIRMATION_ARGUMENT = 'confirmationToken';

/** Query of the preview-undo area that answers whether the mode is on and who holds the bridge. */
export const CONFIRMATION_MODE_QUERY = 'getConfirmationMode';

/** Five minutes: long enough to show the preview to a person and ask, short enough to go stale. */
export const CONFIRMATION_TTL_MS = 5 * 60_000;

const MAX_OPEN_TOKENS = 100;

export interface ConfirmationMode {
  enabled: boolean;
  userId?: string;
  userName?: string;
}

export interface GateTool {
  name: string;
  destructive: boolean;
  /** The tool has a `dryRun` parameter, so the preview can show what would happen. */
  hasDryRun: boolean;
}

export interface ConfirmationGateOptions {
  /** Ask the module; the registry's own query. */
  query(name: string, data: unknown, options: { timeoutMs: number }): Promise<unknown>;
  now?: () => number;
  ttlMs?: number;
}

export type GateOutcome =
  { run: true; args: Record<string, unknown> } | { run: false; result: ToolResult };

interface OpenToken {
  tool: string;
  argsHash: string;
  userId: string;
  expiresAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** JSON with sorted keys, so the same arguments in another order hash the same. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .filter(key => value[key] !== undefined)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export function argumentsHash(args: Record<string, unknown>): string {
  return createHash('sha256').update(canonical(args)).digest('hex');
}

/** The arguments without the token, and the token when one was given. */
export function splitConfirmation(args: Record<string, unknown>): {
  args: Record<string, unknown>;
  token: unknown;
} {
  if (!(CONFIRMATION_ARGUMENT in args)) return { args, token: undefined };
  const { [CONFIRMATION_ARGUMENT]: token, ...rest } = args;
  return { args: rest, token };
}

/** Whether a tool schema offers `dryRun`. */
export function schemaHasDryRun(schema: Record<string, unknown>): boolean {
  const properties = schema['properties'];
  return isRecord(properties) && 'dryRun' in properties;
}

export class ConfirmationGate {
  private readonly tokens = new Map<string, OpenToken>();
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(private readonly options: ConfirmationGateOptions) {
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? CONFIRMATION_TTL_MS;
  }

  /**
   * Decide one call. `args` come without the token (splitConfirmation).
   * `dryRun` runs the tool with the given arguments and is only used for a
   * preview; its result is shown, never acted on.
   */
  async check(
    tool: GateTool,
    args: Record<string, unknown>,
    token: unknown,
    dryRun: (args: Record<string, unknown>) => Promise<ToolResult>
  ): Promise<GateOutcome> {
    if (!tool.destructive || args['dryRun'] === true) return { run: true, args };

    const mode = await this.readMode();
    if ('result' in mode) return { run: false, result: mode.result };
    if (!mode.enabled) return { run: true, args };

    if (token !== undefined) {
      const problem = this.redeem(tool.name, args, token, mode.userId ?? '');
      return problem ? { run: false, result: errorResult(problem) } : { run: true, args };
    }
    return { run: false, result: await this.preview(tool, args, mode, dryRun) };
  }

  /** The mode, or the error result when it cannot be read and the call must not run blind. */
  private async readMode(): Promise<ConfirmationMode | { result: ToolResult }> {
    try {
      const answer = await this.options.query(CONFIRMATION_MODE_QUERY, {}, { timeoutMs: 10_000 });
      if (!isRecord(answer)) return { enabled: false };
      const mode: ConfirmationMode = { enabled: answer['enabled'] === true };
      if (typeof answer['userId'] === 'string') mode.userId = answer['userId'];
      if (typeof answer['userName'] === 'string') mode.userName = answer['userName'];
      return mode;
    } catch (error) {
      // An older module has no such setting. Without a bridge, or for a user
      // who is no Gamemaster, the call itself fails with the same cause.
      const record = error as { code?: unknown; moduleCode?: unknown };
      if (
        isUnknownQuery(error) ||
        record?.code === 'NOT_CONNECTED' ||
        record?.moduleCode === 'ACCESS_DENIED'
      )
        return { enabled: false };
      return {
        result: errorResult(
          `Could not read from the Foundry module whether destructive tools need a confirmation, so nothing was run ` +
            `and nothing was changed: ${messageOf(error)}`
        ),
      };
    }
  }

  private redeem(
    tool: string,
    args: Record<string, unknown>,
    token: unknown,
    userId: string
  ): string | null {
    this.prune();
    const open = typeof token === 'string' ? this.tokens.get(token) : undefined;
    const retry = `Call ${tool} again without ${CONFIRMATION_ARGUMENT} for a new preview. Nothing was changed.`;
    if (!open)
      return `The confirmation token is unknown, used already or expired (tokens are valid for ${Math.round(this.ttlMs / 1000)} seconds and once). ${retry}`;
    const problems: string[] = [];
    if (open.tool !== tool) problems.push(`it was issued for the tool ${open.tool}`);
    if (open.argsHash !== argumentsHash(args))
      problems.push('the arguments differ from the previewed ones');
    if (open.userId !== userId)
      problems.push('it was issued while another Gamemaster held the bridge');
    if (problems.length)
      return `The confirmation token does not fit this call: ${problems.join('; ')}. ${retry}`;
    this.tokens.delete(token as string);
    return null;
  }

  private async preview(
    tool: GateTool,
    args: Record<string, unknown>,
    mode: ConfirmationMode,
    dryRun: (args: Record<string, unknown>) => Promise<ToolResult>
  ): Promise<ToolResult> {
    let dry: ToolResult | null = null;
    if (tool.hasDryRun) {
      dry = await dryRun({ ...args, dryRun: true });
      if (dry.isError) {
        const text = dry.content.map(block => block.text).join('\n');
        return errorResult(
          `Preview of ${tool.name}: its dry run already fails, so no confirmation token was issued and nothing was changed. ${text.replace(/^Error: /, '')}`
        );
      }
    }
    this.prune();
    const token = randomBytes(16).toString('hex');
    const expiresAt = this.now() + this.ttlMs;
    this.tokens.set(token, {
      tool: tool.name,
      argsHash: argumentsHash(args),
      userId: mode.userId ?? '',
      expiresAt,
    });
    const lines = [
      `Preview only, nothing was changed. "Confirm destructive tools" is on in Ninjo's Foundry MCP, so ${tool.name} ` +
        'runs only when it is called again with exactly the same arguments plus ' +
        `"${CONFIRMATION_ARGUMENT}": "${token}". The token works once, until ${new Date(expiresAt).toISOString()}` +
        `${mode.userName ? `, while ${mode.userName} holds the bridge` : ''}. Show this preview to the user and confirm only after they agree.`,
      dry
        ? `Dry run of ${tool.name}:\n${dry.content.map(block => block.text).join('\n')}`
        : `${tool.name} has no dry run, so this preview cannot show its effect. It would be called with: ${JSON.stringify(args)}`,
    ];
    return { content: [{ type: 'text', text: lines.join('\n\n') }] };
  }

  private prune(): void {
    const now = this.now();
    for (const [token, open] of this.tokens) if (open.expiresAt <= now) this.tokens.delete(token);
    while (this.tokens.size >= MAX_OPEN_TOKENS) {
      const oldest = this.tokens.keys().next().value;
      if (oldest === undefined) break;
      this.tokens.delete(oldest);
    }
  }
}
