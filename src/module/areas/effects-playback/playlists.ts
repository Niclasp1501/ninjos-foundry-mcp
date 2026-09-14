/**
 * manage-playlists: describe (read), create, update and delete (write).
 *
 * Overlap with the world area:
 * - describe without a playlist is list-playlists: the same handler answers.
 * - delete is delete-playlist: the same handler runs, by id only, refusing a
 *   playlist that a scene still uses.
 *
 * Everything is checked before the first write. create sends the playlist
 * and its tracks in one call, so a bad track never leaves half a playlist.
 * update writes the tracks in one batch and then the playlist; when the
 * second write fails, the tracks are put back.
 */
import type { Access } from '../../../common/permissions.js';
import type { HandlerContext, QueryHandler } from '../../dispatcher.js';
import { QueryError } from '../../dispatcher.js';
import { requireWorld } from '../../world-ready.js';
import { documentClass, smallEnough } from '../journals/common.js';
import { idOf } from '../world/lookup.js';
import { deletePlaylist, listPlaylists } from '../world/playlists.js';
import {
  argsOf,
  causeOf,
  differences,
  invalid,
  isRecord,
  modeName,
  notApplied,
  notFound,
  pickOne,
  playlists,
  refuseUnknown,
  suggestions,
  typeOf,
  type Match,
} from './lookup.js';

const ACTIONS = ['create', 'update', 'delete', 'describe'] as const;
/** Fields of the playlist itself, as parameters and inside `updates`. */
const FIELD_KEYS = [
  'name',
  'mode',
  'fade',
  'description',
  'sorting',
  'folder',
  'color',
  'channel',
] as const;
const KNOWN = ['action', 'playlist', ...FIELD_KEYS, 'sounds', 'updates'];
const SOUND_KEYS = ['id', 'name', 'path', 'volume', 'repeat', 'fade'];
const CHANNELS = ['music', 'environment', 'interface'];

type Fields = Record<string, unknown>;

/** describe only reads; the other actions need the playlist level for what they do. */
export function playlistAccess(data: unknown): Access {
  const action = isRecord(data) ? data['action'] : undefined;
  if (action === 'describe') return { kind: 'read' };
  return {
    kind: 'write',
    document: 'Playlists',
    action: action === 'create' || action === 'delete' ? action : 'update',
  };
}

export function findPlaylist(identifier: string, match: Match): FoundryEffectsPlaybackPlaylist {
  const all = playlists();
  const playlist = pickOne(all, identifier, 'playlist', match);
  if (!playlist) {
    notFound(
      `playlist not found: "${identifier}". ${suggestions(all, identifier, 'playlist')} A playlist that only ` +
        'exists in a compendium has to be imported first with import-from-compendium.'
    );
  }
  return playlist;
}

/**
 * The fields of the playlist from the explicit parameters and from `updates`.
 * An explicit parameter wins over the same key in `updates`, and a known key
 * in `updates` is checked like the parameter. `checked` must read back as
 * sent; `loose` (color and free keys) may be dropped by Foundry and only warns.
 */
function readPlaylistFields(args: Fields, problems: string[]): { checked: Fields; loose: Fields } {
  const updates = args['updates'];
  const source: Fields = {};
  const loose: Fields = {};
  if (updates !== undefined && !isRecord(updates)) {
    problems.push(`updates must be an object, got ${typeOf(updates)}`);
  } else if (updates) {
    for (const [key, value] of Object.entries(updates)) {
      if (key === '_id' || key === 'id') problems.push('updates must not change the id');
      else if (key === 'sounds')
        problems.push('updates must not carry sounds; use the sounds parameter');
      else if (key === 'playing')
        problems.push('updates must not carry playing; use control-playlist');
      else if ((FIELD_KEYS as readonly string[]).includes(key)) source[key] = value;
      else loose[key] = value;
    }
  }
  for (const key of FIELD_KEYS) if (args[key] !== undefined) source[key] = args[key];

  const checked: Fields = {};
  const name = source['name'];
  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim() === '')
      problems.push('name must be a non-empty string');
    else checked['name'] = name.trim();
  }
  const mode = source['mode'];
  if (mode !== undefined) {
    if (!Number.isInteger(mode) || (mode as number) < -1 || (mode as number) > 2) {
      problems.push('mode must be -1 (disabled), 0 (sequential), 1 (shuffle) or 2 (simultaneous)');
    } else checked['mode'] = mode;
  }
  const fade = source['fade'];
  if (fade !== undefined) {
    if (!Number.isInteger(fade) || (fade as number) < 0) {
      problems.push('fade must be a whole number of milliseconds, 0 or more');
    } else checked['fade'] = fade;
  }
  const description = source['description'];
  if (description !== undefined) {
    if (typeof description !== 'string') problems.push('description must be a string');
    else checked['description'] = description;
  }
  const sorting = source['sorting'];
  if (sorting !== undefined) {
    if (sorting !== 'a' && sorting !== 'm')
      problems.push('sorting must be "a" (alphabetical) or "m" (manual)');
    else checked['sorting'] = sorting;
  }
  const channel = source['channel'];
  if (channel !== undefined) {
    if (!CHANNELS.includes(channel as string))
      problems.push(`channel must be one of ${CHANNELS.join(', ')}`);
    else checked['channel'] = channel;
  }
  const folder = source['folder'];
  if (folder !== undefined) {
    if (folder === null) checked['folder'] = null;
    else if (typeof folder !== 'string' || folder.trim() === '') {
      problems.push('folder must be the id of a playlist folder, or null for the top level');
    } else {
      const found = game.folders.get(folder) as FoundryEffectsPlaybackFolder | undefined;
      if (!found) problems.push(`folder "${folder}" is not the id of a folder in this world`);
      else if (found.type !== 'Playlist') {
        problems.push(
          `folder "${found.name}" (${folder}) is a ${String(found.type)} folder, not a playlist folder`
        );
      } else checked['folder'] = folder;
    }
  }
  const color = source['color'];
  if (color !== undefined) {
    if (color !== null && typeof color !== 'string')
      problems.push('color must be a string or null');
    else loose['color'] = color;
  }
  return { checked, loose };
}

interface SoundEntry {
  index: number;
  id?: string;
  fields: Fields;
}

function readSounds(args: Fields, problems: string[]): SoundEntry[] {
  const raw = args['sounds'];
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    problems.push(`sounds must be a list, got ${typeOf(raw)}`);
    return [];
  }
  return raw.flatMap((entry, index): SoundEntry[] => {
    const at = `sounds[${index}]`;
    if (!isRecord(entry)) {
      problems.push(`${at} must be an object`);
      return [];
    }
    problems.push(...refuseUnknown(entry, SOUND_KEYS, `${at}.`));
    const fields: Fields = {};
    for (const key of ['name', 'path']) {
      const value = entry[key];
      if (value === undefined) continue;
      if (typeof value !== 'string' || value.trim() === '')
        problems.push(`${at}.${key} must be a non-empty string`);
      else fields[key] = value.trim();
    }
    const volume = entry['volume'];
    if (volume !== undefined) {
      if (typeof volume !== 'number' || volume < 0 || volume > 1)
        problems.push(`${at}.volume must be a number from 0 to 1`);
      else fields['volume'] = volume;
    }
    const repeat = entry['repeat'];
    if (repeat !== undefined) {
      if (typeof repeat !== 'boolean') problems.push(`${at}.repeat must be true or false`);
      else fields['repeat'] = repeat;
    }
    const fade = entry['fade'];
    if (fade !== undefined) {
      if (!Number.isInteger(fade) || (fade as number) < 0) {
        problems.push(`${at}.fade must be a whole number of milliseconds, 0 or more`);
      } else fields['fade'] = fade;
    }
    const id = entry['id'];
    if (id !== undefined && (typeof id !== 'string' || id.trim() === '')) {
      problems.push(`${at}.id must be a non-empty string`);
    }
    if (id === undefined && fields['name'] === undefined && fields['path'] === undefined) {
      problems.push(`${at} needs at least one of id, name or path`);
    }
    return [{ index, ...(typeof id === 'string' && id.trim() ? { id: id.trim() } : {}), fields }];
  });
}

/** The name of a track without one: the file name without extension, decoded. */
export function nameFromPath(path: string): string {
  const file = path.split('/').at(-1) ?? path;
  let decoded = file;
  try {
    decoded = decodeURIComponent(file);
  } catch {
    decoded = file;
  }
  return decoded.replace(/\.[^.]+$/, '') || decoded;
}

function fieldWarnings(sent: Fields, stored: Fields, what: string): string[] {
  const differing = differences(sent, stored);
  return differing.length
    ? [`Foundry dropped or stored these fields of ${what} differently: ${differing.join('; ')}.`]
    : [];
}

function storedFields(playlist: FoundryEffectsPlaybackPlaylist): Fields {
  const data = playlist.toObject();
  return { ...data, folder: idOf(data['folder']) };
}

function tracksOf(playlist: FoundryEffectsPlaybackPlaylist): string {
  const tracks = playlist.sounds.map(
    sound => `"${sound.name}" (id ${sound.id}, ${String(sound.path ?? 'no path')})`
  );
  return tracks.length ? tracks.join(', ') : 'none';
}

async function create(args: Fields, context: HandlerContext): Promise<unknown> {
  const problems = refuseUnknown(args, KNOWN);
  if (args['playlist'] !== undefined && args['playlist'] !== null) {
    problems.push('playlist is not used with create; pass the name of the new playlist as name');
  }
  if (args['updates'] !== undefined) problems.push('updates is only used with update');
  if (args['name'] === undefined) problems.push('name is required for create');
  const fields = readPlaylistFields(args, problems);
  const sounds = readSounds(args, problems);
  for (const sound of sounds) {
    if (sound.id !== undefined) {
      problems.push(
        `sounds[${sound.index}].id cannot be used with create; a new track gets a new id`
      );
    }
    if (sound.fields['path'] === undefined) problems.push(`sounds[${sound.index}] needs a "path"`);
  }
  if (problems.length) invalid(`Invalid arguments: ${problems.join('; ')}. Nothing was created`);

  const soundData: Fields[] = sounds.map(sound => ({
    ...sound.fields,
    name: sound.fields['name'] ?? nameFromPath(sound.fields['path'] as string),
  }));
  const data: Fields = { ...fields.loose, ...fields.checked, sounds: soundData };
  const created = await documentClass('Playlist').create(data);
  const document = Array.isArray(created) ? created[0] : created;
  const id =
    isRecord(document) || (typeof document === 'object' && document !== null)
      ? (document as { id?: unknown }).id
      : undefined;
  if (typeof id !== 'string' || !id) {
    notApplied(`Foundry did not return the created playlist "${String(data['name'])}"`);
  }

  const playlist = game.playlists.get(id) as FoundryEffectsPlaybackPlaylist | undefined;
  if (!playlist) notApplied(`The new playlist ${id} does not read back`);
  const stored = storedFields(playlist);
  const storedTracks = playlist.sounds.contents;
  const matching = (sound: Fields) =>
    storedTracks.find(track => track.name === sound['name'] && track.path === sound['path']);
  const differing = [
    ...differences(fields.checked, stored),
    ...(storedTracks.length !== soundData.length
      ? [`${storedTracks.length} tracks instead of ${soundData.length}`]
      : []),
    ...soundData
      .filter(sound => !matching(sound))
      .map(
        sound => `track "${String(sound['name'])}" with path ${String(sound['path'])} is missing`
      ),
  ];
  if (differing.length) {
    notApplied(
      `Playlist "${playlist.name}" (${id}) was created, but reads back differently: ${differing.join('; ')}`
    );
  }
  const warnings = [
    ...fieldWarnings(fields.loose, stored, `playlist "${playlist.name}"`),
    ...soundData.flatMap(sound => {
      const track = matching(sound);
      return track ? fieldWarnings(sound, track.toObject(), `track "${track.name}"`) : [];
    }),
  ];

  context.recordChange({
    query: 'managePlaylists',
    tool: 'manage-playlists',
    document: 'Playlists',
    action: 'create',
    targets: [{ id, uuid: playlist.uuid, name: playlist.name }],
    summary: `Created the playlist "${playlist.name}" with ${storedTracks.length} tracks.`,
  });
  return {
    success: true,
    action: 'create',
    playlist: {
      id,
      name: playlist.name,
      mode: playlist.mode ?? null,
      modeName: modeName(playlist.mode),
    },
    soundsCreated: storedTracks.length,
    sounds: storedTracks.map(track => ({
      id: track.id,
      name: track.name,
      path: track.path ?? null,
    })),
    ...(warnings.length ? { warnings } : {}),
  };
}

/** The track an update entry means: id, else a unique exact path, else a unique exact name. Case counts. */
function trackFor(
  playlist: FoundryEffectsPlaybackPlaylist,
  entry: SoundEntry
): FoundryEffectsPlaybackSound {
  const at = `sounds[${entry.index}]`;
  if (entry.id !== undefined) {
    const byId = playlist.sounds.get(entry.id);
    if (!byId) {
      notFound(
        `${at}: track id ${entry.id} is not in playlist "${playlist.name}". Its tracks: ${tracksOf(playlist)}.`
      );
    }
    return byId;
  }
  for (const key of ['path', 'name'] as const) {
    const value = entry.fields[key];
    if (value === undefined) continue;
    const found = playlist.sounds.filter(sound => sound[key] === value);
    if (found.length === 1) return found[0] as FoundryEffectsPlaybackSound;
    if (found.length > 1) {
      throw new QueryError(
        'AMBIGUOUS',
        `${at}: ${found.length} tracks in playlist "${playlist.name}" have the ${key} "${String(value)}": ` +
          `${found.map(sound => `"${sound.name}" (id ${sound.id})`).join(', ')}. Pass the id.`
      );
    }
  }
  notFound(
    `${at}: sound not found in playlist "${playlist.name}" (need exact id or unique path/name). ` +
      `Adding tracks is not part of update. Its tracks: ${tracksOf(playlist)}.`
  );
}

async function update(args: Fields, context: HandlerContext): Promise<unknown> {
  const identifier = typeof args['playlist'] === 'string' ? args['playlist'].trim() : '';
  if (!identifier) invalid('update requires a playlist identifier');
  const problems = refuseUnknown(args, KNOWN);
  const fields = readPlaylistFields(args, problems);
  const entries = readSounds(args, problems);
  if (problems.length) invalid(`Invalid arguments: ${problems.join('; ')}. Nothing was changed`);

  const playlist = findPlaylist(identifier, 'write');
  const soundUpdates: Fields[] = [];
  const soundBefore: Fields[] = [];
  const seen = new Map<string, number>();
  for (const entry of entries) {
    const track = trackFor(playlist, entry);
    const earlier = seen.get(track.id);
    if (earlier !== undefined) {
      invalid(
        `sounds[${earlier}] and sounds[${entry.index}] both mean the track "${track.name}" (id ${track.id})`
      );
    }
    seen.set(track.id, entry.index);
    if (Object.keys(entry.fields).length === 0) {
      invalid(
        `sounds[${entry.index}] names the track "${track.name}" but changes nothing; pass name, path, volume, repeat or fade`
      );
    }
    const data = track.toObject();
    soundUpdates.push({ _id: track.id, ...entry.fields });
    soundBefore.push({
      _id: track.id,
      ...Object.fromEntries(Object.keys(entry.fields).map(key => [key, data[key]])),
    });
  }
  const playlistChanges: Fields = { ...fields.loose, ...fields.checked };
  if (Object.keys(playlistChanges).length === 0 && soundUpdates.length === 0) {
    invalid('Nothing to update: pass a field of the playlist, updates, or sounds');
  }

  const before = playlist.toObject();
  if (soundUpdates.length) await playlist.updateEmbeddedDocuments('PlaylistSound', soundUpdates);
  if (Object.keys(playlistChanges).length) {
    try {
      await playlist.update(playlistChanges);
    } catch (error) {
      let restored = 'no tracks had been changed';
      if (soundBefore.length) {
        try {
          await playlist.updateEmbeddedDocuments('PlaylistSound', soundBefore);
          restored = `the ${soundBefore.length} changed tracks were put back`;
        } catch (undoError) {
          restored =
            `putting back the ${soundBefore.length} changed tracks failed as well (${causeOf(undoError)}), ` +
            'so those tracks keep their new values';
        }
      }
      throw new QueryError(
        'WRITE_FAILED',
        `Foundry refused the change of playlist "${playlist.name}": ${causeOf(error)}. ${restored}.`
      );
    }
  }

  const current = game.playlists.get(playlist.id) as FoundryEffectsPlaybackPlaylist | undefined;
  if (!current) notApplied(`Playlist ${playlist.id} is gone after the update`);
  const stored = storedFields(current);
  const differing = differences(fields.checked, stored);
  for (const change of soundUpdates) {
    const track = current.sounds.get(change['_id'] as string);
    const sent = { ...change };
    delete sent['_id'];
    differing.push(...differences(sent, track?.toObject() ?? {}, `track ${String(change['_id'])}`));
  }
  if (differing.length) {
    notApplied(
      `Playlist "${current.name}" reads back differently after the update: ${differing.join('; ')}`
    );
  }
  const warnings = fieldWarnings(fields.loose, stored, `playlist "${current.name}"`);

  const changed = Object.keys(playlistChanges);
  context.recordChange({
    query: 'managePlaylists',
    tool: 'manage-playlists',
    document: 'Playlists',
    action: 'update',
    targets: [{ id: current.id, uuid: current.uuid, name: current.name }],
    summary:
      `Changed the playlist "${current.name}"` +
      (changed.length ? `: ${changed.join(', ')}` : '') +
      (soundUpdates.length ? `; ${soundUpdates.length} tracks` : '') +
      '.',
    before: smallEnough(before),
  });
  return {
    success: true,
    action: 'update',
    playlist: { id: current.id, name: current.name },
    fieldsUpdated: changed,
    soundsUpdated: soundUpdates.length,
    ...(warnings.length ? { warnings } : {}),
  };
}

async function remove(args: Fields, context: HandlerContext): Promise<unknown> {
  const problems = refuseUnknown(args, ['action', 'playlist']);
  if (problems.length)
    invalid(`Invalid arguments: ${problems.join('; ')}. delete takes only playlist`);
  const identifier = typeof args['playlist'] === 'string' ? args['playlist'].trim() : '';
  if (!identifier) invalid('delete requires a playlist identifier (its id)');
  // One implementation with delete-playlist: by id only, refused while a scene uses the playlist.
  const answer = (await deletePlaylist.run({ playlistId: identifier }, context)) as {
    id: string;
    name: string;
  };
  return { success: true, action: 'delete', deleted: answer.name, id: answer.id };
}

function describe(args: Fields, context: HandlerContext): unknown {
  const problems = refuseUnknown(args, ['action', 'playlist']);
  if (problems.length)
    invalid(`Invalid arguments: ${problems.join('; ')}. describe takes only playlist`);
  const raw = args['playlist'];
  if (raw !== undefined && raw !== null && typeof raw !== 'string') {
    invalid(`playlist must be a string or null, got ${typeOf(raw)}`);
  }
  const identifier = typeof raw === 'string' ? raw.trim() : '';

  if (!identifier) {
    // The same answer as list-playlists without tracks; mode as number and name, as below.
    const answer = listPlaylists.run({ includeSounds: false }, context) as {
      playlists: Array<Record<string, unknown>>;
    };
    return {
      success: true,
      playlists: answer.playlists.map(entry => {
        const mode = (
          game.playlists.get(String(entry['id'])) as FoundryEffectsPlaybackPlaylist | undefined
        )?.mode;
        return { ...entry, mode: mode ?? null, modeName: modeName(mode) };
      }),
    };
  }

  const playlist = findPlaylist(identifier, 'read');
  const folderId = idOf(playlist.folder);
  const folder = folderId ? game.folders.get(folderId) : undefined;
  return {
    success: true,
    playlist: {
      id: playlist.id,
      name: playlist.name,
      mode: playlist.mode ?? null,
      modeName: modeName(playlist.mode),
      playing: playlist.playing === true,
      description: typeof playlist.description === 'string' ? playlist.description : '',
      folder: folderId ? { id: folderId, name: folder?.name ?? null } : null,
      sort: playlist.sort ?? null,
      sorting: playlist.sorting ?? null,
      channel: playlist.channel ?? null,
      fade: playlist.fade ?? null,
      sounds: playlist.sounds.map(sound => ({
        id: sound.id,
        name: sound.name,
        path: typeof sound.path === 'string' ? sound.path : null,
        volume: typeof sound.volume === 'number' ? sound.volume : null,
        repeat: sound.repeat === true,
        fade: typeof sound.fade === 'number' ? sound.fade : null,
        playing: sound.playing === true,
      })),
    },
  };
}

export const managePlaylists: QueryHandler = {
  access: playlistAccess,
  run: async (data, context) => {
    requireWorld();
    const args = argsOf(data);
    const action = args['action'];
    if (action === undefined) invalid('action is required (create | update | delete | describe)');
    if (action === 'create') return create(args, context);
    if (action === 'update') return update(args, context);
    if (action === 'delete') return remove(args, context);
    if (action === 'describe') return describe(args, context);
    invalid(`Unknown action: ${String(action)}. Use one of ${ACTIONS.join(', ')}`);
  },
};
