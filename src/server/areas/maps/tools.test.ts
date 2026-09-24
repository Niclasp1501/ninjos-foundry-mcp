/**
 * The three image tools the whole way: server tool, a Gemini that answers
 * from memory, the bridge, the module storing, reading and previewing on a
 * fake Foundry, and the scene through the scenes area.
 *
 * What must hold beyond "it works": the key only ever travels in the request
 * header, never in a URL, an answer or an error; without a key the tools are
 * not listed and a call sends nothing; nothing is ever overwritten.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { FakeFoundry } from '../../../testing/fake-foundry.js';
import { withMaps, type FakeFilePicker } from '../../../module/areas/maps/testing.js';
import { useImageTools } from '../../../module/areas/maps/read.js';
import { clearUploads } from '../../../module/areas/maps/upload.js';
import type { ToolResult } from '../../control/api.js';
import { createMapsArea } from './area.js';
import { STYLE_CORE } from './style.js';
import type { MapsDeps } from './tools.js';

const KEY = 'test-gemini-key-0123456789';

let harness: AreaHarness | null = null;
afterEach(() => {
  harness?.close();
  harness = null;
  clearUploads();
  useImageTools();
});

/** A PNG header with the given size, enough for every reader here. */
function png(width: number, height: number, length = 400): Uint8Array {
  const bytes = new Uint8Array(length).fill(5);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

interface SentRequest {
  url: string;
  headers: Record<string, string>;
  body: {
    contents: Array<{ parts: Array<{ text?: string; inlineData?: { mimeType: string } }> }>;
    generationConfig: { imageConfig: { aspectRatio: string; imageSize: string } };
  };
}

interface GeminiFake {
  sent: SentRequest[];
  fetch: typeof fetch;
}

function gemini(
  answer: (request: SentRequest) => { status: number; body: unknown } = () => ({
    status: 200,
    body: {
      candidates: [
        {
          finishReason: 'STOP',
          content: {
            parts: [
              { text: 'Here is the map.' },
              {
                inlineData: {
                  mimeType: 'image/png',
                  data: Buffer.from(png(2752, 1536)).toString('base64'),
                },
              },
            ],
          },
        },
      ],
      usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 1300, totalTokenCount: 2200 },
    },
  })
): GeminiFake {
  const sent: SentRequest[] = [];
  const fake = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request: SentRequest = {
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body)) as SentRequest['body'],
    };
    sent.push(request);
    const { status, body } = answer(request);
    return new Response(JSON.stringify(body), { status });
  };
  return { sent, fetch: fake as typeof fetch };
}

interface Setup {
  harness: AreaHarness;
  picker: FakeFilePicker;
  foundry: FakeFoundry;
  gemini: GeminiFake;
}

function open(
  options: {
    env?: Record<string, string>;
    gemini?: GeminiFake;
    imagesEnabled?: boolean;
    files?: Record<string, Uint8Array>;
  } = {}
): Setup {
  const foundry = new FakeFoundry();
  const { picker } = withMaps(foundry, {
    media: {
      'Maps/Anker/SC_Innen.jpg': { width: 1376, height: 768 },
      'Maps/Anker/BM_Anker.png': { width: 2752, height: 1536 },
    },
  });
  const fake = options.gemini ?? gemini();
  const files = options.files ?? {};
  useImageTools({
    async fetchBytes(url) {
      const bytes = files[decodeURI(url)];
      return bytes
        ? { ok: true, status: 200, bytes }
        : { ok: false, status: 404, bytes: new Uint8Array() };
    },
    async loadPicture() {
      return {
        width: 2752,
        height: 1536,
        toJpegDataUrl: () => 'data:image/jpeg;base64,cHJldmlldw==',
      };
    },
  });
  const deps: MapsDeps = {
    env: () => options.env ?? { GEMINI_API_KEY: KEY },
    fetch: fake.fetch,
    newId: () => 'upload-1',
  };
  harness = createAreaHarness({
    foundry,
    serverAreas: [createMapsArea(deps)],
    imagesEnabled: options.imagesEnabled ?? true,
  });
  return { harness, picker, foundry, gemini: fake };
}

const text = (result: ToolResult) =>
  result.content
    .map(block => ('text' in block ? block.text : ''))
    .filter(Boolean)
    .join('\n');

const NAMES = ['generate-battlemap', 'generate-scene-image', 'edit-map-image'];

describe('the image tools as listed', () => {
  it('appear only when the server has a Gemini key', async () => {
    const without = open({ imagesEnabled: false }).harness;
    const listedWithout = (await without.tools.list()).map(tool => tool.name);
    expect(NAMES.filter(name => listedWithout.includes(name))).toEqual([]);
    without.close();

    const listed = await open().harness.tools.list();
    for (const name of NAMES) {
      const tool = listed.find(entry => entry.name === name);
      expect(tool, name).toBeDefined();
      expect(tool?.annotations).toMatchObject({ readOnlyHint: false, openWorldHint: true });
      expect(tool?.description, name).toMatch(/paid request to Google/);
    }
  });
});

describe('generate-battlemap', () => {
  it('asks Gemini with the key in the header only, stores the map, creates the scene and returns a preview', async () => {
    const { harness, picker, foundry, gemini: fake } = open();
    const result = await harness.call('generate-battlemap', {
      description: 'the taproom of a stone tavern with a hearth on the left wall',
      name: 'Anker',
      directory: 'Maps/Anker',
      grid_size: 140,
    });
    expect(result.isError, text(result)).toBeFalsy();

    expect(fake.sent).toHaveLength(1);
    const request = fake.sent[0] as SentRequest;
    expect(request.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent'
    );
    expect(request.url).not.toContain(KEY);
    expect(request.headers['x-goog-api-key']).toBe(KEY);
    expect(request.body.generationConfig.imageConfig).toEqual({
      aspectRatio: '16:9',
      imageSize: '2K',
    });
    const prompt = request.body.contents[0]?.parts.at(-1)?.text ?? '';
    expect(prompt).toMatch(/^Top-down battle map of the taproom of a stone tavern/);
    expect(prompt).toContain(STYLE_CORE);
    expect(prompt).toMatch(/no grid/);

    expect(picker.files.has('Maps/Anker/BM_Anker.png')).toBe(true);
    const scenes = foundry.collection('Scene').contents;
    expect(scenes).toHaveLength(1);
    expect(scenes[0]?.['name']).toBe('Anker');
    expect(scenes[0]?.['navigation']).toBe(false);
    expect(scenes[0]?.['active']).not.toBe(true);

    const output = text(result);
    expect(output).toContain('Image stored: Maps/Anker/BM_Anker.png (2752 x 1536)');
    expect(output).toContain('Scene created: Anker');
    expect(output).toContain('2200 tokens');
    expect(output).not.toContain(KEY);
    expect(result.content).toContainEqual({
      type: 'image',
      data: 'cHJldmlldw==',
      mimeType: 'image/jpeg',
    });
  });

  it('sends the backgrounds of reference scenes and reference images before the text', async () => {
    const { harness, gemini: fake } = open({
      files: {
        'Maps/Anker/SC_Innen.jpg': new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]),
        'Maps/Anker/Wappen.png': png(250, 320),
      },
    });
    await harness.query('createScene', {
      name: 'SC Innen',
      background: 'Maps/Anker/SC_Innen.jpg',
    });
    const result = await harness.call('generate-battlemap', {
      description: 'the tavern',
      name: 'Anker',
      reference_scenes: ['SC Innen'],
      reference_images: ['Maps/Anker/Wappen.png'],
      create_scene: false,
    });
    expect(result.isError, text(result)).toBeFalsy();
    const parts = fake.sent[0]?.body.contents[0]?.parts ?? [];
    expect(parts.map(part => part.inlineData?.mimeType ?? 'text')).toEqual([
      'image/jpeg',
      'image/png',
      'text',
    ]);
    expect(parts[2]?.text).toMatch(/The 2 attached images show the same place/);
    expect(text(result)).toContain(
      'References: scene "SC Innen" (Maps/Anker/SC_Innen.jpg); Maps/Anker/Wappen.png'
    );
  });

  it('without a key sends nothing and says where the key belongs', async () => {
    const { harness, gemini: fake, picker } = open({ env: {} });
    const result = await harness.call('generate-battlemap', { description: 'x', name: 'y' });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/GEMINI_API_KEY is not set for the MCP server/);
    expect(fake.sent).toHaveLength(0);
    expect(picker.uploads).toBe(0);
  });

  it('names a reached limit and never repeats the key, even when Google does', async () => {
    const fake = gemini(() => ({
      status: 429,
      body: { error: { message: `Quota exceeded for key ${KEY}` } },
    }));
    const { harness, picker } = open({ gemini: fake });
    const result = await harness.call('generate-battlemap', { description: 'x', name: 'y' });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/limit for this key is reached \(HTTP 429\)/);
    expect(text(result)).toContain('[key]');
    expect(text(result)).not.toContain(KEY);
    expect(picker.uploads).toBe(0);
  });

  it('reports a refused prompt without storing anything', async () => {
    const fake = gemini(() => ({
      status: 200,
      body: { promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } },
    }));
    const { harness, picker } = open({ gemini: fake });
    const result = await harness.call('generate-battlemap', { description: 'x', name: 'y' });
    expect(text(result)).toMatch(/refused the prompt \(PROHIBITED_CONTENT\)/);
    expect(picker.uploads).toBe(0);
  });

  it('refuses a folder outside the data folder before asking Gemini', async () => {
    const { harness, gemini: fake } = open();
    const result = await harness.call('generate-battlemap', {
      description: 'x',
      name: 'y',
      directory: '../../outside',
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/directory must be a folder inside Foundry's data folder/);
    expect(fake.sent).toHaveLength(0);
  });
});

describe('generate-scene-image', () => {
  it('paints at eye level, names the file SC_ and follows the model and size of the environment', async () => {
    const {
      harness,
      picker,
      gemini: fake,
    } = open({
      env: { GEMINI_API_KEY: KEY, GEMINI_IMAGE_SIZE: '4k', GEMINI_IMAGE_MODEL: 'gemini-9-image' },
    });
    const result = await harness.call('generate-scene-image', {
      description: 'a cosy tavern taproom in warm evening light',
      name: 'Anker Innen',
      create_scene: false,
    });
    expect(result.isError, text(result)).toBeFalsy();
    const request = fake.sent[0] as SentRequest;
    expect(request.url).toContain('/models/gemini-9-image:generateContent');
    expect(request.body.generationConfig.imageConfig.imageSize).toBe('4K');
    const prompt = request.body.contents[0]?.parts.at(-1)?.text ?? '';
    expect(prompt).toMatch(/^a cosy tavern taproom in warm evening light,/);
    expect(prompt).toMatch(/at eye level/);
    expect([...picker.files.keys()]).toEqual([
      'worlds/test-world/ai-generated-maps/SC_Anker_Innen.png',
    ]);
  });

  it('leaves the style out with FOUNDRY_MCP_IMAGE_STYLE=none and uses another text when given', async () => {
    for (const [style, expected] of [
      ['none', false],
      ['watercolour sketch', true],
    ] as const) {
      const { harness, gemini: fake } = open({
        env: { GEMINI_API_KEY: KEY, FOUNDRY_MCP_IMAGE_STYLE: style },
      });
      await harness.call('generate-scene-image', {
        description: 'a hut',
        name: 'Hut',
        create_scene: false,
      });
      const prompt = fake.sent[0]?.body.contents[0]?.parts.at(-1)?.text ?? '';
      expect(prompt).not.toContain(STYLE_CORE);
      expect(prompt.includes('watercolour sketch')).toBe(expected);
      harness.close();
    }
  });
});

describe('edit-map-image', () => {
  it('stores the result next to the original, keeps its shape and leaves it untouched', async () => {
    const original = png(1024, 1024);
    const {
      harness,
      picker,
      gemini: fake,
    } = open({
      files: { 'Maps/Anker/BM_Anker.png': original },
    });
    picker.files.set('Maps/Anker/BM_Anker.png', { size: original.length, type: 'image/png' });
    picker.directories.add('Maps');
    picker.directories.add('Maps/Anker');
    const result = await harness.call('edit-map-image', {
      source_path: 'Maps/Anker/BM_Anker.png',
      instruction: 'Remove the spear leaning against the hearth.',
    });
    expect(result.isError, text(result)).toBeFalsy();
    const request = fake.sent[0] as SentRequest;
    expect(request.body.generationConfig.imageConfig.aspectRatio).toBe('1:1');
    const parts = request.body.contents[0]?.parts ?? [];
    expect(parts[0]?.inlineData?.mimeType).toBe('image/png');
    expect(parts.at(-1)?.text).toMatch(/^Edit the first attached image\..*Remove the spear/s);
    expect(picker.files.has('Maps/Anker/BM_Anker_edit.png')).toBe(true);
    expect(picker.files.get('Maps/Anker/BM_Anker.png')).toEqual({
      size: original.length,
      type: 'image/png',
    });
    expect(text(result)).toContain('Original, unchanged: Maps/Anker/BM_Anker.png');
  });

  it('sets the result as background of a scene only when asked', async () => {
    const original = png(2752, 1536);
    const { harness, foundry } = open({
      files: { 'Maps/Anker/BM_Anker.png': original },
    });
    await harness.query('createScene', {
      name: 'BM Anker',
      background: 'Maps/Anker/BM_Anker.png',
    });
    const result = await harness.call('edit-map-image', {
      source_scene: 'BM Anker',
      instruction: 'Make the window glass clear.',
      replace_scene_background: 'BM Anker',
    });
    expect(result.isError, text(result)).toBeFalsy();
    expect(text(result)).toContain('Scene "BM Anker" now shows Maps/Anker/BM_Anker_edit.png.');
    const scene = foundry.collection('Scene').contents[0];
    expect(JSON.stringify(scene?.toObject())).toContain('BM_Anker_edit.png');
  });

  it('needs exactly one source', async () => {
    const { harness, gemini: fake } = open();
    const result = await harness.call('edit-map-image', { instruction: 'x' });
    expect(text(result)).toMatch(/exactly one of source_path or source_scene/);
    expect(fake.sent).toHaveLength(0);
  });
});
