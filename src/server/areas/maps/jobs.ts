/**
 * Map jobs with a real lifecycle.
 *
 * Every fault of the previous generation with jobs has its answer here:
 *
 * - **Retries are retried.** A failed attempt waits and runs again, from the
 *   last finished stage: a generated image is not generated again, an uploaded
 *   image not uploaded again. At most three attempts.
 * - **Total time limit.** A job that runs longer than the limit is stopped,
 *   ComfyUI is interrupted, and the job fails with that reason.
 * - **Cancel really prevents the scene.** The last check happens right before
 *   the scene request is sent, with nothing awaited in between. Once that
 *   request is out, cancelling is refused as too late instead of pretending.
 * - **Dedup never starts twice.** The same request returns the job that
 *   exists; nothing new runs.
 * - **Retention never deletes a running job.** Only jobs that ended are
 *   removed, 30 minutes after they ended.
 * - **One job at a time.** ComfyUI works on one image; further jobs wait in
 *   order, at most five.
 * - **A scene request is never repeated.** Its outcome is unknown after a lost
 *   answer, and a repeat could make two scenes of the same name.
 */
import type { Logger } from '../../logger.js';
import { BridgeError } from '../../bridge/foundry-bridge.js';
import {
  MAP_QUALITY_STEPS,
  MAP_SIZES,
  type MapQuality,
  type MapSize,
} from '../../../common/areas/maps/constants.js';
import { isRetryable, MapsError, messageOf } from './errors.js';

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type JobStage =
  | 'waiting'
  | 'starting-comfyui'
  | 'checking-models'
  | 'queued-in-comfyui'
  | 'generating'
  | 'downloading'
  | 'uploading'
  | 'creating-scene'
  | 'retry-wait'
  | 'finished';

export const STAGE_TEXT: Readonly<Record<JobStage, string>> = {
  waiting: 'waiting for the job before it',
  'starting-comfyui': 'starting ComfyUI',
  'checking-models': 'checking the models',
  'queued-in-comfyui': 'queued in ComfyUI',
  generating: 'generating the image',
  downloading: 'downloading the image',
  uploading: 'uploading the image into the world',
  'creating-scene': 'creating the scene',
  'retry-wait': 'waiting before the next attempt',
  finished: 'finished',
};

/** Where each stage starts and ends on the 0 to 100 scale. */
const STAGE_RANGE: Readonly<Record<JobStage, [number, number]>> = {
  waiting: [0, 0],
  'starting-comfyui': [0, 5],
  'checking-models': [5, 7],
  'queued-in-comfyui': [7, 10],
  generating: [10, 85],
  downloading: [85, 90],
  uploading: [90, 95],
  'creating-scene': [95, 99],
  'retry-wait': [0, 0],
  finished: [100, 100],
};

export interface MapJobRequest {
  prompt: string;
  sceneName: string;
  size: MapSize;
  gridSize: number;
  quality: MapQuality;
  activateScene: boolean;
}

export interface MapJobResult {
  sceneId: string;
  sceneName: string;
  path: string;
  activated: boolean;
  warnings: string[];
}

export interface MapJob {
  readonly id: string;
  readonly key: string;
  readonly request: MapJobRequest;
  readonly createdAt: number;
  status: JobStatus;
  stage: JobStage;
  /** Whole percent. */
  progress: number;
  attempts: number;
  startedAt?: number;
  finishedAt?: number;
  generationMs?: number;
  error?: string;
  result?: MapJobResult;
  notes: string[];
  /** Work kept between attempts. */
  promptId?: string;
  image?: Uint8Array;
  uploadedPath?: string;
  uploadStarted: boolean;
  sceneRequested: boolean;
}

export type StageReport = (stage: JobStage, fraction?: number) => void;

/** The work of one attempt, injected so the lifecycle is testable without ComfyUI and Foundry. */
export interface JobSteps {
  ensureService(job: MapJob, signal: AbortSignal): Promise<void>;
  generate(job: MapJob, signal: AbortSignal, report: StageReport): Promise<Uint8Array>;
  upload(job: MapJob, image: Uint8Array, signal: AbortSignal, report: StageReport): Promise<string>;
  createScene(job: MapJob, path: string, signal: AbortSignal): Promise<MapJobResult>;
  /** Stop the job's prompt in ComfyUI, when it has one. */
  interrupt(job: MapJob): Promise<void>;
  /** Tell the Gamemaster in Foundry. */
  notifyFailure(job: MapJob): Promise<void>;
}

export interface MapJobsOptions {
  steps: JobSteps;
  logger: Logger;
  totalTimeoutMs: number;
  maxAttempts?: number;
  /** Wait before the second, third attempt. */
  retryDelaysMs?: number[];
  retentionMs?: number;
  sweepEveryMs?: number;
  maxWaiting?: number;
  now?: () => number;
}

export type CancelOutcome =
  | { outcome: 'cancelled'; job: MapJob }
  | { outcome: 'not-found' }
  | { outcome: 'finished'; job: MapJob }
  | { outcome: 'too-late'; job: MapJob };

export type JobListener = (job: MapJob) => void;

const FINISHED: ReadonlySet<JobStatus> = new Set(['completed', 'failed', 'cancelled']);

export function isFinished(job: MapJob): boolean {
  return FINISHED.has(job.status);
}

export function jobKey(request: MapJobRequest): string {
  return JSON.stringify([
    request.prompt,
    request.sceneName,
    request.size,
    request.gridSize,
    request.quality,
    request.activateScene,
  ]);
}

export function stepsOf(quality: MapQuality): number {
  return MAP_QUALITY_STEPS[quality];
}

export function pixelsOf(size: MapSize): number {
  return MAP_SIZES[size];
}

/** Wait `ms`, or reject with the reason as soon as `signal` aborts. */
export function abortable(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export class MapJobs {
  readonly #options: MapJobsOptions;
  readonly #now: () => number;
  readonly #jobs = new Map<string, MapJob>();
  readonly #waiting: MapJob[] = [];
  readonly #listeners = new Map<string, Set<JobListener>>();
  #active: { job: MapJob; controller: AbortController; done: Promise<void> } | null = null;
  #counter = 0;
  #sweeper: NodeJS.Timeout | null = null;
  #closed = false;

  constructor(options: MapJobsOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#sweeper = setInterval(() => this.sweep(), options.sweepEveryMs ?? 60_000);
    this.#sweeper.unref();
  }

  /** Queue a job, or return the identical one that exists. */
  submit(request: MapJobRequest): { job: MapJob; deduplicated: boolean } {
    if (this.#closed) throw new MapsError('CLOSED', 'The map generator is shutting down', false);
    this.sweep();
    const key = jobKey(request);
    for (const job of this.#jobs.values()) {
      if (
        job.key === key &&
        (job.status === 'queued' || job.status === 'running' || job.status === 'completed')
      )
        return { job, deduplicated: true };
    }
    const maxWaiting = this.#options.maxWaiting ?? 5;
    if (this.#waiting.length >= maxWaiting) {
      throw new MapsError(
        'QUEUE_FULL',
        `${this.#waiting.length} map jobs are already waiting. Wait until one of them has finished, or cancel one.`,
        false
      );
    }
    this.#counter += 1;
    const job: MapJob = {
      id: `map-${this.#now().toString(36)}-${this.#counter}-${Math.random().toString(36).slice(2, 6)}`,
      key,
      request,
      createdAt: this.#now(),
      status: 'queued',
      stage: 'waiting',
      progress: 0,
      attempts: 0,
      notes: [],
      uploadStarted: false,
      sceneRequested: false,
    };
    this.#jobs.set(job.id, job);
    this.#waiting.push(job);
    this.#pump();
    return { job, deduplicated: false };
  }

  get(id: string): MapJob | undefined {
    return this.#jobs.get(id);
  }

  /** Jobs ahead of this one, counting the one that runs; 0 when it runs or ended. */
  position(job: MapJob): number {
    const index = this.#waiting.indexOf(job);
    if (index < 0) return 0;
    return index + (this.#active ? 1 : 0);
  }

  list(): MapJob[] {
    return [...this.#jobs.values()];
  }

  subscribe(id: string, listener: JobListener): () => void {
    const set = this.#listeners.get(id) ?? new Set<JobListener>();
    set.add(listener);
    this.#listeners.set(id, set);
    return () => {
      set.delete(listener);
      if (!set.size) this.#listeners.delete(id);
    };
  }

  /** Resolves with the job when it ended. Rejects when `signal` aborts; the job keeps running. */
  waitFor(id: string, signal?: AbortSignal): Promise<MapJob> {
    const job = this.#jobs.get(id);
    if (!job) return Promise.reject(new MapsError('NOT_FOUND', `Job ${id} not found`, false));
    if (isFinished(job)) return Promise.resolve(job);
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        unsubscribe();
        reject(signal?.reason ?? new Error('The wait was cancelled; the job keeps running'));
      };
      const unsubscribe = this.subscribe(id, current => {
        if (!isFinished(current)) return;
        unsubscribe();
        signal?.removeEventListener('abort', onAbort);
        resolve(current);
      });
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  cancel(id: string): CancelOutcome {
    const job = this.#jobs.get(id);
    if (!job) return { outcome: 'not-found' };
    if (isFinished(job)) return { outcome: 'finished', job };
    if (job.status === 'queued') {
      const index = this.#waiting.indexOf(job);
      if (index >= 0) this.#waiting.splice(index, 1);
      this.#finish(job, 'cancelled', 'Job cancelled by user before it started');
      return { outcome: 'cancelled', job };
    }
    if (job.sceneRequested) return { outcome: 'too-late', job };

    // Synchronous from here to the abort: the run loop checks the signal right
    // before it sends the scene request, so no scene can follow this cancel.
    const active = this.#active;
    if (job.uploadStarted) {
      job.notes.push(
        job.uploadedPath
          ? `The uploaded image stays in the world at ${job.uploadedPath}.`
          : 'Part of the image may already have been written to the folder ai-generated-maps of the world.'
      );
    }
    this.#finish(job, 'cancelled', 'Job cancelled by user');
    if (active?.job === job)
      active.controller.abort(new MapsError('CANCELLED', 'Job cancelled by user', false));
    this.#interrupt(job);
    return { outcome: 'cancelled', job };
  }

  /** Remove jobs that ended longer than the retention ago. Never a queued or running one. */
  sweep(): void {
    const retention = this.#options.retentionMs ?? 30 * 60 * 1000;
    const now = this.#now();
    for (const [id, job] of this.#jobs) {
      if (!isFinished(job) || job.finishedAt === undefined) continue;
      if (now - job.finishedAt >= retention) {
        this.#jobs.delete(id);
        this.#listeners.delete(id);
      }
    }
  }

  /** Stop everything: waiting jobs are cancelled, the running one is aborted. */
  async close(): Promise<void> {
    this.#closed = true;
    if (this.#sweeper) clearInterval(this.#sweeper);
    this.#sweeper = null;
    for (const job of this.#waiting.splice(0))
      this.#finish(job, 'cancelled', 'The map generator was shut down');
    const active = this.#active;
    if (active) {
      if (!isFinished(active.job))
        this.#finish(active.job, 'cancelled', 'The map generator was shut down');
      active.controller.abort(new MapsError('CANCELLED', 'The map generator was shut down', false));
      this.#interrupt(active.job);
      await active.done;
    }
  }

  #pump(): void {
    if (this.#active || this.#closed) return;
    const next = this.#waiting.shift();
    if (!next) return;
    const controller = new AbortController();
    const entry = { job: next, controller, done: Promise.resolve() };
    this.#active = entry;
    entry.done = this.#run(next, controller).finally(() => {
      if (this.#active === entry) this.#active = null;
      this.#pump();
    });
  }

  async #run(job: MapJob, controller: AbortController): Promise<void> {
    const { logger } = this.#options;
    const maxAttempts = this.#options.maxAttempts ?? 3;
    const delays = this.#options.retryDelaysMs ?? [10_000, 30_000];
    job.status = 'running';
    job.startedAt = this.#now();
    this.#emit(job);

    const limitMs = this.#options.totalTimeoutMs;
    const timer = setTimeout(() => {
      controller.abort(
        new MapsError(
          'TIMEOUT',
          `The job ran longer than ${Math.round(limitMs / 60_000)} minutes (COMFYUI_JOB_TIMEOUT_MS) and was stopped.`,
          false
        )
      );
      this.#interrupt(job);
    }, limitMs);
    timer.unref();

    try {
      for (;;) {
        job.attempts += 1;
        try {
          await this.#attempt(job, controller.signal);
          if (job.status === 'running') this.#finish(job, 'completed');
          return;
        } catch (thrown) {
          if (job.status !== 'running') return; // cancelled meanwhile; the cancel set the state
          const error = controller.signal.aborted ? (controller.signal.reason as unknown) : thrown;
          if (job.sceneRequested) {
            this.#finish(job, 'failed', this.#sceneFailure(error));
            return;
          }
          if (controller.signal.aborted || !isRetryable(error) || job.attempts >= maxAttempts) {
            const tries = job.attempts > 1 ? ` (after ${job.attempts} attempts)` : '';
            this.#finish(job, 'failed', `${messageOf(error)}${tries}`);
            return;
          }
          const delay = delays[Math.min(job.attempts - 1, delays.length - 1)] ?? 10_000;
          job.notes.push(`Attempt ${job.attempts} failed: ${messageOf(error)}`);
          logger.warn(
            `Map job ${job.id}: attempt ${job.attempts} failed, retrying in ${delay} ms`,
            {
              reason: messageOf(error),
            }
          );
          this.#stage(job, 'retry-wait');
          try {
            await abortable(delay, controller.signal);
          } catch {
            if (job.status === 'running')
              this.#finish(job, 'failed', messageOf(controller.signal.reason));
            return;
          }
        }
      }
    } finally {
      clearTimeout(timer);
      delete job.image;
    }
  }

  async #attempt(job: MapJob, signal: AbortSignal): Promise<void> {
    const { steps } = this.#options;
    const report: StageReport = (stage, fraction) => this.#stage(job, stage, fraction);
    signal.throwIfAborted();
    this.#stage(job, 'starting-comfyui');
    await steps.ensureService(job, signal);
    signal.throwIfAborted();
    if (!job.image) job.image = await steps.generate(job, signal, report);
    signal.throwIfAborted();
    if (!job.uploadedPath) {
      this.#stage(job, 'uploading');
      job.uploadStarted = true;
      job.uploadedPath = await steps.upload(job, job.image, signal, report);
    }
    // The last moment a cancel counts. Nothing is awaited between this check and the request.
    signal.throwIfAborted();
    if (job.status !== 'running') throw new MapsError('CANCELLED', 'Job cancelled by user', false);
    job.sceneRequested = true;
    this.#stage(job, 'creating-scene');
    job.result = await steps.createScene(job, job.uploadedPath, signal);
  }

  #sceneFailure(error: unknown): string {
    const unknownOutcome =
      error instanceof BridgeError &&
      (error.code === 'TIMEOUT' || error.code === 'CONNECTION_LOST');
    return unknownOutcome
      ? `The scene request got no answer: ${messageOf(error)} The scene may have been created anyway; check the scenes of the world before generating this map again.`
      : `The scene could not be created: ${messageOf(error)}`;
  }

  #stage(job: MapJob, stage: JobStage, fraction = 0): void {
    if (isFinished(job)) return;
    const [from, to] = STAGE_RANGE[stage];
    const bounded = Math.min(1, Math.max(0, fraction));
    job.stage = stage;
    if (stage !== 'retry-wait') job.progress = Math.round(from + (to - from) * bounded);
    this.#emit(job);
  }

  #finish(job: MapJob, status: 'completed' | 'failed' | 'cancelled', reason?: string): void {
    if (isFinished(job)) return;
    job.status = status;
    job.stage = 'finished';
    job.finishedAt = this.#now();
    if (status === 'completed') job.progress = 100;
    if (reason) job.error = reason;
    delete job.image;
    if (status === 'failed') {
      this.#options.logger.warn(`Map job ${job.id} failed: ${reason ?? ''}`);
      this.#options.steps.notifyFailure(job).catch(error =>
        this.#options.logger.warn(`Could not tell Foundry that map job ${job.id} failed`, {
          reason: messageOf(error),
        })
      );
    }
    this.#emit(job);
  }

  #interrupt(job: MapJob): void {
    this.#options.steps.interrupt(job).catch(error =>
      this.#options.logger.warn(`Could not stop the prompt of map job ${job.id} in ComfyUI`, {
        reason: messageOf(error),
      })
    );
  }

  #emit(job: MapJob): void {
    for (const listener of [...(this.#listeners.get(job.id) ?? [])]) {
      try {
        listener(job);
      } catch {
        // A listener must not break the job.
      }
    }
  }
}
