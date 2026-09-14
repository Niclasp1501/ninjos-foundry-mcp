/**
 * update-scene-music: the playlist and track a scene plays when activated.
 *
 * The same write as set-scene-playlist (the world area), with the parameter
 * forms of the original: a left out parameter keeps the field, `null` or an
 * empty text clears it. One rule holds after every call: the scene never
 * points at a track that is not in its playlist.
 *
 * - playlist alone: a track that belongs to the new playlist stays, any other
 *   track is cleared and the result says so.
 * - playlist_sound alone: the track is looked up in the playlist the scene
 *   already has (in the original it was never found).
 * - playlist null with a track: refused, a track needs its playlist.
 */
import type { QueryHandler } from '../../dispatcher.js';
import { requireWorld } from '../../world-ready.js';
import { idOf, quoteList } from '../world/lookup.js';
import {
  argsOf,
  invalid,
  notApplied,
  notFound,
  pickOne,
  playlists,
  refuseUnknown,
  requiredText,
  suggestions,
  typeOf,
} from './lookup.js';
import { findSound } from './playback.js';

type Given = { kind: 'omitted' } | { kind: 'clear' } | { kind: 'set'; value: string };

function given(args: Record<string, unknown>, key: string, problems: string[]): Given {
  const value = args[key];
  if (value === undefined) return { kind: 'omitted' };
  if (value === null) return { kind: 'clear' };
  if (typeof value !== 'string') {
    problems.push(`${key} must be a string or null, got ${typeOf(value)}`);
    return { kind: 'omitted' };
  }
  return value.trim() === '' ? { kind: 'clear' } : { kind: 'set', value: value.trim() };
}

function findScene(identifier: string): FoundryEffectsPlaybackScene {
  const scenes = game.scenes.contents as FoundryEffectsPlaybackScene[];
  const scene = pickOne(scenes, identifier, 'scene', 'write');
  if (!scene)
    notFound(`Scene not found: "${identifier}". ${suggestions(scenes, identifier, 'scene')}`);
  return scene;
}

function findWorldPlaylist(identifier: string): FoundryEffectsPlaybackPlaylist {
  const all = playlists();
  const playlist = pickOne(all, identifier, 'playlist', 'write');
  if (!playlist) {
    const names = all.map(entry => entry.name);
    notFound(
      `playlist not found: "${identifier}". ` +
        (names.length
          ? `Playlists in the world: ${quoteList(names)}. `
          : 'The world has no playlists. ') +
        'A playlist that only exists in a compendium has to be imported first with import-from-compendium.'
    );
  }
  return playlist;
}

const worldPlaylist = (id: string | null) =>
  id ? ((game.playlists.get(id) as FoundryEffectsPlaybackPlaylist | undefined) ?? null) : null;

export const updateSceneMusic: QueryHandler = {
  // The scene is what changes, as with set-scene-playlist.
  access: { kind: 'write', document: 'Scenes', action: 'update' },
  run: async (data, context) => {
    requireWorld();
    const args = argsOf(data);
    const problems = refuseUnknown(args, ['scene_identifier', 'playlist', 'playlist_sound']);
    const playlistArg = given(args, 'playlist', problems);
    const soundArg = given(args, 'playlist_sound', problems);
    if (problems.length) invalid(`Invalid arguments: ${problems.join('; ')}`);
    const sceneIdentifier = requiredText(args, 'scene_identifier').trim();
    if (playlistArg.kind === 'omitted' && soundArg.kind === 'omitted') {
      invalid('Nothing to update: pass playlist and/or playlist_sound (null to clear)');
    }
    if (playlistArg.kind === 'clear' && soundArg.kind === 'set') {
      invalid('playlist_sound cannot be set while clearing playlist; a track needs its playlist');
    }
    const scene = findScene(sceneIdentifier);

    const before = { playlist: idOf(scene.playlist), playlistSound: idOf(scene.playlistSound) };
    // A left out playlist keeps the stored id, even one whose playlist is gone.
    const target =
      playlistArg.kind === 'set'
        ? findWorldPlaylist(playlistArg.value)
        : playlistArg.kind === 'clear'
          ? null
          : worldPlaylist(before.playlist);
    const playlistId = playlistArg.kind === 'omitted' ? before.playlist : (target?.id ?? null);

    let sound: FoundryEffectsPlaybackSound | null = null;
    let soundCleared: string | null = null;
    if (soundArg.kind === 'set') {
      if (!target) {
        invalid(
          playlistId
            ? `playlist_sound requires the scene's playlist, but its playlist ${playlistId} no longer exists (pass playlist too)`
            : 'playlist_sound requires the scene to have a playlist (pass playlist too)'
        );
      }
      sound = findSound(target, soundArg.value);
    } else if (soundArg.kind === 'omitted' && before.playlistSound) {
      const kept = target?.sounds.get(before.playlistSound);
      if (kept) sound = kept;
      else {
        soundCleared = target
          ? `The previous track ${before.playlistSound} is not in playlist "${target.name}" and was removed.`
          : `The previous track ${before.playlistSound} was removed together with the playlist.`;
      }
    }

    const wanted = { playlist: playlistId, playlistSound: sound?.id ?? null };
    const summary = {
      sceneId: scene.id,
      sceneName: scene.name,
      playlist: target
        ? { id: target.id, name: target.name }
        : playlistId
          ? { id: playlistId, name: null }
          : null,
      playlistSound: sound ? { id: sound.id, name: sound.name } : null,
    };
    if (wanted.playlist === before.playlist && wanted.playlistSound === before.playlistSound) {
      // Nothing to write; say what is set instead of pretending a change.
      return { success: true, changed: false, ...summary };
    }

    await scene.update(wanted);
    const after = game.scenes.get(scene.id) as FoundryEffectsPlaybackScene | undefined;
    const actual = { playlist: idOf(after?.playlist), playlistSound: idOf(after?.playlistSound) };
    if (actual.playlist !== wanted.playlist || actual.playlistSound !== wanted.playlistSound) {
      notApplied(
        `Scene "${scene.name}" reads back with playlist ${actual.playlist ?? 'none'} and track ` +
          `${actual.playlistSound ?? 'none'} instead of ${wanted.playlist ?? 'none'} and ${wanted.playlistSound ?? 'none'}`
      );
    }

    context.recordChange({
      query: 'updateSceneMusic',
      tool: 'update-scene-music',
      document: 'Scenes',
      action: 'update',
      targets: [{ id: scene.id, uuid: scene.uuid, name: scene.name }],
      summary: wanted.playlist
        ? `Set the music of scene "${scene.name}" to playlist ${target ? `"${target.name}"` : wanted.playlist}` +
          `${sound ? `, track "${sound.name}"` : ', no single track'}.`
        : `Removed the music of scene "${scene.name}".`,
      before,
      after: actual,
    });
    return { success: true, changed: true, ...summary, ...(soundCleared ? { soundCleared } : {}) };
  },
};
