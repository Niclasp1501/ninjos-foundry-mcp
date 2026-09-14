import { afterEach, describe, expect, it } from 'vitest';
import { MODULE_ID } from '../../../common/constants.js';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { FakeFoundry, type FakeFoundryOptions } from '../../../testing/fake-foundry.js';

let harness: AreaHarness | null = null;
afterEach(() => {
  harness?.close();
  harness = null;
});

function world(options: FakeFoundryOptions = {}) {
  const h = (harness = createAreaHarness({ foundry: new FakeFoundry(options) }));
  const folder = h.foundry.seed('Folder', { _id: 'folder1', name: 'Music', type: 'Playlist' });
  const tavern = h.foundry.seed('Playlist', {
    _id: 'tavern',
    name: 'Tavern',
    mode: 1,
    playing: true,
    folder: folder.id,
    sounds: [
      { _id: 'lute', name: 'Lute', path: 'music/lute.ogg', repeat: true, volume: 0.5 },
      { _id: 'rain', name: 'Rain', path: 'music/rain.ogg', repeat: false, volume: 0.8 },
      { _id: 'rainh', name: 'Rain heavy', path: 'music/rain2.ogg', repeat: false, volume: 0.8 },
    ],
  });
  h.foundry.seed('Playlist', { _id: 'battle', name: 'Battle', mode: 0, sounds: [] });
  const harbour = h.foundry.seed('Scene', { _id: 'harbour', name: 'Harbour', playlist: null });
  return { h, tavern, harbour };
}

describe('listPlaylists', () => {
  it('lists playlists with folder, mode and sounds', async () => {
    const { h } = world();
    const answer = (await h.query('listPlaylists', {})) as { playlists: unknown[] };
    expect(answer.playlists[0]).toEqual({
      id: 'tavern',
      name: 'Tavern',
      mode: 'shuffle',
      playing: true,
      folder: 'Music',
      soundCount: 3,
      sounds: [
        { id: 'lute', name: 'Lute', path: 'music/lute.ogg', repeat: true, volume: 0.5 },
        { id: 'rain', name: 'Rain', path: 'music/rain.ogg', repeat: false, volume: 0.8 },
        { id: 'rainh', name: 'Rain heavy', path: 'music/rain2.ogg', repeat: false, volume: 0.8 },
      ],
    });
  });

  it('leaves the sounds out on request', async () => {
    const { h } = world();
    const answer = (await h.query('listPlaylists', { includeSounds: false })) as {
      playlists: Array<Record<string, unknown>>;
    };
    expect(answer.playlists[0]).not.toHaveProperty('sounds');
    expect(answer.playlists[0]).toHaveProperty('soundCount', 3);
  });
});

describe('setScenePlaylist', () => {
  it('links a playlist and a track by name, reads it back and logs the change', async () => {
    const { h, harbour } = world();
    const answer = await h.query('setScenePlaylist', {
      sceneIdentifier: 'Harbour',
      playlistName: 'Tavern',
      soundName: 'Lute',
    });
    expect(answer).toMatchObject({ removed: false, playlistId: 'tavern', soundId: 'lute' });
    expect(harbour['playlist']).toBe('tavern');
    expect(harbour['playlistSound']).toBe('lute');
    expect(h.changeLog.list()[0]).toMatchObject({
      document: 'Scenes',
      action: 'update',
      before: { playlist: null, playlistSound: null },
      undoable: true,
    });
  });

  it('removes the link with an empty playlist name, track included', async () => {
    const { h, harbour } = world();
    harbour['playlist'] = 'tavern';
    harbour['playlistSound'] = 'lute';
    const answer = await h.query('setScenePlaylist', {
      sceneIdentifier: 'harbour',
      playlistName: '',
    });
    expect(answer).toMatchObject({ removed: true, hadLink: true });
    expect(harbour['playlist']).toBeNull();
    expect(harbour['playlistSound']).toBeNull();
  });

  it('refuses a track without a playlist instead of ignoring it', async () => {
    const { h } = world();
    await expect(
      h.query('setScenePlaylist', { sceneIdentifier: 'Harbour', soundName: 'Lute' })
    ).rejects.toMatchObject({ moduleCode: 'INVALID_ARGUMENTS' });
    expect(h.foundry.operations).toEqual([]);
  });

  it('names the playlists of the world when one is missing', async () => {
    const { h } = world();
    await expect(
      h.query('setScenePlaylist', { sceneIdentifier: 'Harbour', playlistName: 'Forest' })
    ).rejects.toThrow(/Playlist "Forest" not found.*"Tavern", "Battle".*import-from-compendium/);
  });

  it('reports an unknown scene', async () => {
    const { h } = world();
    await expect(
      h.query('setScenePlaylist', { sceneIdentifier: 'Nowhere', playlistName: 'Tavern' })
    ).rejects.toThrow('Scene "Nowhere" not found');
  });

  it('matches a track by a unique part of its name, and reports an ambiguous one', async () => {
    const { h } = world();
    await expect(
      h.query('setScenePlaylist', {
        sceneIdentifier: 'Harbour',
        playlistName: 'Tavern',
        soundName: 'heavy',
      })
    ).resolves.toMatchObject({ soundId: 'rainh' });
    // "Rain" is an exact name and wins over the partial match "Rain heavy".
    await expect(
      h.query('setScenePlaylist', {
        sceneIdentifier: 'Harbour',
        playlistName: 'Tavern',
        soundName: 'rain',
      })
    ).resolves.toMatchObject({ soundId: 'rain' });
    await expect(
      h.query('setScenePlaylist', {
        sceneIdentifier: 'Harbour',
        playlistName: 'Tavern',
        soundName: 'ai',
      })
    ).rejects.toMatchObject({ moduleCode: 'AMBIGUOUS' });
    await expect(
      h.query('setScenePlaylist', {
        sceneIdentifier: 'Harbour',
        playlistName: 'Tavern',
        soundName: 'Drums',
      })
    ).rejects.toThrow(/Track "Drums" not found.*"Lute" \(id lute\)/);
  });

  it('refuses two scenes with the same name', async () => {
    const { h } = world();
    h.foundry.seed('Scene', { _id: 'harbour2', name: 'Harbour' });
    await expect(
      h.query('setScenePlaylist', { sceneIdentifier: 'Harbour', playlistName: 'Tavern' })
    ).rejects.toThrow(/2 scenes are named "Harbour".*id harbour2/);
  });

  it('is held by the switch and by the scene level', async () => {
    const off = world({ settings: { [`${MODULE_ID}.allowWriteOperations`]: false } });
    await expect(
      off.h.query('setScenePlaylist', { sceneIdentifier: 'Harbour', playlistName: 'Tavern' })
    ).rejects.toMatchObject({ moduleCode: 'WRITE_DISABLED' });
    off.h.close();
    const read = world({ settings: { [`${MODULE_ID}.permScenes`]: 'read' } });
    await expect(
      read.h.query('setScenePlaylist', { sceneIdentifier: 'Harbour', playlistName: 'Tavern' })
    ).rejects.toMatchObject({ moduleCode: 'PERMISSION_DENIED' });
  });

  it('fails when reading back shows a different link', async () => {
    const { h, harbour } = world();
    harbour['update'] = async () => harbour;
    await expect(
      h.query('setScenePlaylist', { sceneIdentifier: 'Harbour', playlistName: 'Tavern' })
    ).rejects.toMatchObject({ moduleCode: 'NOT_APPLIED' });
    expect(h.changeLog.size).toBe(0);
  });
});

describe('deletePlaylist', () => {
  const full = { settings: { [`${MODULE_ID}.permPlaylists`]: 'full' } };

  it('is off by default', async () => {
    const { h } = world();
    await expect(h.query('deletePlaylist', { playlistId: 'battle' })).rejects.toThrow(
      /Deleting playlists is not permitted.*off by default/
    );
  });

  it('deletes by id, reads back and keeps the state before', async () => {
    const { h } = world(full);
    await expect(h.query('deletePlaylist', { playlistId: 'battle' })).resolves.toEqual({
      id: 'battle',
      name: 'Battle',
      deleted: true,
    });
    expect(h.foundry.collection('Playlist').has('battle')).toBe(false);
    expect(h.changeLog.list()[0]).toMatchObject({ action: 'delete', undoable: true });
  });

  it('refuses a playlist still linked to a scene and names the scene', async () => {
    const { h, harbour } = world(full);
    harbour['playlist'] = 'tavern';
    await expect(h.query('deletePlaylist', { playlistId: 'tavern' })).rejects.toThrow(
      /still linked to 1 scene\(s\): "Harbour" \(id harbour\)/
    );
    expect(h.foundry.collection('Playlist').has('tavern')).toBe(true);
  });

  it('never deletes by name, but says which id the name has', async () => {
    const { h } = world(full);
    await expect(h.query('deletePlaylist', { playlistId: 'Battle' })).rejects.toThrow(
      /Playlist "Battle" not found\. Deleting works by id only\. .*"Battle" \(id battle\)/
    );
    expect(h.foundry.operations).toEqual([]);
  });
});
