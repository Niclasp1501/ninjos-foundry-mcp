/**
 * Stored dnd5e 5.3 documents for tests, in the shape of the SRD compendium
 * sources of release 5.3.3 (goblin, a young dragon, a level 3 wizard). Only
 * used by tests; free of Foundry.
 */
type Data = Record<string, unknown>;

const scimitarAttack = {
  _id: 'scimAttack000001',
  type: 'attack',
  activation: { type: 'action', value: 1, override: false },
  attack: {
    ability: '',
    bonus: '',
    critical: { threshold: null },
    flat: false,
    type: { value: 'melee', classification: 'weapon' },
  },
  damage: { critical: {}, includeBase: true, parts: [] },
};

export const GOBLIN: Data = {
  _id: 'goblin0000000001',
  name: 'Goblin',
  type: 'npc',
  img: 'systems/dnd5e/tokens/humanoid/Goblin.webp',
  system: {
    abilities: {
      str: { value: 8, proficient: 0 },
      dex: { value: 14, proficient: 0 },
      con: { value: 10, proficient: 0 },
      int: { value: 10, proficient: 0 },
      wis: { value: 8, proficient: 0 },
      cha: { value: 8, proficient: 0 },
    },
    attributes: {
      ac: { calc: 'default', flat: null },
      hp: { value: 7, max: 7, temp: null, formula: '2d6' },
      movement: { walk: 30, units: 'ft', hover: false },
      senses: { ranges: { darkvision: 60 }, units: 'ft', special: '' },
      spell: { level: 0 },
      spellcasting: 'int',
    },
    details: {
      cr: 0.25,
      type: { value: 'humanoid', subtype: 'goblinoid', swarm: '', custom: '' },
      alignment: 'Neutral Evil',
      source: { book: 'SRD 5.1', page: '', rules: '2014', license: 'CC-BY-4.0' },
    },
    traits: { size: 'sm', languages: { value: ['common', 'goblin'], custom: '' } },
    skills: { ste: { value: 2, ability: 'dex' } },
    resources: { legact: { max: 0, spent: 0 }, legres: { max: 0, spent: 0 } },
  },
  items: [
    {
      _id: 'scimitar00000001',
      name: 'Scimitar',
      type: 'weapon',
      system: {
        quantity: 1,
        equipped: true,
        proficient: 1,
        properties: ['fin', 'lgt'],
        type: { value: 'martialM', baseItem: 'scimitar' },
        range: { value: null, long: null, reach: 5, units: 'ft' },
        damage: { base: { number: 1, denomination: 6, types: ['slashing'] } },
        activities: { scimAttack000001: scimitarAttack },
      },
    },
  ],
};

export const YOUNG_DRAGON: Data = {
  _id: 'dragon0000000001',
  name: 'Young Red Dragon',
  type: 'npc',
  system: {
    attributes: {
      ac: { calc: 'natural', flat: 18 },
      hp: { value: 178, max: 178, formula: '17d10+85' },
      spell: { level: 3 },
    },
    details: { cr: 10, type: { value: 'dragon', subtype: '' }, alignment: 'Chaotic Evil' },
    traits: { size: 'lg' },
    resources: { legact: { max: 3, spent: 0 }, legres: { max: 0, spent: 0 } },
  },
  items: [],
};

export const MIRA: Data = {
  _id: 'mira000000000001',
  name: 'Mira',
  type: 'character',
  system: {
    abilities: { int: { value: 16, proficient: 1 }, wis: { value: 12, proficient: 1 } },
    attributes: { ac: { calc: 'default' }, hp: { value: 14, max: 17, temp: 3 } },
    details: { race: '' },
    spells: { spell1: { value: 3, override: 4 }, spell2: { value: 2, override: null } },
  },
  items: [
    {
      _id: 'wizardClass00001',
      name: 'Wizard',
      type: 'class',
      system: {
        identifier: 'wizard',
        levels: 3,
        spellcasting: { progression: 'full', ability: 'int' },
      },
    },
    { _id: 'elfRace000000001', name: 'Elf', type: 'race', system: {} },
    {
      _id: 'magicMissile0001',
      name: 'Magic Missile',
      type: 'spell',
      system: {
        level: 1,
        method: 'spell',
        prepared: 1,
        sourceItem: 'class:wizard',
        range: { value: 120, units: 'ft' },
        activation: { type: 'action', value: 1 },
      },
    },
    {
      _id: 'light00000000001',
      name: 'Light',
      type: 'spell',
      system: {
        level: 0,
        method: 'spell',
        prepared: 0,
        range: { units: 'touch' },
        target: { affects: { count: 1, type: 'object' } },
      },
    },
  ],
};
