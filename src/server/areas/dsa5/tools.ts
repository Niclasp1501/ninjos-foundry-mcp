/**
 * list-dsa5-archetypes and create-dsa5-character-from-archetype on the server.
 *
 * Both check first that the connected world is dsa5 and name the detected
 * system otherwise; an undetectable system is an error with its cause.
 *
 * The listing reads compendium indexes through getAvailablePacks and
 * getPackIndex, which the module of this and of the previous generation both
 * answer. It asks for species and profession explicitly (without them Foundry
 * leaves the fields out and every filter finds nothing), and a compendium that
 * cannot be read is reported with its cause instead of silently skipped.
 */
import { checkCustomization } from '../../../common/areas/dsa5/archetype.js';
import { isRecord, read, text } from '../../../common/areas/dsa5/rules.js';
import { activeGameSystem, serverSystemAdapters } from '../../game-systems.js';
import { legacyFailure, messageOf, moduleTooOld } from '../../tools/results.js';
import {
  readOnlyTool,
  writingTool,
  type ToolContext,
  type ToolDefinition,
} from '../../tools/types.js';
import { createFromArchetypeSchema, listArchetypesSchema } from './schemas.js';

type Args = Record<string, unknown>;

export const ARCHETYPE_FIELDS = ['system.details.species.value', 'system.details.career.value'];

export async function requireDsa5World(context: ToolContext, tool: string): Promise<void> {
  const system = await activeGameSystem(context);
  if (system.detection.problem) {
    throw new Error(
      `${tool} needs a dsa5 world, and the game system could not be detected: ${system.detection.problem}. Nothing was changed.`
    );
  }
  serverSystemAdapters.requireSystem(system, 'dsa5', tool);
}

async function ask(
  context: ToolContext,
  query: string,
  data: Args,
  operation: string
): Promise<unknown> {
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
  return answer;
}

const listOf = (answer: unknown, key: string): Args[] => {
  const raw = Array.isArray(answer) ? answer : isRecord(answer) ? answer[key] : undefined;
  return Array.isArray(raw) ? raw.filter(isRecord) : [];
};

export const listArchetypesTool: ToolDefinition = {
  name: 'list-dsa5-archetypes',
  title: 'List DSA5 archetypes',
  group: 'systems',
  description:
    '[DSA5 only] Find archetypes (ready made heroes of type character) in the actor compendiums of the dsa5 system, e.g. ' +
    'from the DSA5 core rules module, to create a hero with create-dsa5-character-from-archetype. Each archetype comes with ' +
    'id, name, compendium, species, profession and image. filterBySpecies matches the whole species ignoring case, ' +
    'filterByProfession a part of the profession ignoring case. A compendium that cannot be read is named with its cause.',
  inputSchema: listArchetypesSchema,
  annotations: readOnlyTool('List DSA5 archetypes'),
  handler: async (args, context) => {
    await requireDsa5World(context, 'list-dsa5-archetypes');
    const packId = text(args['packId']).trim();
    const species = text(args['filterBySpecies']).trim();
    const profession = text(args['filterByProfession']).trim();
    const warnings: string[] = [];

    const packs = listOf(
      await ask(context, 'getAvailablePacks', { type: 'Actor' }, 'list the actor compendiums'),
      'packs'
    ).filter(pack => text(pack['type']) === 'Actor');
    let chosen: Args[];
    if (packId) {
      const pack = packs.find(entry => entry['id'] === packId);
      if (!pack) {
        throw new Error(
          `Actor compendium "${packId}" not found. Actor compendiums: ${packs.map(entry => `"${text(entry['id'])}"`).join(', ') || 'none'}.`
        );
      }
      if (text(pack['system']) && text(pack['system']) !== 'dsa5')
        warnings.push(
          `Compendium "${packId}" belongs to the system "${text(pack['system'])}", not dsa5.`
        );
      chosen = [pack];
    } else {
      chosen = packs.filter(pack => text(pack['system']) === 'dsa5');
    }

    const archetypes: Args[] = [];
    const skippedPacks: Array<{ id: string; reason: string }> = [];
    for (const [position, pack] of chosen.entries()) {
      const id = text(pack['id']);
      context.progress({ progress: position, total: chosen.length, message: `Reading ${id}` });
      let answer: unknown;
      try {
        answer = await ask(
          context,
          'getPackIndex',
          { packId: id, fields: ARCHETYPE_FIELDS },
          `read the index of "${id}"`
        );
      } catch (error) {
        skippedPacks.push({ id, reason: messageOf(error) });
        continue;
      }
      const label = (isRecord(answer) && text(answer['label'])) || text(pack['label']) || id;
      for (const entry of listOf(answer, 'entries')) {
        if (entry['type'] !== 'character') continue;
        const entrySpecies = text(read(entry, 'system.details.species.value'));
        const entryProfession = text(read(entry, 'system.details.career.value'));
        if (species && entrySpecies.toLowerCase() !== species.toLowerCase()) continue;
        if (profession && !entryProfession.toLowerCase().includes(profession.toLowerCase()))
          continue;
        archetypes.push({
          id: text(entry['_id']) || text(entry['id']),
          name: text(entry['name']),
          pack: { id, label },
          species: entrySpecies || 'Unknown',
          profession: entryProfession || 'Unknown',
          img: text(entry['img']) || null,
        });
      }
    }
    context.progress({ progress: chosen.length, total: chosen.length });

    const filters = [
      packId ? `pack ${packId}` : '',
      species ? `species ${species}` : '',
      profession ? `profession ${profession}` : '',
    ].filter(Boolean);
    const notes: string[] = [];
    if (!chosen.length)
      notes.push(
        'No actor compendium of the dsa5 system is available. Archetypes come with the DSA5 content modules, which must be installed and active.'
      );
    return {
      summary: `Found ${archetypes.length} DSA5 archetypes${filters.length ? ` (${filters.join(', ')})` : ''}`,
      total: archetypes.length,
      archetypes,
      packsSearched: chosen
        .map(pack => text(pack['id']))
        .filter(id => !skippedPacks.some(s => s.id === id)),
      skippedPacks,
      warnings,
      ...(notes.length ? { notes } : {}),
    };
  },
};

export const createFromArchetypeTool: ToolDefinition = {
  name: 'create-dsa5-character-from-archetype',
  title: 'Create a DSA5 character from an archetype',
  group: 'systems',
  description:
    '[DSA5 only] Create one hero as a copy of an archetype from list-dsa5-archetypes, with a new name and optional ' +
    'details (age, biography, gender, eye and hair color, height, weight, species, culture, profession) written onto the ' +
    'hero and read back. The hero goes into the folder "Foundry MCP Actors", without a token in a scene, linked to its ' +
    'archetype. A name another actor has already (ignoring case) is refused. addToWorld false only prepares the hero and ' +
    'shows it, without writing anything.',
  inputSchema: createFromArchetypeSchema,
  annotations: writingTool('Create a DSA5 character from an archetype', {
    destructive: false,
    idempotent: false,
  }),
  handler: async (args, context) => {
    const checked = checkCustomization(args['customization']);
    const problems = [...checked.problems];
    for (const key of ['archetypePackId', 'archetypeId', 'characterName'])
      if (!text(args[key]).trim()) problems.push(`${key} is required`);
    if (problems.length)
      throw new Error(
        `Invalid arguments for create-dsa5-character-from-archetype: ${problems.join('; ')}. Nothing was changed.`
      );
    await requireDsa5World(context, 'create-dsa5-character-from-archetype');
    const data: Args = {
      archetypePackId: args['archetypePackId'],
      archetypeId: args['archetypeId'],
      characterName: args['characterName'],
      customization: args['customization'] ?? {},
      addToWorld: args['addToWorld'] ?? true,
    };
    const answer = await ask(
      context,
      'createDsa5CharacterFromArchetype',
      data,
      `create the DSA5 character "${text(args['characterName'])}"`
    );
    return isRecord(answer) ? answer : { answer };
  },
};
