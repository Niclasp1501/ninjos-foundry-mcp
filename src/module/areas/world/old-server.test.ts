/**
 * This module answering a server of the previous generation: the queries of
 * the world area, with the data that server sends, and the answer
 * fields it reads, in the types it expects.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { MODULE_ID } from '../../../common/constants.js';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { FakeFoundry, type FakeFoundryOptions } from '../../../testing/fake-foundry.js';

let harness: AreaHarness | null = null;
afterEach(() => {
  harness?.close();
  harness = null;
});

const open = (options: FakeFoundryOptions = {}) =>
  (harness = createAreaHarness({ foundry: new FakeFoundry(options) }));

type Row = Record<string, unknown>;

describe('permissions for a previous generation server', () => {
  it('getPermissions without data has writeOperationsEnabled and permissions with label and level', async () => {
    const answer = (await open({
      settings: { [`${MODULE_ID}.permPlaylists`]: 'full' },
    }).query('getPermissions', undefined)) as Row;
    expect(typeof answer['writeOperationsEnabled']).toBe('boolean');
    const rows = answer['permissions'] as Row[];
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(7);
    for (const row of rows) {
      expect(typeof row['label']).toBe('string');
      expect(['read', 'write', 'full']).toContain(row['level']);
    }
    expect(rows.find(row => row['kind'] === 'permPlaylists')).toMatchObject({
      level: 'full',
      canDelete: true,
    });
  });
});

describe('playlists for a previous generation server', () => {
  function world(options: FakeFoundryOptions = {}) {
    const h = open(options);
    h.foundry.seed('Playlist', {
      _id: 'tavern',
      name: 'Tavern',
      sounds: [{ _id: 'lute', name: 'Lute' }],
    });
    h.foundry.seed('Playlist', { _id: 'battle', name: 'Battle', sounds: [] });
    h.foundry.seed('Scene', { _id: 'harbour', name: 'Harbour', playlist: null });
    return h;
  }

  it('listPlaylists includes the sounds unless includeSounds is false', async () => {
    const h = world();
    const answer = (await h.query('listPlaylists', {})) as { playlists: Row[] };
    expect(answer.playlists[0]).toMatchObject({
      name: 'Tavern',
      id: 'tavern',
      soundCount: 1,
      sounds: [{ name: 'Lute', id: 'lute' }],
    });
    const lean = (await h.query('listPlaylists', { includeSounds: false })) as {
      playlists: Row[];
    };
    expect(lean.playlists[0]).not.toHaveProperty('sounds');
  });

  it('setScenePlaylist answers scene, playlist and sound as texts', async () => {
    const h = world();
    await expect(
      h.query('setScenePlaylist', {
        sceneIdentifier: 'Harbour',
        playlistName: 'Tavern',
        soundName: 'Lute',
      })
    ).resolves.toMatchObject({ scene: 'Harbour', playlist: 'Tavern', sound: 'Lute' });
  });

  it('setScenePlaylist with null names removes the link and answers an empty playlist', async () => {
    const h = world();
    await expect(
      h.query('setScenePlaylist', {
        sceneIdentifier: 'Harbour',
        playlistName: null,
        soundName: null,
      })
    ).resolves.toMatchObject({ scene: 'Harbour', playlist: '', sound: '' });
  });

  it('a refusal is an error, never an answer the old server would read as "link removed"', async () => {
    const h = world({ settings: { [`${MODULE_ID}.permScenes`]: 'read' } });
    await expect(
      h.query('setScenePlaylist', { sceneIdentifier: 'Harbour', playlistName: 'Tavern' })
    ).rejects.toMatchObject({ moduleCode: 'PERMISSION_DENIED' });
  });

  it('deletePlaylist answers the name', async () => {
    const h = world({ settings: { [`${MODULE_ID}.permPlaylists`]: 'full' } });
    await expect(h.query('deletePlaylist', { playlistId: 'battle' })).resolves.toMatchObject({
      name: 'Battle',
    });
  });
});

describe('roll tables for a previous generation server', () => {
  it('createRollTable reads results[].text and answers name, formula, resultCount and id', async () => {
    const h = open();
    const answer = (await h.query('createRollTable', {
      name: 'Loot',
      description: 'What the chest holds',
      folderPath: 'Treasure/Chests',
      results: [{ text: 'gold', range: [1, 3] }, { text: 'gem', weight: 2 }, { text: 'nothing' }],
    })) as Row;
    expect(typeof answer['name']).toBe('string');
    expect(answer['formula']).toBe('1d5');
    expect(answer['resultCount']).toBe(3);
    expect(typeof answer['id']).toBe('string');

    const table = h.foundry.collection('RollTable').get(String(answer['id']));
    expect(table).toMatchObject({
      description: 'What the chest holds',
      replacement: true,
      displayRoll: true,
    });
    const results = table?.getEmbeddedCollection('TableResult').contents ?? [];
    expect(
      results.map(r => [r['text'], r['description'], r['range'], r['weight'], r['sort']])
    ).toEqual([
      ['gold', 'gold', [1, 3], 1, 100],
      ['gem', 'gem', [4, 4], 2, 200],
      ['nothing', 'nothing', [5, 5], 1, 300],
    ]);

    for (const name of ['Treasure', 'Chests']) {
      const folder = h.foundry
        .collection('Folder')
        .contents.find(entry => entry['name'] === name) as Row | undefined;
      const flags = (folder?.['flags'] as Record<string, Row>)[MODULE_ID];
      expect(flags).toMatchObject({ createdByMcp: true, mcpGenerated: true });
      expect(Date.parse(String(flags?.['createdAt']))).not.toBeNaN();
    }
  });

  it('listRollTables answers tables with name, formula, resultCount and id', async () => {
    const h = open();
    h.foundry.seed('RollTable', {
      _id: 't1',
      name: 'Weather',
      formula: '1d2',
      results: [{ range: [1, 1] }, { range: [2, 2] }],
    });
    const answer = (await h.query('listRollTables', undefined)) as { tables: Row[] };
    expect(answer.tables).toEqual([
      expect.objectContaining({ name: 'Weather', formula: '1d2', resultCount: 2, id: 't1' }),
    ]);
  });

  it('deleteRollTable answers the name', async () => {
    const h = open({ settings: { [`${MODULE_ID}.permRollTables`]: 'full' } });
    h.foundry.seed('RollTable', { _id: 't1', name: 'Weather', results: [] });
    await expect(h.query('deleteRollTable', { tableId: 't1' })).resolves.toMatchObject({
      name: 'Weather',
    });
  });
});
