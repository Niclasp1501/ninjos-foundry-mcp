/**
 * Runs the queries that arrive over the bridge, and nothing else.
 *
 * Two decisions live here:
 *
 * 1. **The permission gate runs before every handler, in one place.** A
 *    handler declares what it does (`AccessRule`), and the dispatcher asks
 *    `checkAccessAll` first. No handler checks the switch or the matrix itself,
 *    so none can forget one of the two. Where a handler only learns during its
 *    work that it needs more (a folder turns out to be missing), it asks the
 *    same decision through `context.requireAccess`, before its first write.
 * 2. **The handlers are not registered in `CONFIG.queries`.** Foundry lets any
 *    connected user send a query to another client by name. Handlers kept
 *    there could be triggered by a player's client in the GM's browser, with
 *    the GM's rights. Here they are only reachable from the bridge socket,
 *    which only the GM's client opens, and every call checks again that the
 *    local user is a Gamemaster.
 */
import { fullQueryName } from '../common/constants.js';
import type { ChangeEntry, ChangeInput, ChangeLog } from '../common/change-log.js';
import {
  checkAccessAll,
  resolveAccess,
  type Access,
  type AccessRule,
  type SettingReader,
} from '../common/permissions.js';
import type { ProgressPayload } from '../common/protocol.js';

export class QueryError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'QueryError';
  }
}

export interface HandlerContext {
  /** Report progress; the server restarts its time limit with each report. */
  progress(progress: ProgressPayload): void;
  /** Record a change to the world, with the state before it when available. */
  recordChange(change: ChangeInput): ChangeEntry;
  /**
   * Throw the refusal when these accesses are not allowed. For what a handler
   * only knows during its work; call it before the first write. `prefix` is put
   * in front of the reason, e.g. which folder would have to be created.
   */
  requireAccess(access: Access | readonly Access[], prefix?: string): void;
  /** The refusal as text, or null when allowed. For dry runs that report instead of failing. */
  accessProblem(access: Access | readonly Access[]): string | null;
  /** The change log this dispatcher records into, for listing and undo. */
  changeLog?: ChangeLog;
}

let callCounter = 0;

/** The local user as the change log names it; null outside Foundry. */
function localUser(): { id: string; name: string } | null {
  const user = (globalThis as { game?: { user?: { id?: unknown; name?: unknown } | null } }).game
    ?.user;
  return user && typeof user.id === 'string'
    ? { id: user.id, name: typeof user.name === 'string' ? user.name : '' }
    : null;
}

export interface QueryHandler {
  /** One access, several, or a function of the call data. See `AccessRule`. */
  access: AccessRule;
  run(data: unknown, context: HandlerContext): unknown;
}

export interface DispatcherOptions {
  isGM: () => boolean;
  readSetting: SettingReader;
  changeLog: ChangeLog;
}

export class QueryDispatcher {
  private readonly handlers = new Map<string, QueryHandler>();

  constructor(private readonly options: DispatcherOptions) {}

  /**
   * Register one handler under every spelling a server of either generation uses.
   * A name that already has a handler is refused: with one list per package,
   * a silent replacement would hide which package answers.
   */
  register(names: string | readonly string[], handler: QueryHandler): void {
    const list = typeof names === 'string' ? [names] : names;
    for (const name of list) {
      if (this.handlers.has(fullQueryName(name)))
        throw new Error(`The query "${name}" is registered twice`);
    }
    for (const name of list) this.handlers.set(fullQueryName(name), handler);
  }

  has(name: string): boolean {
    return this.handlers.has(fullQueryName(name));
  }

  async dispatch(
    method: string,
    data: unknown,
    progress: (p: ProgressPayload) => void = () => undefined
  ): Promise<unknown> {
    const handler = this.handlers.get(fullQueryName(method));
    if (!handler) throw new QueryError('UNKNOWN_QUERY', `No handler found for query: ${method}`);

    if (!this.options.isGM()) {
      throw new QueryError(
        'ACCESS_DENIED',
        'Access denied: only a Gamemaster can use the MCP bridge'
      );
    }

    let accesses: readonly Access[];
    try {
      accesses = resolveAccess(handler.access, data);
    } catch (error) {
      if (error instanceof QueryError) throw error;
      throw new QueryError(
        'ACCESS_RULE_FAILED',
        `The permissions for ${method} could not be determined: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    const decision = checkAccessAll(accesses, this.options.readSetting);
    if (!decision.allowed) throw new QueryError(decision.code, decision.reason);

    const read = this.options.readSetting;
    const list = (access: Access | readonly Access[]): readonly Access[] =>
      Array.isArray(access) ? access : [access as Access];

    callCounter += 1;
    const user = localUser();
    const origin = {
      callId: `call-${Date.now().toString(36)}-${callCounter}`,
      ...(user ? { user } : {}),
    };
    return await handler.run(data, {
      progress,
      changeLog: this.options.changeLog,
      recordChange: change => this.options.changeLog.record(change, origin),
      requireAccess: (access, prefix) => {
        const late = checkAccessAll(list(access), read);
        if (!late.allowed)
          throw new QueryError(late.code, prefix ? `${prefix} ${late.reason}` : late.reason);
      },
      accessProblem: access => {
        const late = checkAccessAll(list(access), read);
        return late.allowed ? null : late.reason;
      },
    });
  }
}
