import { afterEach, describe, expect, it } from 'vitest';
import { MODULE_ID } from '../../../common/constants.js';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { FakeFoundry, type FakeFoundryOptions } from '../../../testing/fake-foundry.js';
import { withPlayback } from './testing.js';

let harness: AreaHarness | null = null;
afterEach(() => {
  harness?.close();
  harness = null;
});

function world(options: FakeFoundryOptions = {}, playback = true) {
  const foundry = new FakeFoundry(options);
  const h = (harness = createAreaHarness({ foundry: playback ? withPlayback(foundry) : foundry }));
  const tavern = h.foundry.seed('Playlist', {
    _id: 'tavern',
    name: 'Tavern',
    mode: 0,
    playing: false,
    sounds: [
      { _id: 'lute', name: 'Lute', path: 'music/lute.ogg', playing: false },
      { _id: 'drums', name: 'Drums', path: 'music/drums.ogg', playing: false },
    ],
  });
  h.foundry.seed('Playlist', { _id: 'empty', name: 'Empty', mode: 0, sounds: [] });
  h.foundry.seed('Playlist', {
    _id: 'off',
    name: 'Off',
    mode: -1,
    sounds: [{ _id: 's', name: 'S' }],
  });
  return { h, tavern };
}

const control = (h: AreaHarness, data: Record<string, unknown>) =>
  h.query('controlPlaylist', data) as Promise<Record<string, any>>;
const track = (playlist: unknown, id: string) =>
  (playlist as { getEmbeddedCollection(name: string): Map<string, Record<string, unknown>> })
    .getEmbeddedCollection('PlaylistSound')
    .get(id);

describe('controlPlaylist', () => {
  it('plays and stops a playlist and reads the state back', async () => {
    const { h, tavern } = world();
    await expect(control(h, { playlist: 'Tavern', command: 'play' })).resolves.toMatchObject({
      success: true,
      action: 'play',
      playlist: { id: 'tavern', playing: true, mode: 0, modeName: 'sequential' },
    });
    expect(track(tavern, 'lute')?.['playing']).toBe(true);
    await control(h, { playlist: 'tavern', command: 'stop' });
    expect(tavern['playing']).toBe(false);
    expect(track(tavern, 'lute')?.['playing']).toBe(false);
    // The change log lists the newest entry first.
    expect(h.changeLog.list().map(entry => entry.summary)).toEqual([
      'stop on playlist "Tavern".',
      'play on playlist "Tavern".',
    ]);
  });

  it('reports the mode after cycling everywhere, and the one before as previousMode', async () => {
    const { h, tavern } = world();
    tavern['mode'] = 2;
    await expect(control(h, { playlist: 'Tavern', command: 'cycle-mode' })).resolves.toMatchObject({
      mode: -1,
      playlist: { mode: -1, modeName: 'disabled' },
      previousMode: 2,
      previousModeName: 'simultaneous',
    });
  });

  it('plays and stops one track found by its name in any case', async () => {
    const { h, tavern } = world();
    await expect(
      control(h, { playlist: 'Tavern', command: 'play-sound', sound: 'drums' })
    ).resolves.toMatchObject({ sound: { id: 'drums', name: 'Drums', playing: true } });
    await control(h, { playlist: 'Tavern', command: 'stop-sound', sound: 'Drums' });
    expect(track(tavern, 'drums')?.['playing']).toBe(false);
  });

  it('refuses what would play nothing, before calling Foundry', async () => {
    const { h } = world();
    await expect(control(h, { playlist: 'Empty', command: 'play' })).rejects.toThrow(
      /has no tracks/
    );
    await expect(control(h, { playlist: 'Off', command: 'play' })).rejects.toThrow(
      /mode "disabled"/
    );
    expect(h.foundry.operations).toEqual([]);
  });

  it('checks the sound against the command', async () => {
    const { h } = world();
    await expect(control(h, { playlist: 'Tavern', command: 'play-sound' })).rejects.toThrow(
      'Invalid arguments: command play-sound requires "sound"'
    );
    await expect(
      control(h, { playlist: 'Tavern', command: 'play', sound: 'Lute' })
    ).rejects.toThrow(/sound is only used with play-sound and stop-sound, not with play/);
  });

  it('never takes a part of a name', async () => {
    const { h } = world();
    await expect(control(h, { playlist: 'Tav', command: 'play' })).rejects.toMatchObject({
      moduleCode: 'NOT_FOUND',
    });
    await expect(
      control(h, { playlist: 'Tavern', command: 'play-sound', sound: 'dru' })
    ).rejects.toThrow(
      /playlistSound not found in playlist "Tavern": "dru"\. Names containing it .*"Drums" \(id drums\)/
    );
  });

  it('fails when the state does not read back', async () => {
    const { h, tavern } = world();
    Object.defineProperty(tavern, 'playAll', { value: async () => tavern, enumerable: false });
    await expect(control(h, { playlist: 'Tavern', command: 'play' })).rejects.toMatchObject({
      moduleCode: 'NOT_APPLIED',
    });
    expect(h.changeLog.size).toBe(0);
  });

  it('says so when Foundry lacks the playback method', async () => {
    const { h } = world({}, false);
    await expect(control(h, { playlist: 'Tavern', command: 'play' })).rejects.toThrow(
      'This Foundry version has no Playlist#playAll, so play cannot run'
    );
  });

  it('is held by the switch', async () => {
    const { h } = world({ settings: { [`${MODULE_ID}.allowWriteOperations`]: false } });
    await expect(control(h, { playlist: 'Tavern', command: 'play' })).rejects.toMatchObject({
      moduleCode: 'WRITE_DISABLED',
    });
  });
});
