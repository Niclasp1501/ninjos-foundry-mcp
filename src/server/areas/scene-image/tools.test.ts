/**
 * get-scene-image from the tool registry to the module handler and back, and
 * the checks on what the module sends.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { withSceneImage } from '../../../module/areas/scene-image/testing.js';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { FakeFoundry } from '../../../testing/fake-foundry.js';
import { SERVER_AREAS } from '../index.js';
import { sceneImageResult } from './tools.js';

let harness: AreaHarness | null = null;
afterEach(() => {
  harness?.close();
  harness = null;
});

type Block = Record<string, unknown>;

function open(): AreaHarness {
  const foundry = new FakeFoundry();
  withSceneImage(foundry, { media: { 'maps/road.jpg': { width: 1000, height: 600 } } });
  const h = (harness = createAreaHarness({ foundry }));
  const scene = foundry.seed('Scene', {
    _id: 'road',
    name: 'Road',
    active: true,
    width: 1000,
    height: 600,
    grid: { type: 1, size: 50 },
    background: { src: 'maps/road.jpg' },
  });
  foundry.seed('Token', { _id: 'a', name: 'Wagon', x: 100, y: 100, width: 2, height: 1 }, scene);
  return h;
}

describe('get-scene-image', () => {
  it('returns a summary, one image block and the details without the image data', async () => {
    const result = await open().call('get-scene-image', { maxDimension: 500 });
    expect(result.isError).toBeUndefined();
    const content = result.content as unknown as Block[];
    expect(content.map(block => block['type'])).toEqual(['text', 'image', 'text']);
    expect(content[0]?.['text']).toMatch(
      /^Scene image of "Road" \[road\] via the composed path: 500 x 300 pixels/
    );
    expect(content[1]).toMatchObject({
      mimeType: 'image/jpeg',
      data: expect.stringMatching(/^A+$/),
    });
    const details = JSON.parse(String(content[2]?.['text'])) as Record<string, any>;
    expect(details['image']).not.toHaveProperty('data');
    expect(details['tokens'][0]).toMatchObject({ name: 'Wagon', cell: { column: 2, row: 2 } });
    expect(details['grid']).toMatchObject({ columns: 20, rows: 12 });
  });

  it('is offered read only in the scenes group', () => {
    const tool = SERVER_AREAS.flatMap(area => area.tools).find(t => t?.name === 'get-scene-image');
    expect(tool).toMatchObject({
      group: 'scenes',
      annotations: { readOnlyHint: true, destructiveHint: false },
    });
  });

  it('refuses arguments of the wrong type before asking the module', async () => {
    const result = await open().call('get-scene-image', { grid: 'yes' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('grid must be boolean');
  });

  it('passes the cause of a module error on', async () => {
    const result = await open().call('get-scene-image', { sceneIdentifier: 'Nowhere' });
    expect(result.content[0]?.text).toBe(
      'Error: Failed to get the scene image: Scene not found: "Nowhere".'
    );
  });

  it('says the module is too old when it lacks the query', async () => {
    const old = (harness = createAreaHarness({ foundry: new FakeFoundry(), moduleAreas: [] }));
    const refused = await old.call('get-scene-image', {});
    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text).toContain('does not know the query "getSceneImage"');
  });
});

describe('sceneImageResult', () => {
  const answer = (image: Record<string, unknown>) => ({
    scene: { id: 's', name: 'S' },
    path: 'canvas',
    image,
    tokens: [],
  });

  it('refuses an answer without a usable image', () => {
    expect(() => sceneImageResult({ scene: {} }, 1000)).toThrow('answered without an image');
    expect(() => sceneImageResult(answer({ data: 'QUJD', mimeType: 'image/png' }), 1000)).toThrow(
      'image type "image/png"'
    );
    expect(() => sceneImageResult(answer({ data: 'QUJDQUJD', mimeType: 'image/jpeg' }), 3)).toThrow(
      'sent 6 bytes, more than maxBytes 3'
    );
    expect(() => sceneImageResult({ success: false, error: 'Access denied' }, 10)).toThrow(
      'Failed to get the scene image: Access denied'
    );
  });
});
