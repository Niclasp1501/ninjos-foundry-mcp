/**
 * The ComfyUI process, one way to find it, start it and stop it.
 *
 * Decisions:
 *
 * - **One start path.** The tools, the service window and the autostart all
 *   call `start()`. A start in progress is shared, so a second click never
 *   spawns a second process on the same port.
 * - **Loopback only.** ComfyUI is told to listen on the configured loopback
 *   address, never on every interface.
 * - **Tracked.** Only a process this server spawned is stopped from here. A
 *   ComfyUI started by someone else counts as running, and stopping it is an
 *   error that says so, not a success.
 * - **Not detached.** The process ends with the backend: `stop` of the area
 *   closes the runtime inside `close` of the backend, which kills it.
 * There is no
 *   process exit hook of its own any more. A backend killed hard cannot end
 *   it; the next start finds the running ComfyUI and uses it.
 */
import type { Logger } from '../../logger.js';
import { hostForUrl } from './env.js';
import { MapsError, messageOf } from './errors.js';
import type { LocateResult } from './locate.js';

export interface ChildLike {
  readonly pid?: number | undefined;
  readonly exitCode: number | null;
  readonly signalCode?: string | null;
  readonly stdout?: { on(event: 'data', listener: (chunk: unknown) => void): unknown } | null;
  readonly stderr?: { on(event: 'data', listener: (chunk: unknown) => void): unknown } | null;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: 'exit', listener: (code: number | null, signal: string | null) => void): unknown;
  once(event: 'error', listener: (error: Error) => void): unknown;
}

export type SpawnFn = (
  command: string,
  args: string[],
  options: { cwd: string; windowsHide: boolean; stdio: ['ignore', 'pipe', 'pipe'] }
) => ChildLike;

export interface ServiceReport {
  state: 'running' | 'stopped' | 'error';
  detail?: string;
  alreadyRunning?: boolean;
}

export interface ComfyServiceOptions {
  host: string;
  port: number;
  locate(): LocateResult;
  spawn: SpawnFn;
  logger: Logger;
  fetch?: typeof fetch;
  /** Longest wait for ComfyUI to answer after the start. Default 120 s. */
  readyTimeoutMs?: number;
  readyPollMs?: number;
  /** How long a polite stop may take before the process is killed. Default 5 s. */
  stopGraceMs?: number;
  probeTimeoutMs?: number;
}

type Probe =
  { kind: 'running' } | { kind: 'stopped'; reason: string } | { kind: 'foreign'; reason: string };

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Node's fetch as it was at load, so nothing that later replaces the global reaches ComfyUI. */
const nodeFetch: typeof fetch = globalThis.fetch;

export class ComfyService {
  readonly baseUrl: string;
  readonly #options: ComfyServiceOptions;
  readonly #fetch: typeof fetch;
  #child: ChildLike | null = null;
  #starting: Promise<ServiceReport> | null = null;
  #output: string[] = [];

  constructor(options: ComfyServiceOptions) {
    this.#options = options;
    this.#fetch = options.fetch ?? nodeFetch;
    this.baseUrl = `http://${hostForUrl(options.host)}:${options.port}`;
  }

  /** Whether a process of this server is alive. */
  get ownsProcess(): boolean {
    const child = this.#child;
    return Boolean(child && child.exitCode === null && !child.signalCode);
  }

  get starting(): boolean {
    return this.#starting !== null;
  }

  async probe(): Promise<Probe> {
    try {
      const response = await this.#fetch(`${this.baseUrl}/system_stats`, {
        signal: AbortSignal.timeout(this.#options.probeTimeoutMs ?? 3000),
      });
      if (!response.ok)
        return { kind: 'foreign', reason: `it answers /system_stats with HTTP ${response.status}` };
      const body: unknown = await response.json().catch(() => null);
      if (typeof body !== 'object' || body === null)
        return { kind: 'foreign', reason: 'its answer to /system_stats is not JSON' };
      return { kind: 'running' };
    } catch (error) {
      const cause = (error as { cause?: { code?: string } }).cause?.code;
      return { kind: 'stopped', reason: cause ?? messageOf(error) };
    }
  }

  #runningDetail(): string {
    return this.ownsProcess
      ? `started by this server (process ${this.#child?.pid ?? 'unknown'})`
      : 'running, not started by this server';
  }

  async status(): Promise<ServiceReport> {
    if (this.#starting) return { state: 'stopped', detail: 'ComfyUI is starting' };
    const probe = await this.probe();
    if (probe.kind === 'running') return { state: 'running', detail: this.#runningDetail() };
    if (probe.kind === 'foreign')
      return {
        state: 'error',
        detail: `port ${this.#options.port} is taken by something that is not ComfyUI: ${probe.reason}`,
      };
    return { state: 'stopped', detail: `not running on ${this.baseUrl}` };
  }

  /** Start ComfyUI, or report that it runs. Resolves when it answers; rejects with the cause. */
  start(): Promise<ServiceReport> {
    if (!this.#starting) {
      this.#starting = this.#start().finally(() => {
        this.#starting = null;
      });
    }
    return this.#starting;
  }

  async #start(): Promise<ServiceReport> {
    const probe = await this.probe();
    if (probe.kind === 'running')
      return { state: 'running', alreadyRunning: true, detail: this.#runningDetail() };
    if (probe.kind === 'foreign') {
      throw new MapsError(
        'PORT_TAKEN',
        `Port ${this.#options.port} answers, but not as ComfyUI (${probe.reason}). Free the port or set COMFYUI_PORT.`,
        false
      );
    }

    const located = this.#options.locate();
    if (!located.found) throw new MapsError('NOT_INSTALLED', located.problem, false);
    const { installation } = located;
    const listen =
      this.#options.host === 'localhost' ? '127.0.0.1' : this.#options.host.replace(/^\[|\]$/g, '');
    const args = [
      ...installation.pythonArgs,
      installation.mainPy,
      '--listen',
      listen,
      '--port',
      String(this.#options.port),
      '--disable-auto-launch',
      ...(installation.portable ? ['--windows-standalone-build'] : []),
    ];

    this.#output = [];
    let spawnError: Error | null = null;
    let exit: { code: number | null; signal: string | null } | null = null;
    let child: ChildLike;
    try {
      child = this.#options.spawn(installation.python, args, {
        cwd: installation.workDir,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      throw new MapsError(
        'START_FAILED',
        `ComfyUI could not be started with ${installation.python}: ${messageOf(error)}`,
        false
      );
    }
    this.#child = child;
    this.#options.logger.info(`Starting ComfyUI: ${installation.python} ${args.join(' ')}`);
    const collect = (chunk: unknown) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (!line.trim()) continue;
        this.#output.push(line);
        if (this.#output.length > 20) this.#output.shift();
      }
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    child.once('error', error => {
      spawnError = error;
    });
    child.once('exit', (code, signal) => {
      exit = { code, signal };
      if (this.#child === child) this.#child = null;
      this.#options.logger.info(`ComfyUI ended (code ${code}, signal ${signal})`);
    });

    const timeoutMs = this.#options.readyTimeoutMs ?? 120_000;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (spawnError) {
        throw new MapsError(
          'START_FAILED',
          `ComfyUI could not be started with ${installation.python}: ${messageOf(spawnError)}`,
          false
        );
      }
      if (exit) {
        const ended = exit as { code: number | null; signal: string | null };
        throw new MapsError(
          'START_FAILED',
          `ComfyUI process exited before becoming ready (exit code ${ended.code ?? 'none'}${
            ended.signal ? `, signal ${ended.signal}` : ''
          }).${this.#lastOutput()}`
        );
      }
      const now = await this.probe();
      if (now.kind === 'running') return { state: 'running', detail: this.#runningDetail() };
      if (now.kind === 'foreign') {
        await this.#kill();
        throw new MapsError(
          'PORT_TAKEN',
          `Port ${this.#options.port} answers, but not as ComfyUI (${now.reason}).`,
          false
        );
      }
      if (Date.now() >= deadline) {
        await this.#kill();
        throw new MapsError(
          'START_TIMEOUT',
          `ComfyUI did not become ready within ${Math.round(timeoutMs / 1000)} seconds; the process was stopped.${this.#lastOutput()}`
        );
      }
      await sleep(this.#options.readyPollMs ?? 2000);
    }
  }

  #lastOutput(): string {
    if (!this.#output.length) return '';
    return ` Last output: ${this.#output.slice(-5).join(' | ').slice(0, 1500)}`;
  }

  /** Stop the process this server started. Anything else is an error with its cause. */
  async stop(): Promise<ServiceReport> {
    if (this.#starting) {
      // A stop during a start ends that start; the start reports its own failure.
      await this.#kill();
      await this.#starting.catch(() => undefined);
    }
    if (this.ownsProcess) {
      await this.#kill();
      const after = await this.probe();
      if (after.kind === 'running') {
        throw new MapsError(
          'STILL_RUNNING',
          `The ComfyUI process of this server was stopped, but port ${this.#options.port} still answers as ComfyUI: another instance runs there.`,
          false
        );
      }
      return { state: 'stopped', detail: 'ComfyUI stopped' };
    }
    const probe = await this.probe();
    if (probe.kind === 'running') {
      throw new MapsError(
        'NOT_OWN_PROCESS',
        `ComfyUI on ${this.baseUrl} was not started by this server, so it is not stopped from here. Stop it where it was started.`,
        false
      );
    }
    if (probe.kind === 'foreign') {
      throw new MapsError(
        'PORT_TAKEN',
        `Port ${this.#options.port} is taken by something that is not ComfyUI (${probe.reason}); nothing was stopped.`,
        false
      );
    }
    return { state: 'stopped', detail: 'ComfyUI is already stopped' };
  }

  async #kill(): Promise<void> {
    const child = this.#child;
    if (!child || child.exitCode !== null || child.signalCode) return;
    const ended = new Promise<void>(resolve => child.once('exit', () => resolve()));
    child.kill('SIGTERM');
    const grace = this.#options.stopGraceMs ?? 5000;
    const politely = await Promise.race([ended.then(() => true), sleep(grace).then(() => false)]);
    if (!politely) {
      this.#options.logger.warn('ComfyUI did not stop within the grace period, killing it');
      child.kill('SIGKILL');
      await Promise.race([ended, sleep(2000)]);
    }
    if (this.#child === child) this.#child = null;
  }

  /** Synchronous end, when the runtime closes with the backend. */
  dispose(): void {
    const child = this.#child;
    this.#child = null;
    if (child && child.exitCode === null && !child.signalCode) {
      try {
        child.kill('SIGKILL');
      } catch {
        // Already gone.
      }
    }
  }
}
