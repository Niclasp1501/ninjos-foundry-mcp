/**
 * The map generator while it is switched on.
 *
 * Nothing of this exists while COMFYUI_ENABLED is off: the core hides the
 * three tools, and the area creates the runtime at its start only when the
 * generator is on. There is no queue, no client, no process and no connection
 * otherwise.
 *
 * The area lifecycle of the core creates and closes it
 * (area.ts), the window reaches the service through a request instead of an
 * open query, and the log goes into the backend log of the area.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import {
  imageTypeOf,
  isMapQuality,
  MAP_QUERY,
  UPLOAD_CHUNK_CHARS,
  UPLOAD_MAX_BYTES,
  withImageExtension,
  type MapQuality,
} from '../../../common/areas/maps/constants.js';
import { BridgeError, type QueryOptions } from '../../bridge/foundry-bridge.js';
import { areaLogger, type Logger } from '../../logger.js';
import { ComfyClient, type ProgressWatch } from './client.js';
import { readMapsEnv, type Env, type MapsEnv } from './env.js';
import { isMissingQuery, MapsError, messageOf, moduleTooOldMessage } from './errors.js';
import {
  abortable,
  MapJobs,
  pixelsOf,
  stepsOf,
  type JobSteps,
  type MapJob,
  type MapJobResult,
} from './jobs.js';
import { locateComfyUI, type LocateResult } from './locate.js';
import { ComfyService, type SpawnFn } from './service.js';
import { buildGraph, chooseModels, randomSeed } from './workflow.js';

export type BridgeQuery = (
  name: string,
  data?: unknown,
  options?: QueryOptions
) => Promise<unknown>;

export interface MapsTimings {
  readyTimeoutMs?: number;
  readyPollMs?: number;
  stopGraceMs?: number;
  /** How often a running prompt is looked up in ComfyUI. Default 2 s. */
  pollMs?: number;
  retryDelaysMs?: number[];
  retentionMs?: number;
  requestTimeoutMs?: number;
}

/** Failures kept for a module that is not there to show them; the oldest go first. */
const UNDELIVERED_KEPT = 20;

export interface MapsRuntimeOptions {
  env: MapsEnv;
  logger: Logger;
  spawn?: SpawnFn;
  fetch?: typeof fetch;
  locate?: () => LocateResult;
  timings?: MapsTimings;
  now?: () => number;
}

export interface MapSettings {
  quality: MapQuality;
  /** Why a map could not become a scene in this world, or null. */
  sceneProblem: string | null;
  notes: string[];
  /** The world setting mapGenAutoStart; false from a module that does not report it. */
  autoStart: boolean;
}

/** A failed job as the Gamemaster is told about it. */
export interface FailureNotice {
  jobId: string;
  name: string;
  reason: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class MapsRuntime {
  readonly env: MapsEnv;
  readonly service: ComfyService;
  readonly client: ComfyClient;
  readonly jobs: MapJobs;
  readonly #logger: Logger;
  readonly #timings: MapsTimings;
  readonly #controller = new AbortController();
  #query: BridgeQuery | null = null;
  #connected: () => boolean = () => true;
  readonly #undelivered: FailureNotice[] = [];

  constructor(options: MapsRuntimeOptions) {
    this.env = options.env;
    this.#logger = options.logger;
    this.#timings = options.timings ?? {};
    const { env } = options;
    this.service = new ComfyService({
      host: env.host,
      port: env.port,
      logger: options.logger,
      spawn: options.spawn ?? (nodeSpawn as unknown as SpawnFn),
      locate:
        options.locate ??
        (() =>
          locateComfyUI({
            platform: process.platform,
            home: homedir(),
            ...(process.env['LOCALAPPDATA'] ? { localAppData: process.env['LOCALAPPDATA'] } : {}),
            ...(env.installPath ? { installPath: env.installPath } : {}),
            ...(env.pythonCommand ? { pythonCommand: env.pythonCommand } : {}),
            exists: existsSync,
          })),
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(this.#timings.readyTimeoutMs !== undefined
        ? { readyTimeoutMs: this.#timings.readyTimeoutMs }
        : {}),
      ...(this.#timings.readyPollMs !== undefined
        ? { readyPollMs: this.#timings.readyPollMs }
        : {}),
      ...(this.#timings.stopGraceMs !== undefined
        ? { stopGraceMs: this.#timings.stopGraceMs }
        : {}),
    });
    this.client = new ComfyClient({
      baseUrl: this.service.baseUrl,
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(this.#timings.requestTimeoutMs !== undefined
        ? { requestTimeoutMs: this.#timings.requestTimeoutMs }
        : {}),
    });
    this.jobs = new MapJobs({
      steps: this.#steps(),
      logger: options.logger,
      totalTimeoutMs: env.jobTimeoutMs,
      ...(this.#timings.retryDelaysMs ? { retryDelaysMs: this.#timings.retryDelaysMs } : {}),
      ...(this.#timings.retentionMs !== undefined
        ? { retentionMs: this.#timings.retentionMs }
        : {}),
      ...(options.now ? { now: options.now } : {}),
    });
    if (env.autoStart) this.#autoStart('FOUNDRY_MCP_AUTOSTART_COMFYUI');
  }

  #autoStart(cause: string): void {
    this.service
      .start()
      .then(report =>
        this.#logger.info(`ComfyUI autostart (${cause}): ${report.detail ?? report.state}`)
      )
      .catch(error =>
        this.#logger.warn(`ComfyUI autostart (${cause}) failed: ${messageOf(error)}`)
      );
  }

  /** The way to the module: the query of the area, handed over once when the area starts. */
  useBridge(query: BridgeQuery): void {
    this.#query = query;
  }

  /** Whether a module is connected, so a failure notice is kept instead of lost. */
  useConnection(connected: () => boolean): void {
    this.#connected = connected;
  }

  /** Failure notices that wait for a module. For tests and the log. */
  get undeliveredFailures(): readonly FailureNotice[] {
    return this.#undelivered;
  }

  /**
   * Tell the Gamemaster that a job failed. Without a module, or when the
   * connection is gone while sending, the notice is kept and delivered when a
   * module introduces itself.
   */
  async tellFailure(notice: FailureNotice): Promise<void> {
    if (!this.#query || !this.#connected()) {
      this.#keep(notice);
      return;
    }
    try {
      await this.query(MAP_QUERY.jobFailed, notice, { timeoutMs: 10_000 });
    } catch (error) {
      if (
        error instanceof BridgeError &&
        (error.code === 'NOT_CONNECTED' || error.code === 'CONNECTION_LOST')
      ) {
        this.#keep(notice);
        return;
      }
      throw error;
    }
  }

  #keep(notice: FailureNotice): void {
    this.#undelivered.push(notice);
    if (this.#undelivered.length > UNDELIVERED_KEPT)
      this.#undelivered.splice(0, this.#undelivered.length - UNDELIVERED_KEPT);
    this.#logger.info(
      `Map job ${notice.jobId} failed while no module was connected; kept for later`
    );
  }

  /**
   * A module introduced itself: deliver the kept notices in order, then start
   * ComfyUI when the world asks for it with mapGenAutoStart. Never throws.
   */
  async moduleIntroduced(): Promise<void> {
    const waiting = this.#undelivered.splice(0);
    for (const notice of waiting) {
      try {
        await this.tellFailure(notice);
      } catch (error) {
        this.#logger.warn(`Could not tell Foundry that map job ${notice.jobId} failed`, {
          reason: messageOf(error),
        });
      }
    }
    try {
      const settings = await this.mapSettings();
      if (settings.autoStart) this.#autoStart('mapGenAutoStart');
    } catch (error) {
      this.#logger.info(
        `The world settings of the map generator were not read: ${messageOf(error)}`
      );
    }
  }

  /**
   * Ask the module. Always with an own signal and progress sink, so nothing of
   * the tool call that handed over the bridge is kept alive.
   */
  async query(name: string, data: unknown = {}, options: QueryOptions = {}): Promise<unknown> {
    const query = this.#query;
    if (!query)
      throw new MapsError('NO_BRIDGE', 'The map generator has no connection to Foundry yet', true);
    try {
      return await query(name, data, {
        onProgress: () => undefined,
        signal: this.#controller.signal,
        ...options,
      });
    } catch (error) {
      if (isMissingQuery(error))
        throw new MapsError('MODULE_TOO_OLD', moduleTooOldMessage(name, error), false);
      throw error;
    }
  }

  async mapSettings(): Promise<MapSettings> {
    const answer = await this.query(MAP_QUERY.settings, {});
    const record = isRecord(answer) ? answer : {};
    const notes = Array.isArray(record['notes'])
      ? record['notes'].filter((note): note is string => typeof note === 'string')
      : [];
    return {
      quality: isMapQuality(record['quality']) ? record['quality'] : 'low',
      sceneProblem:
        typeof record['sceneProblem'] === 'string' && record['sceneProblem']
          ? record['sceneProblem']
          : null,
      notes,
      autoStart: record['autoStart'] === true,
    };
  }

  async close(): Promise<void> {
    this.#controller.abort(new MapsError('CLOSED', 'The map generator was shut down', false));
    await this.jobs.close();
    this.service.dispose();
  }

  #steps(): JobSteps {
    const pollMs = () => this.#timings.pollMs ?? 2000;
    return {
      ensureService: async () => {
        await this.service.start();
      },

      generate: async (job, signal, report) => {
        report('checking-models');
        const models = chooseModels(
          await this.client.checkpoints(signal),
          await this.client.vaes(signal)
        );
        for (const note of models.notes) if (!job.notes.includes(note)) job.notes.push(note);

        const clientId = randomUUID();
        let watch: ProgressWatch | null = this.client.watch(
          clientId,
          (promptId, value, max) => {
            if (promptId && job.promptId && promptId !== job.promptId) return;
            report('generating', value / max);
          },
          reason => this.#logger.debug(`ComfyUI progress socket of ${job.id} ended: ${reason}`)
        );
        try {
          // Open before the prompt goes in, so the first step is not missed. A socket
          // that does not open in time costs only progress: the history is polled anyway.
          await Promise.race([
            watch.ready,
            new Promise(resolve => setTimeout(resolve, 2000).unref()),
          ]);
          if (job.promptId) {
            // An earlier attempt submitted it. Use it when ComfyUI still has it, instead of generating twice.
            const history = await this.client.history(job.promptId, signal);
            const queue = await this.client.queue(signal);
            const known =
              history.state === 'done' ||
              queue.running.includes(job.promptId) ||
              queue.pending.includes(job.promptId);
            if (!known) delete job.promptId;
          }
          let submittedAt = Date.now();
          if (!job.promptId) {
            report('queued-in-comfyui');
            const side = pixelsOf(job.request.size);
            job.promptId = await this.client.submit(
              buildGraph({
                prompt: job.request.prompt,
                models,
                width: side,
                height: side,
                steps: stepsOf(job.request.quality),
                seed: randomSeed(),
              }),
              clientId,
              signal
            );
            submittedAt = Date.now();
          }

          let misses = 0;
          for (;;) {
            signal.throwIfAborted();
            const promptId = job.promptId;
            const history = await this.client.history(promptId, signal);
            if (history.state === 'done') {
              job.generationMs = Date.now() - submittedAt;
              report('downloading');
              const image = await this.client.image(history.image, signal);
              if (!imageTypeOf(image))
                throw new MapsError(
                  'BAD_IMAGE',
                  'ComfyUI returned a file that is neither PNG nor JPEG'
                );
              return image;
            }
            if (history.state === 'error') {
              delete job.promptId;
              throw new MapsError(
                'GENERATION_FAILED',
                `ComfyUI could not generate the map: ${history.message}`
              );
            }
            const queue = await this.client.queue(signal);
            if (queue.running.includes(promptId)) {
              misses = 0;
              if (job.stage !== 'generating') report('generating', 0);
            } else if (queue.pending.includes(promptId)) {
              misses = 0;
              report('queued-in-comfyui');
            } else if (++misses >= 3) {
              delete job.promptId;
              throw new MapsError(
                'PROMPT_LOST',
                'ComfyUI no longer knows the prompt of this job; it was probably restarted'
              );
            }
            await abortable(pollMs(), signal);
          }
        } finally {
          watch?.close();
          watch = null;
        }
      },

      upload: async (job, image, signal, report) => {
        const type = imageTypeOf(image);
        if (!type) throw new MapsError('BAD_IMAGE', 'The image is neither PNG nor JPEG', false);
        if (image.byteLength > UPLOAD_MAX_BYTES) {
          throw new MapsError(
            'TOO_LARGE',
            `The image has ${image.byteLength} bytes, more than the ${UPLOAD_MAX_BYTES} the upload accepts`,
            false
          );
        }
        const filename = withImageExtension(`${job.request.sceneName}-${job.id}`, type);
        const data = Buffer.from(image).toString('base64');
        const total = Math.max(1, Math.ceil(data.length / UPLOAD_CHUNK_CHARS));
        const uploadId = `${job.id}-${job.attempts}`;
        let answer: unknown = null;
        for (let index = 0; index < total; index += 1) {
          answer = await this.query(
            MAP_QUERY.uploadChunk,
            {
              uploadId,
              filename,
              index,
              total,
              data: data.slice(index * UPLOAD_CHUNK_CHARS, (index + 1) * UPLOAD_CHUNK_CHARS),
            },
            { signal }
          );
          report('uploading', (index + 1) / total);
        }
        const path = isRecord(answer) ? answer['path'] : undefined;
        if (typeof path !== 'string' || !path)
          throw new MapsError(
            'UPLOAD_FAILED',
            `The module confirmed no stored file: ${JSON.stringify(answer)}`
          );
        return path;
      },

      createScene: async (job, path, signal): Promise<MapJobResult> => {
        const side = pixelsOf(job.request.size);
        const answer = await this.query(
          MAP_QUERY.createScene,
          {
            jobId: job.id,
            name: job.request.sceneName,
            path,
            width: side,
            height: side,
            gridSize: job.request.gridSize,
            activate: job.request.activateScene,
          },
          { signal }
        );
        const record = isRecord(answer) ? answer : {};
        if (typeof record['sceneId'] !== 'string')
          throw new MapsError(
            'SCENE_UNCONFIRMED',
            `The module confirmed no scene: ${JSON.stringify(answer)}`,
            false
          );
        return {
          sceneId: record['sceneId'],
          sceneName: typeof record['name'] === 'string' ? record['name'] : job.request.sceneName,
          path,
          activated: record['activated'] === true,
          warnings: Array.isArray(record['warnings'])
            ? record['warnings'].filter((w): w is string => typeof w === 'string')
            : [],
        };
      },

      interrupt: async (job: MapJob) => {
        if (!job.promptId) return;
        const outcome = await this.client.stopPrompt(job.promptId);
        this.#logger.info(`Map job ${job.id}: prompt ${job.promptId} ${outcome} in ComfyUI`);
      },

      notifyFailure: job =>
        this.tellFailure({
          jobId: job.id,
          name: job.request.sceneName,
          reason: job.error ?? 'unknown cause',
        }),
    };
  }
}

/**
 * The runtime from the environment. Throws with every problem of the
 * configuration. Without a logger it writes into the backend log as the area
 * `maps`, never into a file of its own.
 */
export function createMapsRuntime(
  envVars: Env,
  overrides: Partial<MapsRuntimeOptions> = {}
): MapsRuntime {
  const { env, problems } = readMapsEnv(envVars);
  if (problems.length) throw new MapsError('CONFIGURATION', problems.join(' '), false);
  const logger = overrides.logger ?? areaLogger('maps');
  return new MapsRuntime({ ...overrides, env, logger });
}
