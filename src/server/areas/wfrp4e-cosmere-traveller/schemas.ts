/**
 * Parameters of the two WFRP4e tools. Names, types, nesting, required fields
 * and closed objects are those the previous generation offered (the tool
 * directory has no entry for them); the
 * descriptions are written anew.
 */

const KEYS = ['ws', 'bs', 's', 't', 'i', 'ag', 'dex', 'int', 'wp', 'fel'];

const characteristicEntry = {
  type: 'object',
  properties: {
    initial: { type: 'number', description: 'Starting value of the characteristic' },
    advances: { type: 'number', description: 'Advances bought in it' },
    modifier: { type: 'number', description: 'Modifier, negative allowed' },
  },
  additionalProperties: false,
};

export const updateActorSchema = {
  type: 'object',
  properties: {
    actor: { type: 'string', description: 'Id or exact name of the actor (a token id works too)' },
    characteristics: {
      type: 'object',
      description: `Changes per characteristic, keys ${KEYS.join(', ')}; each sets initial, advances and/or modifier. Value and bonus follow by themselves.`,
      properties: Object.fromEntries(KEYS.map(key => [key, structuredClone(characteristicEntry)])),
      additionalProperties: false,
    },
    wounds: {
      type: 'object',
      description: 'Current and maximum wounds.',
      properties: {
        value: { type: 'number', description: 'Current wounds' },
        max: { type: 'number', description: 'Maximum wounds' },
      },
      additionalProperties: false,
    },
    skills: {
      type: 'array',
      description:
        'Advances for skills the actor has already; new skills come with wfrp4e-add-items.',
      items: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of a skill on the actor, e.g. "Melee (Basic)"',
          },
          advances: { type: 'number', description: 'Advances to store' },
        },
        required: ['name', 'advances'],
        additionalProperties: false,
      },
    },
    career: {
      type: 'string',
      description:
        'Name of a career item on the actor that becomes the current one; every other career stops being current.',
    },
    movement: { type: 'number', description: 'Movement value (system.details.move.value).' },
    biography: {
      type: 'string',
      description: 'New biography, replacing the old one; HTML is allowed.',
    },
  },
  required: ['actor'],
};

export const addItemsSchema = {
  type: 'object',
  properties: {
    actor: { type: 'string', description: 'Id or exact name of the actor (a token id works too)' },
    items: {
      type: 'array',
      description: 'The items to add, at least one.',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name to look up, e.g. "Entertain (Taunt)" or "Strike Mighty Blow"',
          },
          type: {
            type: 'string',
            description:
              'WFRP item type (skill, talent, trait, trapping, career, weapon, armour, spell, prayer and others). Chooses between entries of one name, and is the type of a blank item when no compendium has the name.',
          },
          pack: {
            type: 'string',
            description: 'Compendium id, or part of it, to take the entry from.',
          },
          advances: { type: 'number', description: 'Skills only: advances of the new skill.' },
          quantity: { type: 'number', description: 'Gear only: quantity of the new item.' },
          setCurrent: { type: 'boolean', description: 'Careers only: make it the current career.' },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
  },
  required: ['actor', 'items'],
};
