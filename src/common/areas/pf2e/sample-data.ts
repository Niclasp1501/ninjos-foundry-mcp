/**
 * Stored pf2e documents for tests, shaped like the source data of the pf2e
 * system (npc, character, hazard, spellcasting entry, condition). Written by
 * hand for these tests; the numbers are chosen so the rules can be checked.
 */

export const GOBLIN_WARRIOR = {
  _id: 'gobWarrior0001',
  name: 'Goblin Warrior',
  type: 'npc',
  img: 'systems/pf2e/icons/goblin.webp',
  system: {
    abilities: {
      str: { mod: 0 },
      dex: { mod: 3 },
      con: { mod: 1 },
      int: { mod: 0 },
      wis: { mod: -1 },
      cha: { mod: 1 },
    },
    attributes: { ac: { value: 16, details: '' }, hp: { value: 6, max: 6, temp: 0, details: '' } },
    perception: { mod: 2, details: '', senses: [{ type: 'darkvision' }] },
    saves: {
      fortitude: { value: 5, saveDetail: '' },
      reflex: { value: 7, saveDetail: '' },
      will: { value: 3, saveDetail: '' },
    },
    skills: { acrobatics: { base: 5 }, athletics: { base: 2 }, stealth: { base: 5 } },
    details: { level: { value: -1 }, blurb: '', publicNotes: '<p>Goblin warriors are eager.</p>' },
    traits: { value: ['goblin', 'humanoid'], rarity: 'common', size: { value: 'sm' } },
    resources: { focus: { value: 0, max: 0, cap: 3 } },
  },
  items: [
    {
      _id: 'dogslicer00001',
      name: 'Dogslicer',
      type: 'melee',
      system: {
        bonus: { value: 8 },
        traits: { value: ['agile', 'backstabber', 'finesse'] },
        damageRolls: {},
      },
    },
    {
      _id: 'shortbow000001',
      name: 'Shortbow',
      type: 'melee',
      system: {
        bonus: { value: 8 },
        traits: { value: ['deadly-d10', 'range-increment-60'] },
        damageRolls: {},
      },
    },
    {
      _id: 'goblinScuttle1',
      name: 'Goblin Scuttle',
      type: 'action',
      system: {
        actionType: { value: 'reaction' },
        actions: { value: null },
        traits: { value: [] },
      },
    },
  ],
};

export const CAVE_WORM_CASTER = {
  _id: 'cultist0000001',
  name: 'Cult Fanatic',
  type: 'npc',
  system: {
    abilities: {
      str: { mod: 0 },
      dex: { mod: 1 },
      con: { mod: 1 },
      int: { mod: 0 },
      wis: { mod: 4 },
      cha: { mod: 2 },
    },
    attributes: { ac: { value: 18 }, hp: { value: 40, max: 45, temp: 5 } },
    perception: { mod: 9 },
    saves: { fortitude: { value: 7 }, reflex: { value: 6 }, will: { value: 11 } },
    skills: { religion: { base: 11 } },
    details: { level: { value: 3 }, alignment: { value: 'ce' } },
    traits: { value: ['human', 'humanoid'], rarity: 'uncommon', size: { value: 'med' } },
    resources: { focus: { value: 1, max: 1, cap: 3 } },
  },
  items: [
    {
      _id: 'divineEntry001',
      name: 'Divine Prepared Spells',
      type: 'spellcastingEntry',
      system: {
        ability: { value: 'wis' },
        spelldc: { value: 11, dc: 19 },
        tradition: { value: 'divine' },
        prepared: { value: 'prepared' },
        slots: {
          slot0: { max: 5, value: 5, prepared: [{ id: 'spellDivLance1' }] },
          slot1: {
            max: 3,
            value: 3,
            prepared: [
              { id: 'spellHeal00001', expended: false },
              { id: 'spellHeal00001', expended: true },
            ],
          },
          slot2: { max: 2, value: 2, prepared: [] },
        },
      },
    },
    {
      _id: 'spellDivLance1',
      name: 'Divine Lance',
      type: 'spell',
      system: {
        level: { value: 1 },
        traits: { value: ['cantrip', 'concentrate', 'manipulate', 'sanctified', 'spirit'] },
        time: { value: '2' },
        range: { value: '30 feet' },
        target: { value: '1 creature' },
        area: null,
        location: { value: 'divineEntry001' },
      },
    },
    {
      _id: 'spellHeal00001',
      name: 'Heal',
      type: 'spell',
      system: {
        level: { value: 1 },
        traits: { value: ['healing', 'manipulate', 'vitality'] },
        time: { value: '1 to 3' },
        range: { value: 'varies' },
        target: { value: '' },
        area: { type: 'emanation', value: 30 },
        location: { value: 'divineEntry001', heightenedLevel: 2 },
      },
    },
    {
      _id: 'spellFocus0001',
      name: 'Fire Ray',
      type: 'spell',
      system: {
        level: { value: 1 },
        traits: { value: ['focus', 'fire'] },
        time: { value: '2' },
        range: { value: '60 feet' },
        target: { value: '1 creature' },
        location: { value: '' },
      },
    },
    {
      _id: 'cursebound0001',
      name: 'Frightened',
      type: 'condition',
      system: {
        slug: 'frightened',
        value: { isValued: true, value: 2 },
        references: { children: [], overriddenBy: [], overrides: [] },
      },
    },
  ],
};

export const VALERIA = {
  _id: 'valeria0000001',
  name: 'Valeria',
  type: 'character',
  system: {
    abilities: null,
    build: {
      attributes: {
        manual: false,
        boosts: { 1: ['str', 'dex', 'con', 'wis'], 5: ['str', 'dex', 'con', 'wis'] },
      },
    },
    details: { level: { value: 5 }, keyability: { value: 'str' } },
    attributes: { hp: { value: 60, temp: 2 } },
    skills: { athletics: { rank: 2 }, intimidation: { rank: 1 } },
    resources: { focus: { value: 1 }, heroPoints: { value: 1, max: 3 } },
    proficiencies: { attacks: {} },
    traits: { value: [], rarity: 'common', size: { value: 'med' } },
  },
  items: [
    {
      _id: 'ancestryHuman1',
      name: 'Human',
      type: 'ancestry',
      system: {
        hp: 8,
        size: 'med',
        boosts: {
          0: { value: ['str', 'dex', 'con', 'int', 'wis', 'cha'], selected: 'str' },
          1: { value: ['str', 'dex', 'con', 'int', 'wis', 'cha'], selected: 'con' },
        },
        flaws: {},
      },
    },
    { _id: 'heritageVersa1', name: 'Versatile Human', type: 'heritage', system: {} },
    {
      _id: 'backgroundGuar',
      name: 'Guard',
      type: 'background',
      system: {
        boosts: {
          0: { value: ['str', 'cha'], selected: 'str' },
          1: { value: ['str', 'dex', 'con', 'int', 'wis', 'cha'], selected: 'wis' },
        },
        trainedSkills: { value: ['intimidation'], lore: ['Legal Lore'] },
      },
    },
    {
      _id: 'classFighter01',
      name: 'Fighter',
      type: 'class',
      system: {
        hp: 10,
        keyAbility: { value: ['str', 'dex'], selected: 'str' },
        perception: 2,
        savingThrows: { fortitude: 2, reflex: 2, will: 1 },
        attacks: { simple: 2, martial: 2, advanced: 1, unarmed: 2 },
        defenses: { unarmored: 1, light: 1, medium: 1, heavy: 1 },
        trainedSkills: { value: ['acrobatics'], additional: 3 },
      },
    },
    {
      _id: 'longsword00001',
      name: 'Longsword',
      type: 'weapon',
      system: {
        category: 'martial',
        group: 'sword',
        range: null,
        bonus: { value: 0 },
        runes: { potency: 1, striking: 1, property: [] },
        traits: { value: ['versatile-p'], rarity: 'common' },
        equipped: { carryType: 'held', handsHeld: 1 },
        quantity: 1,
        level: { value: 2 },
      },
    },
    {
      _id: 'daggerAgile001',
      name: 'Dagger',
      type: 'weapon',
      system: {
        category: 'simple',
        range: null,
        runes: { potency: 0 },
        traits: { value: ['agile', 'finesse', 'thrown-10', 'versatile-s'] },
        equipped: { carryType: 'worn' },
        quantity: 2,
        level: { value: 0 },
      },
    },
    {
      _id: 'chainMail00001',
      name: 'Chain Mail',
      type: 'armor',
      system: {
        category: 'medium',
        acBonus: 4,
        dexCap: 1,
        runes: { potency: 0 },
        equipped: { carryType: 'worn', inSlot: true },
        traits: { value: ['flexible', 'noisy'] },
      },
    },
    {
      _id: 'ringInvested01',
      name: 'Ring of Sustenance',
      type: 'equipment',
      system: {
        equipped: { carryType: 'worn', invested: true },
        traits: { value: ['invested', 'magical'], rarity: 'uncommon' },
        level: { value: 7 },
      },
    },
    {
      _id: 'suddenCharge01',
      name: 'Sudden Charge',
      type: 'feat',
      system: {
        category: 'class',
        level: { value: 1 },
        actionType: { value: 'action' },
        actions: { value: 2 },
        traits: { value: ['fighter', 'flourish', 'open'] },
      },
    },
    {
      _id: 'legalLore00001',
      name: 'Legal Lore',
      type: 'lore',
      system: { proficient: { value: 1 } },
    },
    {
      _id: 'powerAttack001',
      name: 'Power Attack',
      type: 'feat',
      system: {
        category: 'class',
        level: { value: 1 },
        actionType: { value: 'action' },
        actions: { value: 2 },
        traits: { value: ['fighter', 'flourish'] },
        rules: [
          {
            key: 'RollOption',
            domain: 'all',
            option: 'power-attack',
            toggleable: true,
            label: 'Power Attack',
          },
        ],
      },
    },
  ],
};

export const SPIKED_PIT = {
  _id: 'spikedPit00001',
  name: 'Spiked Pit',
  type: 'hazard',
  system: {
    attributes: {
      ac: { value: 18 },
      hp: { value: 12, max: 12 },
      hardness: 5,
      stealth: { value: 20, details: '' },
    },
    details: { level: { value: 0 }, isComplex: false, description: 'A pit with spikes.' },
    saves: { fortitude: { value: 0 }, reflex: { value: 0 }, will: { value: 0 } },
    traits: { value: ['mechanical', 'trap'], rarity: 'common', size: { value: 'med' } },
  },
  items: [],
};
