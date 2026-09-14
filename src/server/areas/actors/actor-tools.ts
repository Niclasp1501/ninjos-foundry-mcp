/**
 * create-actor-from-compendium and manage-actors.
 */
import { activeGameSystem, serverSystemAdapters } from '../../game-systems.js';
import { writingTool, type ToolContext, type ToolDefinition } from '../../tools/types.js';
import * as schema from './schemas.js';
import { askModule, isRecord, pick, str, unusedArguments, type Args } from './shared.js';

export const createActorFromCompendiumTool: ToolDefinition = {
  name: 'create-actor-from-compendium',
  title: 'Create actors from a compendium',
  group: 'actors',
  description:
    'Copy one actor entry of a compendium into the world, once per name, into the folder "Foundry MCP Creatures", and ' +
    'optionally place the copies as tokens in the active scene. Find packId and itemId with search-compendium first. ' +
    'At most 10 copies (and not more than the setting "maxActorsPerRequest"). The copy keeps a link to its entry, never ' +
    'its id; a remote token image is dropped so Foundry uses its default. Everything that could refuse, including ' +
    'the scene permission for addToScene, is checked before the first actor is created. The answer lists every actor ' +
    'with its real name, the placed tokens and every problem.',
  inputSchema: schema.createActorFromCompendiumSchema,
  annotations: writingTool('Create actors from a compendium', {
    destructive: false,
    idempotent: false,
  }),
  handler: async (args, context) => {
    const names = Array.isArray(args['names']) ? args['names'].map(name => str(name)) : [];
    const quantity = typeof args['quantity'] === 'number' ? args['quantity'] : names.length;
    // The previous module expects the names already filled up to quantity.
    const customNames = [...names];
    for (let index = customNames.length; index < quantity; index += 1)
      customNames.push(`${names[0] ?? ''} ${index + 1}`);
    const data: Args = {
      packId: args['packId'],
      itemId: args['itemId'],
      names,
      customNames,
      quantity,
      addToScene: args['addToScene'] === true,
      ...pick(args, ['placement']),
    };
    const answer = await askModule(
      context,
      'createActorFromCompendium',
      data,
      `create actors from "${str(args['itemId'])}" of "${str(args['packId'])}"`
    );
    return isRecord(answer) ? answer : { answer };
  },
};

interface ActionPlan {
  query: string;
  needs: string[];
  optional?: string[];
  operation: string;
  data?: (args: Args) => Args;
}

const ACTOR_ACTIONS: Record<string, ActionPlan> = {
  create: {
    query: 'createActors',
    needs: ['actors'],
    optional: ['folder'],
    operation: 'create actors',
  },
  update: { query: 'updateActors', needs: ['updates'], operation: 'update actors' },
  delete: { query: 'deleteActors', needs: ['ids'], operation: 'delete actors' },
  place: {
    query: 'addActorsToScene',
    needs: ['actorIds'],
    optional: ['placement', 'hidden'],
    operation: 'place actors in the active scene',
    data: args => ({
      actorIds: args['actorIds'],
      placement: args['placement'] ?? 'random',
      hidden: args['hidden'] === true,
    }),
  },
  'update-items': {
    query: 'updateActorItems',
    needs: ['actorIdentifier', 'itemUpdates'],
    operation: 'update the items of an actor',
  },
  'delete-items': {
    query: 'deleteActorItems',
    needs: ['actorIdentifier', 'itemIds'],
    operation: 'delete items of an actor',
  },
};

/** Run an action plan: required arguments first, then the query, then the unused arguments named. */
export async function runAction(
  tool: string,
  plans: Record<string, ActionPlan>,
  args: Args,
  context: ToolContext
): Promise<Args> {
  const action = str(args['action']);
  const plan = plans[action];
  if (!plan) throw new Error(`${tool}: the action "${action}" has no module query.`);
  const missing = plan.needs.filter(key => args[key] === undefined);
  if (missing.length)
    throw new Error(
      `${tool} with action "${action}" needs ${missing.join(' and ')}. Nothing was changed.`
    );
  const keys = [...plan.needs, ...(plan.optional ?? [])];
  const data = plan.data ? plan.data(args) : pick(args, keys);
  const answer = await askModule(context, plan.query, data, plan.operation);
  const result: Args = isRecord(answer) ? answer : { result: answer };
  const unused = unusedArguments(args, ['action', ...keys]);
  if (unused.length)
    result['ignoredParameters'] = `Not used by action "${action}": ${unused.join(', ')}.`;
  return result;
}

async function describeActors(context: ToolContext): Promise<Args> {
  const system = await activeGameSystem(context);
  if (system.detection.problem) {
    return {
      gameSystem: null,
      notes: `The game system could not be detected, so there are no schema notes: ${system.detection.problem}`,
    };
  }
  const answer = serverSystemAdapters.answer(system, 'actorData');
  return {
    gameSystem: system.rawId,
    adapter: system.adapter?.title ?? null,
    fromAdapter: !answer.fallbackFor.includes('schemaNotes'),
    reshapesSystemData: !answer.fallbackFor.includes('normalize'),
    notes: answer.questions.schemaNotes?.() ?? '',
  };
}

export const manageActorsTool: ToolDefinition = {
  name: 'manage-actors',
  title: 'Manage actors',
  group: 'actors',
  description:
    'Create, change, delete and place world actors, and change or delete items on an actor. ' +
    '"create" makes actors with a type of the game system and free system data (the adapter of the system reshapes it ' +
    'where it knows how). "update" changes actors found by id or exact name and merges system data. "delete" removes ' +
    'actors by id for good and needs the actor permission "full". "place" puts world actors as tokens into the active ' +
    'scene. "update-items" and "delete-items" work on the items of one actor by item id; deleting needs "full". ' +
    '"describe" returns what the adapter of the game system says about actor data. Every target is checked before the ' +
    'first write, nothing found is named, and values the system did not store as written are listed as mismatches.',
  inputSchema: schema.manageActorsSchema,
  annotations: writingTool('Manage actors', { destructive: true, idempotent: false }),
  handler: async (args, context) => {
    if (str(args['action']) === 'describe') return describeActors(context);
    return runAction('manage-actors', ACTOR_ACTIONS, args, context);
  },
};
