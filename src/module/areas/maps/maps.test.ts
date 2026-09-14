/**
 * The module side of the maps area through the dispatcher: storing the image,
 * the scene, the settings the server reads, failure messages, the service
 * channel, and the answers to a server of the previous generation.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { UPLOAD_CHUNK_CHARS } from '../../../common/areas/maps/constants.js';
import { resolveAccess } from '../../../common/permissions.js';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { FakeFoundry } from '../../../testing/fake-foundry.js';
import { BridgeError } from '../../../server/bridge/foundry-bridge.js';
import { useServerRequests } from '../../core-services.js';
import { ServerRequestError } from '../../server-requests.js';
import { clearInterfaceServices } from '../interface/services.js';
import { mapService } from './channel.js';
import { MAP_SETTING_ROWS } from './queries.js';
import { createMapScene } from './scene.js';
import { withMaps, type FakeFilePicker, type MapsFakeOptions } from './testing.js';
import { clearUploads, pendingUploadCount } from './upload.js';

let harness: AreaHarness | null = null;
afterEach(() => {
  harness?.close();
  harness = null;
  clearUploads();
  clearInterfaceServices();
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
  uploadId = 'u1'
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

  it('accepts only PNG and JPEG', async () => {
    const { harness, picker } = open();
    const error = await refusal(
      upload(harness, Buffer.from('hello, this is text').toString('base64'))
    );
    expect(error).toMatchObject({
      moduleCode: 'UNSUPPORTED_IMAGE',
      message: 'Only PNG and JPEG images are supported',
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

  it('answers the single upload of a server of the previous generation', async () => {
    const { harness } = open();
    const answer = await harness.query('upload-generated-map', {
      filename: 'old-map.png',
      imageData: `data:image/png;base64,${png(200)}`,
    });
    expect(answer).toEqual({
      success: true,
      path: 'worlds/test-world/ai-generated-maps/old-map.png',
      message: 'Map uploaded successfully to worlds/test-world/ai-generated-maps/old-map.png',
    });
  });
});

describe('createMapScene', () => {
  const data = {
    jobId: 'j',
    name: 'Harbor',
    path: 'worlds/test-world/ai-generated-maps/harbor.png',
    width: 1536,
    height: 1536,
    gridSize: 70,
  };

  it('needs the right to change scenes only when it activates', () => {
    expect(resolveAccess(createMapScene.access, data)).toEqual([
      { kind: 'write', document: 'Scenes', action: 'create' },
    ]);
    expect(resolveAccess(createMapScene.access, { ...data, activate: true })).toEqual([
      { kind: 'write', document: 'Scenes', action: 'create' },
      { kind: 'write', document: 'Scenes', action: 'update' },
    ]);
  });

  it('creates the scene outside the folder, with a warning, when folders may not be created', async () => {
    const { harness, foundry } = open({ 'ninjos-foundry-mcp.permFolders': 'read' });
    const answer = (await harness.query('createMapScene', data)) as Record<string, unknown>;
    expect(answer).toMatchObject({ name: 'Harbor', activated: false, folderId: null });
    expect(answer['warnings']).toEqual(
      expect.arrayContaining([
        expect.stringContaining('The scene is not in the folder "AI Generated Maps": '),
      ])
    );
    expect(foundry.collection('Scene').contents).toHaveLength(1);
    expect(foundry.collection('Folder').contents).toHaveLength(0);
  });

  it('reuses the folder "AI Generated Maps" when it exists', async () => {
    const { harness, foundry } = open();
    const folder = foundry.seed('Folder', {
      name: 'ai generated maps',
      type: 'Scene',
      folder: null,
    });
    const answer = (await harness.query('createMapScene', data)) as Record<string, unknown>;
    expect(answer['folderId']).toBe(folder.id);
    expect(foundry.collection('Folder').contents).toHaveLength(1);
  });

  it('is refused as a whole where scenes may not be created', async () => {
    const { harness, foundry } = open({ 'ninjos-foundry-mcp.permScenes': 'read' });
    const error = await refusal(harness.query('createMapScene', data));
    expect(error).toMatchObject({ moduleCode: 'PERMISSION_DENIED' });
    expect(foundry.collection('Scene').contents).toHaveLength(0);
  });
});

describe('getMapSettings and mapJobFailed', () => {
  it('registers both settings outside the settings list and reports the stored quality', async () => {
    expect(MAP_SETTING_ROWS).toEqual([
      { key: 'mapGenAutoStart', kind: Boolean, initial: false, listed: false },
      {
        key: 'mapGenQuality',
        kind: String,
        initial: 'low',
        listed: false,
        options: ['low', 'medium', 'high'],
      },
    ]);
    const { harness } = open({ 'ninjos-foundry-mcp.mapGenQuality': 'medium' });
    await expect(harness.query('getMapSettings')).resolves.toEqual({
      protocol: 1,
      quality: 'medium',
      sceneProblem: null,
      notes: [],
      // The server reads mapGenAutoStart from here when the module introduces itself.
      autoStart: false,
    });
  });

  it('falls back to low for a damaged quality and says so', async () => {
    const { harness } = open({ 'ninjos-foundry-mcp.mapGenQuality': 'ultra' });
    await expect(harness.query('getMapSettings')).resolves.toMatchObject({
      quality: 'low',
      notes: ['The world setting mapGenQuality holds "ultra", which is no quality; "low" is used.'],
    });
  });

  it('tells the server why a map could not become a scene', async () => {
    const { harness } = open({ 'ninjos-foundry-mcp.allowWriteOperations': false });
    await expect(harness.query('getMapSettings')).resolves.toMatchObject({
      sceneProblem: expect.stringContaining('"Allow Write Operations" is off'),
    });
  });

  it('shows a failed job to the Gamemaster as an error', async () => {
    const { harness, foundry } = open();
    await harness.query('mapJobFailed', {
      jobId: 'j',
      name: 'Swamp',
      reason: 'ComfyUI installation not found',
    });
    expect(foundry.notifications).toEqual([
      {
        level: 'error',
        message: 'The map Swamp could not be made: ComfyUI installation not found',
      },
    ]);
  });

  it('tells a server of the previous generation that it has to be updated for maps', async () => {
    const { harness } = open();
    for (const name of ['generate-map', 'check-map-status', 'cancel-map-job']) {
      const error = await refusal(harness.query(name, { job_id: 'x' }));
      expect(error).toMatchObject({
        moduleCode: 'SERVER_TOO_OLD',
        message: expect.stringContaining('Update the MCP server'),
      });
    }
  });
});

describe('the map service over requests', () => {
  function answering(reply: (method: string, data: unknown) => Promise<unknown>) {
    const sent: Array<{ method: string; data: unknown; timeoutMs?: number }> = [];
    useServerRequests({
      available: () => true,
      request: (method, data, options) => {
        sent.push({ method, data, ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}) });
        return reply(method, data);
      },
    });
    return sent;
  }

  it('asks the server once per click, with the time limit of the action, and passes the report on', async () => {
    open();
    const sent = answering(async () => ({ state: 'running', alreadyRunning: true, detail: 'ok' }));
    await expect(mapService.start()).resolves.toEqual({
      state: 'running',
      alreadyRunning: true,
      detail: 'ok',
    });
    expect(sent).toEqual([{ method: 'mapService', data: { action: 'start' }, timeoutMs: 150_000 }]);
  });

  it('shows disabled as the server reports it', async () => {
    open();
    answering(async () => ({ state: 'disabled', detail: 'COMFYUI_ENABLED is not true' }));
    await expect(mapService.status()).resolves.toEqual({
      state: 'disabled',
      detail: 'COMFYUI_ENABLED is not true',
    });
  });

  it('turns a missing bridge, a timeout, a refusal of the server and an unreadable answer into reasons', async () => {
    open();
    answering(async () => {
      throw new ServerRequestError('NOT_CONNECTED', 'no bridge');
    });
    await expect(mapService.status()).rejects.toMatchObject({ code: 'BRIDGE_MISSING' });
    answering(async () => {
      throw new ServerRequestError('TIMEOUT', 'too slow');
    });
    await expect(mapService.stop()).rejects.toMatchObject({
      code: 'FAILED',
      message: 'The MCP server did not answer within 20 seconds.',
    });
    answering(async () => {
      throw new ServerRequestError(
        'NOT_OWN_PROCESS',
        'ComfyUI on http://127.0.0.1:31411 was not started by this server'
      );
    });
    await expect(mapService.stop()).rejects.toMatchObject({
      code: 'FAILED',
      message: expect.stringContaining('was not started by this server'),
    });
    answering(async () => ({ state: 'sleeping' }));
    await expect(mapService.status()).rejects.toThrow('sent no readable state');
  });

  it('reports mapGenAutoStart to the server with the other map settings', async () => {
    const on = open({ 'ninjos-foundry-mcp.mapGenAutoStart': true });
    await expect(on.harness.query('getMapSettings', {})).resolves.toMatchObject({
      autoStart: true,
    });
    on.harness.close();
    const off = open();
    await expect(off.harness.query('getMapSettings', {})).resolves.toMatchObject({
      autoStart: false,
    });
  });
});
