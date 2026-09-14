/**
 * get-character, get-character-entity, list-characters, search-character-items
 * and get-compendium-entry-full.
 */
import { sanitize } from '../../../common/areas/actors/sanitize.js';
import { systemAnswer } from '../../game-systems.js';
import { readOnlyTool, type ToolContext, type ToolDefinition } from '../../tools/types.js';
import * as schema from './schemas.js';
import {
  askModule,
  askOrPrevious,
  isRecord,
  listIn,
  pick,
  records,
  str,
  unknownShape,
  type Args,
} from './shared.js';

/**
 * A module of the previous generation answers getCharacterInfo with the raw
 * `system`, not with values. The adapter registered on this server reads them,
 * so the answer has the same shape either way.
 */
async function fromPreviousModule(answer: Args, context: ToolContext): Promise<Args> {
  const characters = await systemAnswer(context, 'characters');
  const plain = {
    name: answer['name'],
    type: answer['type'],
    img: answer['img'],
    system: answer['system'] ?? {},
    items: answer['items'] ?? [],
  };
  const summary = characters.questions.summary(plain);
  const notes = [
    'Answered by a Foundry module of the previous generation; the values were read by this server.',
  ];
  if (characters.fallbackFor.includes('summary'))
    notes.push(
      `No adapter for the game system "${characters.system.rawId}" reads character values.`
    );
  return {
    id: answer['id'],
    name: answer['name'],
    type: answer['type'],
    hasImage: typeof answer['img'] === 'string' && answer['img'] !== '',
    basicInfo: sanitize(summary.basicInfo),
    stats: sanitize(summary.stats),
    items: records(answer['items']).map(item => ({
      id: item['id'] ?? item['_id'] ?? null,
      name: item['name'] ?? '',
      type: item['type'] ?? '',
      ...(sanitize(characters.questions.itemFields?.(item) ?? {}) as Args),
    })),
    effects: sanitize(answer['effects'] ?? []),
    actions: sanitize(answer['actions'] ?? []),
    spellcasting: sanitize(answer['spellcasting'] ?? []),
    notes,
  };
}

export const getCharacterTool: ToolDefinition = {
  name: 'get-character',
  title: 'Get character',
  group: 'actors',
  description:
    'Overview of one actor with few tokens: head values and the value block as the adapter of the game system reads them, ' +
    'every item with id, name and type (plus the fields the system marks as relevant, no descriptions), effects, actions ' +
    'and spellcasting where the system has them. Without an adapter for the game system only name, type and image are ' +
    'known, and notes says so. The actor is found by id, exact name or token id; similar names are suggested, never ' +
    'guessed. Fetch the full data of one item or effect with get-character-entity.',
  inputSchema: schema.getCharacterSchema,
  annotations: readOnlyTool('Get character'),
  handler: async (args, context) => {
    const identifier = str(args['identifier']).trim();
    const answer = await askModule(
      context,
      'getCharacterInfo',
      { characterName: identifier, identifier, omitSystem: true },
      `retrieve character "${identifier}"`
    );
    if (!isRecord(answer)) return unknownShape(answer);
    if (!('basicInfo' in answer)) return fromPreviousModule(answer, context);
    const { system: _unused, ...rest } = answer;
    return rest;
  },
};

function findEntityIn(answer: Args, wanted: string): Args | null {
  const lower = wanted.toLowerCase();
  const byName = (entry: Args) => str(entry['name']).toLowerCase() === lower;
  const item = records(answer['items']).find(entry => entry['id'] === wanted || byName(entry));
  if (item) return { kind: 'item', ...item };
  const action = records(answer['actions']).find(byName);
  if (action) return { kind: 'action', ...action };
  const effect = records(answer['effects']).find(entry => entry['id'] === wanted || byName(entry));
  return effect ? { kind: 'effect', ...effect } : null;
}

export const getCharacterEntityTool: ToolDefinition = {
  name: 'get-character-entity',
  title: 'Get character entity',
  group: 'actors',
  description:
    'Full data of one item, action or effect of an actor: description, all system data (credentials removed, game data ' +
    'such as save or activity data kept) and its effects. Looks among items first (id or exact name), then actions, then ' +
    'effects; two entries of the same name are reported with their ids instead of picking one.',
  inputSchema: schema.getCharacterEntitySchema,
  annotations: readOnlyTool('Get character entity'),
  handler: async (args, context) => {
    const data = pick(args, ['characterIdentifier', 'entityIdentifier']);
    const operation = `retrieve "${str(args['entityIdentifier'])}" of "${str(args['characterIdentifier'])}"`;
    return (await askOrPrevious(context, 'getCharacterEntity', data, operation, async () => {
      const answer = await askModule(
        context,
        'getCharacterInfo',
        { characterName: args['characterIdentifier'] },
        operation
      );
      if (!isRecord(answer)) return unknownShape(answer);
      const found = findEntityIn(answer, str(args['entityIdentifier']).trim());
      if (!found) {
        throw new Error(
          `Failed to ${operation}: not found among the items, actions and effects of "${str(answer['name'])}".`
        );
      }
      return sanitize(found);
    })) as Args | string;
  },
};

export const listCharactersTool: ToolDefinition = {
  name: 'list-characters',
  title: 'List characters',
  group: 'actors',
  description:
    'List the actors of the world with id, name, type, folder and whether they have an image, optionally of one type. ' +
    'When no actor has the given type, the answer names the types that exist.',
  inputSchema: schema.listCharactersSchema,
  annotations: readOnlyTool('List characters'),
  handler: async (args, context) => {
    const type = str(args['type']).trim();
    const answer = await askModule(context, 'listActors', type ? { type } : {}, 'list characters');
    const list = listIn(answer, 'actors');
    if (!list) return unknownShape(answer);
    const characters = list.filter(isRecord).map(actor => ({
      id: actor['id'],
      name: actor['name'],
      type: actor['type'],
      folder: actor['folder'] ?? null,
      hasImage: typeof actor['img'] === 'string' && actor['img'] !== '',
    }));
    const result: Args = {
      characters,
      total: characters.length,
      filtered: type ? `Filtered by type: ${type}` : 'All characters',
    };
    if (type && !characters.length) {
      const all =
        listIn(await askModule(context, 'listActors', {}, 'list characters'), 'actors') ?? [];
      const types = [...new Set(all.filter(isRecord).map(actor => str(actor['type'])))].filter(
        Boolean
      );
      result['note'] =
        `No actor has the type "${type}" (compared exactly). Types in the world: ${types.length ? types.map(entry => `"${entry}"`).join(', ') : 'none, the world has no actors'}.`;
    }
    return result;
  },
};

export const searchCharacterItemsTool: ToolDefinition = {
  name: 'search-character-items',
  title: 'Search character items',
  group: 'actors',
  description:
    'Search inside one actor instead of loading all of it: items whose name or description contains the query, ' +
    'optionally of one item type or category, or actions and effects. Each match has id, name, type, a short plain ' +
    'description and the details the adapter of the game system adds (range, target, level, equipped and so on). ' +
    'Categories come from the adapter; without one there are none, and an unknown category is refused, never ignored.',
  inputSchema: schema.searchCharacterItemsSchema,
  annotations: readOnlyTool('Search character items'),
  handler: async (args, context) => {
    const data = {
      ...pick(args, ['characterIdentifier', 'query', 'type', 'category']),
      limit: args['limit'] ?? 20,
    };
    const answer = await askModule(
      context,
      'searchCharacterItems',
      data,
      `search the items of "${str(args['characterIdentifier'])}"`
    );
    return isRecord(answer) ? answer : unknownShape(answer);
  },
};

/** The entry of getCompendiumDocumentFull, from a module of either generation. */
export function formatEntryFull(answer: unknown, packId: string): Args | string {
  if (!isRecord(answer)) return unknownShape(answer);
  const full = isRecord(answer['fullData']) ? answer['fullData'] : {};
  const packValue = answer['pack'];
  const pack = {
    id: isRecord(packValue) ? str(packValue['id']) || packId : str(packValue) || packId,
    label:
      str(answer['packLabel']) || (isRecord(packValue) ? str(packValue['label']) : '') || packId,
  };
  const items = records(Array.isArray(full['items']) ? full['items'] : answer['items']).map(
    item => ({
      id: item['_id'] ?? item['id'] ?? null,
      name: item['name'] ?? '',
      type: item['type'] ?? '',
      img: item['img'] ?? null,
      system: sanitize(item['system'] ?? null),
    })
  );
  const effects = records(Array.isArray(full['effects']) ? full['effects'] : answer['effects']).map(
    effect => ({
      id: effect['_id'] ?? effect['id'] ?? null,
      name: str(effect['name']) || str(effect['label']) || 'Unknown Effect',
      disabled: effect['disabled'] === true,
    })
  );
  const name = str(answer['name']) || str(full['name']);
  const type = str(answer['type']) || str(full['type']);
  return {
    name,
    type,
    documentType: answer['documentType'] ?? null,
    pack,
    img: answer['img'] ?? full['img'] ?? null,
    description: answer['fullDescription'] ?? answer['description'] ?? null,
    system: sanitize(answer['system'] ?? full['system'] ?? null),
    items,
    effects,
    summary: {
      name,
      type,
      pack: pack.label,
      items: items.map(item => item.name),
      effects: effects.map(effect => effect.name),
    },
    fullData: sanitize(full),
  };
}

export const getCompendiumEntryFullTool: ToolDefinition = {
  name: 'get-compendium-entry-full',
  title: 'Get compendium entry in full',
  group: 'actors',
  description:
    'One compendium entry of any document type with everything needed before copying it into the world: name, type, ' +
    'compendium label, description, system data, every contained item with its system data, the effects, a short ' +
    'summary and the whole document. Credentials are removed. A missing compendium or entry is reported as such.',
  inputSchema: schema.getCompendiumEntryFullSchema,
  annotations: readOnlyTool('Get compendium entry in full'),
  handler: async (args, context) => {
    const packId = str(args['packId']);
    const entryId = str(args['entryId']);
    const answer = await askModule(
      context,
      'getCompendiumDocumentFull',
      { packId, documentId: entryId, entryId },
      `retrieve entry "${entryId}" of compendium "${packId}"`
    );
    return formatEntryFull(answer, packId);
  },
};
