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

function world(options: FakeFoundryOptions = {}) {
  const h = (harness = createAreaHarness({ foundry: withPlayback(new FakeFoundry(options)) }));
  h.foundry.seed('Folder', { _id: 'music', name: 'Music', type: 'Playlist' });
  h.foundry.seed('Folder', { _id: 'npcs', name: 'NPCs', type: 'Actor' });
  const tavern = h.foundry.seed('Playlist', {
    _id: 'tavern',
    name: 'Tavern',
    mode: 1,
    folder: 'music',
    description: 'Evening',
    sounds: [
      { _id: 'lute', name: 'Lute', path: 'music/lute.ogg', volume: 0.5, repeat: true },
      { _id: 'drums', name: 'Drums', path: 'music/drums.ogg', volume: 0.8 },
    ],
  });
  h.foundry.seed('Playlist', { _id: 'battle', name: 'Battle', mode: 0, sounds: [] });
  const harbour = h.foundry.seed('Scene', { _id: 'harbour', name: 'Harbour' });
  return { h, tavern, harbour };
}

const managed = (h: AreaHarness, data: Record<string, unknown>) =>
  h.query('managePlaylists', data) as Promise<Record<string, any>>;
const tracks = (playlist: unknown) =>
  (
    playlist as { getEmbeddedCollection(name: string): Map<string, Record<string, unknown>> }
  ).getEmbeddedCollection('PlaylistSound');

describe('describe', () => {
  it('lists every playlist like list-playlists, with the mode as number and name, even with writing off', async () => {
    const { h } = world({ settings: { [`${MODULE_ID}.allowWriteOperations`]: false } });
    const answer = await managed(h, { action: 'describe', playlist: null });
    expect(answer['playlists'][0]).toEqual({
      id: 'tavern',
      name: 'Tavern',
      mode: 1,
      modeName: 'shuffle',
      playing: false,
      folder: 'Music',
      soundCount: 2,
    });
  });

  it('describes one playlist found by a unique part of its name', async () => {
    const { h } = world();
    const answer = await managed(h, { action: 'describe', playlist: 'tav' });
    expect(answer['playlist']).toMatchObject({
      id: 'tavern',
      description: 'Evening',
      folder: { id: 'music', name: 'Music' },
      sounds: [
        {
          id: 'lute',
          name: 'Lute',
          path: 'music/lute.ogg',
          volume: 0.5,
          repeat: true,
          fade: null,
          playing: false,
        },
        {
          id: 'drums',
          name: 'Drums',
          path: 'music/drums.ogg',
          volume: 0.8,
          repeat: false,
          fade: null,
          playing: false,
        },
      ],
    });
  });

  it('reports an unknown playlist instead of falling back to the list', async () => {
    const { h } = world();
    await expect(managed(h, { action: 'describe', playlist: 'Forest' })).rejects.toThrow(
      /playlist not found: "Forest"\. Existing playlists: "Tavern", "Battle"/
    );
  });
});

describe('create', () => {
  it('creates the playlist with all tracks in one write and reads them back', async () => {
    const { h } = world();
    const answer = await managed(h, {
      action: 'create',
      name: 'Forest',
      mode: 2,
      folder: 'music',
      channel: 'environment',
      sounds: [
        { path: 'ambience/Wind%20Howl.ogg', volume: 0.3 },
        { name: 'Birds', path: 'ambience/birds.ogg' },
      ],
    });
    expect(answer).toMatchObject({
      success: true,
      soundsCreated: 2,
      playlist: { name: 'Forest', mode: 2 },
    });
    expect(answer['sounds'].map((sound: { name: string }) => sound.name)).toEqual([
      'Wind Howl',
      'Birds',
    ]);
    expect(h.foundry.operations).toHaveLength(1);
    expect(h.changeLog.list()[0]).toMatchObject({ action: 'create', document: 'Playlists' });
  });

  it('writes nothing when one track is wrong', async () => {
    const { h } = world();
    await expect(
      managed(h, {
        action: 'create',
        name: 'Forest',
        folder: 'npcs',
        sounds: [{ path: 'a.ogg' }, { name: 'No path' }, { volume: 2 }],
      })
    ).rejects.toThrow(
      'Invalid arguments: folder "NPCs" (npcs) is a Actor folder, not a playlist folder; sounds[2].volume must be a ' +
        'number from 0 to 1; sounds[2] needs at least one of id, name or path; sounds[1] needs a "path"; ' +
        'sounds[2] needs a "path". Nothing was created'
    );
    expect(h.foundry.operations).toEqual([]);
  });

  it('needs the playlist level to create', async () => {
    const { h } = world({ settings: { [`${MODULE_ID}.permPlaylists`]: 'read' } });
    await expect(managed(h, { action: 'create', name: 'Forest' })).rejects.toThrow(
      /^Creating playlists is not permitted/
    );
  });
});

describe('update', () => {
  it('changes fields and a track found by its exact path, and reads both back', async () => {
    const { h, tavern } = world();
    const answer = await managed(h, {
      action: 'update',
      playlist: 'tavern',
      name: 'Tavern at night',
      updates: { fade: 500, name: 'ignored, the parameter wins' },
      sounds: [{ path: 'music/lute.ogg', volume: 0.2 }],
    });
    expect(answer).toEqual({
      success: true,
      action: 'update',
      playlist: { id: 'tavern', name: 'Tavern at night' },
      fieldsUpdated: ['name', 'fade'],
      soundsUpdated: 1,
    });
    expect(tavern['fade']).toBe(500);
    expect(tracks(tavern).get('lute')?.['volume']).toBe(0.2);
  });

  it('checks known fields inside updates like the parameters', async () => {
    const { h } = world();
    await expect(
      managed(h, {
        action: 'update',
        playlist: 'Tavern',
        updates: { folder: 'nowhere', playing: true },
      })
    ).rejects.toThrow(
      /updates must not carry playing; use control-playlist; folder "nowhere" is not the id of a folder/
    );
  });

  it('never finds the playlist by a part of its name', async () => {
    const { h } = world();
    await expect(managed(h, { action: 'update', playlist: 'tav', fade: 1 })).rejects.toThrow(
      /playlist not found: "tav"\. Names containing it \(a part of a name is not used for changes\): "Tavern" \(id tavern\)/
    );
  });

  it('finds a track by its exact name only, case counting', async () => {
    const { h } = world();
    await expect(
      managed(h, { action: 'update', playlist: 'Tavern', sounds: [{ name: 'lute', volume: 1 }] })
    ).rejects.toThrow(/sounds\[0\]: sound not found in playlist "Tavern"/);
  });

  it('puts the tracks back when Foundry refuses the playlist change', async () => {
    const { h, tavern } = world();
    h.foundry.onWrite(operation => {
      if (operation.documentName === 'Playlist' && operation.action === 'update')
        throw new Error('invalid mode');
    });
    await expect(
      managed(h, {
        action: 'update',
        playlist: 'Tavern',
        mode: 0,
        sounds: [{ id: 'drums', volume: 0.1 }],
      })
    ).rejects.toThrow(
      'Foundry refused the change of playlist "Tavern": invalid mode. the 1 changed tracks were put back.'
    );
    expect(tracks(tavern).get('drums')?.['volume']).toBe(0.8);
  });
});

describe('delete', () => {
  const full = { settings: { [`${MODULE_ID}.permPlaylists`]: 'full' } };

  it('is off by default', async () => {
    const { h } = world();
    await expect(managed(h, { action: 'delete', playlist: 'battle' })).rejects.toMatchObject({
      moduleCode: 'PERMISSION_DENIED',
    });
  });

  it('deletes by id with the implementation of delete-playlist', async () => {
    const { h } = world(full);
    await expect(managed(h, { action: 'delete', playlist: 'battle' })).resolves.toEqual({
      success: true,
      action: 'delete',
      deleted: 'Battle',
      id: 'battle',
    });
    expect(h.foundry.collection('Playlist').has('battle')).toBe(false);
  });

  it('never deletes by name, and never a playlist a scene uses', async () => {
    const { h, harbour } = world(full);
    await expect(managed(h, { action: 'delete', playlist: 'Battle' })).rejects.toThrow(
      /Deleting works by id only/
    );
    harbour['playlist'] = 'tavern';
    await expect(managed(h, { action: 'delete', playlist: 'tavern' })).rejects.toThrow(
      /still linked to 1 scene/
    );
    expect(h.foundry.operations).toEqual([]);
  });
});
