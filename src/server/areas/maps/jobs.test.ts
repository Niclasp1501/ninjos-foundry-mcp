/**
 * The lifecycle of map jobs without ComfyUI and without Foundry: retries that
 * run again, the total limit, a cancel that prevents the scene, dedup that
 * never starts twice, and retention that never removes a running job.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BridgeError } from '../../bridge/foundry-bridge.js';
import { silentLogger } from '../../logger.js';
import { MapsError } from './errors.js';
import {
  MapJobs,
  type JobStage,
  type JobSteps,
  type MapJobRequest,
  type MapJobsOptions,
} from './jobs.js';

function gate<T>() {
  let open!: (value: T) => void;
  const promise = new Promise<T>(resolve => {
    open = resolve;
  });
  return { promise, open };
}

const request = (over: Partial<MapJobRequest> = {}): MapJobRequest => ({
  prompt: 'a harbor at night',
  sceneName: 'Harbor',
  size: 'small',
  gridSize: 70,
  quality: 'low',
  activateScene: false,
  ...over,
});

let jobs: MapJobs | null = null;
afterEach(async () => {
  await jobs?.close();
  jobs = null;
});

function setup(overrides: Partial<JobSteps> = {}, options: Partial<MapJobsOptions> = {}) {
  const calls = {
    ensure: 0,
    generate: 0,
    upload: 0,
    scene: 0,
    interrupt: 0,
    notified: [] as string[],
  };
  const steps: JobSteps = {
    ensureService: async () => {
      calls.ensure += 1;
    },
    generate: async (_job, _signal, report) => {
      calls.generate += 1;
      report('generating', 0.5);
      return new Uint8Array([1, 2, 3]);
    },
    upload: async () => {
      calls.upload += 1;
      return 'worlds/w/ai-generated-maps/harbor.png';
    },
    createScene: async (job, path) => {
      calls.scene += 1;
      return {
        sceneId: 'scene1',
        sceneName: job.request.sceneName,
        path,
        activated: false,
        warnings: [],
      };
    },
    interrupt: async () => {
      calls.interrupt += 1;
    },
    notifyFailure: async job => {
      calls.notified.push(job.error ?? '');
    },
    ...overrides,
  };
  jobs = new MapJobs({
    steps,
    logger: silentLogger,
    totalTimeoutMs: 60_000,
    retryDelaysMs: [5, 5],
    ...options,
  });
  return { jobs, calls, steps };
}

describe('MapJobs', () => {
  it('runs a job through its stages to a scene', async () => {
    const { jobs, calls } = setup();
    const { job } = jobs.submit(request());
    // The job starts inside submit, so the first stage is already set here.
    expect(job).toMatchObject({ status: 'running', stage: 'starting-comfyui' });
    const stages: JobStage[] = [];
    jobs.subscribe(job.id, current => stages.push(current.stage));
    const done = await jobs.waitFor(job.id);
    expect(done).toMatchObject({
      status: 'completed',
      progress: 100,
      attempts: 1,
      result: { sceneId: 'scene1' },
    });
    expect(stages).toEqual(['generating', 'uploading', 'creating-scene', 'finished']);
    expect(calls).toMatchObject({ ensure: 1, generate: 1, upload: 1, scene: 1 });
    expect(done.image).toBeUndefined();
  });

  it('really runs a failed attempt again, up to success', async () => {
    let failures = 2;
    const { jobs, calls } = setup({
      generate: async () => {
        calls.generate += 1;
        if (failures-- > 0) throw new MapsError('GENERATION_FAILED', 'CUDA out of memory');
        return new Uint8Array([1]);
      },
    });
    const { job } = jobs.submit(request());
    const done = await jobs.waitFor(job.id);
    expect(done.status).toBe('completed');
    expect(done.attempts).toBe(3);
    expect(calls.generate).toBe(3);
    expect(done.notes).toEqual([
      'Attempt 1 failed: CUDA out of memory',
      'Attempt 2 failed: CUDA out of memory',
    ]);
  });

  it('keeps finished stages between attempts: the image is not generated twice', async () => {
    let failures = 1;
    const { jobs, calls } = setup({
      upload: async () => {
        calls.upload += 1;
        if (failures-- > 0)
          throw new BridgeError('CONNECTION_LOST', 'The connection to Foundry was lost');
        return 'worlds/w/ai-generated-maps/harbor.png';
      },
    });
    const done = await jobs.waitFor(jobs.submit(request()).job.id);
    expect(done.status).toBe('completed');
    expect(calls).toMatchObject({ generate: 1, upload: 2, scene: 1 });
  });

  it('fails after three attempts with the cause and tells the Gamemaster once', async () => {
    const { jobs, calls } = setup({
      ensureService: async () => {
        throw new MapsError('START_TIMEOUT', 'ComfyUI did not become ready within 120 seconds');
      },
    });
    const done = await jobs.waitFor(jobs.submit(request()).job.id);
    expect(done.status).toBe('failed');
    expect(done.error).toBe('ComfyUI did not become ready within 120 seconds (after 3 attempts)');
    await vi.waitFor(() => expect(calls.notified).toEqual([done.error]));
  });

  it('does not repeat a refusal of the world', async () => {
    const { jobs, calls } = setup({
      upload: async () => {
        calls.upload += 1;
        throw new BridgeError(
          'MODULE_ERROR',
          'Creating scenes is not permitted.',
          'PERMISSION_DENIED'
        );
      },
    });
    const done = await jobs.waitFor(jobs.submit(request()).job.id);
    expect(done).toMatchObject({
      status: 'failed',
      attempts: 1,
      error: 'Creating scenes is not permitted.',
    });
    expect(calls.upload).toBe(1);
  });

  it('never sends the scene request twice, and says the scene may exist after a lost answer', async () => {
    const { jobs, calls } = setup({
      createScene: async () => {
        calls.scene += 1;
        throw new BridgeError(
          'TIMEOUT',
          'Foundry did not answer "createMapScene" within 30 s of silence.'
        );
      },
    });
    const done = await jobs.waitFor(jobs.submit(request()).job.id);
    expect(done.status).toBe('failed');
    expect(calls.scene).toBe(1);
    expect(done.error).toContain('The scene may have been created anyway');
  });

  it('stops a job at its total time limit and interrupts ComfyUI', async () => {
    const { jobs, calls } = setup(
      {
        generate: (_job, signal) =>
          new Promise((_resolve, reject) =>
            signal.addEventListener('abort', () => reject(signal.reason))
          ),
      },
      { totalTimeoutMs: 40 }
    );
    const done = await jobs.waitFor(jobs.submit(request()).job.id);
    expect(done.status).toBe('failed');
    expect(done.error).toContain('ran longer than');
    expect(done.attempts).toBe(1);
    await vi.waitFor(() => expect(calls.interrupt).toBeGreaterThan(0));
  });

  it('prevents the scene when cancelled during generation, even if the image still arrives', async () => {
    const image = gate<Uint8Array>();
    const { jobs, calls } = setup({
      generate: async (_job, _signal, report) => {
        calls.generate += 1;
        report('generating', 0.2);
        return image.promise; // ignores the signal on purpose, like a download that finishes anyway
      },
    });
    const { job } = jobs.submit(request());
    await vi.waitFor(() => expect(job.stage).toBe('generating'));
    expect(jobs.cancel(job.id)).toMatchObject({ outcome: 'cancelled' });
    expect(job.status).toBe('cancelled');
    image.open(new Uint8Array([1]));
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(calls.upload).toBe(0);
    expect(calls.scene).toBe(0);
    expect(calls.interrupt).toBe(1);
    expect(jobs.cancel(job.id)).toMatchObject({ outcome: 'finished' });
  });

  it('refuses a cancel once the scene request is out', async () => {
    const scene = gate<void>();
    const { jobs } = setup({
      createScene: async (job, path) => {
        await scene.promise;
        return {
          sceneId: 's',
          sceneName: job.request.sceneName,
          path,
          activated: false,
          warnings: [],
        };
      },
    });
    const { job } = jobs.submit(request());
    await vi.waitFor(() => expect(job.stage).toBe('creating-scene'));
    expect(jobs.cancel(job.id)).toMatchObject({ outcome: 'too-late' });
    scene.open();
    expect((await jobs.waitFor(job.id)).status).toBe('completed');
  });

  it('runs one job at a time; a waiting job cancelled never starts', async () => {
    const first = gate<Uint8Array>();
    const { jobs, calls } = setup({
      generate: async () => {
        calls.generate += 1;
        return first.promise;
      },
    });
    const a = jobs.submit(request()).job;
    const b = jobs.submit(request({ sceneName: 'Tavern' })).job;
    await vi.waitFor(() => expect(a.status).toBe('running'));
    expect(b.status).toBe('queued');
    expect(jobs.position(b)).toBe(1);
    expect(jobs.cancel(b.id)).toMatchObject({ outcome: 'cancelled' });
    first.open(new Uint8Array([1]));
    await jobs.waitFor(a.id);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(calls.generate).toBe(1);
    expect(b.status).toBe('cancelled');
  });

  it('returns the existing job for an identical request and never starts it twice', async () => {
    const { jobs, calls } = setup();
    const first = jobs.submit(request());
    const second = jobs.submit(request());
    expect(second).toMatchObject({ deduplicated: true, job: { id: first.job.id } });
    await jobs.waitFor(first.job.id);
    expect(jobs.submit(request())).toMatchObject({ deduplicated: true, job: { id: first.job.id } });
    expect(calls.generate).toBe(1);

    const other = jobs.submit(request({ sceneName: 'Harbor 2' }));
    expect(other.deduplicated).toBe(false);
    const activated = jobs.submit(request({ activateScene: true }));
    expect(activated.deduplicated).toBe(false);
  });

  it('starts a new job for a request whose earlier job failed', async () => {
    const { jobs } = setup({
      ensureService: async () => {
        throw new MapsError('NOT_INSTALLED', 'ComfyUI installation not found', false);
      },
    });
    const first = jobs.submit(request()).job;
    await jobs.waitFor(first.id);
    expect(jobs.submit(request()).job.id).not.toBe(first.id);
  });

  it('removes ended jobs after the retention, never a running one', async () => {
    let now = 1_000_000;
    const hold = gate<Uint8Array>();
    const { jobs } = setup(
      {
        generate: async (job, _signal, report) => {
          report('generating');
          return job.request.sceneName === 'Long' ? hold.promise : new Uint8Array([1]);
        },
      },
      { now: () => now, retentionMs: 30 * 60 * 1000 }
    );
    const short = jobs.submit(request({ sceneName: 'Short' })).job;
    await jobs.waitFor(short.id);
    const long = jobs.submit(request({ sceneName: 'Long' })).job;
    await vi.waitFor(() => expect(long.stage).toBe('generating'));

    now += 29 * 60 * 1000;
    jobs.sweep();
    expect(jobs.get(short.id)).toBeDefined();
    now += 2 * 60 * 60 * 1000;
    jobs.sweep();
    expect(jobs.get(short.id)).toBeUndefined();
    expect(jobs.get(long.id)).toBe(long);

    hold.open(new Uint8Array([1]));
    await jobs.waitFor(long.id);
    jobs.sweep();
    expect(jobs.get(long.id)).toBeDefined();
  });

  it('refuses more than the waiting limit with a reason', async () => {
    const hold = gate<Uint8Array>();
    const { jobs } = setup({ generate: () => hold.promise }, { maxWaiting: 2 });
    const running = jobs.submit(request({ sceneName: 'A' })).job;
    await vi.waitFor(() => expect(running.status).toBe('running'));
    jobs.submit(request({ sceneName: 'B' }));
    jobs.submit(request({ sceneName: 'C' }));
    expect(() => jobs.submit(request({ sceneName: 'D' }))).toThrow(
      '2 map jobs are already waiting'
    );
    hold.open(new Uint8Array([1]));
  });
});
