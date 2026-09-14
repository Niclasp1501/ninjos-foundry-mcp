/**
 * Start, stop and connection events of the server areas.
 *
 * The maps area had to create its runtime on the first map tool call, because
 * nothing ran at backend start, and ended ComfyUI through process.on('exit'),
 * because nothing ran at shutdown. Here the backend calls `start` of every
 * area once the bridge is open, `stop` in `close`, and hands each connection
 * event of the bridge to the areas in between.
 *
 * One area never takes another down: every call is caught and logged with the
 * area's id. `stop` is bounded in time per area, so a hanging child process
 * cannot keep the backend from ending.
 */
import type { BridgeConnectionEvent, QueryOptions } from './bridge/foundry-bridge.js';
import type { ServerConfig } from './config.js';
import { scopedLogger, type Logger } from './logger.js';
import type { AreaMcpAccess } from './tools/notifications.js';
import type { ServerArea, ServerAreaContext } from './tools/areas.js';
import { messageOf } from './tools/results.js';

export interface AreaLifecycleOptions {
  areas: readonly ServerArea[];
  /** The backend log; every area gets it with `[area:<id>]`. */
  logger: Logger;
  config: ServerConfig;
  env?: Readonly<Record<string, string | undefined>>;
  query(name: string, data?: unknown, options?: QueryOptions): Promise<unknown>;
  isModuleConnected(): boolean;
  /** Longest wait for one area's stop, and for starts still running at shutdown. Default 10 s. */
  stopTimeoutMs?: number;
  /** Handed to every area as `context.mcp`. */
  mcp?: AreaMcpAccess;
}

type State = 'new' | 'started' | 'stopping' | 'stopped';

export class AreaLifecycle {
  readonly #options: AreaLifecycleOptions;
  readonly #controller = new AbortController();
  readonly #contexts = new Map<string, ServerAreaContext>();
  #state: State = 'new';
  #starting: Promise<void> | null = null;
  #stopping: Promise<void> | null = null;

  constructor(options: AreaLifecycleOptions) {
    this.#options = options;
  }

  get state(): State {
    return this.#state;
  }

  /** The context an area gets; the same object on every call. */
  context(area: ServerArea): ServerAreaContext {
    let context = this.#contexts.get(area.id);
    if (!context) {
      const options = this.#options;
      context = {
        areaId: area.id,
        logger: scopedLogger(options.logger, `area:${area.id}`),
        config: options.config,
        env: options.env ?? {},
        query: (name, data, queryOptions) => options.query(name, data, queryOptions),
        isModuleConnected: () => options.isModuleConnected(),
        signal: this.#controller.signal,
        ...(options.mcp ? { mcp: options.mcp } : {}),
      };
      this.#contexts.set(area.id, context);
    }
    return context;
  }

  /** Start every area at once. Resolves when all starts have settled; never rejects. */
  start(): Promise<void> {
    if (this.#starting) return this.#starting;
    if (this.#state !== 'new') return Promise.resolve();
    this.#state = 'started';
    this.#starting = Promise.all(
      this.#options.areas
        .filter(area => area.start)
        .map(area => this.#guard(area, 'start', () => area.start?.(this.context(area))))
    ).then(() => undefined);
    return this.#starting;
  }

  /** Stop every area in reverse order, each bounded in time. Resolves once; never rejects. */
  stop(): Promise<void> {
    if (this.#stopping) return this.#stopping;
    const wasStarted = this.#state === 'started';
    this.#state = 'stopping';
    this.#controller.abort();
    this.#stopping = (async () => {
      if (wasStarted && this.#starting) {
        await this.#bounded(this.#starting, 'waiting for the starts of the areas');
      }
      if (wasStarted) {
        for (const area of [...this.#options.areas].reverse()) {
          if (!area.stop) continue;
          await this.#bounded(
            this.#guard(area, 'stop', () => area.stop?.(this.context(area))),
            `stopping area "${area.id}"`
          );
        }
      }
      this.#state = 'stopped';
    })();
    return this.#stopping;
  }

  /** Hand a connection event of the bridge to every area that listens. Only between start and stop. */
  connectionEvent(event: BridgeConnectionEvent): void {
    if (this.#state !== 'started') return;
    for (const area of this.#options.areas) {
      if (!area.onModuleConnection) continue;
      void this.#guard(area, `onModuleConnection (${event.type})`, () =>
        area.onModuleConnection?.(event, this.context(area))
      );
    }
  }

  async #guard(area: ServerArea, what: string, run: () => unknown): Promise<void> {
    try {
      await run();
    } catch (error) {
      this.context(area).logger.error(`${what} failed: ${messageOf(error)}`);
    }
  }

  async #bounded(work: Promise<void>, what: string): Promise<void> {
    const ms = this.#options.stopTimeoutMs ?? 10_000;
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<'late'>(resolve => {
      timer = setTimeout(() => resolve('late'), ms);
      timer.unref();
    });
    const outcome = await Promise.race([work.then(() => 'done' as const), late]);
    clearTimeout(timer);
    if (outcome === 'late') {
      this.#options.logger.warn(`Gave up ${what} after ${ms} ms; the backend shuts down anyway`);
    }
  }
}
