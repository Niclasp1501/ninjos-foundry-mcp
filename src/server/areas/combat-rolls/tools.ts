/**
 * The combat and roll tools on the server side.
 *
 * None of them existed in the previous generation (it had no
 * combat tool), so names and parameters are new, designed from Foundry's
 * Combat, Combatant and Roll API. Every handler asks the module once and
 * passes on what the module read back from the world; "module too old" and
 * refusals arrive with their cause.
 */
import { legacyFailure, messageOf, moduleTooOld } from '../../tools/results.js';
import {
  readOnlyTool,
  writingTool,
  type ToolContext,
  type ToolDefinition,
} from '../../tools/types.js';
import { param, pick, schema } from '../chat-tables-macros/shared.js';

/** "Failed to <operation>:" once, whether the module already put it in front or not. */
function prefixed(operation: string, reason: string): string {
  return reason.startsWith(`Failed to ${operation}`) ? reason : `Failed to ${operation}: ${reason}`;
}

async function ask(
  context: ToolContext,
  query: string,
  data: Record<string, unknown>,
  operation: string
): Promise<unknown> {
  let answer: unknown;
  try {
    answer = await context.query(query, data);
  } catch (error) {
    throw moduleTooOld(query, error, operation) ?? new Error(prefixed(operation, messageOf(error)));
  }
  const failure = legacyFailure(answer);
  if (failure !== null) throw new Error(prefixed(operation, failure));
  return answer;
}

const ROLL_MODES = ['publicroll', 'gmroll', 'blindroll', 'selfroll'];

const COMBAT_ID = param(
  'string',
  'Id of the combat encounter, as list-combats shows it. Without it the active encounter is used.'
);
const DRY_RUN = param(
  'boolean',
  'Only report what would happen and whether it is permitted; change nothing'
);
const TO_CHAT = param('boolean', 'Post the roll to the chat. Default false: nothing is posted');
const ROLL_MODE = param(
  'string',
  'Who sees a posted roll: publicroll everyone, gmroll Gamemasters (default), blindroll Gamemasters only and hidden from the roller, selfroll only the bridge user',
  { enum: ROLL_MODES }
);
const ID_LIST = (about: string) => ({
  type: 'array',
  items: { type: 'string' },
  description: about,
});

function tool(
  definition: Omit<ToolDefinition, 'handler' | 'group'> & { group?: ToolDefinition['group'] },
  query: string,
  operation: string,
  keys: readonly string[]
): ToolDefinition {
  return {
    ...definition,
    group: definition.group ?? 'combat',
    handler: async (args, context) => {
      const answer = await ask(context, query, pick(args, keys), operation);
      return (answer ?? {}) as Record<string, unknown>;
    },
  };
}

export const listCombatsTool = tool(
  {
    name: 'list-combats',
    title: 'List combat encounters',
    description:
      'List every combat encounter of the world with its scene, whether it is active and started, round, turn, number of combatants and who acts now.',
    inputSchema: schema({}),
    annotations: readOnlyTool('List combat encounters'),
  },
  'listCombats',
  'list combats',
  []
);

export const getCombatTool = tool(
  {
    name: 'get-combat',
    title: 'Get combat encounter',
    description:
      'Read one combat encounter: the turn order with initiative, hidden and defeated flags, and the current turn with its actor ' +
      '(values from the game system adapter where there is one), token, conditions and who comes next.',
    inputSchema: schema({ combatId: COMBAT_ID }),
    annotations: readOnlyTool('Get combat encounter'),
  },
  'getCombat',
  'get combat',
  ['combatId']
);

export const createCombatTool = tool(
  {
    name: 'create-combat',
    title: 'Create combat encounter',
    description:
      'Create a combat encounter on a scene (the active scene by default) and optionally add tokens as combatants. ' +
      'It does not start the encounter; start-combat does. Tokens are named by id only.',
    inputSchema: schema({
      sceneIdentifier: param(
        'string',
        'Scene of the encounter, by id or name. Default: the scene active for everyone'
      ),
      tokenIds: ID_LIST('Ids of tokens on that scene to add as combatants'),
      activate: param('boolean', 'Make it the active encounter (default true)'),
      unlinked: param(
        'boolean',
        'Create an encounter without a scene; tokenIds and sceneIdentifier are not allowed then'
      ),
      dryRun: DRY_RUN,
    }),
    annotations: writingTool('Create combat encounter', { destructive: false, idempotent: false }),
  },
  'createCombat',
  'create combat',
  ['sceneIdentifier', 'tokenIds', 'activate', 'unlinked', 'dryRun']
);

export const addCombatantsTool = tool(
  {
    name: 'add-combatants',
    title: 'Add combatants',
    description:
      "Add tokens to a combat encounter as combatants. Tokens come from the encounter's scene (for an encounter without scene: " +
      'sceneIdentifier or the active scene). One unknown id stops everything; tokens already in the encounter are named and not added twice.',
    inputSchema: schema(
      {
        combatId: COMBAT_ID,
        tokenIds: { ...ID_LIST('Ids of the tokens to add'), minItems: 1 },
        sceneIdentifier: param(
          'string',
          'Scene of the tokens, only for an encounter without scene'
        ),
        dryRun: DRY_RUN,
      },
      ['tokenIds']
    ),
    annotations: writingTool('Add combatants', { destructive: false, idempotent: true }),
  },
  'addCombatants',
  'add combatants',
  ['combatId', 'tokenIds', 'sceneIdentifier', 'dryRun']
);

export const removeCombatantsTool = tool(
  {
    name: 'remove-combatants',
    title: 'Remove combatants',
    description:
      'Remove combatants from a combat encounter, by combatant id or token id. Their initiative is lost; the tokens stay on the scene. ' +
      'One unknown id stops everything.',
    inputSchema: schema({
      combatId: COMBAT_ID,
      combatantIds: ID_LIST('Ids of combatants to remove'),
      tokenIds: ID_LIST('Ids of tokens whose combatants to remove'),
      dryRun: DRY_RUN,
    }),
    annotations: writingTool('Remove combatants', { destructive: true, idempotent: true }),
  },
  'removeCombatants',
  'remove combatants',
  ['combatId', 'combatantIds', 'tokenIds', 'dryRun']
);

export const updateCombatantTool = tool(
  {
    name: 'update-combatant',
    title: 'Update combatant',
    description:
      'Set the initiative of a combatant (null clears it), hide it from players in the tracker, or mark it defeated. ' +
      'The acting combatant keeps its turn when the order changes. defeated is only the tracker flag; toggle-token-condition sets a condition.',
    inputSchema: schema({
      combatId: COMBAT_ID,
      combatantId: param('string', 'Id of the combatant'),
      tokenId: param('string', 'Or the id of its token'),
      initiative: { type: ['number', 'null'], description: 'New initiative, or null to clear it' },
      hidden: param('boolean', 'Hidden from players in the combat tracker'),
      defeated: param('boolean', 'Defeated'),
    }),
    annotations: writingTool('Update combatant', { destructive: true, idempotent: true }),
  },
  'updateCombatant',
  'update combatant',
  ['combatId', 'combatantId', 'tokenId', 'initiative', 'hidden', 'defeated']
);

export const rollInitiativeTool = tool(
  {
    name: 'roll-initiative',
    title: 'Roll initiative',
    description:
      "Roll initiative with the game system's formula: for all combatants, only non player characters, or the combatants named. " +
      'By default only those without initiative roll. Rolls are posted to the chat only with toChat; a hidden combatant is never posted publicly.',
    inputSchema: schema({
      combatId: COMBAT_ID,
      scope: param('string', 'all (default) or npcs, combatants no player owns', {
        enum: ['all', 'npcs'],
      }),
      onlyMissing: param('boolean', 'Only combatants without initiative (default true)'),
      combatantIds: ID_LIST(
        'Roll exactly for these combatants; scope and onlyMissing do not apply then'
      ),
      formula: param('string', 'Formula instead of the system formula, e.g. "1d20+2"'),
      toChat: TO_CHAT,
      rollMode: ROLL_MODE,
    }),
    annotations: writingTool('Roll initiative', { destructive: true, idempotent: false }),
  },
  'rollInitiative',
  'roll initiative',
  ['combatId', 'scope', 'onlyMissing', 'combatantIds', 'formula', 'toChat', 'rollMode']
);

export const startCombatTool = tool(
  {
    name: 'start-combat',
    title: 'Start combat',
    description:
      'Start a combat encounter in round 1 with the first combatant of the turn order. A running encounter is left as it is and the answer says so.',
    inputSchema: schema({ combatId: COMBAT_ID }),
    annotations: writingTool('Start combat', { destructive: false, idempotent: true }),
  },
  'startCombat',
  'start combat',
  ['combatId']
);

export const changeCombatTurnTool = tool(
  {
    name: 'change-combat-turn',
    title: 'Change combat turn',
    description:
      'Move a running combat encounter: next-turn, previous-turn, next-round, previous-round, or set-turn to a combatant. ' +
      "Moves use Foundry's own rules (for example skipping defeated combatants when the tracker is set so). The answer gives round and turn before and after.",
    inputSchema: schema(
      {
        combatId: COMBAT_ID,
        action: param('string', 'The move', {
          enum: ['next-turn', 'previous-turn', 'next-round', 'previous-round', 'set-turn'],
        }),
        combatantId: param('string', 'For set-turn: the combatant who acts'),
        tokenId: param('string', 'For set-turn: or the id of its token'),
      },
      ['action']
    ),
    annotations: writingTool('Change combat turn', { destructive: false, idempotent: false }),
  },
  'changeCombatTurn',
  'change combat turn',
  ['combatId', 'action', 'combatantId', 'tokenId']
);

export const endCombatTool = tool(
  {
    name: 'end-combat',
    title: 'End combat',
    description:
      'End a combat encounter: it stops (round 0, not active) and keeps its combatants and initiatives. deleteEncounter deletes it instead, ' +
      "as Foundry's own End Combat does; deleting encounters is refused until they have a permission level.",
    inputSchema: schema({
      combatId: COMBAT_ID,
      deleteEncounter: param(
        'boolean',
        'Delete the encounter instead of stopping it (default false)'
      ),
      dryRun: DRY_RUN,
    }),
    annotations: writingTool('End combat', { destructive: true, idempotent: true }),
  },
  'endCombat',
  'end combat',
  ['combatId', 'deleteEncounter', 'dryRun']
);

export const rollDiceTool = tool(
  {
    name: 'roll-dice',
    title: 'Roll dice',
    description:
      'Roll a free formula in Foundry, in any game system, e.g. "2d6+3" or "4d6kh3". Returns the total and every single die result. ' +
      "With actorId, @ references use that actor's roll data. Nothing is posted unless toChat is true.",
    group: 'dice',
    inputSchema: schema(
      {
        formula: param('string', 'Foundry roll formula'),
        flavor: param('string', 'Text shown with a posted roll'),
        actorId: param('string', 'Actor id or exact name whose roll data fills @ references'),
        toChat: TO_CHAT,
        rollMode: ROLL_MODE,
      },
      ['formula']
    ),
    annotations: writingTool('Roll dice', { destructive: false, idempotent: false }),
  },
  'rollDice',
  'roll dice',
  ['formula', 'flavor', 'actorId', 'toChat', 'rollMode']
);

export const rollActorCheckTool = tool(
  {
    name: 'roll-actor-check',
    title: 'Roll actor check',
    description:
      'Roll a check of the game system for an actor, such as ability, skill, save or attack. The formula comes from the game system adapter; ' +
      'in a system without one the answer is SYSTEM_NOT_SUPPORTED and roll-dice rolls a free formula. To let a player roll, use request-player-rolls.',
    group: 'dice',
    inputSchema: schema(
      {
        actorId: param('string', 'Actor id or exact name'),
        rollType: param(
          'string',
          'Roll type the adapter offers, e.g. ability, skill, save, attack'
        ),
        rollTarget: param('string', 'What is rolled, e.g. "dex", "Perception" or a weapon name'),
        rollModifier: param('string', 'Extra modifier, e.g. "+2"'),
        flavor: param('string', 'Text shown with a posted roll'),
        toChat: TO_CHAT,
        rollMode: ROLL_MODE,
      },
      ['actorId', 'rollType']
    ),
    annotations: writingTool('Roll actor check', { destructive: false, idempotent: false }),
  },
  'rollActorCheck',
  'roll actor check',
  ['actorId', 'rollType', 'rollTarget', 'rollModifier', 'flavor', 'toChat', 'rollMode']
);

export const combatRollsTools: readonly ToolDefinition[] = [
  listCombatsTool,
  getCombatTool,
  createCombatTool,
  addCombatantsTool,
  removeCombatantsTool,
  updateCombatantTool,
  rollInitiativeTool,
  startCombatTool,
  changeCombatTurnTool,
  endCombatTool,
  rollDiceTool,
  rollActorCheckTool,
];
