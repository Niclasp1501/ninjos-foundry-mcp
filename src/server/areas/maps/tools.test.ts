/**
 * The three map tools from the registry through the bridge into the module
 * and back, with a fake ComfyUI over real HTTP and WebSocket on a free port,
 * and a fake Foundry. Nothing real is started.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { FakeFoundry } from '../../../testing/fake-foundry.js';
import { readToolDirectory } from '../../../testing/tool-directory.js';
import {
  clearInterfaceServices,
  interfaceService,
} from '../../../module/areas/interface/services.js';
import { useServerRequests } from '../../../module/core-services.js';
import { mapsArea as moduleMapsArea } from '../../../module/areas/maps/index.js';
import { withMaps, type FakeFilePicker } from '../../../module/areas/maps/testing.js';
import { clearUploads } from '../../../module/areas/maps/upload.js';
import type { ProgressPayload } from '../../../common/protocol.js';
import { silentLogger } from '../../logger.js';
import { createMapsArea } from './area.js';
import { createMapsRuntime } from './runtime.js';
import { FakeComfyUI, fakeSpawn, type FakeComfyOptions } from './testing.js';
import { MapsRuntimeHolder } from './tools.js';

const TOOL_NAMES = ['generate-map', 'check-map-status', 'cancel-map-job'];

let comfy: FakeComfyUI | null = null;
let source: MapsRuntimeHolder | null = null;
let harness: AreaHarness | null = null;

afterEach(async () => {
  await harness?.stopServerAreas();
  await source?.close();
  harness?.close();
  await comfy?.close();
  clearUploads();
  clearInterfaceServices();
  comfy = null;
  source = null;
  harness = null;
});

interface OpenOptions {
  comfy?: FakeComfyOptions;
  settings?: Record<string, unknown>;
  env?: Record<string, string>;
  comfyuiEnabled?: boolean;
}

async function open(
  options: OpenOptions = {}
): Promise<{ harness: AreaHarness; picker: FakeFilePicker; foundry: FakeFoundry }> {
  comfy = await FakeComfyUI.start({ steps: 35, stepMs: 1, ...options.comfy });
  const port = comfy.port;
  const foundry = new FakeFoundry({ settings: options.settings ?? {} });
  const { picker } = withMaps(foundry);
  source = new MapsRuntimeHolder(() =>
    createMapsRuntime(
      { COMFYUI_PORT: String(port), ...options.env },
      {
        logger: silentLogger,
        spawn: fakeSpawn().spawn,
        locate: () => ({ found: false, searched: [], problem: 'no installation in tests' }),
        timings: {
          pollMs: 5,
          retryDelaysMs: [5, 5],
          readyPollMs: 5,
          readyTimeoutMs: 1000,
        },
      }
    )
  );
  harness = createAreaHarness({
    foundry,
    serverAreas: [createMapsArea(source)],
    comfyuiEnabled: options.comfyuiEnabled ?? true,
  });
  // Area lifecycle: the runtime exists from the start of the area, not from the first tool call.
  await harness.startServerAreas();
  return { harness, picker, foundry };
}

const text = (result: { content: Array<{ text?: string }> }) =>
  result.content.map(block => block.text).join('\n');

describe('the map tools as listed', () => {
  it('keep the names and parameters of the tool directory and add two optional parameters with safe defaults', async () => {
    const { harness } = await open();
    const recorded = readToolDirectory() as unknown as Array<{
      name: string;
      inputSchema: { properties: Record<string, Record<string, unknown>>; required?: string[] };
    }>;
    const listed = await harness.tools.list();
    for (const name of TOOL_NAMES) {
      const before = recorded.find(tool => tool.name === name);
      const now = listed.find(tool => tool.name === name);
      expect(before, name).toBeDefined();
      expect(now, name).toBeDefined();
      const properties = (now?.inputSchema['properties'] ?? {}) as Record<
        string,
        Record<string, unknown>
      >;
      for (const [key, schema] of Object.entries(before?.inputSchema.properties ?? {})) {
        expect(properties[key]?.['type'], `${name}.${key}`).toBe(schema['type']);
        expect(properties[key]?.['enum'], `${name}.${key}`).toEqual(schema['enum']);
        expect(properties[key]?.['default'], `${name}.${key}`).toEqual(schema['default']);
      }
      expect(now?.inputSchema['required']).toEqual(before?.inputSchema.required);
    }
    const generate = listed.find(tool => tool.name === 'generate-map');
    expect(generate?.inputSchema['properties']).toMatchObject({
      activate_scene: { type: 'boolean', default: false },
      wait_for_completion: { type: 'boolean', default: false },
    });
    expect(generate?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
  });

  it('are not listed and create nothing while COMFYUI_ENABLED is off', async () => {
    const { harness } = await open({ comfyuiEnabled: false });
    const names = (await harness.tools.list()).map(tool => tool.name);
    for (const name of TOOL_NAMES) expect(names).not.toContain(name);
    const result = await harness.call('generate-map', { prompt: 'a cave', scene_name: 'Cave' });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('which is switched off on this server');
    expect(source?.current).toBeNull();
    expect(comfy?.prompts).toHaveLength(0);
  });
});

describe('generate-map', () => {
  it('makes the map, uploads it in pieces and creates a scene that is not activated, with few progress notifications', async () => {
    const { harness, picker, foundry } = await open();
    const dispatch = vi.spyOn(harness.dispatcher, 'dispatch');
    const progress: ProgressPayload[] = [];
    const result = await harness.tools.call(
      'generate-map',
      {
        prompt: 'a harbor district at dusk',
        scene_name: 'Harbor District',
        size: 'small',
        wait_for_completion: true,
      },
      { onProgress: payload => progress.push(payload) }
    );

    expect(result.isError, text(result)).toBeUndefined();
    expect(text(result)).toContain('completed successfully');
    expect(text(result)).toContain('The scene is not activated');

    // No notification per step: 35 steps came from ComfyUI.
    expect(comfy?.progressSent).toBe(35);
    expect(progress.length).toBeGreaterThan(3);
    expect(progress.length).toBeLessThanOrEqual(20);
    const values = progress.map(entry => entry.progress);
    expect([...values].sort((a, b) => a - b)).toEqual(values);
    expect(new Set(values).size).toBe(values.length);
    expect(values.at(-1)).toBe(100);

    const graph = comfy?.prompts[0]?.graph as Record<
      string,
      { class_type: string; inputs: Record<string, unknown> }
    >;
    expect(graph['1']?.inputs['ckpt_name']).toBe('dnd_battlemaps_sdxl.safetensors');
    expect(graph['2']?.inputs['vae_name']).toBe('sdxl_vae.safetensors');
    expect(graph['5']?.inputs).toMatchObject({ width: 1024, height: 1024 });
    expect(graph['6']?.inputs['steps']).toBe(8);
    expect(graph['8']?.class_type).toBe('PreviewImage');
    expect(String(graph['3']?.inputs['text'])).toMatch(
      /^2d DnD battlemap, top-down view.*a harbor district at dusk$/
    );

    const pieces = dispatch.mock.calls.filter(call => call[0] === 'uploadMapChunk');
    expect(pieces.length).toBe(4);
    expect([...picker.files.entries()]).toEqual([
      [
        expect.stringMatching(
          /^worlds\/test-world\/ai-generated-maps\/Harbor_District-map-[\w-]+\.png$/
        ),
        { size: 700_000, type: 'image/png' },
      ],
    ]);

    const scenes = foundry.collection('Scene').contents;
    expect(scenes).toHaveLength(1);
    const scene = scenes[0] as unknown as Record<string, unknown>;
    expect(scene).toMatchObject({
      name: 'Harbor District',
      active: false,
      width: 1024,
      height: 1024,
      padding: 0.25,
      tokenVision: true,
      fog: { exploration: true },
      grid: { type: 1, size: 70, distance: 5, units: 'ft' },
    });
    const folder = foundry
      .collection('Folder')
      .contents.find(entry => (entry as unknown as { name: string }).name === 'AI Generated Maps');
    expect(folder).toBeDefined();
    expect(scene['folder']).toBe(folder?.id);
    expect(foundry.notifications).toContainEqual({
      level: 'info',
      message: 'Scene Harbor District created.',
    });
    expect(harness.changeLog.list().map(entry => entry.action)).toEqual(
      expect.arrayContaining(['create', 'update'])
    );
  });

  it('activates the scene only when activate_scene is true', async () => {
    const { harness, foundry } = await open();
    const result = await harness.call('generate-map', {
      prompt: 'a tavern',
      scene_name: 'Moonlit Tavern',
      size: 'small',
      grid_size: 100,
      activate_scene: true,
      wait_for_completion: true,
    });
    expect(text(result)).toContain('The scene is now active for all players.');
    const scene = foundry.collection('Scene').contents[0] as unknown as Record<string, unknown>;
    expect(scene).toMatchObject({ active: true, grid: { size: 100 } });
    expect(foundry.notifications).toContainEqual({
      level: 'info',
      message: 'Switched to the scene Moonlit Tavern.',
    });
  });

  it('refuses before generating when the map could not become a scene', async () => {
    const { harness } = await open({
      settings: { 'ninjos-foundry-mcp.allowWriteOperations': false },
    });
    const result = await harness.call('generate-map', { prompt: 'a cave', scene_name: 'Cave' });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain(
      'No map job was started, because the finished map could not become a scene'
    );
    expect(text(result)).toContain('"Allow Write Operations" is off');
    expect(comfy?.prompts).toHaveLength(0);
  });

  it('answers at once, returns the same job for the same request, and check-map-status follows it', async () => {
    const { harness } = await open();
    const args = { prompt: 'crystal caverns', scene_name: 'Crystal Caverns', size: 'small' };
    const started = text(await harness.call('generate-map', args));
    expect(started).toContain('Map generation started. Job ID: map-');
    expect(started).toContain('Size: small (1024 x 1024 pixels)');
    expect(started).toContain('Quality: low (8 steps');
    const id = /Job ID: (\S+)/.exec(started)?.[1] ?? '';

    const again = text(await harness.call('generate-map', args));
    expect(again).toContain(
      `An identical map job exists already, so no new one was started. Job ID: ${id}`
    );

    await source?.current?.jobs.waitFor(id);
    expect(text(await harness.call('check-map-status', { job_id: id }))).toContain(
      `Job ${id} completed successfully.`
    );
    expect(comfy?.prompts).toHaveLength(1);
  });

  it('uses the quality of the world setting', async () => {
    const { harness } = await open({ settings: { 'ninjos-foundry-mcp.mapGenQuality': 'high' } });
    await harness.call('generate-map', {
      prompt: 'a keep',
      scene_name: 'Keep',
      size: 'small',
      wait_for_completion: true,
    });
    const graph = comfy?.prompts[0]?.graph as Record<string, { inputs: Record<string, unknown> }>;
    expect(graph['6']?.inputs['steps']).toBe(35);
  });

  it('really retries a failed generation and shows the final failure to the Gamemaster', async () => {
    const { harness, foundry } = await open({ comfy: { failFirst: 5, steps: 3 } });
    const result = await harness.call('generate-map', {
      prompt: 'a swamp',
      scene_name: 'Swamp',
      size: 'small',
      wait_for_completion: true,
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain(
      'failed. Reason: ComfyUI could not generate the map: KSampler failed: CUDA out of memory (after 3 attempts)'
    );
    expect(comfy?.prompts).toHaveLength(3);
    await vi.waitFor(() =>
      expect(foundry.notifications).toContainEqual({
        level: 'error',
        message: expect.stringContaining(
          'The map Swamp could not be made: ComfyUI could not generate the map'
        ),
      })
    );
    expect(foundry.collection('Scene').contents).toHaveLength(0);
  });

  it('checks the arguments without starting anything', async () => {
    const { harness } = await open();
    const empty = await harness.call('generate-map', { prompt: '   ', scene_name: 'X' });
    expect(text(empty)).toBe('Error: Prompt is required and must not be empty.');
    const grid = await harness.call('generate-map', { prompt: 'x', scene_name: 'X', grid_size: 0 });
    expect(text(grid)).toBe('Error: grid_size must be a whole number from 20 to 400, got 0.');
    const size = await harness.call('generate-map', { prompt: 'x', scene_name: 'X', size: 'huge' });
    expect(text(size)).toContain('size must be one of "small", "medium", "large"');
    expect(comfy?.prompts).toHaveLength(0);
  });

  it('refuses a ComfyUI address outside this PC', async () => {
    const { harness } = await open({ env: { COMFYUI_HOST: '192.0.2.20' } });
    const result = await harness.call('generate-map', { prompt: 'x', scene_name: 'X' });
    expect(text(result)).toContain('COMFYUI_HOST="192.0.2.20" is not a loopback address');
  });
});

describe('cancel-map-job and check-map-status', () => {
  it('stop the prompt in ComfyUI, and no scene follows', async () => {
    const { harness, foundry } = await open({ comfy: { steps: 400, stepMs: 5 } });
    const started = text(
      await harness.call('generate-map', { prompt: 'ruins', scene_name: 'Ruins', size: 'small' })
    );
    const id = /Job ID: (\S+)/.exec(started)?.[1] ?? '';
    await vi.waitFor(() => expect(comfy?.runningPrompt).not.toBeNull(), { timeout: 5000 });
    await vi.waitFor(async () =>
      expect(text(await harness!.call('check-map-status', { job_id: id }))).toMatch(
        /in progress\. Stage: generating the image\. Progress: \d+%/
      )
    );

    expect(text(await harness.call('cancel-map-job', { job_id: id }))).toBe(
      `Job ${id} cancelled. No scene will be created.`
    );
    await vi.waitFor(() => expect(comfy?.interrupts).toHaveLength(1));
    await new Promise(resolve => setTimeout(resolve, 80));
    expect(foundry.collection('Scene').contents).toHaveLength(0);
    expect(text(await harness.call('check-map-status', { job_id: id }))).toContain(
      `Job ${id} was cancelled.`
    );
    expect(text(await harness.call('cancel-map-job', { job_id: id }))).toBe(
      `Error: Job ${id} cannot be cancelled: it has already been cancelled.`
    );
  });

  it('name a job that does not exist', async () => {
    const { harness } = await open();
    expect(text(await harness.call('check-map-status', { job_id: 'map-nope' }))).toContain(
      'Error: Job map-nope not found.'
    );
    expect(text(await harness.call('cancel-map-job', { job_id: 'map-nope' }))).toBe(
      'Error: Job map-nope not found.'
    );
  });
});

describe('the map service of the window', () => {
  it('reaches the server through a request from the start: checks, and refuses to stop a foreign ComfyUI', async () => {
    await open();
    moduleMapsArea.init?.();
    const service = interfaceService('mapService');
    expect(service).toBeDefined();

    const previous = useServerRequests(null);
    try {
      await expect(service!.status()).rejects.toMatchObject({ code: 'BRIDGE_MISSING' });
    } finally {
      useServerRequests(previous);
    }

    // No map tool call is needed first: the area started the runtime.
    await expect(service!.status()).resolves.toMatchObject({
      state: 'running',
      detail: 'running, not started by this server',
    });
    await expect(service!.start()).resolves.toMatchObject({
      state: 'running',
      alreadyRunning: true,
    });
    await expect(service!.stop()).rejects.toMatchObject({
      code: 'FAILED',
      message: expect.stringContaining(
        'was not started by this server, so it is not stopped from here'
      ),
    });
  });

  it('answers disabled while COMFYUI_ENABLED is off, and refuses an unknown action', async () => {
    const { harness } = await open({ comfyuiEnabled: false });
    moduleMapsArea.init?.();
    await expect(interfaceService('mapService')!.status()).resolves.toMatchObject({
      state: 'disabled',
      detail: expect.stringContaining('COMFYUI_ENABLED'),
    });
    await expect(harness.request('mapService', { action: 'reboot' })).rejects.toMatchObject({
      message: expect.stringContaining('action must be status, start or stop'),
    });
  });

  it('names a configuration problem in the window instead of a silent off', async () => {
    await open({ env: { COMFYUI_HOST: '192.0.2.20' } });
    moduleMapsArea.init?.();
    await expect(interfaceService('mapService')!.status()).resolves.toMatchObject({
      state: 'disabled',
      detail: expect.stringContaining('is not a loopback address'),
    });
  });
});
