/**
 * list-playlists, set-scene-playlist, delete-playlist.
 */
import { readOnlyTool, writingTool, type ToolDefinition } from '../../tools/types.js';
import { askModule, isRecord, listIn, param, schema, str, unknownShape } from './shared.js';

export function formatPlaylists(answer: unknown): string {
  const list = listIn(answer, 'playlists');
  if (!list) return unknownShape(answer);
  if (!list.length) return 'No playlists in this world.';
  const lines: string[] = [];
  for (const playlist of list.filter(isRecord)) {
    const sounds = Array.isArray(playlist['sounds']) ? playlist['sounds'].filter(isRecord) : null;
    const count =
      typeof playlist['soundCount'] === 'number' ? playlist['soundCount'] : (sounds?.length ?? 0);
    lines.push(`${str(playlist['name'])} (${count} tracks, id ${str(playlist['id'])})`);
    for (const sound of sounds ?? []) {
      lines.push(`  [${str(sound['id'])}] ${str(sound['name'])}`);
    }
  }
  return lines.join('\n');
}

/**
 * This generation answers with `sceneName`, `removed` and the rest; the
 * previous module with the texts `scene`, `playlist`, `sound`, where an empty
 * `playlist` means the link was removed. A refusal of that module never gets
 * here (askModule turns it into an error), so an empty `playlist` is not
 * mistaken for a removal.
 */
export function formatScenePlaylist(answer: unknown): string {
  if (!isRecord(answer)) return unknownShape(answer);
  if (typeof answer['sceneName'] !== 'string') {
    if (typeof answer['scene'] !== 'string') return unknownShape(answer);
    const playlist = str(answer['playlist']);
    if (!playlist) return `Scene "${answer['scene']}": link removed`;
    const sound = str(answer['sound']);
    return `Scene "${answer['scene']}": playlist "${playlist}"${sound ? `, track "${sound}"` : ''}`;
  }
  const scene = answer['sceneName'];
  if (answer['removed'] === true) {
    return `Scene "${scene}": link removed${answer['hadLink'] === false ? ' (it had none)' : ''}`;
  }
  const sound = str(answer['soundName']);
  return `Scene "${scene}": playlist "${str(answer['playlistName'])}"${sound ? `, track "${sound}"` : ''}`;
}

export const listPlaylistsTool: ToolDefinition = {
  name: 'list-playlists',
  title: 'List playlists',
  group: 'playlists',
  description:
    'List the playlists in the world with their sounds. Use this to find the exact playlist and sound name before ' +
    'linking one to a scene, or to check whether a playlist referenced by a journal actually exists in the world.',
  inputSchema: schema({
    includeSounds: param(
      'boolean',
      'List the tracks of every playlist as well; true when left out'
    ),
  }),
  annotations: readOnlyTool('List playlists'),
  handler: async (args, context) =>
    formatPlaylists(
      await askModule(
        context,
        'listPlaylists',
        { includeSounds: args['includeSounds'] !== false },
        'list playlists'
      )
    ),
};

export const setScenePlaylistTool: ToolDefinition = {
  name: 'set-scene-playlist',
  title: 'Link a playlist to a scene',
  group: 'playlists',
  description:
    'Link a playlist, and optionally one specific sound, to a scene so it starts when the scene is activated. ' +
    'Pass an empty playlistName to remove the link. The playlist has to exist in the world; use ' +
    'import-from-compendium first if it only exists in a compendium. Names are matched exactly; a sound may also ' +
    'be given as part of its name, as long as only one sound matches.',
  inputSchema: schema(
    {
      sceneIdentifier: param('string', 'Id or exact name of the scene'),
      playlistName: param(
        'string',
        'Id or exact name of the playlist; an empty text removes the link'
      ),
      soundName: param(
        'string',
        'Optional track of that playlist: id, name, or a unique part of the name'
      ),
    },
    ['sceneIdentifier']
  ),
  annotations: writingTool('Link a playlist to a scene', { destructive: true, idempotent: true }),
  handler: async (args, context) => {
    const data: Record<string, unknown> = { sceneIdentifier: args['sceneIdentifier'] };
    if (args['playlistName'] !== undefined) data['playlistName'] = args['playlistName'];
    if (args['soundName'] !== undefined) data['soundName'] = args['soundName'];
    return formatScenePlaylist(
      await askModule(context, 'setScenePlaylist', data, 'set the scene playlist')
    );
  },
};

export const deletePlaylistTool: ToolDefinition = {
  name: 'delete-playlist',
  title: 'Delete a playlist',
  group: 'playlists',
  description:
    'Delete a playlist by its id. Refuses while the playlist is still linked to a scene, and names those scenes. ' +
    'Requires the playlist permission to be set to full.',
  inputSchema: schema({ playlistId: param('string', 'Id of the playlist to delete') }, [
    'playlistId',
  ]),
  annotations: writingTool('Delete a playlist', { destructive: true, idempotent: true }),
  handler: async (args, context) => {
    const answer = await askModule(
      context,
      'deletePlaylist',
      { playlistId: args['playlistId'] },
      'delete playlist'
    );
    const name = isRecord(answer) ? str(answer['name']) : '';
    return name ? `Playlist "${name}" deleted.` : unknownShape(answer);
  },
};
