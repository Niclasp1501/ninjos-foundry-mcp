/**
 * Input schemas of the twelve tools of the actors area.
 *
 * Tool names, parameter names, types, enums, bounds and required fields are
 * the ones in the tool directory of the previous generation; the descriptions are written for
 * this rewrite. One addition: `confirmBulkOperation` on remove-actor-ownership.
 *
 * Every property is built by one of the small helpers below, so each line
 * carries its own description.
 */

type Schema = Record<string, unknown>;

const text = (description: string): Schema => ({ type: 'string', description });
const num = (description: string, bounds: Schema = {}): Schema => ({
  type: 'number',
  description,
  ...bounds,
});
const flag = (description: string, fallback?: boolean): Schema =>
  fallback === undefined
    ? { type: 'boolean', description }
    : { type: 'boolean', description, default: fallback };
const choice = (values: readonly string[], description: string, fallback?: string): Schema =>
  fallback === undefined
    ? { type: 'string', enum: [...values], description }
    : { type: 'string', enum: [...values], description, default: fallback };
const listOf = (items: Schema, description: string, minItems?: number): Schema =>
  minItems
    ? { type: 'array', items, description, minItems }
    : { type: 'array', items, description };
const texts = (description: string, minItems?: number): Schema =>
  listOf({ type: 'string' }, description, minItems);
const freeData = (description: string): Schema => ({
  type: 'object',
  description,
  additionalProperties: true,
});
const shape = (
  properties: Record<string, Schema>,
  required: string[] = [],
  description?: string
): Schema => ({
  type: 'object',
  ...(description ? { description } : {}),
  properties,
  ...(required.length ? { required } : {}),
});

const PLACEMENTS_WITH_POINTS = ['random', 'grid', 'center', 'coordinates'];
const PLACEMENTS = ['random', 'grid', 'center'];
const ACTOR_ACTIONS = [
  'create',
  'update',
  'delete',
  'place',
  'update-items',
  'delete-items',
  'describe',
];
const ITEM_ACTIONS = ['create', 'list', 'update', 'add-to-actor', 'remove-from-actor', 'describe'];
const LEVELS = ['NONE', 'LIMITED', 'OBSERVER', 'OWNER'];

const actorRef =
  'Id of the actor, its exact name (case does not matter) or the id of one of its tokens';

export const getCharacterSchema = shape({ identifier: text(actorRef) }, ['identifier']);

export const getCharacterEntitySchema = shape(
  {
    characterIdentifier: text(`The actor. ${actorRef}`),
    entityIdentifier: text(
      'Id or exact name of an item, the name of an action, or the id or name of an effect'
    ),
  },
  ['characterIdentifier', 'entityIdentifier']
);

export const listCharactersSchema = shape({
  type: text('Only actors of this type, compared exactly, e.g. "npc"'),
});

export const searchCharacterItemsSchema = shape(
  {
    characterIdentifier: text(`The actor to search. ${actorRef}`),
    query: text(
      'Part of the name or description to look for, ignoring case; leave out to take every item'
    ),
    type: text(
      'An item type of the game system; "action" searches actions and "effect" effects instead of items'
    ),
    category: text(
      'A category the adapter of the game system defines, such as "prepared" or "equipped"; an unknown one is refused with the valid ones'
    ),
    limit: num('How many matches to return, 20 when left out, 200 at most'),
  },
  ['characterIdentifier']
);

const point = shape(
  { x: num('Horizontal position in pixels'), y: num('Vertical position in pixels') },
  ['x', 'y']
);

export const createActorFromCompendiumSchema = shape(
  {
    packId: text('Id of the actor compendium, e.g. "dnd5e.monsters"'),
    itemId: text(
      'Id of the entry inside that compendium, as search-compendium or list-compendium-entries return it'
    ),
    names: texts('Name of each new actor, in order', 1),
    quantity: num(
      'How many copies; the number of names when left out. Missing names become the first name with a number',
      { minimum: 1, maximum: 10 }
    ),
    addToScene: flag('Also place the new actors as tokens in the active scene', false),
    placement: shape(
      {
        type: choice(PLACEMENTS_WITH_POINTS, 'Layout of the tokens', 'grid'),
        coordinates: listOf(point, 'One point per actor, for type "coordinates"'),
      },
      ['type'],
      'Where the tokens go, used with addToScene'
    ),
  },
  ['packId', 'itemId', 'names']
);

export const getCompendiumEntryFullSchema = shape(
  { packId: text('Id of the compendium'), entryId: text('Id of the entry in it') },
  ['packId', 'entryId']
);

const patch = (idText: string, extra: Record<string, Schema> = {}): Schema =>
  shape(
    {
      id: text(idText),
      name: text('New name'),
      img: text('New image path'),
      system: freeData(
        'System fields to change; merged into the stored data, dotted keys such as "attributes.hp.value" allowed'
      ),
      ...extra,
    },
    ['id']
  );

const newActor = shape(
  {
    name: text('Name of the actor'),
    type: text('Actor type of the game system; an unknown type is refused with the valid ones'),
    img: text('Image path'),
    system: freeData(
      'System data of the actor; "describe" tells what the adapter of the system knows about it'
    ),
  },
  ['name', 'type']
);

export const manageActorsSchema = shape(
  {
    action: choice(ACTOR_ACTIONS, 'What to do; each action names the parameters it needs'),
    actors: listOf(newActor, 'For "create": the new actors', 1),
    folder: text(
      'For "create": id of an actor folder, or a folder path that is created when missing; "Foundry MCP Actors" when left out'
    ),
    updates: listOf(
      patch('Id or exact name of the actor'),
      'For "update": one change per actor; every actor is found before the first one is written',
      1
    ),
    ids: texts(
      'For "delete": ids of the world actors to delete; needs the actor permission "full"',
      1
    ),
    actorIds: texts(
      'For "place": ids or exact names of world actors to put into the active scene',
      1
    ),
    placement: choice(PLACEMENTS, 'For "place": layout of the tokens, "random" when left out'),
    hidden: flag('For "place": create the tokens hidden from players'),
    actorIdentifier: text(`For "update-items" and "delete-items": the actor. ${actorRef}`),
    itemUpdates: listOf(
      patch('Id of the item on the actor'),
      'For "update-items": changes of items on the actor, by item id',
      1
    ),
    itemIds: texts(
      'For "delete-items": ids of items on the actor; needs the actor permission "full"',
      1
    ),
  },
  ['action']
);

const newItem = shape(
  {
    name: text('Name of the item'),
    type: text('Item type of the game system; an unknown type is refused with the valid ones'),
    img: text('Image path'),
    system: freeData('System data of the item'),
  },
  ['name', 'type']
);

export const manageWorldItemsSchema = shape(
  {
    action: choice(ITEM_ACTIONS, 'What to do; each action names the parameters it needs'),
    items: listOf(newItem, 'For "create" and "add-to-actor": the new items', 1),
    updates: listOf(
      patch('Id of the world item', {
        folder: text('Id of an item folder, or a folder path that is created when missing'),
      }),
      'For "update": changes of world items by id; all ids are checked before anything is written',
      1
    ),
    folder: text(
      'For "create": id or path of the item folder, created when missing. For "list": only items directly in this folder (id or exact name)'
    ),
    type: text(
      'For "list": only this item type. For "remove-from-actor": only items of this type match itemNames'
    ),
    nameFilter: text('For "list": part of the name, ignoring case'),
    actorIdentifier: text(`For "add-to-actor" and "remove-from-actor": the actor. ${actorRef}`),
    itemIds: texts('For "remove-from-actor": ids of items on the actor'),
    itemNames: texts(
      'For "remove-from-actor": exact names of items on the actor, ignoring case; a name that fits several items is refused'
    ),
  },
  ['action']
);

export const useItemSchema = shape(
  {
    actorIdentifier: text(`The actor that uses the item. ${actorRef}`),
    itemIdentifier: text('Id or exact name of the item on that actor'),
    targets: texts(
      'Tokens of the active scene to target, by token id, token name or actor name; "self" is the token of the actor. Leave out to keep the targets the Gamemaster has selected'
    ),
    consume: flag('Let the game system spend uses, resources or slots; true when left out'),
    spellLevel: num('Cast at this higher level, where the game system knows spell levels'),
  },
  ['actorIdentifier', 'itemIdentifier']
);

export const assignActorOwnershipSchema = shape(
  {
    actorIdentifier: text(
      `${actorRef}; or the phrase "all friendly NPCs" (friendly tokens of the active scene that no player owns) or "party characters" (actors a player owns)`
    ),
    playerIdentifier: text(
      'The player by id or exact name, the name of an actor a player owns, or "party" for every connected player. Gamemasters are never changed'
    ),
    permissionLevel: choice(
      LEVELS,
      'Level to give: NONE hides the actor, LIMITED shows little, OBSERVER shows everything, OWNER allows control'
    ),
    confirmBulkOperation: flag(
      'Must be true when more than one actor or more than one player is affected',
      false
    ),
  },
  ['actorIdentifier', 'playerIdentifier', 'permissionLevel']
);

export const removeActorOwnershipSchema = shape(
  {
    actorIdentifier: text(`${actorRef}, or one of the phrases of assign-actor-ownership`),
    playerIdentifier: text(
      'The player by id or exact name, the name of an actor a player owns, or "party"'
    ),
    confirmRemoval: flag('Must be true, otherwise nothing is removed', false),
    confirmBulkOperation: flag(
      'Must also be true when more than one actor or player is affected',
      false
    ),
  },
  ['actorIdentifier', 'playerIdentifier']
);

export const listActorOwnershipSchema = shape({
  actorIdentifier: text(`One actor. ${actorRef}; "all" or left out lists every actor`),
  playerIdentifier: text('Only this player, by id or exact name'),
});
