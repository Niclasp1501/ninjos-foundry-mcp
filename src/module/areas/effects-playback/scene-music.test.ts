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
  h.foundry.seed('Playlist', {
    _id: 'tavern',
    name: 'Tavern',
    sounds: [
      { _id: 'lute', name: 'Lute' },
      { _id: 'drums', name: 'Drums' },
    ],
  });
  h.foundry.seed('Playlist', {
    _id: 'battle',
    name: 'Battle',
    sounds: [{ _id: 'horn', name: 'Horn' }],
  });
  const harbour = h.foundry.seed('Scene', {
    _id: 'harbour',
    name: 'Harbour',
    playlist: null,
    playlistSound: null,
  });
  return { h, harbour };
}

const music = (h: AreaHarness, data: Record<string, unknown>) =>
  h.query('updateSceneMusic', data) as Promise<Record<string, any>>;

describe('updateSceneMusic', () => {
  it('sets playlist and track by name in one write and logs before and after', async () => {
    const { h, harbour } = world();
    await expect(
      music(h, { scene_identifier: 'harbour', playlist: 'tavern', playlist_sound: 'LUTE' })
    ).resolves.toEqual({
      success: true,
      changed: true,
      sceneId: 'harbour',
      sceneName: 'Harbour',
      playlist: { id: 'tavern', name: 'Tavern' },
      playlistSound: { id: 'lute', name: 'Lute' },
    });
    expect([harbour['playlist'], harbour['playlistSound']]).toEqual(['tavern', 'lute']);
    expect(h.foundry.operations).toHaveLength(1);
    expect(h.changeLog.list()[0]).toMatchObject({
      before: { playlist: null, playlistSound: null },
      after: { playlist: 'tavern', playlistSound: 'lute' },
    });
  });

  it('sets a track alone within the playlist the scene already has', async () => {
    const { h, harbour } = world();
    harbour['playlist'] = 'tavern';
    await expect(
      music(h, { scene_identifier: 'Harbour', playlist_sound: 'Drums' })
    ).resolves.toMatchObject({
      playlistSound: { id: 'drums' },
    });
    expect(harbour['playlist']).toBe('tavern');
  });

  it('clears a track that does not belong to the new playlist, and says so', async () => {
    const { h, harbour } = world();
    Object.assign(harbour, { playlist: 'tavern', playlistSound: 'lute' });
    const answer = await music(h, { scene_identifier: 'Harbour', playlist: 'Battle' });
    expect(answer['soundCleared']).toBe(
      'The previous track lute is not in playlist "Battle" and was removed.'
    );
    expect([harbour['playlist'], harbour['playlistSound']]).toEqual(['battle', null]);
  });

  it('clears both with null or an empty text, and only the track with playlist_sound null', async () => {
    const { h, harbour } = world();
    Object.assign(harbour, { playlist: 'tavern', playlistSound: 'lute' });
    await music(h, { scene_identifier: 'Harbour', playlist_sound: null });
    expect([harbour['playlist'], harbour['playlistSound']]).toEqual(['tavern', null]);
    Object.assign(harbour, { playlistSound: 'lute' });
    const answer = await music(h, { scene_identifier: 'Harbour', playlist: '' });
    expect(answer).toMatchObject({ playlist: null, playlistSound: null });
    expect(answer['soundCleared']).toMatch(/removed together with the playlist/);
    expect([harbour['playlist'], harbour['playlistSound']]).toEqual([null, null]);
  });

  it('keeps a left out playlist even when it no longer exists', async () => {
    const { h, harbour } = world();
    Object.assign(harbour, { playlist: 'gone', playlistSound: 'x' });
    await music(h, { scene_identifier: 'Harbour', playlist_sound: null });
    expect([harbour['playlist'], harbour['playlistSound']]).toEqual(['gone', null]);
    await expect(music(h, { scene_identifier: 'Harbour', playlist_sound: 'Lute' })).rejects.toThrow(
      "playlist_sound requires the scene's playlist, but its playlist gone no longer exists (pass playlist too)"
    );
  });

  it('refuses a track while clearing the playlist, and a call without anything to do', async () => {
    const { h } = world();
    await expect(
      music(h, { scene_identifier: 'Harbour', playlist: null, playlist_sound: 'Lute' })
    ).rejects.toThrow(/playlist_sound cannot be set while clearing playlist/);
    await expect(music(h, { scene_identifier: 'Harbour' })).rejects.toThrow(/^Nothing to update/);
    await expect(music(h, { scene_identifier: 'Harbour', playlist_sound: 'Lute' })).rejects.toThrow(
      'playlist_sound requires the scene to have a playlist (pass playlist too)'
    );
    expect(h.foundry.operations).toEqual([]);
  });

  it('does not write when nothing changes', async () => {
    const { h, harbour } = world();
    Object.assign(harbour, { playlist: 'tavern', playlistSound: 'lute' });
    await expect(
      music(h, { scene_identifier: 'Harbour', playlist: 'Tavern' })
    ).resolves.toMatchObject({
      changed: false,
      playlistSound: { id: 'lute' },
    });
    expect(h.foundry.operations).toEqual([]);
  });

  it('never takes a part of a name, and names the playlists of the world', async () => {
    const { h } = world();
    await expect(music(h, { scene_identifier: 'Harbour', playlist: 'Tav' })).rejects.toThrow(
      /playlist not found: "Tav"\. Playlists in the world: "Tavern", "Battle"\. .*import-from-compendium/
    );
    await expect(music(h, { scene_identifier: 'Harb', playlist: 'Tavern' })).rejects.toMatchObject({
      moduleCode: 'NOT_FOUND',
    });
  });

  it('needs the scene level', async () => {
    const { h } = world({ settings: { [`${MODULE_ID}.permScenes`]: 'read' } });
    await expect(
      music(h, { scene_identifier: 'Harbour', playlist: 'Tavern' })
    ).rejects.toMatchObject({
      moduleCode: 'PERMISSION_DENIED',
    });
  });

  it('fails when the scene reads back differently', async () => {
    const { h, harbour } = world();
    harbour['update'] = async () => harbour;
    await expect(
      music(h, { scene_identifier: 'Harbour', playlist: 'Tavern' })
    ).rejects.toMatchObject({
      moduleCode: 'NOT_APPLIED',
    });
    expect(h.changeLog.size).toBe(0);
  });
});
