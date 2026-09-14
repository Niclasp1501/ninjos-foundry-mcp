/**
 * control-playlist: play, stop, cycle-mode, play-sound, stop-sound.
 *
 * Everything runs through Foundry's own playback methods, which store the
 * state and hand it to every connected browser. Each command reads the state
 * back: a playlist in mode "disabled" or without tracks does not start, and
 * that is an error with the cause instead of a success that plays nothing.
 */
import type { QueryHandler } from '../../dispatcher.js';
import { QueryError } from '../../dispatcher.js';
import { requireWorld } from '../../world-ready.js';
import {
  argsOf,
  invalid,
  modeName,
  notApplied,
  notFound,
  pickOne,
  refuseUnknown,
  requiredText,
  suggestions,
} from './lookup.js';
import { findPlaylist } from './playlists.js';

const COMMANDS = ['play', 'stop', 'cycle-mode', 'play-sound', 'stop-sound'] as const;
type Command = (typeof COMMANDS)[number];

const METHOD = {
  play: 'playAll',
  stop: 'stopAll',
  'cycle-mode': 'cycleMode',
  'play-sound': 'playSound',
  'stop-sound': 'stopSound',
} as const satisfies Record<Command, keyof FoundryEffectsPlaybackPlaylist>;

/** A track of the playlist: id, exact name, or the name in any case when unique. Never a part of it. */
export function findSound(
  playlist: FoundryEffectsPlaybackPlaylist,
  identifier: string
): FoundryEffectsPlaybackSound {
  const tracks = playlist.sounds.contents;
  const sound = pickOne(tracks, identifier, 'track', 'write');
  if (!sound) {
    notFound(
      `playlistSound not found in playlist "${playlist.name}": "${identifier}". ${suggestions(tracks, identifier, 'track')}`
    );
  }
  return sound;
}

function stateOf(playlist: FoundryEffectsPlaybackPlaylist, sound?: FoundryEffectsPlaybackSound) {
  return {
    mode: playlist.mode ?? null,
    playing: playlist.playing === true,
    ...(sound ? { soundPlaying: sound.playing === true } : {}),
  };
}

export const controlPlaylist: QueryHandler = {
  // Playback changes the stored state of the playlist and its tracks.
  access: { kind: 'write', document: 'Playlists', action: 'update' },
  run: async (data, context) => {
    requireWorld();
    const args = argsOf(data);
    const problems = refuseUnknown(args, ['playlist', 'command', 'sound']);
    const command = args['command'] as Command;
    const known = COMMANDS.includes(command);
    if (!known) problems.push(`command must be one of ${COMMANDS.join(', ')}`);
    const withSound = command === 'play-sound' || command === 'stop-sound';
    if (known && !withSound && args['sound'] !== undefined) {
      problems.push(
        `sound is only used with play-sound and stop-sound, not with ${command}; nothing was played or stopped`
      );
    }
    if (withSound && (typeof args['sound'] !== 'string' || args['sound'].trim() === '')) {
      problems.push(`command ${command} requires "sound"`);
    }
    if (problems.length) invalid(`Invalid arguments: ${problems.join('; ')}`);

    const playlist = findPlaylist(requiredText(args, 'playlist').trim(), 'write');
    const sound = withSound ? findSound(playlist, (args['sound'] as string).trim()) : null;

    const methodName = METHOD[command];
    const method = playlist[methodName];
    if (typeof method !== 'function') {
      throw new QueryError(
        'NOT_AVAILABLE',
        `This Foundry version has no Playlist#${methodName}, so ${command} cannot run`
      );
    }
    if (command === 'play' && playlist.sounds.size === 0) {
      invalid(`Playlist "${playlist.name}" has no tracks, so there is nothing to play`);
    }
    if ((command === 'play' || command === 'play-sound') && playlist.mode === -1) {
      invalid(
        `Playlist "${playlist.name}" is in mode "disabled", which Foundry does not play. ` +
          'Change its mode first (manage-playlists update with mode, or cycle-mode)'
      );
    }

    const before = stateOf(playlist, sound ?? undefined);
    if (sound)
      await (method as (track: FoundryEffectsPlaybackSound) => Promise<unknown>).call(
        playlist,
        sound
      );
    else await (method as () => Promise<unknown>).call(playlist);

    const after = game.playlists.get(playlist.id) as FoundryEffectsPlaybackPlaylist | undefined;
    if (!after) notApplied(`Playlist ${playlist.id} is gone after the command`);
    const afterSound = sound ? after.sounds.get(sound.id) : undefined;

    if (command === 'play' && after.playing !== true) {
      notApplied(`Playlist "${after.name}" does not read back as playing`);
    }
    if (command === 'stop') {
      const still = after.sounds.filter(track => track.playing === true);
      if (after.playing === true || still.length) {
        notApplied(
          `Playlist "${after.name}" still reads back as playing` +
            (still.length ? ` (tracks ${still.map(track => `"${track.name}"`).join(', ')})` : '')
        );
      }
    }
    if (command === 'cycle-mode' && after.mode === before.mode) {
      notApplied(`The mode of playlist "${after.name}" is still ${modeName(after.mode)}`);
    }
    if (command === 'play-sound' && afterSound?.playing !== true) {
      notApplied(
        `Track "${sound?.name}" in playlist "${after.name}" does not read back as playing`
      );
    }
    if (command === 'stop-sound' && afterSound?.playing === true) {
      notApplied(`Track "${sound?.name}" in playlist "${after.name}" still reads back as playing`);
    }

    // Every mode in the result is read after the command; the one before is named as such.
    const result: Record<string, unknown> = {
      success: true,
      action: command,
      playlist: {
        id: after.id,
        name: after.name,
        mode: after.mode ?? null,
        modeName: modeName(after.mode),
        playing: after.playing === true,
      },
      mode: after.mode ?? null,
    };
    if (command === 'cycle-mode') {
      result['previousMode'] = before.mode;
      result['previousModeName'] = modeName(before.mode);
    }
    if (sound) {
      result['sound'] = {
        id: sound.id,
        name: sound.name,
        path: typeof sound.path === 'string' ? sound.path : null,
        playing: afterSound?.playing === true,
      };
    }

    context.recordChange({
      query: 'controlPlaylist',
      tool: 'control-playlist',
      document: 'Playlists',
      action: 'update',
      targets: [{ id: after.id, uuid: after.uuid, name: after.name }],
      summary:
        command === 'cycle-mode'
          ? `Switched playlist "${after.name}" from ${modeName(before.mode)} to ${modeName(after.mode)}.`
          : `${command} on playlist "${after.name}"${sound ? `, track "${sound.name}"` : ''}.`,
      before,
      after: stateOf(after, afterSound),
    });
    return result;
  },
};
