/**
 * The scene tools on the server side.
 *
 * Names and parameters are those of the tool directory; the
 * descriptions are written anew. Each handler asks the module with the query
 * name a module of either generation answers, turns a failure
 * sent as a normal value into an error, and formats the answer forms of both
 * generations (format.ts). Only an answer of neither form is passed on as JSON.
 *
 * Schemas are assembled from the builders in `field` and `shape`; every tool
 * is made by `sceneTool`, which fixes the group.
 */
import { BridgeError } from '../../bridge/foundry-bridge.js';
import { legacyFailure } from '../../tools/results.js';
import {
  readOnlyTool,
  writingTool,
  type ToolContext,
  type ToolDefinition,
  type ToolOutput,
} from '../../tools/types.js';
import {
  currentScene,
  formatCreate,
  formatFolders,
  formatNote,
  formatRestore,
  formatSceneList,
  formatSwitch,
  formatThumb,
  foldersCreatedLine,
  isRecord,
  str,
  warningLines,
} from './format.js';

type Fragment = Record<string, unknown>;

/** Parameter fragments. A description is optional; a default is added only when given. */
const field = {
  text: (description?: string, fallback?: string): Fragment =>
    fragment('string', description, fallback),
  number: (description?: string): Fragment => fragment('number', description),
  flag: (description?: string, fallback?: boolean): Fragment =>
    fragment('boolean', description, fallback),
};

function fragment(kind: string, description?: string, fallback?: unknown): Fragment {
  const out: Fragment = { type: kind };
  if (description !== undefined) out['description'] = description;
  if (fallback !== undefined) out['default'] = fallback;
  return out;
}

/** An object schema; `required` only appears when a tool has mandatory parameters. */
function shape(fields: Record<string, Fragment>, ...mandatory: string[]): Fragment {
  return mandatory.length
    ? { type: 'object', properties: fields, required: mandatory }
    : { type: 'object', properties: fields };
}

/** A module that lacks the query answers 'No handler found'; the harness also sets UNKNOWN_QUERY. */
function queryMissing(problem: unknown): boolean {
  if (!(problem instanceof BridgeError)) return false;
  return problem.moduleCode === 'UNKNOWN_QUERY' || /no handler found/i.test(problem.message);
}

const NOT_GAMEMASTER =
  'Access denied: the module refused because the connected Foundry user is not a Gamemaster.';

async function ask(context: ToolContext, queryName: string, data: Fragment): Promise<unknown> {
  const reply: unknown = await context.query(queryName, data).catch((problem: unknown) => {
    if (!queryMissing(problem)) throw problem;
    const cause = (problem as Error).message;
    throw new Error(
      `The connected Foundry module does not answer the query ${queryName} (${cause}). ` +
        'Update the module ninjos-foundry-mcp in Foundry.'
    );
  });
  const failure = legacyFailure(reply);
  if (failure === null) return reply;
  throw new Error(failure === 'Access denied' ? NOT_GAMEMASTER : failure);
}

/** Text when the answer has a known form, otherwise the answer as it came. */
function shown(answer: unknown, text: string | null): ToolOutput {
  if (text !== null) return text;
  if (isRecord(answer) || Array.isArray(answer)) return answer;
  return typeof answer === 'string' ? answer : JSON.stringify(answer ?? null);
}

function sceneTool(
  toolName: string,
  title: string,
  about: string,
  inputSchema: Fragment,
  annotations: ToolDefinition['annotations'],
  handler: ToolDefinition['handler']
): ToolDefinition {
  return {
    name: toolName,
    title,
    group: 'scenes',
    description: about,
    inputSchema,
    annotations,
    handler,
  };
}

/** Forward the arguments unchanged and format the reply with `format`. */
function passThrough(queryName: string, format: (answer: unknown) => string | null) {
  return async (args: Fragment, context: ToolContext): Promise<ToolOutput> => {
    const answer = await ask(context, queryName, args);
    return shown(answer, format(answer));
  };
}

const sceneRef = field.text(
  'Id or name of the scene. A name matches exactly, or in any case when only one scene has it.'
);
const journalRef = field.text(
  'Journal linked as the scene journal (shown by Foundry for the scene, unlike a note on the map), by id or ' +
    'name. An empty string removes the link.'
);
const journalPage = field.text('Page of that journal to open, by id or exact name');

export const listScenesTool = sceneTool(
  'list-scenes',
  'List scenes',
  'List the scenes of the world with id, name, whether active, size, grid size, background and how many ' +
    'walls, tokens, lights and sounds each holds. filter narrows by a part of the name, in any case.',
  shape({
    filter: field.text('Only scenes whose name contains this text, in any case', ''),
    include_active_only: field.flag('Only the scene that is active for everyone', false),
  }),
  readOnlyTool('List scenes'),
  async (args, context) => {
    const onlyActive = args['include_active_only'] === true;
    const nameFilter = typeof args['filter'] === 'string' ? args['filter'] : '';
    const answer = await ask(context, 'list-scenes', {
      filter: nameFilter,
      include_active_only: onlyActive,
    });
    return shown(answer, formatSceneList(answer));
  }
);

export const listSceneFoldersTool = sceneTool(
  'list-scene-folders',
  'List scene folders',
  'List every scene folder with its full path, its id and how many scenes lie directly in it. Call it before ' +
    'create-scene or update-scene to pick a valid folderPath.',
  shape({}),
  readOnlyTool('List scene folders'),
  (_args, context) => passThrough('listSceneFolders', formatFolders)({}, context)
);

export const getCurrentSceneTool = sceneTool(
  'get-current-scene',
  'Current scene',
  'Describe the scene that is active for everyone: size, background, navigation, how many walls, lights, ' +
    'sounds and notes it holds, its notes, and with includeTokens its tokens. Hidden tokens are left out of the ' +
    'list and the summary unless includeHidden is set.',
  shape({
    includeTokens: field.flag('List the tokens on the scene (default: true)', true),
    includeHidden: field.flag('Include hidden tokens (default: false)', false),
  }),
  readOnlyTool('Current scene'),
  async (args, context) => {
    const withTokens = args['includeTokens'] !== false;
    const withHidden = args['includeHidden'] === true;
    const answer = await ask(context, 'getActiveScene', {
      includeTokens: withTokens,
      includeHidden: withHidden,
    });
    return currentScene(answer, withTokens, withHidden) ?? shown(answer, null);
  }
);

export const createSceneTool = sceneTool(
  'create-scene',
  'Create scene',
  'Create a scene from an image or video already in the Foundry data directory, such as a battlemap or a ' +
    'location picture. Without width and height the file is measured so the grid fits. templateName copies ' +
    'the settings of an existing scene (grid, lighting, level settings) but nothing that lies on its map and ' +
    'never its id. folderPath takes nested paths like "Locations/Harbour" and creates missing folders. ' +
    'journalIdentifier links a journal as the scene journal.',
  shape(
    {
      name: field.text('Name of the scene; underscores become spaces'),
      background: field.text(
        'Path of the image or video inside the Foundry data directory, e.g. "Maps/Hafen/SC_Hafen_Nacht.webp"'
      ),
      navName: field.text(
        'Label in the scene navigation. Without it: the name without an SC_ or BM_ prefix, underscores as spaces.'
      ),
      folderPath: field.text('Folder path, nested with "/", e.g. "Locations/Harbour"'),
      templateName: field.text('Id or name of a scene whose settings are copied'),
      width: field.number('Width in pixels instead of the measured one'),
      height: field.number('Height in pixels instead of the measured one'),
      padding: field.number('Padding around the map; default the template value or 0'),
      gridSize: field.number('Grid size in pixels; default the template value or 100'),
      navigation: field.flag('Show the scene in the navigation (default false)'),
      journalIdentifier: journalRef,
      journalPageName: journalPage,
      activate: field.flag('Activate the scene for everyone once it exists'),
    },
    'name',
    'background'
  ),
  writingTool('Create scene', { destructive: false, idempotent: false }),
  passThrough('createScene', formatCreate)
);

export const restoreSceneTool = sceneTool(
  'restore-scene',
  'Restore scene',
  'Recreate a scene from a JSON file in the Foundry data directory, for example one pulled out of a world ' +
    'backup, with its walls, tiles, lights, sounds, tokens and levels. The file travels as a file because a ' +
    'scene with walls is too large for the bridge. The scene always gets a new id unless keepId is set, is ' +
    'never active, and never overwrites an existing scene.',
  shape(
    {
      jsonPath: field.text(
        'Path of the JSON file inside the Foundry data directory, e.g. "Bergung/szenen.json". One scene or a list.'
      ),
      index: field.number('Entry of the list to restore; needed when the list holds more than one'),
      name: field.text('A different name for the restored scene'),
      folderPath: field.text('Folder path, nested with "/"'),
      keepId: field.flag('Keep the id of the backup. Only when the original scene is really gone.'),
      navigation: field.flag('Show the scene in the navigation'),
    },
    'jsonPath'
  ),
  writingTool('Restore scene', { destructive: false, idempotent: false }),
  passThrough('restoreScene', formatRestore)
);

export const updateSceneTool = sceneTool(
  'update-scene',
  'Update scene',
  'Change an existing scene: name, navigation label, background image or video, background colour, size, ' +
    'folder, navigation, or the linked scene journal. A new background without width and height is measured ' +
    'and the scene takes its size. An empty journalIdentifier removes the link. Every change is read back.',
  shape(
    {
      sceneIdentifier: sceneRef,
      name: field.text('New name; the navigation label follows unless navName is given'),
      navName: field.text('New label in the navigation'),
      background: field.text('New background path inside the Foundry data directory'),
      backgroundColor: field.text('Colour around the artwork, as hex like "#000000"'),
      folderPath: field.text('Move into this folder path; empty for no folder'),
      width: field.number(),
      height: field.number(),
      navigation: field.flag(),
      journalIdentifier: journalRef,
      journalPageName: journalPage,
    },
    'sceneIdentifier'
  ),
  writingTool('Update scene', { destructive: true, idempotent: true }),
  async (args, context) => {
    const answer = await ask(context, 'updateScene', args);
    if (!isRecord(answer) || !Array.isArray(answer['changed'])) return shown(answer, null);
    const report = [
      `Scene "${str(answer['name'])}" changed (${answer['changed'].map(str).join(', ')})`,
    ];
    if (answer['measured'] === true) report.push('The new size was measured from the file.');
    report.push(...foldersCreatedLine(answer), ...warningLines(answer));
    return report.join('\n');
  }
);

export const createSceneNoteTool = sceneTool(
  'create-scene-note',
  'Place a journal note',
  'Place a note on a scene at pixel coordinates that opens a journal, or one page of it, when clicked. ' +
    'Useful to make the places on a town map clickable.',
  shape(
    {
      sceneIdentifier: sceneRef,
      journalName: field.text('Id or name of the journal'),
      pageName: field.text('Page of that journal, by id or exact name'),
      x: field.number('X in scene pixels'),
      y: field.number('Y in scene pixels'),
      label: field.text('Text shown at the note'),
      icon: field.text('Icon path, default "icons/svg/book.svg"'),
      iconSize: field.number('Icon size in pixels, default 40'),
    },
    'sceneIdentifier',
    'journalName',
    'x',
    'y'
  ),
  writingTool('Place a journal note', { destructive: false, idempotent: false }),
  passThrough('createSceneNote', formatNote)
);

export const refreshSceneThumbTool = sceneTool(
  'refresh-scene-thumb',
  'Renew scene thumbnail',
  'Create the thumbnail of a scene anew. Needed after a background swap: Foundry keeps showing the old picture ' +
    'in the sidebar until then.',
  shape({ sceneIdentifier: sceneRef }, 'sceneIdentifier'),
  writingTool('Renew scene thumbnail', { destructive: false, idempotent: true }),
  passThrough('refreshSceneThumb', formatThumb)
);

export const switchSceneTool = sceneTool(
  'switch-scene',
  'Switch scene',
  'Activate a scene for every player, by id or name. With optimize_view the view is centred on the map and ' +
    'zoomed so the whole map fits. Players see the switch at once, so this is a change to the world and needs ' +
    'writing to be allowed.',
  shape(
    {
      scene_identifier: field.text('Id or name of the scene to activate'),
      optimize_view: field.flag('Centre and fit the view on the map afterwards', true),
    },
    'scene_identifier'
  ),
  writingTool('Switch scene', { destructive: false, idempotent: true }),
  async (args, context) => {
    const target = args['scene_identifier'];
    const answer = await ask(context, 'switch-scene', {
      scene_identifier: target,
      // The second spelling, which a module of the previous generation also reads.
      sceneId: target,
      optimize_view: args['optimize_view'] !== false,
    });
    return shown(answer, formatSwitch(answer));
  }
);

export const deleteSceneTool = sceneTool(
  'delete-scene',
  'Delete scene',
  'Delete a scene for good, by its id only, so a scene with a similar name is never hit. The active scene is ' +
    'never deleted; activate another one first. Needs the scene permission on "create, change and delete".',
  shape({ sceneId: field.text('Id of the scene') }, 'sceneId'),
  writingTool('Delete scene', { destructive: true, idempotent: true }),
  async (args, context) => {
    const answer = await ask(context, 'deleteScene', args);
    const deletedName = isRecord(answer) ? answer['name'] : undefined;
    if (typeof deletedName !== 'string') return shown(answer, null);
    return `Scene "${deletedName}" deleted.`;
  }
);

export const sceneTools: readonly ToolDefinition[] = [
  listScenesTool,
  listSceneFoldersTool,
  getCurrentSceneTool,
  createSceneTool,
  restoreSceneTool,
  updateSceneTool,
  createSceneNoteTool,
  refreshSceneThumbTool,
  switchSceneTool,
  deleteSceneTool,
];
