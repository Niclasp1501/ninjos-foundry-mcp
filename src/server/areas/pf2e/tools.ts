/**
 * pf2e-manage-conditions on the server: a new tool of this generation, because
 * pf2e keeps conditions as items with values (frightened 2) that
 * toggle-token-condition can neither set to a value nor read back, so it
 * needs a tool of its own.
 */
import { CONDITION_ACTIONS } from '../../../common/areas/pf2e/conditions.js';
import { activeGameSystem, serverSystemAdapters } from '../../game-systems.js';
import { legacyFailure, messageOf, moduleTooOld } from '../../tools/results.js';
import { writingTool, type ToolContext, type ToolDefinition } from '../../tools/types.js';

const TOOL = 'pf2e-manage-conditions';

const described = (type: string, description: string, extra: Record<string, unknown> = {}) => ({
  type,
  description,
  ...extra,
});

export const manageConditionsSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    actorIdentifier: described(
      'string',
      'Actor id, exact actor name (case is ignored when unique) or token id.'
    ),
    action: described(
      'string',
      'list: the conditions on the actor. set: to a value (valued conditions) or present. increase and decrease: by amount (default 1); decreasing a valued condition to 0 removes it. remove. toggle: remove when present, else add with value 1.',
      { enum: [...CONDITION_ACTIONS] }
    ),
    condition: described(
      'string',
      'Condition slug or name, e.g. "frightened", "off-guard" ("flat-footed" is accepted), "drained". Required except for list.'
    ),
    value: described('integer', 'For set on a valued condition: the value, at least 1.', {
      minimum: 1,
    }),
    amount: described(
      'integer',
      'For increase and decrease on a valued condition: the step, at least 1. Default 1.',
      { minimum: 1 }
    ),
  },
  required: ['actorIdentifier', 'action'],
  additionalProperties: false,
};

export async function requirePf2eWorld(context: ToolContext): Promise<void> {
  const system = await activeGameSystem(context);
  if (system.detection.problem)
    throw new Error(
      `${TOOL} needs a pf2e world, and the game system could not be detected: ${system.detection.problem}. Nothing was changed.`
    );
  serverSystemAdapters.requireSystem(system, 'pf2e', TOOL);
}

export const manageConditionsTool: ToolDefinition = {
  name: TOOL,
  title: 'Manage Pathfinder 2e conditions',
  group: 'systems',
  description:
    '[Pathfinder 2e only] List, set, increase, decrease, remove or toggle a condition on an actor, with values such as frightened 2 or drained 1. ' +
    'pf2e keeps conditions as items with a value, which toggle-token-condition cannot set or read back; this tool writes through the ' +
    "system's own condition handling and reads the result back. A condition granted by another one (e.g. by grabbed) is removed with its source, " +
    'not here. persistent-damage needs its damage and is applied on the sheet.',
  inputSchema: manageConditionsSchema,
  annotations: writingTool('Manage Pathfinder 2e conditions', {
    destructive: true,
    idempotent: false,
  }),
  handler: async (args, context) => {
    await requirePf2eWorld(context);
    const action = String(args['action'] ?? '');
    if (action !== 'list' && !String(args['condition'] ?? '').trim())
      throw new Error(
        `condition is required for action "${action}", e.g. "frightened". Nothing was changed.`
      );
    let answer: unknown;
    try {
      answer = await context.query('pf2eManageConditions', args);
    } catch (error) {
      throw (
        moduleTooOld('pf2eManageConditions', error, 'manage a Pathfinder 2e condition') ??
        new Error(`Failed to manage the condition: ${messageOf(error)}`)
      );
    }
    const failure = legacyFailure(answer);
    if (failure !== null) throw new Error(`Failed to manage the condition: ${failure}`);
    return typeof answer === 'object' && answer !== null
      ? (answer as Record<string, unknown>)
      : { answer };
  },
};
