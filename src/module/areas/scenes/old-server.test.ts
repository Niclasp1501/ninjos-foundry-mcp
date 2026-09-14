/**
 * The new module answering a server of the previous generation: every scene
 * query under its old name, with the data fields that server sends, and the
 * answer fields it reads in the types it reads.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { FakeFoundry, type FakeFoundryOptions } from '../../../testing/fake-foundry.js';
import { MODULE_ID } from '../../../common/constants.js';
import { withScenes, type ScenesFakeOptions } from './testing.js';

let harness: AreaHarness | null = null;
afterEach(() => {
  harness?.close();
  harness = null;
});

function open(options: FakeFoundryOptions = {}, scenes: ScenesFakeOptions = {}): AreaHarness {
  const foundry = withScenes(new FakeFoundry(options), {
    media: { 'Maps/Kerker.webp': { width: 1500, height: 1000 } },
    ...scenes,
  });
  harness = createAreaHarness({ foundry });
  return harness;
}

type Answer = Record<string, any>;

describe('read queries for an old server', () => {
  it('getActiveScene without data gives every token and the flat fields', async () => {
    const h = open();
    const kai = h.foundry.seed('Scene', {
      name: 'Kai',
      active: true,
      width: 1000,
      height: 800,
      padding: 0.1,
      background: { src: 'Maps/Kerker.webp' },
    });
    h.foundry.seed('Token', { name: 'Wache', x: 1, y: 2, disposition: -1, actorId: 'a1' }, kai);
    h.foundry.seed('Token', { name: 'Dieb', x: 3, y: 4, hidden: true }, kai);
    h.foundry.seed('Note', { x: 5, y: 6, text: 'Tor' }, kai);

    const answer = (await h.query('getActiveScene', undefined)) as Answer;
    expect(answer).toMatchObject({
      id: kai.id,
      name: 'Kai',
      active: true,
      width: 1000,
      height: 800,
      padding: 0.1,
      navigation: false,
      walls: 0,
      lights: 0,
      sounds: 0,
    });
    expect(answer['background']).toBeTruthy();
    expect(answer['notes']).toEqual([{ id: expect.any(String), text: 'Tor', x: 5, y: 6 }]);
    expect(answer['tokens']).toHaveLength(2);
    for (const token of answer['tokens'])
      for (const key of [
        'id',
        'name',
        'x',
        'y',
        'width',
        'height',
        'actorId',
        'disposition',
        'hidden',
        'img',
      ])
        expect(token, key).toHaveProperty(key);
    expect(answer['tokens'].map((t: Answer) => [t['disposition'], t['hidden']])).toEqual([
      [-1, false],
      [0, true],
    ]);
  });

  it('list-scenes is a bare list with the old fields, listSceneFolders under folders', async () => {
    const h = open();
    const folder = h.foundry.seed('Folder', { name: 'Orte', type: 'Scene', folder: null });
    h.foundry.seed('Scene', {
      name: 'Kai',
      width: 10,
      height: 20,
      grid: { size: 50 },
      folder: folder.id,
    });
    const list = (await h.query('list-scenes', { include_active_only: false })) as Answer[];
    expect(Array.isArray(list)).toBe(true);
    expect(list[0]).toMatchObject({
      name: 'Kai',
      active: false,
      dimensions: { width: 10, height: 20 },
      gridSize: 50,
      background: null,
      walls: 0,
      tokens: 0,
      lighting: 0,
      sounds: 0,
      navigation: false,
    });
    const folders = (await h.query('listSceneFolders', undefined)) as Answer;
    expect(folders['folders']).toEqual([{ id: folder.id, path: 'Orte', scenes: 1 }]);
  });

  it('refuses a player with an error, never with a value an old server reads as success', async () => {
    const h = open({ users: [{ name: 'Spieler', isGM: false }] });
    await expect(h.query('getActiveScene', undefined)).rejects.toThrow();
  });
});

describe('create and restore for an old server', () => {
  it('createScene answers name, id, size, probed, template, folder and journal as texts', async () => {
    const h = open();
    h.foundry.seed('Scene', { name: 'Vorlage', width: 5, height: 5 });
    const journal = h.foundry.seed('JournalEntry', { name: 'Hafen' });
    const answer = (await h.query('createScene', {
      name: 'SC_Kerker',
      background: 'Maps/Kerker.webp',
      folderPath: 'Orte',
      templateName: 'Vorlage',
      journalIdentifier: 'Hafen',
    })) as Answer;
    expect(answer).toMatchObject({
      name: 'SC Kerker',
      id: expect.any(String),
      width: 1500,
      height: 1000,
      probed: true,
      template: 'Vorlage',
      folder: expect.any(String),
      journal: 'Hafen',
      journalId: journal.id,
    });
  });

  it('restoreScene answers name, id, width, height and contains', async () => {
    const h = open(
      {},
      { files: { 'Bergung/s.json': JSON.stringify([{ name: 'Alt', width: 7, height: 9 }]) } }
    );
    const answer = (await h.query('restoreScene', { jsonPath: 'Bergung/s.json' })) as Answer;
    expect(answer).toMatchObject({ name: 'Alt', id: expect.any(String), width: 7, height: 9 });
    expect(typeof answer['contains']).toBe('string');
  });
});

describe('update, note and thumbnail for an old server', () => {
  it('answers changed as a list, the note with scene and journal texts, and the thumbnail with scene', async () => {
    const h = open();
    h.foundry.seed('Scene', { name: 'Kai', width: 10, height: 10 });
    h.foundry.seed('JournalEntry', { name: 'Taverne' });
    const updated = (await h.query('updateScene', {
      sceneIdentifier: 'Kai',
      navigation: true,
    })) as Answer;
    expect(updated).toMatchObject({ name: 'Kai', changed: ['navigation'] });

    const note = (await h.query('createSceneNote', {
      sceneIdentifier: 'Kai',
      journalName: 'Taverne',
      x: 1,
      y: 2,
    })) as Answer;
    expect(note).toMatchObject({
      scene: 'Kai',
      journal: 'Taverne',
      x: 1,
      y: 2,
      id: expect.any(String),
    });

    const thumb = (await h.query('refreshSceneThumb', { sceneIdentifier: 'Kai' })) as Answer;
    expect(thumb).toMatchObject({ updated: true, scene: 'Kai' });
  });
});

describe('switch and delete for an old server', () => {
  it('switch-scene answers success, sceneId, sceneName, dimensions; deleteScene answers name', async () => {
    const h = open({ settings: { [`${MODULE_ID}.permScenes`]: 'full' } });
    const kai = h.foundry.seed('Scene', { name: 'Kai', width: 40, height: 30 });
    const alt = h.foundry.seed('Scene', { name: 'Alt', width: 1, height: 1 });
    const switched = (await h.query('switch-scene', {
      scene_identifier: 'kai',
      optimize_view: false,
    })) as Answer;
    expect(switched).toMatchObject({
      success: true,
      sceneId: kai.id,
      sceneName: 'Kai',
      dimensions: { width: 40, height: 30 },
    });
    await expect(h.query('deleteScene', { sceneId: alt.id })).resolves.toMatchObject({
      name: 'Alt',
    });
  });
});
