/**
 * Stored documents of the three systems, only for tests. Their shape follows
 * the public data models named in the adapters (read 14.09.2026); names and
 * values are invented for the tests.
 *
 * The documents are put together from the small factories below, so each
 * sample reads as its values rather than as repeated structure.
 */

type Data = Record<string, unknown>;

/** An embedded or compendium document: id, name, type and system data, then anything extra. */
const doc = (_id: string, name: string, type: string, system: Data = {}, extra: Data = {}) => ({
  _id,
  name,
  type,
  ...extra,
  system,
});

/** A world actor: like `doc`, with its items and no active effects. */
const actorDoc = (_id: string, name: string, type: string, system: Data, items: Data[] = []) => ({
  ...doc(_id, name, type, system),
  items,
  effects: [],
});

/** A compendium entry as the index loader returns it: no effects and no flags unless given. */
const packDoc = (_id: string, name: string, type: string, system: Data = {}, extra: Data = {}) =>
  doc(_id, name, type, system, { effects: [], flags: {}, ...extra });

/** `{ value }`, or `{ value, max }` when a maximum is given. */
const val = (value: unknown, max?: number) => (max === undefined ? { value } : { value, max });

const eachOf = <T>(entries: Record<string, T>, make: (entry: T) => Data): Data =>
  Object.fromEntries(Object.entries(entries).map(([key, entry]) => [key, make(entry)]));

/** WFRP4e characteristics from [initial, advances]. */
const characteristics = (values: Record<string, [number, number]>) =>
  eachOf(values, ([initial, advances]) => ({
    initial,
    advances,
    modifier: 0,
    bonusMod: 0,
    calculationBonusModifier: 0,
  }));

/** Cosmere attributes from [value, bonus]. */
const cosmereAttributes = (values: Record<string, [number, number]>) =>
  eachOf(values, ([value, bonus]) => ({ value, bonus }));

/** Traveller characteristics from plain numbers. */
const plainValues = (values: Record<string, number>) => eachOf(values, value => val(value));

const quantity = (count: number) => ({ quantity: val(count) });
const career = (current: boolean) => ({ current: val(current) });

/** A WFRP4e dwarf character with two careers, skills, a spell and a prayer. */
export const WFRP_BRUNHILDE = actorDoc(
  'wfrpBrunhilde01',
  'Brunhilde Eisenfaust',
  'character',
  {
    characteristics: characteristics({
      ws: [42, 5],
      bs: [28, 0],
      s: [35, 0],
      t: [44, 5],
      i: [31, 0],
      ag: [25, 0],
      dex: [30, 0],
      int: [29, 0],
      wp: [48, 0],
      fel: [22, 0],
    }),
    status: {
      wounds: val(13, 15),
      advantage: val(0, 10),
      criticalWounds: val(0, 4),
      corruption: val(1, 9),
      fate: val(2),
      fortune: val(2),
      resilience: val(1),
      resolve: val(1),
    },
    details: {
      species: { value: 'Dwarf', subspecies: '' },
      size: val('avg'),
      move: { value: 3, walk: '', run: '' },
      biography: val('<p>Former soldier.</p>'),
      experience: { total: 350, spent: 200, log: [] },
      class: val('Warriors'),
      career: val('[Circular Reference]'),
      status: { standing: 'Silver 3', tier: 2, modifier: 0, value: '' },
    },
    settings: { autoCalc: { wounds: true } },
  },
  [
    doc('skMelee', 'Melee (Basic)', 'skill', {
      characteristic: val('ws'),
      advances: val(5),
      modifier: val(0),
    }),
    doc('skPercept', 'Perception', 'skill', {
      characteristic: val('i'),
      advances: val(10),
      modifier: val(0),
    }),
    doc('crSoldier', 'Soldier', 'career', career(true)),
    doc('crRat', 'Rat Catcher', 'career', career(false)),
    doc('spDart', 'Dart', 'spell', {
      cn: val(0),
      lore: val('petty'),
      range: val('Willpower yards'),
      target: val('1'),
    }),
    doc('prBless', 'Bless', 'prayer', {
      god: val('Grungni'),
      range: val('6 yards'),
      target: val('1'),
    }),
    doc('wpAxe', 'Hand Axe', 'weapon', { ...quantity(1), equipped: val(true) }),
    doc('trRope', 'Rope', 'trapping', quantity(2)),
  ]
);

/** A WFRP4e creature as a bestiary keeps it. */
export const WFRP_GIANT_RAT = actorDoc(
  'wfrpGiantRat001',
  'Giant Rat',
  'creature',
  {
    characteristics: characteristics({
      ws: [25, 0],
      bs: [0, 0],
      s: [15, 0],
      t: [20, 0],
      i: [35, 0],
      ag: [40, 0],
      dex: [0, 0],
      int: [10, 0],
      wp: [10, 0],
      fel: [0, 0],
    }),
    status: { wounds: val(5, 5) },
    details: { species: val('Rat'), size: val('sml'), move: val(5) },
  },
  [doc('trBite', 'Bite', 'trait'), doc('trSkittish', 'Skittish', 'trait')]
);

/** Item compendium entries for wfrp4e-add-items. */
export const WFRP_CORE_ITEMS = [
  packDoc(
    'cEntertain',
    'Entertain ()',
    'skill',
    { characteristic: val('fel'), advances: val(0), grouped: val('isSpec') },
    { img: 'icons/entertain.webp' }
  ),
  packDoc('cDodge', 'Dodge', 'skill', { characteristic: val('ag'), advances: val(0) }),
  packDoc(
    'cMighty',
    'Strike Mighty Blow',
    'talent',
    { tests: val('') },
    { effects: [{ name: 'Mighty Blow' }], flags: { wfrp4e: { core: true } } }
  ),
  packDoc('cAxe', 'Hand Axe', 'weapon', quantity(1)),
  packDoc('cSoldier', 'Soldier', 'career', career(false)),
  packDoc('cScout', 'Scout', 'career', career(false)),
  packDoc('cBlessedT', 'Blessed', 'talent'),
  packDoc('cBlessedR', 'Blessed', 'trait'),
  packDoc('cRope1', 'Rope', 'trapping', quantity(1)),
];

export const WFRP_OTHER_ITEMS = [
  packDoc('oAxe', 'Hand Axe', 'weapon', quantity(1)),
  packDoc('oTwin1', 'Twin Blade', 'weapon'),
  packDoc('oTwin2', 'Twin Blade', 'weapon'),
];

const field = (value: number, bonus = 0) => ({
  derived: value,
  override: null,
  useOverride: false,
  bonus,
});

/** A Cosmere resource: current value and a derived maximum. */
const pool = (current: number, max: Data) => ({ value: current, max, bonus: 0 });

/** A Cosmere adversary with derived fields as the data model stores them. */
export const COSMERE_CHASMFIEND = actorDoc('cosChasmfiend01', 'Chasmfiend', 'adversary', {
  tier: 3,
  role: 'boss',
  type: { id: 'animal', custom: null, subtype: 'greatshell' },
  size: 'gargantuan',
  attributes: cosmereAttributes({
    str: [6, 0],
    spd: [2, 0],
    int: [0, 0],
    wil: [3, 0],
    awa: [3, 0],
    pre: [1, 0],
  }),
  defenses: { phy: field(18), cog: field(13), spi: field(14) },
  resources: {
    hea: pool(180, field(180)),
    foc: pool(5, field(5)),
    inv: pool(0, field(0)),
  },
  deflect: { ...field(2), natural: 2, source: 'natural' },
  movement: { walk: { rate: field(30) } },
  skills: { ath: { rank: 3, mod: field(9) } },
});

/** A Cosmere character whose investiture maximum is overridden by hand. */
export const COSMERE_SHARDBEARER = actorDoc('cosShardbearer1', 'Veyla', 'character', {
  tier: 1,
  level: 3,
  type: { id: 'humanoid', custom: null, subtype: null },
  size: 'medium',
  attributes: cosmereAttributes({
    str: [2, 0],
    spd: [3, 1],
    int: [2, 0],
    wil: [2, 0],
    awa: [3, 0],
    pre: [2, 0],
  }),
  resources: {
    hea: pool(14, field(16)),
    foc: pool(4, field(4)),
    inv: pool(2, { ...field(0), override: 3, useOverride: true }),
  },
  skills: { agi: { rank: 2 }, prs: { rank: 1, mod: field(3) } },
});

/** A Traveller skill level with its trained marker. */
const rank = (value: number, trained: boolean, extra: Data = {}) => ({ value, trained, ...extra });

/** Traveller hit points: current, maximum and the damage taken. */
const hits = (value: number, max: number, damage: number) => ({ value, max, damage, tmpDamage: 0 });

/** A Traveller with a damaged characteristic and skills with specialities. */
export const TRAVELLER_KESSA = actorDoc(
  'mgtKessaVorn001',
  'Kessa Vorn',
  'traveller',
  {
    characteristics: plainValues({ STR: 7, DEX: 10, END: 8, INT: 9, EDU: 11, SOC: 5, PSI: 0 }),
    damage: { STR: val(0), DEX: val(3), END: { value: 0, tmp: 0 } },
    hits: hits(22, 25, 3),
    skills: {
      pilot: rank(2, true, {
        specialities: {
          smallCraft: rank(2, true),
          spacecraft: rank(0, false),
          capitalShips: rank(0, false),
        },
      }),
      vaccsuit: rank(1, true, { id: 'vaccsuit' }),
      admin: rank(0, false),
    },
    sophont: {
      species: 'Human',
      gender: 'female',
      age: 34,
      homeworld: 'Regina',
      profession: 'Scout',
    },
  },
  [
    doc('itPistol', 'Autopistol', 'weapon', {
      status: 'equipped',
      quantity: 1,
      weapon: { skill: 'guncombat.slug' },
    }),
    doc('itKit', 'Medikit', 'item', { status: 'carried', quantity: 2 }),
  ]
);

export const TRAVELLER_KIAN = actorDoc('mgtKianBeast001', 'Kian', 'creature', {
  characteristics: plainValues({ STR: 12, DEX: 9, END: 11, INT: 1, PSI: 0 }),
  damage: { STR: val(0), DEX: val(0), END: { value: 0, tmp: 0 } },
  hits: hits(32, 32, 0),
  skills: {},
  behaviour: 'carnivore pouncer',
  traits: 'Armour (+2)',
});
