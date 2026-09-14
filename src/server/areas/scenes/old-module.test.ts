/**
 * The new server with a module of the previous generation: a fake old module
 * answers with the documented shapes, and the tools
 * turn them into text, "Access denied" into a tool error, and a missing query
 * into a clear message.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import type { ModuleArea } from '../../../module/areas.js';
import type { QueryHandler } from '../../../module/dispatcher.js';

let harness: AreaHarness | null = null;
afterEach(() => {
  harness?.close();
  harness = null;
});

const answer = (value: unknown): QueryHandler => ({ access: { kind: 'read' }, run: () => value });

const OLD_ANSWERS: Record<string, unknown> = {
  getActiveScene: {
    id: 's1',
    name: 'Kai',
    active: true,
    width: 1000,
    height: 800,
    padding: 0.1,
    background: 'Maps/Kai.webp',
    navigation: true,
    walls: 3,
    lights: 2,
    sounds: 1,
    notes: [{ id: 'n1', text: 'Tor', x: 5, y: 6 }],
    tokens: [
      {
        id: 't1',
        name: 'Wache',
        x: 1,
        y: 2,
        width: 1,
        height: 1,
        actorId: 'a1',
        disposition: -1,
        hidden: false,
        img: 'w.webp',
      },
      {
        id: 't2',
        name: 'Dieb',
        x: 3,
        y: 4,
        width: 1,
        height: 1,
        actorId: null,
        disposition: 0,
        hidden: true,
        img: 'd.webp',
      },
    ],
  },
  'list-scenes': [
    {
      id: 's1',
      name: 'Kai',
      active: true,
      dimensions: { width: 1000, height: 800 },
      gridSize: 100,
      background: 'Maps/Kai.webp',
      walls: 3,
      tokens: 2,
      lighting: 2,
      sounds: 1,
      navigation: true,
    },
  ],
  listSceneFolders: { folders: [{ path: 'Orte/Hafen', scenes: 2, id: 'f1' }] },
  'switch-scene': {
    success: true,
    sceneId: 's1',
    sceneName: 'Kai',
    dimensions: { width: 1000, height: 800 },
  },
  createScene: {
    name: 'Kai',
    id: 's2',
    width: 3000,
    height: 2000,
    probed: true,
    template: 'Vorlage',
    folder: 'f1',
    journal: 'Hafen',
    levelPatched: true,
  },
  updateScene: { name: 'Kai', changed: ['name', 'navigation'] },
  restoreScene: { name: 'Alt', id: 's3', width: 7, height: 9, contains: '12 walls, 3 tiles' },
  deleteScene: { name: 'Kai' },
  createSceneNote: { scene: 'Kai', journal: 'Taverne', x: 1, y: 2, id: 'n2' },
};

function oldModule(overrides: Record<string, QueryHandler | null> = {}): ModuleArea {
  const handlers: Record<string, QueryHandler | null> = {
    ...Object.fromEntries(
      Object.entries(OLD_ANSWERS).map(([name, value]) => [name, answer(value)])
    ),
    refreshSceneThumb: answer({ updated: false, scene: 'Kai' }),
    ...overrides,
  };
  return {
    id: 'old-scenes',
    queries: Object.entries(handlers)
      .filter((entry): entry is [string, QueryHandler] => entry[1] !== null)
      .map(([names, handler]) => ({ names, handler })),
    settings: [],
  };
}

function open(overrides: Record<string, QueryHandler | null> = {}): AreaHarness {
  harness = createAreaHarness({ moduleAreas: [oldModule(overrides)] });
  return harness;
}

const text = (result: { content: Array<{ text?: string }> }) => result.content[0]?.text ?? '';

describe('read tools with an old module', () => {
  it('get-current-scene builds the described result and filters hidden tokens itself', async () => {
    const result = JSON.parse(text(await open().call('get-current-scene', {})));
    expect(result).toMatchObject({
      id: 's1',
      dimensions: { width: 1000, height: 800, padding: 0.1 },
      hasBackground: true,
      navigation: true,
      elements: { walls: 3, lights: 2, sounds: 1, notes: 1 },
      tokenSummary: { shown: 1, hidden: 0, hiddenNotShown: 1, withActor: 1 },
    });
    expect(result.tokens.map((t: { name: string }) => t.name)).toEqual(['Wache']);
  });

  it('list-scenes and list-scene-folders become text lines', async () => {
    const h = open();
    expect(text(await h.call('list-scenes', {}))).toBe(
      '1 scene:\n"Kai" [s1]: 1000 x 800, grid 100, active, in navigation, 3 walls, 2 tokens, 2 lights, 1 sounds, background Maps/Kai.webp'
    );
    expect(text(await h.call('list-scene-folders', {}))).toBe('Orte/Hafen (2 scenes, id f1)');
  });

  it('turns "Access denied" sent as a value into a tool error with the cause', async () => {
    const result = await open({
      listSceneFolders: answer({ error: 'Access denied', success: false }),
    }).call('list-scene-folders', {});
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Access denied');
    expect(text(result)).toContain('not a Gamemaster');
  });
});

describe('create and restore with an old module', () => {
  it('formats the old createScene and restoreScene answers', async () => {
    const h = open();
    expect(
      text(await h.call('create-scene', { name: 'Kai', background: 'Maps/Kai.webp' })).split('\n')
    ).toEqual([
      'Scene created: Kai',
      'Id: s2',
      'Size: 3000 x 2000 (measured from the file)',
      'Template: "Vorlage"',
      'Folder id: f1',
      'Journal: "Hafen"',
      'Level patched: yes',
    ]);
    expect(text(await h.call('restore-scene', { jsonPath: 'Bergung/s.json' }))).toBe(
      'Scene restored: Alt\nId: s3\nSize: 7 x 9\nCame along: 12 walls, 3 tiles'
    );
  });
});

describe('update, note and thumbnail with an old module', () => {
  it('formats the answers and reports a thumbnail that was not generated as an error', async () => {
    const h = open();
    expect(text(await h.call('update-scene', { sceneIdentifier: 'Kai', name: 'Kai' }))).toBe(
      'Scene "Kai" changed (name, navigation)'
    );
    expect(
      text(
        await h.call('create-scene-note', {
          sceneIdentifier: 'Kai',
          journalName: 'Taverne',
          x: 1,
          y: 2,
        })
      )
    ).toBe('Note placed on "Kai": "Taverne" at 1/2\nNote id: n2');
    const thumb = await h.call('refresh-scene-thumb', { sceneIdentifier: 'Kai' });
    expect(thumb.isError).toBe(true);
    expect(text(thumb)).toBe('Error: Thumbnail of "Kai" could not be generated.');
  });

  it('says clearly when the module lacks a query', async () => {
    const result = await open({ refreshSceneThumb: null }).call('refresh-scene-thumb', {
      sceneIdentifier: 'Kai',
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('does not answer the query refreshSceneThumb');
    expect(text(result)).toContain('No handler found');
  });
});

describe('switch and delete with an old module', () => {
  it('formats the switch and the deletion', async () => {
    const h = open();
    expect(text(await h.call('switch-scene', { scene_identifier: 'Kai' }))).toBe(
      'Scene "Kai" is now active for everyone (id s1, 1000 x 800).'
    );
    expect(text(await h.call('delete-scene', { sceneId: 's1' }))).toBe('Scene "Kai" deleted.');
  });

  it('turns an old failure value of switch-scene into a tool error', async () => {
    const result = await open({
      'switch-scene': answer({ success: false, error: 'Scene not found' }),
    }).call('switch-scene', { scene_identifier: 'x' });
    expect(result.isError).toBe(true);
    expect(text(result)).toBe('Error: Scene not found');
  });
});
