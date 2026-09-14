/**
 * The tools of the effects-playback area. Names and parameters are the original's;
 * the tool directory does not list
 * them, because our previous generation never had them. The descriptions are
 * written anew and say what this version does.
 *
 * Every rule lives in the module. The server passes the arguments on, turns a
 * failure into one error with its cause, and says plainly when the connected
 * module is too old to know the query.
 */
import { isBlank, prepareContent } from '../../../common/areas/effects-playback/content.js';
import type { ToolAnnotations } from '../../control/api.js';
import { BridgeError } from '../../bridge/foundry-bridge.js';
import { legacyFailure, messageOf } from '../../tools/results.js';
import {
  writingTool,
  type ToolContext,
  type ToolDefinition,
  type ToolGroup,
} from '../../tools/types.js';

type Answer = Record<string, unknown>;

const isRecord = (value: unknown): value is Answer =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The module has no handler for the query: a module of the previous generation. */
export function isUnknownQuery(problem: unknown): boolean {
  if (problem instanceof BridgeError && problem.moduleCode === 'UNKNOWN_QUERY') return true;
  return /No handler found for query/i.test(messageOf(problem));
}

const TOO_OLD = 'does not know the query';

function tooOld(operation: string, query: string, problem: unknown): Error {
  return new Error(
    `Failed to ${operation}: the connected Foundry module ${TOO_OLD} ${query}, so it is older than this ` +
      "server. Update the module Ninjo's Foundry MCP in Foundry and reload the world. Nothing was changed. " +
      `(${messageOf(problem)})`
  );
}

/** Ask the module; every failure becomes "Failed to <operation>: <cause>", wrapped once. */
export async function askModule(
  context: ToolContext,
  query: string,
  payload: Answer,
  operation: string
): Promise<Answer> {
  let answer: unknown;
  try {
    answer = await context.query(query, payload);
  } catch (problem) {
    if (isUnknownQuery(problem)) throw tooOld(operation, query, problem);
    throw new Error(`Failed to ${operation}: ${messageOf(problem)}`);
  }
  const failure = legacyFailure(answer);
  if (failure !== null) throw new Error(`Failed to ${operation}: ${failure}`);
  if (!isRecord(answer)) {
    const shown = JSON.stringify(answer);
    throw new Error(`Failed to ${operation}: the module answered ${shown} instead of a result`);
  }
  return answer;
}

// Schema pieces, one line each.
const str = (about: string) => ({ type: 'string', description: about });
const strOrNull = (about: string) => ({ type: ['string', 'null'], description: about });
const pick = (values: string[], about: string) => ({
  type: 'string',
  enum: values,
  description: about,
});
const int = (about: string, more: Answer = {}) => ({
  type: 'integer',
  description: about,
  ...more,
});
const objectOf = (params: Answer, needs: string[] = []) => ({
  type: 'object',
  properties: params,
  required: needs,
  additionalProperties: false,
});

interface Spec {
  id: string;
  title: string;
  group: ToolGroup;
  query: string;
  verb: string;
  about: string;
  params: Answer;
  needs: string[];
  hints: ToolAnnotations;
}

function define(spec: Spec): ToolDefinition {
  return {
    name: spec.id,
    title: spec.title,
    group: spec.group,
    description: spec.about,
    inputSchema: objectOf(spec.params, spec.needs),
    annotations: spec.hints,
    handler: (args, context) => askModule(context, spec.query, args, spec.verb),
  };
}

export const manageEffectsTool = define({
  id: 'manage-effects',
  title: 'Manage active effects',
  group: 'effects',
  query: 'manageEffects',
  verb: 'manage effects',
  about:
    'Create, change or delete an active effect on an actor, or on an item that actor carries. The effect ' +
    'fields go to Foundry as given, without game system rules; Foundry drops unknown fields, and the result ' +
    'lists every field that was dropped or stored differently. Find effect ids with get-character (effects ' +
    'of the actor) or get-character-entity (effects of an item). An effect that lies on an item is changed ' +
    'there, with parentType "item"; parentType "actor" never touches it. create and update need the actor ' +
    'permission "create and change", delete needs "create, change and delete", which is off by default. ' +
    'Every change is read back.',
  params: {
    action: pick(['create', 'update', 'delete'], 'What to do with the effect.'),
    actorIdentifier: str(
      'Id, exact name (case ignored when unique) or uuid of the actor. An unlinked token actor needs its uuid.'
    ),
    parentType: pick(['actor', 'item'], 'Effect on the actor itself, or on one of its items.'),
    parentItemIdentifier: str(
      'With parentType "item" only, and required there: id or name of the item.'
    ),
    effectId: str('Id of the effect. Required for update and delete, not allowed for create.'),
    effectData: {
      type: 'object',
      description:
        'Effect fields for create (name required) and update (at least one; lists such as changes are ' +
        'replaced as a whole). Not allowed for delete.',
    },
  },
  needs: ['action', 'actorIdentifier', 'parentType'],
  hints: writingTool('Manage active effects', { destructive: true, idempotent: false }),
});

const TRACK = {
  ...objectOf({
    id: str('Id of an existing track (update only).'),
    name: str('Name of the track.'),
    path: str('Audio file path relative to the Foundry data directory.'),
    volume: { type: 'number', description: 'Volume from 0 to 1.' },
    repeat: { type: 'boolean', description: 'Repeat the track.' },
    fade: int('Fade in milliseconds.', { minimum: 0 }),
  }),
  description:
    'A track. create: path required, name defaults to the file name. update: found by id, else by a unique ' +
    'exact path, else by a unique exact name (case counts); the other given fields are written.',
};

export const managePlaylistsTool = define({
  id: 'manage-playlists',
  title: 'Manage playlists',
  group: 'playlists',
  query: 'managePlaylists',
  verb: 'manage playlists',
  about:
    'Describe, create, update or delete playlists. describe without playlist lists every playlist (like ' +
    'list-playlists); with playlist it returns that one with its tracks, and a unique part of the name is ' +
    'enough there. create checks every track first and creates the playlist with all tracks in one step. ' +
    'update changes fields of the playlist and of existing tracks; adding or removing tracks is not part of ' +
    'it. delete works by playlist id only, is refused while a scene still uses the playlist, and needs the ' +
    'playlist permission "create, change and delete". For changes a playlist is found by id or exact name ' +
    '(case ignored when unique), never by a part of the name.',
  params: {
    action: pick(['create', 'update', 'delete', 'describe'], 'What to do.'),
    playlist: strOrNull(
      'Id or name for describe and update, id for delete. Null with describe lists all.'
    ),
    name: str('Name of the new playlist (create, required) or the new name (update).'),
    mode: int('-1 disabled, 0 in order, 1 shuffled, 2 all at once (ambience).', {
      enum: [-1, 0, 1, 2],
    }),
    fade: int('Crossfade in milliseconds.', { minimum: 0 }),
    description: str('Description of the playlist.'),
    sorting: pick(['a', 'm'], '"a" alphabetical, "m" manual.'),
    folder: strOrNull(
      'Id of a playlist folder, or null for the top level. A name is not accepted.'
    ),
    color: strOrNull('Colour as text, or null. When Foundry does not keep it, the result says so.'),
    channel: pick(['music', 'environment', 'interface'], 'Audio channel of the playlist.'),
    sounds: {
      type: 'array',
      items: TRACK,
      description: 'Tracks to create, or to change with update.',
    },
    updates: {
      type: 'object',
      description:
        'More playlist fields for update. A parameter of the same name wins; known fields are checked alike.',
    },
  },
  needs: ['action'],
  hints: writingTool('Manage playlists', { destructive: true, idempotent: false }),
});

export const controlPlaylistTool = define({
  id: 'control-playlist',
  title: 'Control playlist playback',
  group: 'playlists',
  query: 'controlPlaylist',
  verb: 'control playlist',
  about:
    "Play or stop a playlist or one of its tracks, or switch its mode, through Foundry's own playback, so " +
    'every connected browser follows. Playlist and track are found by id or exact name (case ignored when ' +
    'unique), never by a part of the name. The state is read back: a playlist without tracks or in mode ' +
    '"disabled" is an error, not a silent success. Browsers may only play sound after someone clicked on ' +
    'the page once. Needs the playlist permission "create and change".',
  params: {
    playlist: str('Id or name of the playlist.'),
    command: pick(
      ['play', 'stop', 'cycle-mode', 'play-sound', 'stop-sound'],
      'play the playlist as its mode says, stop all its tracks, cycle-mode to the next mode, or play-sound ' +
        'and stop-sound for one track.'
    ),
    sound: str(
      'Track for play-sound and stop-sound, required there: id or name. Not for other commands.'
    ),
  },
  needs: ['playlist', 'command'],
  hints: writingTool('Control playlist playback', { destructive: false, idempotent: false }),
});

export const updateSceneMusicTool = define({
  id: 'update-scene-music',
  title: 'Set the music of a scene',
  group: 'playlists',
  query: 'updateSceneMusic',
  verb: 'update scene music',
  about:
    'Set or clear the playlist and the single track a scene plays when it is activated. A parameter left ' +
    'out keeps that field; null or an empty text clears it. playlist_sound alone picks a track of the ' +
    'playlist the scene already has. A new playlist keeps the track only when it belongs to it, otherwise ' +
    'the track is cleared and the result says so; the scene never points at a track outside its playlist. ' +
    'Scene, playlist and track are found by id or exact name (case ignored when unique). Needs the scene ' +
    'permission "create and change".',
  params: {
    scene_identifier: str('Id or name of the scene.'),
    playlist: strOrNull(
      'Id or name of the playlist; null or empty clears it. Leave out to keep it.'
    ),
    playlist_sound: strOrNull('Id or name of a track in that playlist; null or empty clears it.'),
  },
  needs: ['scene_identifier'],
  hints: writingTool('Set the music of a scene', { destructive: true, idempotent: true }),
});

/** A page as the old module's listJournals shows it. */
function legacyPage(list: unknown, journalId: string, pageId: string): Answer | null {
  if (!Array.isArray(list)) return null;
  const journal = list.find(entry => isRecord(entry) && entry['id'] === journalId);
  const pages = isRecord(journal) && Array.isArray(journal['pages']) ? journal['pages'] : [];
  const page = pages.find(entry => isRecord(entry) && entry['id'] === pageId);
  return isRecord(page) ? page : null;
}

/** The whole stored page, read in chunks through getJournalPageContent. */
async function readWholePage(
  context: ToolContext,
  journalId: string,
  pageId: string,
  verb: string
) {
  let whole = '';
  let offset = 0;
  for (let round = 0; round < 1000; round += 1) {
    const piece = await askModule(
      context,
      'getJournalPageContent',
      { journalId, pageId, offset, maxChars: 200_000 },
      verb
    );
    whole += typeof piece['content'] === 'string' ? piece['content'] : '';
    const next = piece['nextOffset'];
    if (piece['hasMore'] !== true || typeof next !== 'number' || next <= offset) break;
    offset = next;
  }
  return whole;
}

/**
 * replace-journal-page against a module of the previous generation: the page
 * type through listJournals, the content through updateJournalContent, and the
 * whole page read back and compared. Renaming is refused there, because the
 * old module's form with both pageId and a new name is not described.
 */
async function replaceWithOldModule(args: Answer, context: ToolContext, cause: unknown) {
  const verb = 'replace journal page';
  if (args['newPageName'] !== undefined) throw tooOld(verb, 'replaceJournalPage', cause);
  const journalId = String(args['journalId']).trim();
  const pageId = String(args['pageId']).trim();
  const content = String(args['newContent']);
  if (isBlank(content)) {
    throw new Error(
      `Failed to ${verb}: newContent is empty or only white space; nothing was changed`
    );
  }

  let list: unknown;
  try {
    list = await context.query('listJournals', {});
  } catch (problem) {
    throw new Error(`Failed to ${verb}: ${messageOf(problem)}`);
  }
  const page = legacyPage(list, journalId, pageId);
  if (!page) throw new Error(`Failed to ${verb}: page ${pageId} not found in journal ${journalId}`);
  if (page['type'] !== 'text') {
    const kind = `page "${String(page['name'])}" (${pageId}) is a ${String(page['type'])} page`;
    throw new Error(`Failed to ${verb}: ${kind}; only text pages have HTML content`);
  }

  const prepared = prepareContent(content);
  const html = prepared.html;
  const written = await askModule(
    context,
    'updateJournalContent',
    { journalId, pageId, content: html },
    verb
  );
  const stored = await readWholePage(context, journalId, pageId, verb);
  if (stored !== html) {
    throw new Error(
      `Failed to ${verb}: the page reads back with ${stored.length} characters instead of ${html.length}. ` +
        'The content was sent to Foundry, so check the page before retrying.'
    );
  }
  const note =
    'The connected Foundry module is older than this server; its previous queries wrote the page.';
  return {
    success: true,
    message: 'Page content replaced successfully',
    journalId,
    pageId,
    pageName: typeof written['pageName'] === 'string' ? written['pageName'] : page['name'],
    length: html.length,
    format: prepared.format,
    verified: true,
    details: `Page content replaced and read back identical. New content length: ${html.length} characters.`,
    note: prepared.note ? `${note} ${prepared.note}` : note,
  };
}

const replaceJournalPageBase = define({
  id: 'replace-journal-page',
  title: 'Replace the content of a page',
  group: 'journals',
  query: 'replaceJournalPage',
  verb: 'replace journal page',
  about:
    'Replace the whole content of one text page, and optionally rename it, in one write. Content with HTML ' +
    'tags is stored exactly as sent. Plain text becomes paragraphs: a blank line starts a new paragraph, a ' +
    'single line break stays a break, and nothing is removed; Markdown is not converted, and the result says ' +
    'when the text looks like Markdown. Empty content is refused. The page is read back and compared; the ' +
    'result carries its length, not the content. To append instead, use journal-append-page. Needs the ' +
    'journal permission "create and change".',
  params: {
    journalId: str('Id of the journal, from list-journals.'),
    pageId: str('Id of the text page, from list-journals.'),
    newContent: str('The new content: HTML, or plain text that becomes paragraphs.'),
    newPageName: str('New name of the page. Leave out to keep the name.'),
  },
  needs: ['journalId', 'pageId', 'newContent'],
  hints: writingTool('Replace the content of a page', { destructive: true, idempotent: true }),
});

export const replaceJournalPageTool: ToolDefinition = {
  ...replaceJournalPageBase,
  handler: async (args, context) => {
    try {
      return await replaceJournalPageBase.handler(args, context);
    } catch (problem) {
      const old =
        problem instanceof Error && problem.message.includes(`${TOO_OLD} replaceJournalPage`);
      if (!old) throw problem;
      return replaceWithOldModule(args, context, problem);
    }
  },
};

export const EFFECTS_PLAYBACK_TOOLS: readonly ToolDefinition[] = [
  manageEffectsTool,
  managePlaylistsTool,
  controlPlaylistTool,
  updateSceneMusicTool,
  replaceJournalPageTool,
];
