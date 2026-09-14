/**
 * The two WFRP4e tools on the server.
 *
 * Each checks the arguments first, then that the connected world runs wfrp4e
 * (naming the detected system otherwise, or why it could not be detected),
 * asks the module and passes its answer on with the module's cause in every
 * error. The previous generation answered a refusal as a normal result
 * ("Access denied"); here it is a tool error.
 */
import {
  checkAddArguments,
  checkUpdateArguments,
} from '../../../common/areas/wfrp4e-cosmere-traveller/wfrp4e-tools.js';
import { isRecord } from '../../../common/areas/wfrp4e-cosmere-traveller/shared.js';
import { activeGameSystem, serverSystemAdapters } from '../../game-systems.js';
import { legacyFailure, messageOf, moduleTooOld } from '../../tools/results.js';
import { writingTool, type ToolContext, type ToolDefinition } from '../../tools/types.js';
import { addItemsSchema, updateActorSchema } from './schemas.js';

type Args = Record<string, unknown>;

export async function requireWfrp4eWorld(context: ToolContext, tool: string): Promise<void> {
  const system = await activeGameSystem(context);
  if (system.detection.problem) {
    throw new Error(
      `${tool} needs a wfrp4e world, and the game system could not be detected: ${system.detection.problem}. Nothing was changed.`
    );
  }
  serverSystemAdapters.requireSystem(system, 'wfrp4e', tool);
}

async function ask(
  context: ToolContext,
  query: string,
  data: Args,
  operation: string
): Promise<Args> {
  let answer: unknown;
  try {
    answer = await context.query(query, data);
  } catch (error) {
    throw (
      moduleTooOld(query, error, operation) ??
      new Error(`Failed to ${operation}: ${messageOf(error)}`)
    );
  }
  const failure = legacyFailure(answer);
  if (failure !== null) throw new Error(`Failed to ${operation}: ${failure}`);
  return isRecord(answer) ? answer : { answer };
}

export const updateActorTool: ToolDefinition = {
  name: 'wfrp4e-update-actor',
  title: 'Update a WFRP4e stat block',
  group: 'systems',
  description:
    '[WFRP4e only] Change the stat block of an existing wfrp4e actor: initial, advances and modifier of characteristics, current and ' +
    'maximum wounds, advances of skills the actor already has, which career is current, movement and biography. Only given fields change; ' +
    'value, bonus and skill totals are recomputed by wfrp4e. Skills and careers match by name ignoring case; one that is missing or ' +
    'there twice is skipped and named in warnings, never guessed. Every value is read back; the answer lists old and new values, the ' +
    'new characteristic totals and anything stored differently. New skills, talents, trappings or careers: wfrp4e-add-items. A new ' +
    'actor: create-actor-from-compendium.',
  inputSchema: updateActorSchema,
  annotations: writingTool('Update a WFRP4e stat block', { destructive: false, idempotent: true }),
  handler: async (args, context) => {
    const problems = checkUpdateArguments(args);
    if (problems.length)
      throw new Error(`Invalid arguments: ${problems.join('; ')} Nothing was changed.`);
    await requireWfrp4eWorld(context, 'wfrp4e-update-actor');
    return ask(
      context,
      'updateWfrp4eActor',
      args,
      `update the WFRP4e actor "${String(args['actor'])}"`
    );
  },
};

export const addItemsTool: ToolDefinition = {
  name: 'wfrp4e-add-items',
  title: 'Add WFRP4e items',
  group: 'systems',
  description:
    '[WFRP4e only] Add skills, talents, traits, trappings, careers, weapons, spells and other items to an existing wfrp4e actor. Each ' +
    'name is looked up whole, ignoring case, in the item compendiums, wfrp4e-core first, and the entry is copied in full with a link to ' +
    'it. A specialised skill such as "Entertain (Taunt)" comes from its template "Entertain ()". A name that exists as several types ' +
    'is skipped with all candidates until "type" chooses; "pack" limits the search to compendiums whose id contains it. A name in no ' +
    'compendium becomes a blank item of "type" (trapping without it) and is listed in notFound. "advances" works for skills, ' +
    '"quantity" for gear, "setCurrent" for careers; elsewhere it is ignored with a warning. A skill or career the actor has already ' +
    'is skipped. Everything is read back. Change existing values with wfrp4e-update-actor.',
  inputSchema: addItemsSchema,
  annotations: writingTool('Add WFRP4e items', { destructive: false, idempotent: false }),
  handler: async (args, context) => {
    const { problems } = checkAddArguments(args);
    if (problems.length)
      throw new Error(`Invalid arguments: ${problems.join('; ')}. Nothing was changed.`);
    await requireWfrp4eWorld(context, 'wfrp4e-add-items');
    const answer = await ask(
      context,
      'addWfrp4eItems',
      args,
      `add items to "${String(args['actor'])}"`
    );
    const added = Array.isArray(answer['added']) ? answer['added'].length : 0;
    if (!added) {
      throw new Error(
        `No items could be added. ${JSON.stringify({
          notFound: answer['notFound'],
          ambiguous: answer['ambiguous'],
          failed: answer['failed'],
          skipped: answer['skipped'],
          warnings: answer['warnings'],
        })}`
      );
    }
    return answer;
  },
};
