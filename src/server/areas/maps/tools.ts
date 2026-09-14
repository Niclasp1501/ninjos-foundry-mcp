/**
 * The three map tools.
 *
 * Names and parameters as in the tool directory. Two parameters are new, both
 * optional with the safe default:
 *
 * - `activate_scene` (default false): the new scene is not switched on for
 *   every player unless asked.
 * - `wait_for_completion` (default false): the call stays open until the job
 *   ended and reports progress through MCP progress notifications, at most one
 *   per stage or per ten percent. Without it the answer comes at once, as before.
 */
import {
  DEFAULT_GRID_SIZE,
  DEFAULT_MAP_SIZE,
  isMapSize,
  MAP_QUALITY_STEPS,
  MAP_SIZES,
  MAX_GRID_SIZE,
  MIN_GRID_SIZE,
} from '../../../common/areas/maps/constants.js';
import type { Logger } from '../../logger.js';
import type { ServerAreaContext } from '../../tools/areas.js';
import {
  readOnlyTool,
  writingTool,
  type ToolContext,
  type ToolDefinition,
} from '../../tools/types.js';
import { messageOf } from './errors.js';
import { isFinished, STAGE_TEXT, type MapJob } from './jobs.js';
import type { Env } from './env.js';
import type { MapsRuntime } from './runtime.js';

export interface MapsRuntimeSource {
  /** The running runtime, or an error with the reason there is none. */
  get(context: ToolContext): MapsRuntime;
}

/**
 * The runtime of this backend, created when the area starts (area lifecycle)
 * and only with COMFYUI_ENABLED=true. Before, it was created by the first
 * map tool call, so autostart and the service window only worked afterwards.
 * A configuration problem is kept and named by every map tool and the window.
 */
export class MapsRuntimeHolder implements MapsRuntimeSource {
  #runtime: MapsRuntime | null = null;
  #problem: string | null = null;

  constructor(private readonly create: (env: Env, logger: Logger) => MapsRuntime) {}

  start(context: ServerAreaContext): void {
    if (!context.config.comfyuiEnabled || this.#runtime) return;
    try {
      const runtime = this.create(context.env, context.logger);
      runtime.useBridge((name, data, options) => context.query(name, data, options));
      runtime.useConnection(() => context.isModuleConnected());
      this.#runtime = runtime;
      this.#problem = null;
    } catch (error) {
      this.#problem = messageOf(error);
      context.logger.warn(`The map generator could not start: ${this.#problem}`);
    }
  }

  get(): MapsRuntime {
    if (this.#runtime) return this.#runtime;
    throw new Error(
      this.#problem ?? 'The map generator does not run on this server: COMFYUI_ENABLED is not true.'
    );
  }

  get current(): MapsRuntime | null {
    return this.#runtime;
  }

  /** Why the runtime could not be created, or null. */
  get problem(): string | null {
    return this.#problem;
  }

  async close(): Promise<void> {
    const runtime = this.#runtime;
    this.#runtime = null;
    await runtime?.close();
  }
}

type Fragment = Record<string, unknown>;

/** Schema fragment of one parameter; `extra` carries enum and default. */
function parameter(kind: string, description: string, extra: Fragment = {}): Fragment {
  return { type: kind, ...extra, description };
}

function jobIdSchema(description: string): Fragment {
  return {
    type: 'object',
    properties: { job_id: parameter('string', description) },
    required: ['job_id'],
  };
}

function nonEmpty(args: Record<string, unknown>, key: string, label: string): string {
  const raw = args[key];
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (trimmed === '') throw new Error(`${label} is required and must not be empty.`);
  return trimmed;
}

function seconds(ms: number | undefined): string {
  return ms === undefined ? 'unknown' : `${Math.round(ms / 100) / 10}`;
}

const noteLine = (note: string) => `Note: ${note}`;

/** One text builder per job status. */
const STATUS_TEXTS: { [S in MapJob['status']]: (job: MapJob, ahead: number) => string[] } = {
  queued: (job, ahead) => [
    `Job ${job.id} is queued. Status: ${STAGE_TEXT[job.stage]}.${ahead ? ` Jobs ahead of it: ${ahead}.` : ''}`,
  ],
  running: job => [
    `Job ${job.id} in progress. Stage: ${STAGE_TEXT[job.stage]}. Progress: ${job.progress}%.` +
      (job.attempts > 1 ? ` Attempt ${job.attempts}.` : ''),
  ],
  completed: job => {
    const out = [
      `Job ${job.id} completed successfully. Generation time: ${seconds(job.generationMs)}s.`,
    ];
    const made = job.result;
    if (made) {
      out.push(`Scene "${made.sceneName}" (${made.sceneId}) created with the map ${made.path}.`);
      out.push(
        made.activated
          ? 'The scene is now active for all players.'
          : 'The scene is not activated; switch to it when the table is ready.'
      );
      out.push(...made.warnings.map(warning => `Warning: ${warning}`));
    }
    return [...out, ...job.notes.map(noteLine)];
  },
  failed: job => [
    `Job ${job.id} failed. Reason: ${job.error ?? 'unknown'}`,
    ...job.notes.map(noteLine),
  ],
  cancelled: job => [
    `Job ${job.id} was cancelled. ${job.error ?? ''}`.trim(),
    ...job.notes.map(noteLine),
  ],
};

export function statusText(job: MapJob, position = 0): string {
  return STATUS_TEXTS[job.status](job, position).join('\n');
}

function startedText(runtime: MapsRuntime, job: MapJob, deduplicated: boolean): string {
  const ahead = runtime.jobs.position(job);
  if (deduplicated) {
    return [
      `An identical map job exists already, so no new one was started. Job ID: ${job.id}`,
      `Its status: ${statusText(job, ahead)}`,
      'A different scene_name starts a new job.',
    ].join('\n');
  }
  const wish = job.request;
  const side = MAP_SIZES[wish.size];
  const activation = wish.activateScene
    ? 'The scene will be activated for all players.'
    : 'The scene will not be activated.';
  return [
    `Map generation started. Job ID: ${job.id}`,
    `Prompt: ${wish.prompt}`,
    `Scene name: ${wish.sceneName}`,
    `Size: ${wish.size} (${side} x ${side} pixels)`,
    `Grid: ${wish.gridSize} pixels per 5 ft square`,
    `Quality: ${wish.quality} (${MAP_QUALITY_STEPS[wish.quality]} steps, world setting mapGenQuality)`,
    ahead ? `Jobs ahead of it: ${ahead}` : 'It starts right away.',
    'Time: varies by hardware and quality; the first map after ComfyUI starts also loads the models.',
    `When the map is done it is uploaded into the world and becomes a new scene in the folder "AI Generated Maps". ${activation} Foundry shows the Gamemaster a message when the scene exists or when the job failed.`,
    'Do not call check-map-status repeatedly: it costs tokens. Check only when the user asks, or pass wait_for_completion to wait for the result.',
  ].join('\n');
}

/** Relays job progress as MCP progress: only increasing values, one per stage or per ten percent. */
function progressRelay(context: ToolContext): (job: MapJob) => void {
  let sent = -1;
  let stage = '';
  return job => {
    const changedStage = job.stage !== stage;
    let value = job.status === 'completed' ? 100 : Math.min(99, job.progress);
    if (!changedStage && value < sent + 10 && !isFinished(job)) return;
    if (value <= sent) {
      if (!changedStage) return;
      value = Math.min(99, sent + 1);
      if (value <= sent) return;
    }
    sent = value;
    stage = job.stage;
    context.progress({ progress: value, total: 100, message: STAGE_TEXT[job.stage] });
  };
}

const GENERATE_ABOUT =
  'Start AI map generation with ComfyUI and the D&D Battlemaps SDXL model on the PC of the MCP server. ' +
  'The finished map is uploaded into the world and becomes a new scene in the folder "AI Generated Maps". ' +
  'Returns a job ID at once; the work runs in the background. The quality comes from the world setting mapGenQuality. ' +
  'The new scene is not activated unless activate_scene is true.';

const CHECK_ABOUT =
  'Check the status of a map generation job. Foundry shows the Gamemaster a message when the scene is created or the job failed. ' +
  'DO NOT check frequently: this wastes tokens. Only check if the user explicitly asks for the status.';

const CANCEL_ABOUT =
  'Cancel a waiting or running map generation job. A cancelled job creates no scene. Refused once the scene is already being created.';

const GENERATE_SCHEMA: Fragment = {
  type: 'object',
  properties: {
    prompt: parameter(
      'string',
      'Map description (it is prefixed with the "2d DnD battlemap" trigger and a top-down view)'
    ),
    scene_name: parameter(
      'string',
      'Short, creative name for the Foundry scene (e.g., "Harbor District", "Moonlit Tavern", "Crystal Caverns"). Be creative and evocative!'
    ),
    size: parameter('string', 'Map size (small=1024px, medium=1536px, large=2048px)', {
      enum: Object.keys(MAP_SIZES),
      default: DEFAULT_MAP_SIZE,
    }),
    grid_size: parameter(
      'number',
      `Pixels per 5ft square for Foundry scene setup, a whole number from ${MIN_GRID_SIZE} to ${MAX_GRID_SIZE}`,
      { default: DEFAULT_GRID_SIZE }
    ),
    activate_scene: parameter(
      'boolean',
      'Activate the new scene for all players when it is created. Default false: players stay where they are.',
      { default: false }
    ),
    wait_for_completion: parameter(
      'boolean',
      'Keep the call open until the map is done or failed, with progress notifications. Default false: answer at once with the job ID.',
      { default: false }
    ),
  },
  required: ['prompt', 'scene_name'],
};

function validGridSize(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_GRID_SIZE &&
    value <= MAX_GRID_SIZE
  );
}

const finishedWord = (status: MapJob['status']) =>
  status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : 'been cancelled';

export function mapTools(source: MapsRuntimeSource): ToolDefinition[] {
  const generateMap: ToolDefinition = {
    name: 'generate-map',
    title: 'Generate a battle map',
    description: GENERATE_ABOUT,
    group: 'maps',
    inputSchema: GENERATE_SCHEMA,
    annotations: writingTool('Generate a battle map', { destructive: false, idempotent: false }),
    handler: async (args, context) => {
      const prompt = nonEmpty(args, 'prompt', 'Prompt');
      const sceneName = nonEmpty(args, 'scene_name', 'Scene name');
      const size = args['size'] ?? DEFAULT_MAP_SIZE;
      if (!isMapSize(size)) throw new Error('size must be one of "small", "medium", "large".');
      const gridSize = args['grid_size'] ?? DEFAULT_GRID_SIZE;
      if (!validGridSize(gridSize)) {
        const got = JSON.stringify(gridSize);
        throw new Error(
          `grid_size must be a whole number from ${MIN_GRID_SIZE} to ${MAX_GRID_SIZE}, got ${got}.`
        );
      }

      const runtime = source.get(context);
      const settings = await runtime.mapSettings();
      if (settings.sceneProblem) {
        const why = settings.sceneProblem;
        throw new Error(
          `No map job was started, because the finished map could not become a scene in this world: ${why}`
        );
      }
      const submitted = runtime.jobs.submit({
        prompt,
        sceneName,
        size,
        gridSize,
        quality: settings.quality,
        activateScene: args['activate_scene'] === true,
      });
      const job = submitted.job;
      settings.notes
        .filter(note => !job.notes.includes(note))
        .forEach(note => job.notes.push(note));

      if (args['wait_for_completion'] !== true)
        return startedText(runtime, job, submitted.deduplicated);

      const relay = progressRelay(context);
      relay(job);
      const unsubscribe = runtime.jobs.subscribe(job.id, relay);
      try {
        const ended = await runtime.jobs.waitFor(job.id, context.signal);
        const report = statusText(ended);
        if (ended.status !== 'completed') throw new Error(report);
        return report;
      } finally {
        unsubscribe();
      }
    },
  };

  const checkMapStatus: ToolDefinition = {
    name: 'check-map-status',
    title: 'Check a map job',
    description: CHECK_ABOUT,
    group: 'maps',
    inputSchema: jobIdSchema('Job ID to check status for'),
    annotations: readOnlyTool('Check a map job'),
    handler: async (args, context) => {
      const id = nonEmpty(args, 'job_id', 'job_id');
      const runtime = source.get(context);
      runtime.jobs.sweep();
      const job = runtime.jobs.get(id);
      if (job) return statusText(job, runtime.jobs.position(job));
      throw new Error(
        `Job ${id} not found. Jobs are kept in memory for 30 minutes after they ended and are gone after a restart of the MCP server.`
      );
    },
  };

  const cancelMapJob: ToolDefinition = {
    name: 'cancel-map-job',
    title: 'Cancel a map job',
    description: CANCEL_ABOUT,
    group: 'maps',
    inputSchema: jobIdSchema('Job ID to cancel'),
    annotations: writingTool('Cancel a map job', { destructive: false, idempotent: true }),
    handler: async (args, context) => {
      const id = nonEmpty(args, 'job_id', 'job_id');
      const result = source.get(context).jobs.cancel(id);
      if (result.outcome === 'cancelled') {
        const imageNotes = result.job.notes.slice(-1).filter(note => note.includes('image'));
        return [`Job ${id} cancelled. No scene will be created.`, ...imageNotes.map(noteLine)].join(
          '\n'
        );
      }
      if (result.outcome === 'not-found') throw new Error(`Job ${id} not found.`);
      if (result.outcome === 'finished')
        throw new Error(
          `Job ${id} cannot be cancelled: it has already ${finishedWord(result.job.status)}.`
        );
      throw new Error(
        `Job ${id} cannot be cancelled any more: its scene is being created in Foundry right now. Delete the scene afterwards if it is not wanted.`
      );
    },
  };

  return [generateMap, checkMapStatus, cancelMapJob];
}
