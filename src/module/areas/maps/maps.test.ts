/**
 * The module side of the maps area through the dispatcher: storing a
 * generated image, reading images as references, and drawing previews.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { UPLOAD_CHUNK_CHARS } from '../../../common/areas/maps/constants.js';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { FakeFoundry } from '../../../testing/fake-foundry.js';
import { BridgeError } from '../../../server/bridge/foundry-bridge.js';
import { useImageTools, type ImageTools } from './read.js';
import { withMaps, type FakeFilePicker, type MapsFakeOptions } from './testing.js';
import { clearUploads, pendingUploadCount } from './upload.js';

let harness: AreaHarness | null = null;
afterEach(() => {
  harness?.close();
  harness = null;
  clearUploads();
  useImageTools();
});

function open(
  settings: Record<string, unknown> = {},
  options: MapsFakeOptions = {}
): { harness: AreaHarness; picker: FakeFilePicker; foundry: FakeFoundry } {
  const foundry = new FakeFoundry({ settings });
  const { picker } = withMaps(foundry, options);
  harness = createAreaHarness({ foundry });
  return { harness, picker, foundry };
}

function png(length: number): string {
  const bytes = Buffer.alloc(length, 7);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  return bytes.toString('base64');
}

async function upload(
  h: AreaHarness,
  base64: string,
  filename = 'Harbor-map-1.png',
  uploadId = 'u1',
  directory?: string
) {
  const total = Math.ceil(base64.length / UPLOAD_CHUNK_CHARS);
  let answer: unknown;
  for (let index = 0; index < total; index += 1) {
    answer = await h.query('uploadMapChunk', {
      uploadId,
      filename,
      index,
      total,
      data: base64.slice(index * UPLOAD_CHUNK_CHARS, (index + 1) * UPLOAD_CHUNK_CHARS),
      ...(directory ? { directory } : {}),
    });
  }
  return answer;
}

const refusal = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: BridgeError) => error
  );

describe('uploadMapChunk', () => {
  it('puts the pieces together and stores the image in the folder of the world, read back', async () => {
    const { harness, picker } = open();
    const answer = await upload(harness, png(600_000));
    expect(answer).toEqual({
      path: 'worlds/test-world/ai-generated-maps/Harbor-map-1.png',
      bytes: 600_000,
    });
    expect(picker.files.get('worlds/test-world/ai-generated-maps/Harbor-map-1.png')).toEqual({
      size: 600_000,
      type: 'image/png',
    });
    expect(picker.directories.has('worlds/test-world/ai-generated-maps')).toBe(true);
    expect(pendingUploadCount()).toBe(0);
  });

  it('lets no path through the file name', async () => {
    const { harness, picker } = open();
    const answer = await upload(harness, png(100), '../../evil/..\\name.png');
    expect(answer).toMatchObject({
      path: 'worlds/test-world/ai-generated-maps/_.._evil_.._name.png',
    });
    expect(
      [...picker.files.keys()].every(path =>
        path.startsWith('worlds/test-world/ai-generated-maps/')
      )
    ).toBe(true);
  });

  it('accepts only PNG, JPEG and WebP', async () => {
    const { harness, picker } = open();
    const error = await refusal(
      upload(harness, Buffer.from('hello, this is text').toString('base64'))
    );
    expect(error).toMatchObject({
      moduleCode: 'UNSUPPORTED_IMAGE',
      message: 'Only PNG, JPEG and WebP images are supported',
    });
    expect(picker.uploads).toBe(0);
  });

  it('names missing pieces instead of storing half an image', async () => {
    const { harness, picker } = open();
    const data = png(600_000);
    const error = await refusal(
      harness.query('uploadMapChunk', {
        uploadId: 'u2',
        filename: 'a.png',
        index: 2,
        total: 3,
        data: data.slice(0, 100),
      })
    );
    expect(error).toMatchObject({
      moduleCode: 'INCOMPLETE',
      message: 'The upload u2 is missing the pieces 0, 1',
    });
    expect(picker.uploads).toBe(0);
  });

  it('is refused where scenes may not be created, before a byte is stored', async () => {
    const { harness, picker } = open({ 'ninjos-foundry-mcp.permScenes': 'read' });
    const error = await refusal(upload(harness, png(100)));
    expect(error).toMatchObject({ moduleCode: 'PERMISSION_DENIED' });
    expect(picker.uploads).toBe(0);
  });

  it("checks Foundry's own permission to upload files", async () => {
    const { harness, foundry, picker } = open();
    (foundry.game.user as unknown as { can: (permission: string) => boolean }).can = permission =>
      permission !== 'FILES_UPLOAD';
    const error = await refusal(upload(harness, png(100)));
    expect(error).toMatchObject({
      moduleCode: 'PERMISSION_DENIED',
      message: expect.stringContaining('Upload New Files'),
    });
    expect(picker.uploads).toBe(0);
  });

  it('reports an upload Foundry confirmed but did not store', async () => {
    const { harness } = open({}, { uploadLoses: true });
    const error = await refusal(upload(harness, png(100)));
    expect(error).toMatchObject({ moduleCode: 'NOT_STORED' });
  });

  it('stores into the folder the call names, creating every missing level, with letters of any language', async () => {
    const { harness, picker } = open();
    const answer = await upload(harness, png(300), 'BM_Anker.png', 'u3', 'Maps/Grünau/Zum Anker');
    expect(answer).toEqual({
      path: 'Maps/Grünau/Zum Anker/BM_Anker.png',
      bytes: 300,
    });
    for (const level of ['Maps', 'Maps/Grünau', 'Maps/Grünau/Zum Anker'])
      expect(picker.directories.has(level), level).toBe(true);
  });

  it('never replaces an existing file, it numbers the new one', async () => {
    const { harness, picker } = open();
    await upload(harness, png(100), 'BM_Hafen.png', 'a', 'Maps/Hafen');
    await upload(harness, png(200), 'BM_Hafen.png', 'b', 'Maps/Hafen');
    const third = await upload(harness, png(300), 'BM_Hafen.png', 'c', 'Maps/Hafen');
    expect(third).toMatchObject({ path: 'Maps/Hafen/BM_Hafen-3.png' });
    expect(picker.files.get('Maps/Hafen/BM_Hafen.png')).toMatchObject({ size: 100 });
    expect(picker.files.get('Maps/Hafen/BM_Hafen-2.png')).toMatchObject({ size: 200 });
  });

  it('refuses a folder outside the data folder before anything is stored', async () => {
    const { harness, picker } = open();
    for (const directory of ['../outside', '/etc', 'C:/Windows', 'Maps/../..', 'Maps/a:b']) {
      const error = await refusal(
        upload(harness, png(100), 'x.png', `bad-${directory}`, directory)
      );
      expect(error, directory).toMatchObject({ moduleCode: 'INVALID_ARGUMENT' });
    }
    expect(picker.uploads).toBe(0);
  });
});

function fakeTools(
  files: Record<string, Uint8Array>,
  sizes: Record<string, [number, number]> = {}
): string[] {
  const seen: string[] = [];
  const tools: ImageTools = {
    async fetchBytes(url) {
      seen.push(url);
      const bytes = files[decodeURI(url)];
      return bytes
        ? { ok: true, status: 200, bytes }
        : { ok: false, status: 404, bytes: new Uint8Array() };
    },
    async loadPicture(url) {
      seen.push(url);
      const size = sizes[decodeURI(url)];
      if (!size) throw new Error('the image could not be loaded');
      return {
        width: size[0],
        height: size[1],
        toJpegDataUrl: (width, height) =>
          `data:image/jpeg;base64,${Buffer.from(`${width}x${height}`).toString('base64')}`,
      };
    },
  };
  useImageTools(tools);
  return seen;
}

function jpegBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length).fill(1);
  bytes.set([0xff, 0xd8, 0xff]);
  return bytes;
}

describe('readMapImage', () => {
  it('reads an image of the data folder as base64 with its type', async () => {
    const { harness } = open();
    const seen = fakeTools({ 'Maps/Hafen Nacht.jpg': jpegBytes(50) });
    const answer = await harness.query('readMapImage', { path: 'Maps/Hafen Nacht.jpg' });
    expect(answer).toMatchObject({
      path: 'Maps/Hafen Nacht.jpg',
      mimeType: 'image/jpeg',
      bytes: 50,
    });
    expect(Buffer.from((answer as { data: string }).data, 'base64')).toHaveLength(50);
    expect(seen).toEqual(['Maps/Hafen%20Nacht.jpg']);
  });

  it('reads the background of a scene from its level', async () => {
    const { harness } = open(
      {},
      { media: { 'Maps/Anker Innen.jpg': { width: 1376, height: 768 } } }
    );
    fakeTools({ 'Maps/Anker Innen.jpg': jpegBytes(20) });
    await harness.query('createScene', {
      name: 'Anker Innen',
      background: 'Maps/Anker Innen.jpg',
    });
    const answer = await harness.query('readMapImage', { scene: 'Anker Innen' });
    expect(answer).toMatchObject({
      path: 'Maps/Anker Innen.jpg',
      scene: 'Anker Innen',
      mimeType: 'image/jpeg',
    });
  });

  it('refuses paths outside the data folder, URLs and files that are no image', async () => {
    const { harness } = open();
    fakeTools({ 'notes.txt': new TextEncoder().encode('just text') });
    for (const path of ['../secret.png', 'https://example.com/a.png', '/../../x.jpg'])
      expect(await refusal(harness.query('readMapImage', { path })), path).toMatchObject({
        moduleCode: 'INVALID_ARGUMENT',
      });
    expect(await refusal(harness.query('readMapImage', { path: 'notes.txt' }))).toMatchObject({
      moduleCode: 'UNSUPPORTED_IMAGE',
    });
    expect(await refusal(harness.query('readMapImage', { path: 'Maps/none.png' }))).toMatchObject({
      moduleCode: 'FILE_NOT_FOUND',
    });
    expect(await refusal(harness.query('readMapImage', {}))).toMatchObject({
      moduleCode: 'INVALID_ARGUMENT',
      message: 'Give exactly one of path or scene',
    });
  });
});

describe('previewMapImage', () => {
  it('draws the image with its longest edge at 1024 pixels as JPEG', async () => {
    const { harness } = open();
    fakeTools({}, { 'Maps/BM_Hafen.jpg': [2752, 1536] });
    const answer = await harness.query('previewMapImage', { path: 'Maps/BM_Hafen.jpg' });
    expect(answer).toMatchObject({
      mimeType: 'image/jpeg',
      width: 1024,
      height: 572,
      originalWidth: 2752,
      originalHeight: 1536,
    });
    expect(Buffer.from((answer as { data: string }).data, 'base64').toString()).toBe('1024x572');
  });

  it('never enlarges a small image', async () => {
    const { harness } = open();
    fakeTools({}, { 'small.png': [300, 200] });
    expect(await harness.query('previewMapImage', { path: 'small.png' })).toMatchObject({
      width: 300,
      height: 200,
    });
  });
});
