/**
 * The seven token and dice tools on the server side.
 *
 * Names and parameters are those the original offered; the tools are not in
 * the tool directory. Added, and optional: `sceneIdentifier` for the six token
 * tools. The descriptions are written anew.
 *
 * Each handler sends the hyphenated query name both module generations
 * answer, turns a refusal sent as a value into an error, puts "Failed to"
 * in front at most once, and shows the answer from what the module stored,
 * not from the input.
 */
import { isUnknownQuery, legacyFailure, messageOf, moduleTooOld } from '../../tools/results.js';
import {
  readOnlyTool,
  writingTool,
  type ToolContext,
  type ToolDefinition,
} from '../../tools/types.js';
import {
  formatConditions,
  formatDelete,
  formatDetails,
  formatMove,
  formatRollRequest,
  formatToggle,
  formatUpdate,
} from './format.js';

// Small builders for the JSON schemas, so every parameter reads as one line.
type Json = Record<string, unknown>;
const textParam = (about: string, extra: Json = {}): Json => ({
  type: 'string',
  description: about,
  ...extra,
});
const numberParam = (about: string, extra: Json = {}): Json => ({
  type: 'number',
  description: about,
  ...extra,
});
const flagParam = (about: string, extra: Json = {}): Json => ({
  type: 'boolean',
  description: about,
  ...extra,
});
const objectOf = (fields: Json, needed: string[] = [], extra: Json = {}): Json => ({
  type: 'object',
  properties: fields,
  ...(needed.length ? { required: needed } : {}),
  ...extra,
});

function withPrefix(operation: string, reason: string): string {
  return reason.toLowerCase().includes(`failed to ${operation}`)
    ? reason
    : `Failed to ${operation}: ${reason}`;
}

/** Ask the module; every way this can go wrong ends as one error that names the cause. */
async function ask(
  context: ToolContext,
  query: string,
  data: Json,
  operation: string
): Promise<unknown> {
  const answer = await context.query(query, data).catch((problem: unknown) => {
    throw (
      moduleTooOld(query, problem, operation) ??
      new Error(withPrefix(operation, messageOf(problem)))
    );
  });
  const refusal = legacyFailure(answer);
  if (refusal === null) return answer;
  const cause =
    refusal === 'Access denied'
      ? 'Access denied: the module refused because the connected Foundry user is not a Gamemaster.'
      : refusal;
  throw new Error(withPrefix(operation, cause));
}

/**
 * A module of the previous generation ignores `sceneIdentifier` and works on
 * its current scene. So before sending it, the module is asked whether it
 * knows the parameter; an old module is refused before anything happens.
 */
async function sceneOf(context: ToolContext, args: Json, operation: string): Promise<Json> {
  const wanted = typeof args['sceneIdentifier'] === 'string' ? args['sceneIdentifier'].trim() : '';
  if (!wanted) return {};
  const known = await context.query('tokensDiceCapabilities', {}).then(
    () => null,
    (problem: unknown) => problem
  );
  if (known === null) return { sceneIdentifier: wanted };
  if (!isUnknownQuery(known)) throw new Error(withPrefix(operation, messageOf(known)));
  throw new Error(
    `Failed to ${operation}: the connected Foundry module does not know sceneIdentifier and would use its ` +
      'current scene instead. Nothing was changed in the world. Leave sceneIdentifier out to work on the active ' +
      `scene, or update the module Ninjo's Foundry MCP in Foundry. (${messageOf(known)})`
  );
}

const SCENE_PARAM = textParam(
  'Scene of the token, by id or name. Without it the scene that is active for everyone is used; every answer names the scene.'
);
const TOKEN_PARAM = textParam(
  'Id of the token on that scene, as get-current-scene lists it. Not a name, not an actor id.'
);

const MOVE_TEXT =
  'Put a token at a new position on the active scene (or the scene in sceneIdentifier). x and y are scene ' +
  'pixels of the top left corner of the token; grid, walls and scene bounds are not checked. With animate the ' +
  'token glides there, otherwise it jumps. The answer gives the position Foundry stored.';

export const moveTokenTool: ToolDefinition = {
  name: 'move-token',
  title: 'Move token',
  group: 'tokens',
  description: MOVE_TEXT,
  inputSchema: objectOf(
    {
      tokenId: TOKEN_PARAM,
      x: numberParam('X in scene pixels'),
      y: numberParam('Y in scene pixels'),
      animate: flagParam('Animate the movement (default false)', { default: false }),
      sceneIdentifier: SCENE_PARAM,
    },
    ['tokenId', 'x', 'y']
  ),
  annotations: writingTool('Move token', { destructive: false, idempotent: true }),
  handler: async (args, context) => {
    const scene = await sceneOf(context, args, 'move token');
    const data = {
      tokenId: args['tokenId'],
      x: args['x'],
      y: args['y'],
      animate: args['animate'] === true,
    };
    return formatMove(await ask(context, 'move-token', { ...data, ...scene }, 'move token'));
  },
};

const UPDATE_TEXT =
  'Change properties of a token on the map (not of its actor): position, size in grid spaces, rotation, ' +
  'hidden, disposition (-2 secret, -1 hostile, 0 neutral, 1 friendly), displayed name, elevation, rotation lock. ' +
  'Other fields are refused with their names. Every change is read back; values Foundry stored differently ' +
  'come as warnings.';

const TOKEN_CHANGES = objectOf(
  {
    x: numberParam('X in scene pixels'),
    y: numberParam('Y in scene pixels'),
    width: numberParam('Width in grid spaces, above 0'),
    height: numberParam('Height in grid spaces, above 0'),
    rotation: numberParam('Rotation in degrees, 0 to 360'),
    hidden: flagParam('Hidden from players'),
    disposition: numberParam('-2 secret, -1 hostile, 0 neutral, 1 friendly', {
      enum: [-2, -1, 0, 1],
    }),
    name: textParam('Name shown on the token'),
    elevation: numberParam('Elevation in the distance units of the scene'),
    lockRotation: flagParam('Lock the rotation'),
  },
  [],
  { additionalProperties: false, description: 'The properties to change' }
);

export const updateTokenTool: ToolDefinition = {
  name: 'update-token',
  title: 'Update token',
  group: 'tokens',
  description: UPDATE_TEXT,
  inputSchema: objectOf(
    { tokenId: TOKEN_PARAM, updates: TOKEN_CHANGES, sceneIdentifier: SCENE_PARAM },
    ['tokenId', 'updates']
  ),
  annotations: writingTool('Update token', { destructive: true, idempotent: true }),
  handler: async (args, context) => {
    const scene = await sceneOf(context, args, 'update token');
    const data = { tokenId: args['tokenId'], updates: args['updates'], ...scene };
    return formatUpdate(await ask(context, 'update-token', data, 'update token'));
  },
};

const DELETE_TEXT =
  'Remove tokens from the active scene (or the scene in sceneIdentifier), by their ids only. The actors stay in ' +
  'the actor directory; an unlinked token loses its own values with it. When one id is not on the scene, ' +
  'nothing is deleted and the answer says where that id lies. The answer lists every deleted and every failed ' +
  'token.';

export const deleteTokensTool: ToolDefinition = {
  name: 'delete-tokens',
  title: 'Delete tokens',
  group: 'tokens',
  description: DELETE_TEXT,
  inputSchema: objectOf(
    {
      tokenIds: {
        type: 'array',
        items: textParam('Id of a token'),
        minItems: 1,
        description: 'Ids of the tokens to remove',
      },
      sceneIdentifier: SCENE_PARAM,
    },
    ['tokenIds']
  ),
  annotations: writingTool('Delete tokens', { destructive: true, idempotent: true }),
  handler: async (args, context) => {
    const scene = await sceneOf(context, args, 'delete tokens');
    const data = { tokenIds: args['tokenIds'], ...scene };
    return formatDelete(await ask(context, 'delete-tokens', data, 'delete tokens'));
  },
};

const DETAILS_TEXT =
  'Read one token: position, size, appearance (rotation, scale, alpha, hidden, image), behaviour ' +
  '(disposition, elevation, rotation lock) and its actor with whether it is linked. Hidden tokens are read too. ' +
  'No actor values such as hit points; get-character reads those.';

export const getTokenDetailsTool: ToolDefinition = {
  name: 'get-token-details',
  title: 'Token details',
  group: 'tokens',
  description: DETAILS_TEXT,
  inputSchema: objectOf({ tokenId: TOKEN_PARAM, sceneIdentifier: SCENE_PARAM }, ['tokenId']),
  annotations: readOnlyTool('Token details'),
  handler: async (args, context) => {
    const scene = await sceneOf(context, args, 'get token details');
    const data = { tokenId: args['tokenId'], ...scene };
    return formatDetails(await ask(context, 'get-token-details', data, 'get token details'));
  },
};

const TOGGLE_TEXT =
  'Set or remove a condition (such as prone, poisoned, blinded) on the actor of a token. active true sets it, ' +
  'false removes it, and without active it toggles. conditionId is the id from get-available-conditions or the ' +
  'name. On a linked token the condition lands on the actor and shows on all its tokens; that also needs the ' +
  'actor permission. Removing takes only the effects of that condition. The state is read back. level sets a ' +
  'condition with levels, such as frightened 2 in Pathfinder 2e or pain level 2 in DSA5, and 0 removes it; it ' +
  'needs an adapter for the game system that knows the levels.';

export const toggleTokenConditionTool: ToolDefinition = {
  name: 'toggle-token-condition',
  title: 'Toggle token condition',
  group: 'tokens',
  description: TOGGLE_TEXT,
  inputSchema: objectOf(
    {
      tokenId: TOKEN_PARAM,
      conditionId: textParam('Id of the condition, or its name in any case'),
      active: flagParam('true to set, false to remove; leave out to toggle'),
      sceneIdentifier: SCENE_PARAM,
      level: numberParam(
        'Optional level of a condition with levels, 0 removes it; leave out for a condition without levels',
        { type: 'integer', minimum: 0 }
      ),
    },
    ['tokenId', 'conditionId']
  ),
  annotations: writingTool('Toggle token condition', { destructive: false, idempotent: false }),
  handler: async (args, context) => {
    const scene = await sceneOf(context, args, 'toggle token condition');
    const data: Json = { tokenId: args['tokenId'], conditionId: args['conditionId'], ...scene };
    // Only when given: without it the module toggles.
    if (typeof args['active'] === 'boolean') data['active'] = args['active'];
    // Only when given, so a module that does not know levels never sees the field.
    if (typeof args['level'] === 'number') data['level'] = args['level'];
    return formatToggle(
      await ask(context, 'toggle-token-condition', data, 'toggle token condition')
    );
  },
};

const CONDITIONS_TEXT =
  'List the conditions the game system of the world offers in Foundry, with id, name, icon and description. ' +
  'Use it to find the id for toggle-token-condition.';

export const getAvailableConditionsTool: ToolDefinition = {
  name: 'get-available-conditions',
  title: 'Available conditions',
  group: 'tokens',
  description: CONDITIONS_TEXT,
  inputSchema: objectOf({}),
  annotations: readOnlyTool('Available conditions'),
  handler: async (_args, context) =>
    formatConditions(
      await ask(context, 'get-available-conditions', {}, 'get available conditions')
    ),
};

const ROLL_TEXT =
  'Put a roll button into the chat so a player rolls on their own device. Only that player and a Gamemaster ' +
  'can press it, and it rolls once. Whether the roll is PUBLIC (visible to all players) or PRIVATE (visible ' +
  'to the target player and the Gamemaster only) is a game decision: if the user did not say it, ask "Do you ' +
  'want this to be a PUBLIC roll or a PRIVATE roll?" and wait for the answer, then set isPublic and ' +
  'userConfirmedVisibility. targetPlayer is a player name or a character name. The formula comes from the ' +
  'adapter of the game system; without one, only rollType "custom" with a formula in rollTarget works. A ' +
  'player who is offline gets no request.';

const ROLL_PARAMS = objectOf(
  {
    rollType: textParam(
      'ability, skill, save, attack, initiative or custom, as far as the game system offers them; custom takes a formula in rollTarget'
    ),
    rollTarget: textParam(
      'What is rolled: an ability like "dex", a skill like "perception", or the formula for custom like "1d100"'
    ),
    targetPlayer: textParam('Name of the player or of their character'),
    isPublic: flagParam(
      'true: everyone sees the roll; false: only the target player and the Gamemaster'
    ),
    userConfirmedVisibility: flagParam(
      'Must be true: the user chose public or private, or was asked',
      {
        enum: [true],
      }
    ),
    rollModifier: textParam('Added to the formula, e.g. "+2", "-1" or "+1d4"', { default: '' }),
    flavor: textParam('The occasion, shown as context in the chat', { default: '' }),
  },
  ['rollType', 'rollTarget', 'targetPlayer', 'isPublic', 'userConfirmedVisibility']
);

export const requestPlayerRollsTool: ToolDefinition = {
  name: 'request-player-rolls',
  title: 'Request a roll from a player',
  group: 'dice',
  description: ROLL_TEXT,
  inputSchema: ROLL_PARAMS,
  annotations: writingTool('Request a roll from a player', {
    destructive: false,
    idempotent: false,
  }),
  handler: async (args, context) => {
    const optional = (key: string) => (typeof args[key] === 'string' ? args[key] : '');
    const data = {
      rollType: args['rollType'],
      rollTarget: args['rollTarget'],
      targetPlayer: args['targetPlayer'],
      isPublic: args['isPublic'],
      userConfirmedVisibility: true,
      rollModifier: optional('rollModifier'),
      flavor: optional('flavor'),
    };
    return formatRollRequest(
      await ask(context, 'request-player-rolls', data, 'request player rolls')
    );
  },
};

export const tokensDiceTools: readonly ToolDefinition[] = [
  moveTokenTool,
  updateTokenTool,
  deleteTokensTool,
  getTokenDetailsTool,
  toggleTokenConditionTool,
  getAvailableConditionsTool,
  requestPlayerRollsTool,
];
