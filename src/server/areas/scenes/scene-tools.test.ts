/**
 * The scene tools from the registry through the module handlers and back:
 * names and parameters against the tool directory, the text outputs, and the
 * permission gate for every writing tool.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { FakeFoundry, type FakeFoundryOptions } from '../../../testing/fake-foundry.js';
import { readToolDirectory } from '../../../testing/tool-directory.js';
import { withScenes, type ScenesFakeOptions } from '../../../module/areas/scenes/testing.js';
import { scenesArea } from './index.js';

let harness: AreaHarness | null = null;
afterEach(() => {
  harness?.close();
  harness = null;
});

function open(options: FakeFoundryOptions = {}, scenes: ScenesFakeOptions = {}): AreaHarness {
  const foundry = withScenes(new FakeFoundry(options), {
    media: { 'Maps/Hafen.webp': { width: 3000, height: 2000 } },
    ...scenes,
  });
  harness = createAreaHarness({ foundry });
  return harness;
}

const text = (result: { content: Array<{ text?: string }> }) => result.content[0]?.text ?? '';

const SCENE_TOOLS = [
  'get-world-info',
  'list-scenes',
  'list-scene-folders',
  'get-current-scene',
  'create-scene',
  'restore-scene',
  'update-scene',
  'create-scene-note',
  'refresh-scene-thumb',
  'switch-scene',
  'delete-scene',
];

interface DescribedTool {
  name: string;
  inputSchema: {
    properties?: Record<string, { type?: string; default?: unknown }>;
    required?: string[];
  };
}

describe('scene tools', () => {
  it('offers all eleven with the names and parameters of the tool directory', () => {
    const described = readToolDirectory() as unknown as DescribedTool[];
    const ours = new Map((scenesArea.tools ?? []).map(tool => [tool.name, tool]));
    expect([...ours.keys()].sort()).toEqual([...SCENE_TOOLS].sort());

    for (const name of SCENE_TOOLS) {
      const want = described.find(tool => tool.name === name);
      const have = ours.get(name)?.inputSchema as DescribedTool['inputSchema'] | undefined;
      expect(want, name).toBeDefined();
      const wantProps = want?.inputSchema.properties ?? {};
      const haveProps = have?.properties ?? {};
      expect(Object.keys(haveProps).sort(), name).toEqual(Object.keys(wantProps).sort());
      for (const [key, schema] of Object.entries(wantProps)) {
        expect(haveProps[key]?.type, `${name}.${key}`).toBe(schema.type);
        expect(haveProps[key]?.default, `${name}.${key} default`).toEqual(schema.default);
      }
      expect([...(have?.required ?? [])].sort(), name).toEqual(
        [...(want?.inputSchema.required ?? [])].sort()
      );
    }
  });

  it('creates a scene and reports it as text, with the measured size', async () => {
    const h = open();
    const result = await h.call('create-scene', {
      name: 'SC_Hafen_Nacht',
      background: 'Maps/Hafen.webp',
      folderPath: 'Orte/Hafen',
    });
    expect(result.isError).toBeUndefined();
    const lines = text(result).split('\n');
    expect(lines[0]).toBe('Scene created: SC Hafen Nacht');
    expect(lines).toContain('Size: 3000 x 2000 (measured from the file)');
    expect(lines).toContain('Folders created: Orte, Hafen');
    expect(lines).toContain('Template: none');
    expect(lines).toContain('Journal: none');
    expect(lines).toContain('Level patched: yes');
    expect(lines).toContain('Thumbnail: created');
  });

  it('refuses without name or background before asking the module', async () => {
    const result = await open().call('create-scene', { background: 'Maps/Hafen.webp' });
    expect(text(result)).toBe('Error: Invalid arguments for create-scene: name is required');
  });

  it('lists scene folders one per line', async () => {
    const h = open();
    const top = h.foundry.seed('Folder', { name: 'Orte', type: 'Scene', folder: null });
    h.foundry.seed('Folder', { name: 'Hafen', type: 'Scene', folder: top.id });
    h.foundry.seed('Scene', { name: 'Kai', folder: top.id, width: 10, height: 10 });
    const result = await h.call('list-scene-folders');
    expect(text(result)).toBe(
      `Orte (1 scenes, id ${top.id})\nOrte/Hafen (0 scenes, id ${[...h.foundry.collection('Folder').keys()][1]})`
    );
  });

  it('keeps writing tools behind the write switch, switch-scene included', async () => {
    const h = open({ settings: { 'ninjos-foundry-mcp.allowWriteOperations': false } });
    const scene = h.foundry.seed('Scene', { name: 'Kai', width: 10, height: 10 });
    for (const [tool, args] of [
      ['switch-scene', { scene_identifier: 'Kai' }],
      ['create-scene', { name: 'X', background: 'Maps/Hafen.webp' }],
      ['update-scene', { sceneIdentifier: 'Kai', navigation: true }],
      ['refresh-scene-thumb', { sceneIdentifier: 'Kai' }],
      ['delete-scene', { sceneId: scene.id }],
    ] as const) {
      const result = await h.call(tool, args);
      expect(result.isError, tool).toBe(true);
      expect(text(result), tool).toContain('"Allow Write Operations" is off');
    }
    expect(h.foundry.operations).toEqual([]);
  });

  it('deletes by id with the full level only, and says so', async () => {
    const h = open();
    const scene = h.foundry.seed('Scene', { name: 'Kai', width: 10, height: 10 });
    expect(text(await h.call('delete-scene', { sceneId: scene.id }))).toContain(
      'Deleting scenes is not permitted'
    );
    const settings = h.foundry.game['settings'] as {
      set(ns: string, key: string, value: unknown): Promise<unknown>;
    };
    await settings.set('ninjos-foundry-mcp', 'permScenes', 'full');
    expect(text(await h.call('delete-scene', { sceneId: scene.id }))).toBe('Scene "Kai" deleted.');
  });

  it('turns a failure of an old module sent as a value into a tool error', async () => {
    const h = createAreaHarness({ serverAreas: [scenesArea], moduleAreas: [] });
    harness = h;
    h.dispatcher.register('updateScene', {
      access: { kind: 'read' },
      run: () => ({ success: false, error: 'Scene not found' }),
    });
    expect(text(await h.call('update-scene', { sceneIdentifier: 'x', name: 'y' }))).toBe(
      'Error: Scene not found'
    );
  });

  it('passes an answer of unknown shape on as JSON', async () => {
    const h = createAreaHarness({ serverAreas: [scenesArea], moduleAreas: [] });
    harness = h;
    h.dispatcher.register('createScene', {
      access: { kind: 'read' },
      run: () => ({ sceneId: 'old' }),
    });
    expect(JSON.parse(text(await h.call('create-scene', { name: 'a', background: 'b' })))).toEqual({
      sceneId: 'old',
    });
  });
});
