/**
 * Playlists: list them, link one to a scene, delete one.
 *
 * Starting, stopping and scene music beyond the link belong to the effects-playback area.
 */
import type { QueryHandler } from '../../dispatcher.js';
import { QueryError } from '../../dispatcher.js';
import { requireWorld } from '../../world-ready.js';
import {
  byIdOrExactName,
  describeDocuments,
  idOf,
  inputOf,
  notFoundById,
  quoteList,
  textOf,
} from './lookup.js';

/** Foundry's playlist modes by their stored number. */
const PLAYLIST_MODES: Readonly<Record<string, string>> = {
  '-1': 'disabled',
  '0': 'sequential',
  '1': 'shuffle',
  '2': 'simultaneous',
};

function modeName(mode: unknown): string {
  return PLAYLIST_MODES[String(mode)] ?? String(mode ?? 'unknown');
}

function folderName(folder: unknown): string | null {
  const id = idOf(folder);
  return id ? (game.folders.get(id)?.name ?? null) : null;
}

const playlists = () => game.playlists as FoundryCollection<FoundryWorldPlaylist>;
const scenes = () => game.scenes as FoundryCollection<FoundryWorldScene>;

export const listPlaylists: QueryHandler = {
  access: { kind: 'read' },
  run: data => {
    requireWorld();
    const includeSounds = inputOf(data)['includeSounds'] !== false;
    return {
      playlists: playlists().map(playlist => {
        const entry: Record<string, unknown> = {
          id: playlist.id,
          name: playlist.name,
          mode: modeName(playlist.mode),
          playing: playlist.playing === true,
          folder: folderName(playlist.folder),
          soundCount: playlist.sounds.size,
        };
        if (includeSounds) {
          entry['sounds'] = playlist.sounds.map(sound => ({
            id: sound.id,
            name: sound.name,
            path: typeof sound.path === 'string' ? sound.path : null,
            repeat: sound.repeat === true,
            volume: typeof sound.volume === 'number' ? sound.volume : null,
          }));
        }
        return entry;
      }),
    };
  },
};

/**
 * Id, exact name, the same name in any case, then a part of the name in any
 * case. At every step more than one match is an error that lists them: before,
 * the first partial match won, so of "Rain" and "Rain heavy" a request for
 * "rain h" and one for "rain" could both land on the wrong track.
 */
export function findSound(
  playlist: FoundryWorldPlaylist,
  identifier: string
): FoundryWorldPlaylistSound {
  const sounds = playlist.sounds.contents;
  const byId = playlist.sounds.get(identifier);
  if (byId) return byId;

  const lower = identifier.toLowerCase();
  const steps: Array<[string, (sound: FoundryWorldPlaylistSound) => boolean]> = [
    ['named', sound => sound.name === identifier],
    ['named, ignoring case,', sound => sound.name.toLowerCase() === lower],
    ['containing', sound => sound.name.toLowerCase().includes(lower)],
  ];
  for (const [how, test] of steps) {
    const found = sounds.filter(test);
    if (found.length === 1) return found[0] as FoundryWorldPlaylistSound;
    if (found.length > 1) {
      throw new QueryError(
        'AMBIGUOUS',
        `${found.length} tracks in playlist "${playlist.name}" are ${how} "${identifier}": ` +
          `${describeDocuments(found)}. Pass the exact name or the id.`
      );
    }
  }
  throw new QueryError(
    'NOT_FOUND',
    `Track "${identifier}" not found in playlist "${playlist.name}". Its tracks: ` +
      (sounds.length ? describeDocuments(sounds) : 'none') +
      '.'
  );
}

export const setScenePlaylist: QueryHandler = {
  // The scene is what changes, not the playlist.
  access: { kind: 'write', document: 'Scenes', action: 'update' },
  run: async (data, context) => {
    requireWorld();
    const input = inputOf(data);
    const sceneIdentifier = textOf(input['sceneIdentifier']);
    const playlistIdentifier = textOf(input['playlistName']);
    const soundIdentifier = textOf(input['soundName']);
    if (!sceneIdentifier) throw new QueryError('INVALID_ARGUMENTS', 'sceneIdentifier is required');

    const scene = byIdOrExactName<FoundryWorldScene>(game.scenes, sceneIdentifier, 'scene');
    if (!scene) throw new QueryError('NOT_FOUND', `Scene "${sceneIdentifier}" not found`);

    if (!playlistIdentifier && soundIdentifier) {
      throw new QueryError(
        'INVALID_ARGUMENTS',
        `soundName "${soundIdentifier}" was given without a playlistName. An empty playlistName removes ` +
          'the link, so nothing was changed. Pass the playlist the track belongs to.'
      );
    }

    let playlist: FoundryWorldPlaylist | null = null;
    let sound: FoundryWorldPlaylistSound | null = null;
    if (playlistIdentifier) {
      playlist = byIdOrExactName<FoundryWorldPlaylist>(
        game.playlists,
        playlistIdentifier,
        'playlist'
      );
      if (!playlist) {
        const names = playlists().map(entry => entry.name);
        throw new QueryError(
          'NOT_FOUND',
          `Playlist "${playlistIdentifier}" not found in the world. ` +
            (names.length
              ? `Playlists in the world: ${quoteList(names)}. `
              : 'The world has no playlists. ') +
            'A playlist that only exists in a compendium has to be imported first with import-from-compendium.'
        );
      }
      if (soundIdentifier) sound = findSound(playlist, soundIdentifier);
    }

    const before = {
      playlist: idOf(scene.playlist),
      playlistSound: idOf(scene.playlistSound),
    };
    const wanted = { playlist: playlist?.id ?? null, playlistSound: sound?.id ?? null };
    await scene.update(wanted);

    const after = scenes().get(scene.id);
    const actual = {
      playlist: idOf(after?.playlist),
      playlistSound: idOf(after?.playlistSound),
    };
    if (actual.playlist !== wanted.playlist || actual.playlistSound !== wanted.playlistSound) {
      throw new QueryError(
        'NOT_APPLIED',
        `Scene "${scene.name}" was updated, but reading it back shows playlist ${actual.playlist ?? 'none'} ` +
          `and track ${actual.playlistSound ?? 'none'} instead of ${wanted.playlist ?? 'none'} and ` +
          `${wanted.playlistSound ?? 'none'}.`
      );
    }

    const removed = playlist === null;
    context.recordChange({
      query: 'setScenePlaylist',
      tool: 'set-scene-playlist',
      document: 'Scenes',
      action: 'update',
      targets: [{ id: scene.id, uuid: scene.uuid, name: scene.name }],
      summary: removed
        ? `Removed the playlist link of scene "${scene.name}".`
        : `Linked playlist "${playlist?.name}"${sound ? ` with track "${sound.name}"` : ''} to scene "${scene.name}".`,
      before,
      after: actual,
    });

    return {
      // A previous generation server reads these three texts and says "link
      // removed" when `playlist` is empty.
      scene: scene.name,
      playlist: playlist?.name ?? '',
      sound: sound?.name ?? '',
      sceneId: scene.id,
      sceneName: scene.name,
      removed,
      hadLink: before.playlist !== null,
      playlistId: playlist?.id ?? null,
      playlistName: playlist?.name ?? null,
      soundId: sound?.id ?? null,
      soundName: sound?.name ?? null,
    };
  },
};

export const deletePlaylist: QueryHandler = {
  access: { kind: 'write', document: 'Playlists', action: 'delete' },
  run: async (data, context) => {
    requireWorld();
    const id = textOf(inputOf(data)['playlistId']);
    if (!id) throw new QueryError('INVALID_ARGUMENTS', 'playlistId is required');

    const playlist = playlists().get(id);
    if (!playlist) throw notFoundById(game.playlists, id, 'Playlist');

    const linked = scenes().filter(scene => idOf(scene.playlist) === playlist.id);
    if (linked.length) {
      throw new QueryError(
        'IN_USE',
        `Playlist "${playlist.name}" is still linked to ${linked.length} scene(s): ${describeDocuments(linked)}. ` +
          'Remove the link there first (set-scene-playlist with an empty playlistName), so no scene loses its ' +
          'music without notice.'
      );
    }

    const before = playlist.toObject();
    await playlist.delete();
    if (playlists().get(id)) {
      throw new QueryError(
        'NOT_APPLIED',
        `Playlist "${playlist.name}" was deleted, but it is still in the world when read back.`
      );
    }

    context.recordChange({
      query: 'deletePlaylist',
      tool: 'delete-playlist',
      document: 'Playlists',
      action: 'delete',
      targets: [{ id, uuid: playlist.uuid, name: playlist.name }],
      summary: `Deleted playlist "${playlist.name}".`,
      before,
    });
    return { id, name: playlist.name, deleted: true };
  },
};
