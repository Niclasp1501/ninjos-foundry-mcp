/**
 * manage-world-items and use-item.
 */
import { writingTool, type ToolDefinition } from '../../tools/types.js';
import { runAction } from './actor-tools.js';
import * as schema from './schemas.js';
import { askModule, isRecord, pick, str } from './shared.js';

const ITEM_ACTIONS = {
  create: {
    query: 'createWorldItems',
    needs: ['items'],
    optional: ['folder'],
    operation: 'create world items',
  },
  list: {
    query: 'listWorldItems',
    needs: [],
    optional: ['type', 'folder', 'nameFilter'],
    operation: 'list world items',
  },
  update: { query: 'updateWorldItems', needs: ['updates'], operation: 'update world items' },
  'add-to-actor': {
    query: 'addActorItems',
    needs: ['actorIdentifier', 'items'],
    operation: 'add items to an actor',
  },
  'remove-from-actor': {
    query: 'removeActorItems',
    needs: ['actorIdentifier'],
    optional: ['itemIds', 'itemNames', 'type'],
    operation: 'remove items from an actor',
  },
  describe: { query: 'getSystemSchema', needs: [], operation: 'describe the item schema' },
};

export const manageWorldItemsTool: ToolDefinition = {
  name: 'manage-world-items',
  title: 'Manage items',
  group: 'actors',
  description:
    'Items in the world and on actors. "create" makes world items (in a folder by id or path, created when missing and ' +
    'named in the answer), "list" filters world items by type, folder and part of the name, "update" changes world ' +
    'items by id, "add-to-actor" creates items directly on an actor, "remove-from-actor" deletes items of an actor by id ' +
    'or exact name (needs the actor permission "full"; a name that fits several items is refused), and "describe" ' +
    'returns the valid item types and the enumerated values the adapter of the game system reads from its configuration. ' +
    'Item types are checked against the game system before anything is written.',
  inputSchema: schema.manageWorldItemsSchema,
  annotations: writingTool('Manage items', { destructive: true, idempotent: false }),
  handler: async (args, context) => {
    const result = await runAction('manage-world-items', ITEM_ACTIONS, args, context);
    if (str(args['action']) === 'list' && Array.isArray(result['result'])) {
      const items = result['result'];
      delete result['result'];
      return { items, total: items.length, ...result };
    }
    return result;
  },
};

export const useItemTool: ToolDefinition = {
  name: 'use-item',
  title: 'Use item',
  group: 'actors',
  description:
    'Start the use of an item of an actor (a spell, an ability, a consumable) in Foundry and return at once, without ' +
    'waiting for a dialog the Gamemaster may have to confirm. Targets are tokens of the active scene; if one cannot be ' +
    'found exactly, nothing is used. The adapter of the game system decides how the item is used and how consume and ' +
    'spellLevel apply; without one the usual item methods are tried, and failing those a plain chat message is posted. ' +
    'The answer says what was verified (targets, whether the use finished) and what was not (consumption).',
  inputSchema: schema.useItemSchema,
  annotations: writingTool('Use item', { destructive: false, idempotent: false }),
  handler: async (args, context) => {
    const consume = args['consume'] !== false;
    const data = {
      ...pick(args, ['actorIdentifier', 'itemIdentifier', 'targets', 'spellLevel']),
      consume,
      options: { consume, skipDialog: true, ...pick(args, ['spellLevel']) },
    };
    const answer = await askModule(
      context,
      'useItem',
      data,
      `use "${str(args['itemIdentifier'])}" of "${str(args['actorIdentifier'])}"`
    );
    return isRecord(answer) ? answer : { answer };
  },
};
