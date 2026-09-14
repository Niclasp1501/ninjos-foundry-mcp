/**
 * The canvas area on the server: thirteen tools in the group "canvas". None
 * existed in the previous generation, so names and parameters are new.
 * Every answer is text the model can read; the
 * module does the work and the checks.
 */
import {
  readOnlyTool,
  writingTool,
  type ToolContext,
  type ToolDefinition,
} from '../../tools/types.js';
import {
  ask,
  isRecord,
  listOf,
  param,
  pick,
  schema,
  str,
  unknownShape,
  warningLines,
} from '../chat-tables-macros/shared.js';

const ELEMENT_TYPES = ['wall', 'light', 'sound', 'region', 'tile', 'drawing'];
const COLLISION_TYPES = ['move', 'sight', 'light', 'sound'];

const SCENE = param('string', 'Scene id or name; default the scene that is active for everyone');
const VIEWED_SCENE = param(
  'string',
  'Optional check: the scene the Gamemaster views must be this one (id or name), else nothing happens'
);
const DRY_RUN = param(
  'boolean',
  'Only check and report what would happen, including a refusal; change nothing'
);

function place(description: string) {
  return param(
    'object',
    `${description}: { tokenId } (id or name of a token), or { x, y } in pixels`,
    {
      properties: {
        tokenId: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
      },
    }
  );
}

function sceneText(answer: Record<string, unknown>): string {
  const scene = isRecord(answer['scene']) ? answer['scene'] : {};
  const how =
    scene['chosenBy'] === 'active scene'
      ? ' (the active scene)'
      : scene['chosenBy'] === 'viewed scene'
        ? ' (viewed)'
        : '';
  return `"${str(scene['name'])}" [${str(scene['id'])}]${how}`;
}

function fields(row: Record<string, unknown>, skip: readonly string[] = ['id', 'type']): string {
  return Object.entries(row)
    .filter(([key]) => !skip.includes(key))
    .map(([key, value]) => `${key} ${JSON.stringify(value)}`)
    .join(', ');
}

function refusalLine(answer: Record<string, unknown>): string {
  return typeof answer['refusal'] === 'string'
    ? `The real call would be refused: ${answer['refusal']}`
    : 'The real call is allowed.';
}

function hasScene(answer: unknown): answer is Record<string, unknown> {
  return isRecord(answer) && isRecord(answer['scene']);
}

async function run(
  context: ToolContext,
  query: string,
  args: Record<string, unknown>,
  keys: readonly string[],
  operation: string,
  format: (answer: Record<string, unknown>) => string
): Promise<string> {
  const answer = await ask(context, query, pick(args, keys), operation);
  return hasScene(answer) ? format(answer) : unknownShape(answer);
}

export function formatElementList(answer: Record<string, unknown>): string {
  const counts = isRecord(answer['counts']) ? answer['counts'] : {};
  const rows = listOf(answer['elements']).filter(isRecord);
  const offset = typeof answer['offset'] === 'number' ? answer['offset'] : 0;
  const lines = [
    `Scene ${sceneText(answer)} holds ${Object.entries(counts)
      .map(([type, count]) => `${type}s ${String(count)}`)
      .join(', ')}.`,
    rows.length
      ? `${String(answer['matching'])} match; showing ${offset + 1} to ${offset + rows.length}:`
      : 'No element matches.',
    ...rows.map(
      row =>
        `- ${str(row['type'])} ${str(row['id'] ?? row['_id'])}: ${fields(row, ['id', '_id', 'type'])}`
    ),
  ];
  if (typeof answer['nextOffset'] === 'number')
    lines.push(`More match: call again with offset ${answer['nextOffset']}.`);
  return lines.join('\n');
}

export const listCanvasElementsTool: ToolDefinition = {
  name: 'list-canvas-elements',
  title: 'List walls, lights and other canvas elements',
  group: 'canvas',
  description:
    'List the walls (with doors), lights, sounds, regions (with behaviors), tiles and drawings of a scene, with ids ' +
    'and their main fields. Filter by type, by an area in pixels or to doors only. Works without a drawn canvas.',
  inputSchema: schema({
    sceneIdentifier: SCENE,
    elementTypes: param('array', 'Only these types; default all', {
      items: { type: 'string', enum: ELEMENT_TYPES },
    }),
    bounds: param(
      'object',
      'Only elements touching this rectangle in pixels: { x, y, width, height }'
    ),
    doorsOnly: param('boolean', 'Only walls that are doors'),
    raw: param('boolean', 'The stored Foundry data of each element instead of the summary'),
    limit: param('integer', 'How many, 1 to 500; default 100'),
    offset: param('integer', 'Skip this many, for the next page'),
  }),
  annotations: readOnlyTool('List canvas elements'),
  handler: (args, context) =>
    run(
      context,
      'listCanvasElements',
      args,
      ['sceneIdentifier', 'elementTypes', 'bounds', 'doorsOnly', 'raw', 'limit', 'offset'],
      'list canvas elements',
      formatElementList
    ),
};

export const createCanvasElementsTool: ToolDefinition = {
  name: 'create-canvas-elements',
  title: 'Create walls, lights and other canvas elements',
  group: 'canvas',
  description:
    'Create up to 200 elements of one type on a scene in one call, as Foundry data. Walls: c [x0, y0, x1, y1], ' +
    'door none, door or secret, doorState closed, open or locked, move none or normal, sight, light and sound none, ' +
    'limited, normal, proximity or distance, dir both, left or right. Lights: x, y, config { dim, bright, color, ' +
    'angle }. Sounds: x, y, radius, path. Tiles: x, y, width, height, texture { src }. Drawings: x, y, shape { type, ' +
    'width, height, points }. Regions: name, shapes, behaviors. One bad entry creates nothing. Needs the level ' +
    '"change" for scenes.',
  inputSchema: schema(
    {
      elementType: param('string', 'Type of all elements in this call', { enum: ELEMENT_TYPES }),
      elements: param('array', 'The elements, 1 to 200, each an object of Foundry fields', {
        items: { type: 'object' },
      }),
      sceneIdentifier: SCENE,
      dryRun: DRY_RUN,
    },
    ['elementType', 'elements']
  ),
  annotations: writingTool('Create canvas elements', { destructive: false, idempotent: false }),
  handler: (args, context) =>
    run(
      context,
      'createCanvasElements',
      args,
      ['elementType', 'elements', 'sceneIdentifier', 'dryRun'],
      'create canvas elements',
      answer => {
        const rows = listOf(answer[answer['dryRun'] === true ? 'elements' : 'created']).filter(
          isRecord
        );
        const type = str(answer['type']);
        if (answer['dryRun'] === true) {
          return [
            `Dry run: would create ${rows.length} ${type}(s) on the scene ${sceneText(answer)}. Nothing was changed.`,
            ...rows.map(row => `- ${fields(row)}`),
            refusalLine(answer),
          ].join('\n');
        }
        return [
          `Created ${rows.length} ${type}(s) on the scene ${sceneText(answer)}, read back:`,
          ...rows.map(row => `- ${type} ${str(row['id'])}: ${fields(row)}`),
          ...warningLines(answer),
        ].join('\n');
      }
    ),
};

function formatChanged(answer: Record<string, unknown>, what: string): string {
  const type = str(answer['type'], 'wall');
  const unchanged = listOf(answer['unchanged']).map(String);
  if (answer['dryRun'] === true) {
    const rows = listOf(answer['wouldChange']);
    return [
      `Dry run on the scene ${sceneText(answer)}: would change ${rows.length} ${type}(s). Nothing was changed.`,
      ...rows.map(row =>
        isRecord(row)
          ? `- ${str(row['id'])}: ${listOf(row['fields'])
              .filter(isRecord)
              .map(
                f =>
                  `${str(f['path'])} from ${JSON.stringify(f['from'])} to ${JSON.stringify(f['to'])}`
              )
              .join('; ')}`
          : `- ${String(row)}`
      ),
      ...(unchanged.length ? [`Already so: ${unchanged.join(', ')}.`] : []),
      refusalLine(answer),
    ].join('\n');
  }
  const changed = listOf(answer['changed']);
  return [
    changed.length
      ? `${what} ${changed.length} ${type}(s) on the scene ${sceneText(answer)}, read back:`
      : `Nothing to change on the scene ${sceneText(answer)}.`,
    ...changed.map(row =>
      isRecord(row) ? `- ${type} ${str(row['id'])}: ${fields(row)}` : `- ${String(row)}`
    ),
    ...(unchanged.length ? [`Already so, not written: ${unchanged.join(', ')}.`] : []),
    ...warningLines(answer),
  ].join('\n');
}

export const updateCanvasElementsTool: ToolDefinition = {
  name: 'update-canvas-elements',
  title: 'Change walls, lights and other canvas elements',
  group: 'canvas',
  description:
    'Change up to 200 elements of one type on a scene: each entry is { id, changes }, with Foundry fields and dotted ' +
    'keys such as "config.dim". Wall words as in create-canvas-elements. Every id is checked first; one unknown id ' +
    'changes nothing. Fields already holding the value are not written. Needs the level "change" for scenes.',
  inputSchema: schema(
    {
      elementType: param('string', 'Type of all elements in this call', { enum: ELEMENT_TYPES }),
      updates: param('array', 'The changes, 1 to 200: { id, changes }', {
        items: { type: 'object' },
      }),
      sceneIdentifier: SCENE,
      dryRun: DRY_RUN,
    },
    ['elementType', 'updates']
  ),
  annotations: writingTool('Change canvas elements', { destructive: true, idempotent: true }),
  handler: (args, context) =>
    run(
      context,
      'updateCanvasElements',
      args,
      ['elementType', 'updates', 'sceneIdentifier', 'dryRun'],
      'update canvas elements',
      answer => formatChanged(answer, 'Changed')
    ),
};

export const deleteCanvasElementsTool: ToolDefinition = {
  name: 'delete-canvas-elements',
  title: 'Delete walls, lights and other canvas elements',
  group: 'canvas',
  description:
    'Delete up to 200 elements of one type from a scene by id. Every id is checked first. Deleting needs the level ' +
    '"create, change and delete" for scenes, which is off by default; dryRun shows what would go and whether it is ' +
    'allowed.',
  inputSchema: schema(
    {
      elementType: param('string', 'Type of all elements in this call', { enum: ELEMENT_TYPES }),
      ids: param('array', 'Ids, 1 to 200', { items: { type: 'string' } }),
      sceneIdentifier: SCENE,
      dryRun: DRY_RUN,
    },
    ['elementType', 'ids']
  ),
  annotations: writingTool('Delete canvas elements', { destructive: true, idempotent: true }),
  handler: (args, context) =>
    run(
      context,
      'deleteCanvasElements',
      args,
      ['elementType', 'ids', 'sceneIdentifier', 'dryRun'],
      'delete canvas elements',
      answer => {
        const type = str(answer['type']);
        if (answer['dryRun'] === true) {
          const rows = listOf(answer['wouldDelete']).filter(isRecord);
          return [
            `Dry run: would delete ${rows.length} ${type}(s) from the scene ${sceneText(answer)}. Nothing was changed.`,
            ...rows.map(row => `- ${str(row['id'])}: ${fields(row)}`),
            refusalLine(answer),
          ].join('\n');
        }
        const ids = listOf(answer['deleted']).map(String);
        return [
          `Deleted ${ids.length} ${type}(s) from the scene ${sceneText(answer)}: ${ids.join(', ')}. Read back: gone.`,
          ...warningLines(answer),
        ].join('\n');
      }
    ),
};

export const setDoorStateTool: ToolDefinition = {
  name: 'set-door-state',
  title: 'Open, close or lock doors',
  group: 'canvas',
  description:
    'Set doors (walls with door "door" or "secret") to open, closed or locked. Every id must be a door of the scene, ' +
    'else nothing changes. Players see the change at once. Needs the level "change" for scenes.',
  inputSchema: schema(
    {
      wallIds: param('array', 'Ids of the door walls, 1 to 200', { items: { type: 'string' } }),
      state: param('string', 'The new state', { enum: ['open', 'closed', 'locked'] }),
      sceneIdentifier: SCENE,
      dryRun: DRY_RUN,
    },
    ['wallIds', 'state']
  ),
  annotations: writingTool('Set door state', { destructive: false, idempotent: true }),
  handler: (args, context) =>
    run(
      context,
      'setDoorState',
      args,
      ['wallIds', 'state', 'sceneIdentifier', 'dryRun'],
      'set the door state',
      answer => {
        const state = str(answer['state']);
        const unchanged = listOf(answer['unchanged']).map(String);
        if (answer['dryRun'] === true) {
          return [
            `Dry run on the scene ${sceneText(answer)}: would set ${listOf(answer['wouldChange']).map(String).join(', ') || 'no door'} to ${state}. Nothing was changed.`,
            ...(unchanged.length ? [`Already ${state}: ${unchanged.join(', ')}.`] : []),
            refusalLine(answer),
          ].join('\n');
        }
        const changed = listOf(answer['changed']).map(String);
        return [
          changed.length
            ? `Doors now ${state} on the scene ${sceneText(answer)}, read back: ${changed.join(', ')}.`
            : `No door changed on the scene ${sceneText(answer)}.`,
          ...(unchanged.length ? [`Already ${state}: ${unchanged.join(', ')}.`] : []),
          ...warningLines(answer),
        ].join('\n');
      }
    ),
};

export const getCanvasViewTool: ToolDefinition = {
  name: 'get-canvas-view',
  title: 'What the canvas shows',
  group: 'canvas',
  description:
    "Whether the Gamemaster's browser has a drawn canvas, which scene it shows and which is active, the view " +
    "position and zoom, and the Gamemaster's targets. Call it before pan-camera, ping-canvas or set-targets, which need the canvas.",
  inputSchema: schema({}),
  annotations: readOnlyTool('Read the canvas view'),
  handler: async (_args, context) => {
    const answer = await ask(context, 'getCanvasView', {}, 'read the canvas view');
    if (!isRecord(answer) || typeof answer['canvasReady'] !== 'boolean')
      return unknownShape(answer);
    const scene = (value: unknown) =>
      isRecord(value) ? `"${str(value['name'])}" [${str(value['id'])}]` : 'none';
    const view = isRecord(answer['view']) ? answer['view'] : null;
    const targets = listOf(answer['targets']).filter(isRecord);
    return [
      answer['canvasReady']
        ? `The canvas is drawn and shows the scene ${scene(answer['viewedScene'])}.`
        : `There is no drawn canvas in the Gamemaster's browser${answer['noCanvas'] === true ? ' ("Disable Game Canvas" is on)' : ''}. ${listOf(answer['needsCanvas']).join(', ')} will fail; everything else works.`,
      `Active scene: ${scene(answer['activeScene'])}.`,
      ...(view
        ? [
            `View center x ${Math.round(Number(view['x']))}, y ${Math.round(Number(view['y']))}, zoom ${String(view['scale'])}.`,
          ]
        : []),
      targets.length
        ? `Targets: ${targets.map(t => `"${str(t['name'])}" [${str(t['id'])}]`).join(', ')}.`
        : 'No targets.',
    ].join('\n');
  },
};

export const panCameraTool: ToolDefinition = {
  name: 'pan-camera',
  title: 'Pan and zoom the view',
  group: 'canvas',
  description:
    "Move the Gamemaster's view to a token or a point and set the zoom; with forEveryone, also pull every player " +
    'viewing the scene to it (needs "Allow Write Operations"). Needs the drawn canvas in the Gamemaster\'s browser.',
  inputSchema: schema({
    tokenId: param('string', 'Center on this token: id or name'),
    x: param('number', 'Center x in pixels'),
    y: param('number', 'Center y in pixels'),
    scale: param('number', 'Zoom, e.g. 1 for 100 percent'),
    duration: param('integer', 'Animation in milliseconds, 0 to 10000; default 250'),
    forEveryone: param('boolean', 'Pull the view of every user on this scene too'),
    sceneIdentifier: VIEWED_SCENE,
  }),
  annotations: writingTool('Pan the camera', { destructive: false, idempotent: true }),
  handler: (args, context) =>
    run(
      context,
      'panCamera',
      args,
      ['tokenId', 'x', 'y', 'scale', 'duration', 'forEveryone', 'sceneIdentifier'],
      'pan the camera',
      answer => {
        const view = isRecord(answer['view']) ? answer['view'] : null;
        return [
          view
            ? `The Gamemaster view on ${sceneText(answer)} is now at x ${Math.round(Number(view['x']))}, y ${Math.round(Number(view['y']))}, zoom ${String(view['scale'])}.`
            : `The Gamemaster view on ${sceneText(answer)} was panned.`,
          answer['pulled'] === true
            ? 'Every user viewing this scene was pulled to the same point.'
            : 'Only the Gamemaster view moved.',
          ...warningLines(answer),
        ].join('\n');
      }
    ),
};

export const pingCanvasTool: ToolDefinition = {
  name: 'ping-canvas',
  title: 'Ping a point',
  group: 'canvas',
  description:
    'Show a ping at a token or a point to everyone viewing the scene, optionally pulling their views there. Needs ' +
    '"Allow Write Operations" and the drawn canvas in the Gamemaster\'s browser.',
  inputSchema: schema({
    tokenId: param('string', 'Ping this token: id or name'),
    x: param('number', 'x in pixels'),
    y: param('number', 'y in pixels'),
    style: param('string', 'Look of the ping; default pulse', {
      enum: ['pulse', 'alert', 'chevron', 'arrow'],
    }),
    pullViews: param('boolean', 'Also move every view on the scene there'),
    zoom: param('number', 'Zoom for pulled views'),
    sceneIdentifier: VIEWED_SCENE,
  }),
  annotations: writingTool('Ping the canvas', { destructive: false, idempotent: false }),
  handler: (args, context) =>
    run(
      context,
      'pingCanvas',
      args,
      ['tokenId', 'x', 'y', 'style', 'pullViews', 'zoom', 'sceneIdentifier'],
      'ping the canvas',
      answer => {
        const point = isRecord(answer['point']) ? answer['point'] : {};
        return [
          `Pinged (${str(answer['style'])}) at x ${Math.round(Number(point['x']))}, y ${Math.round(Number(point['y']))} on ${sceneText(answer)}` +
            `${answer['pulled'] === true ? ', and pulled every view there' : ''}.`,
          ...warningLines(answer),
        ].join('\n');
      }
    ),
};

export const setTargetsTool: ToolDefinition = {
  name: 'set-targets',
  title: "Set the Gamemaster's targets",
  group: 'canvas',
  description:
    "Replace the Gamemaster's targeted tokens on the viewed scene (ids or names); an empty list clears them. Players " +
    'see the target marks, and later rolls use them. Needs "Allow Write Operations" and the drawn canvas.',
  inputSchema: schema(
    {
      tokenIds: param('array', 'Tokens to target, up to 50; empty clears', {
        items: { type: 'string' },
      }),
      sceneIdentifier: VIEWED_SCENE,
    },
    ['tokenIds']
  ),
  annotations: writingTool('Set targets', { destructive: false, idempotent: true }),
  handler: (args, context) =>
    run(context, 'setTargets', args, ['tokenIds', 'sceneIdentifier'], 'set targets', answer => {
      const list = (key: string) =>
        listOf(answer[key])
          .filter(isRecord)
          .map(t => `"${str(t['name'])}" [${str(t['id'])}]`)
          .join(', ') || 'none';
      return `Targets on ${sceneText(answer)}, read back: ${list('targets')}. Before: ${list('previous')}.`;
    }),
};

function placeText(value: unknown): string {
  if (!isRecord(value)) return '?';
  const token = isRecord(value['token'])
    ? ` ("${str(value['token']['name'])}" [${str(value['token']['id'])}])`
    : '';
  return `x ${Math.round(Number(value['x']))}, y ${Math.round(Number(value['y']))}${token}`;
}

export const measureDistanceTool: ToolDefinition = {
  name: 'measure-distance',
  title: 'Measure a distance',
  group: 'canvas',
  description:
    "Measure between two tokens or points, optionally via waypoints, in the scene's units and grid spaces, following " +
    'the grid and the diagonal rule of the world. Token centers count. Works without a drawn canvas.',
  inputSchema: schema(
    {
      from: place('Start'),
      to: place('End'),
      via: param('array', 'Waypoints in between: { x, y }', { items: { type: 'object' } }),
      sceneIdentifier: SCENE,
    },
    ['from', 'to']
  ),
  annotations: readOnlyTool('Measure a distance'),
  handler: (args, context) =>
    run(
      context,
      'measureDistance',
      args,
      ['from', 'to', 'via', 'sceneIdentifier'],
      'measure the distance',
      answer =>
        [
          `${String(answer['distance'])} ${str(answer['units'])}${typeof answer['spaces'] === 'number' ? ` (${answer['spaces']} grid spaces)` : ''} ` +
            `from ${placeText(answer['from'])} to ${placeText(answer['to'])} on ${sceneText(answer)}.`,
          `Grid: ${fields(isRecord(answer['grid']) ? answer['grid'] : {}, [])}; measured by ${str(answer['method'])}.`,
          ...warningLines(answer),
        ].join('\n')
    ),
};

export const checkWallCollisionTool: ToolDefinition = {
  name: 'check-wall-collision',
  title: 'Do walls block a line?',
  group: 'canvas',
  description:
    'Test whether walls block the straight line between two tokens or points, for movement, sight, light or sound, ' +
    "and list the walls on it. Doors that are open do not block. Uses Foundry's own test when the canvas shows the " +
    'scene, otherwise the stored walls.',
  inputSchema: schema(
    {
      from: place('Start'),
      to: place('End'),
      type: param('string', 'What is blocked; default move', { enum: COLLISION_TYPES }),
      sceneIdentifier: SCENE,
    },
    ['from', 'to']
  ),
  annotations: readOnlyTool('Check wall collision'),
  handler: (args, context) =>
    run(
      context,
      'checkWallCollision',
      args,
      ['from', 'to', 'type', 'sceneIdentifier'],
      'check the walls',
      answer => {
        const walls = listOf(answer['walls']).filter(isRecord);
        return [
          `${str(answer['type'])} from ${placeText(answer['from'])} to ${placeText(answer['to'])} on ${sceneText(answer)}: ` +
            `${answer['blocked'] === true ? 'blocked' : 'clear'} (decided by ${str(answer['method'])}).`,
          ...(walls.length
            ? [
                'Walls on the line, nearest first:',
                ...walls.map(w => `- ${str(w['id'])}: ${fields(w, ['id'])}`),
              ]
            : ['No wall on the line.']),
          ...warningLines(answer),
        ].join('\n');
      }
    ),
};

export const findPathTool: ToolDefinition = {
  name: 'find-path',
  title: 'Find a path around walls',
  group: 'canvas',
  description:
    'Find a way from a token or point to another around walls that block movement (or sight, light, sound), on ' +
    'square and gridless scenes, and its length. Moves nothing; move-token moves a token. Works without a drawn canvas.',
  inputSchema: schema(
    {
      from: place('Start'),
      to: place('Goal'),
      type: param('string', 'Which walls count; default move', { enum: COLLISION_TYPES }),
      maxCells: param(
        'integer',
        'Stop after searching this many grid cells, 100 to 200000; default 50000'
      ),
      sceneIdentifier: SCENE,
    },
    ['from', 'to']
  ),
  annotations: readOnlyTool('Find a path'),
  handler: (args, context) =>
    run(
      context,
      'findPath',
      args,
      ['from', 'to', 'type', 'maxCells', 'sceneIdentifier'],
      'find a path',
      answer => {
        const points = listOf(answer['waypoints'])
          .filter(isRecord)
          .map(p => `(${Math.round(Number(p['x']))}, ${Math.round(Number(p['y']))})`);
        return [
          `Path on ${sceneText(answer)} by ${str(answer['method'])}: ${String(answer['distance'])} ${str(answer['units'])}` +
            `${typeof answer['spaces'] === 'number' ? `, ${answer['spaces']} grid spaces` : ''}.`,
          `Waypoints: ${points.join(' ')}`,
          str(answer['note']),
          ...warningLines(answer),
        ].join('\n');
      }
    ),
};

export const findTokensInRangeTool: ToolDefinition = {
  name: 'find-tokens-in-range',
  title: 'Tokens in range',
  group: 'canvas',
  description:
    'List the tokens within a distance (scene units) of a token or point, nearest first, optionally only those not ' +
    'hidden behind walls for sight. Works without a drawn canvas.',
  inputSchema: schema(
    {
      from: place('Center'),
      distance: param('number', 'Range in the units of the scene, e.g. 30 for 30 ft'),
      requireLineOfSight: param('boolean', 'Leave out tokens behind walls that block sight'),
      includeHidden: param('boolean', 'Include hidden tokens; default true'),
      sceneIdentifier: SCENE,
    },
    ['from', 'distance']
  ),
  annotations: readOnlyTool('Find tokens in range'),
  handler: (args, context) =>
    run(
      context,
      'findTokensInRange',
      args,
      ['from', 'distance', 'requireLineOfSight', 'includeHidden', 'sceneIdentifier'],
      'find tokens in range',
      answer => {
        const tokens = listOf(answer['tokens']).filter(isRecord);
        const hidden = listOf(answer['outOfSight']).filter(isRecord);
        return [
          `${tokens.length} token(s) within ${String(answer['distance'])} ${str(answer['units'])} of ${placeText(answer['from'])} on ${sceneText(answer)}:`,
          ...tokens.map(
            t => `- "${str(t['name'])}" [${str(t['id'])}]: ${fields(t, ['id', 'name'])}`
          ),
          ...(hidden.length
            ? [
                `Behind walls for sight: ${hidden.map(t => `"${str(t['name'])}" [${str(t['id'])}]`).join(', ')}.`,
              ]
            : []),
          str(answer['note']),
          ...warningLines(answer),
        ].join('\n');
      }
    ),
};

export const CANVAS_TOOLS: ToolDefinition[] = [
  listCanvasElementsTool,
  createCanvasElementsTool,
  updateCanvasElementsTool,
  deleteCanvasElementsTool,
  setDoorStateTool,
  getCanvasViewTool,
  panCameraTool,
  pingCanvasTool,
  setTargetsTool,
  measureDistanceTool,
  checkWallCollisionTool,
  findPathTool,
  findTokensInRangeTool,
];
