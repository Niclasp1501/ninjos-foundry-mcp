/**
 * Stored dsa5 documents for the tests, in the shape of the data models of
 * dsa5 8.1.5 (modules/data/actor and modules/data/item of the public system).
 * Invented heroes and creatures; no text of a published archetype.
 */

const characteristics = (values: Record<string, number>) =>
  Object.fromEntries(
    Object.entries(values).map(([key, initial]) => [
      key,
      { initial, species: 0, modifier: 0, advances: 0 },
    ])
  );

const skill = (
  id: string,
  name: string,
  value: number,
  checks: [string, string, string],
  group = 'body'
) => ({
  _id: id,
  name,
  type: 'skill',
  system: {
    talentValue: { value },
    characteristic1: { value: checks[0] },
    characteristic2: { value: checks[1] },
    characteristic3: { value: checks[2] },
    group: { value: group },
    StF: { value: 'B' },
  },
});

/** A magical hero: 1100 adventure points, experienced, an arcane tradition with KL as guide. */
export const ALRIK = {
  _id: 'alrik00000000001',
  name: 'Alrik',
  type: 'character',
  img: 'systems/dsa5/tokens/alrik.webp',
  system: {
    characteristics: characteristics({
      mu: 13,
      kl: 14,
      in: 13,
      ch: 11,
      ff: 12,
      ge: 13,
      ko: 12,
      kk: 11,
    }),
    status: {
      wounds: { initial: 5, value: 25, advances: 0, modifier: 0, current: 8, max: 0 },
      astralenergy: { initial: 20, value: 30, advances: 0, modifier: 0, permanentLoss: 0, max: 0 },
      karmaenergy: { initial: 0, value: 0, advances: 0, modifier: 0, permanentLoss: 0, max: 0 },
      fatePoints: { value: 3, modifier: 0, current: 3 },
      speed: { initial: 8, modifier: 0, value: 0 },
      dodge: { value: 0, modifier: 0 },
      initiative: { value: 0, modifier: 0 },
      size: { value: 'average' },
    },
    guidevalue: { magical: 'kl', clerical: '-' },
    energyfactor: { magical: 1, clerical: 1 },
    tradition: { magical: 'Gildenmagier', clerical: '' },
    feature: { magical: 'Hellsicht', clerical: '' },
    details: {
      species: { value: 'Mensch' },
      culture: { value: 'Mittelreich' },
      career: { value: 'Gildenmagier' },
      experience: { total: 1100, spent: 1050 },
      age: { value: '' },
      biography: { value: '' },
    },
  },
  items: [
    skill('climb0000000001', 'Klettern', 4, ['mu', 'ge', 'kk']),
    skill('perception00001', 'Sinnesschärfe', 7, ['kl', 'in', 'in'], 'social'),
    {
      _id: 'daggers00000001',
      name: 'Dolche',
      type: 'combatskill',
      system: { talentValue: { value: 8 }, guidevalue: { value: 'ge' }, weapontype: { value: 0 } },
    },
    {
      _id: 'crossbows000001',
      name: 'Armbrüste',
      type: 'combatskill',
      system: { talentValue: { value: 7 }, guidevalue: { value: 'ff' }, weapontype: { value: 1 } },
    },
    {
      _id: 'dagger000000001',
      name: 'Dolch',
      type: 'meleeweapon',
      system: {
        combatskill: { value: 'Dolche' },
        atmod: { value: 0 },
        pamod: { value: -1 },
        worn: { value: true },
      },
    },
    {
      _id: 'robe00000000001',
      name: 'Robe',
      type: 'armor',
      system: { protection: { value: 1 }, worn: { value: true } },
    },
    {
      _id: 'ignifaxius00001',
      name: 'Ignifaxius',
      type: 'spell',
      system: {
        talentValue: { value: 6 },
        characteristic1: { value: 'mu' },
        characteristic2: { value: 'kl' },
        characteristic3: { value: 'ch' },
        AsPCost: { value: 8 },
        castingTime: { value: 2 },
        range: { value: '32 Schritt' },
        targetCategory: { value: 'Wesen' },
        duration: { value: 'sofort' },
        feature: 'Elementar',
      },
    },
  ],
  effects: [
    {
      _id: 'painEffect00001',
      name: 'Schmerz',
      statuses: ['inpain'],
      system: { condition: { value: 2, max: 4, manual: 2, auto: 0 } },
    },
  ],
};

/** A creature without adventure points and without species. */
export const WOLF = {
  _id: 'wolf000000000001',
  name: 'Wolf',
  type: 'creature',
  system: {
    characteristics: characteristics({
      mu: 12,
      kl: 10,
      in: 13,
      ch: 10,
      ff: 10,
      ge: 13,
      ko: 12,
      kk: 11,
    }),
    status: {
      wounds: { initial: 22, value: 22, advances: 0, modifier: 0 },
      astralenergy: { initial: 0, value: 0 },
      karmaenergy: { initial: 0, value: 0 },
      size: { value: 'small' },
    },
    creatureClass: { value: 'Tier' },
    details: { experience: { total: 0, spent: 0 } },
  },
  items: [{ _id: 'bite00000000001', name: 'Biss', type: 'trait', system: {} }],
  effects: [],
};

/** Two archetypes of a premium module compendium, reduced to what the tools read. */
export const ARCHETYPES = [
  {
    ...structuredClone(ALRIK),
    _id: 'archMage0000001',
    name: 'Gildenmagier aus Punin',
    folder: 'packFolder',
    sort: 100,
    ownership: { default: 0 },
    _stats: { compendiumSource: null, systemVersion: '8.1.5' },
    prototypeToken: { name: 'Gildenmagier aus Punin', actorLink: true },
  },
  {
    _id: 'archDwarf000001',
    name: 'Zwergischer Söldner',
    type: 'character',
    img: 'systems/dsa5/tokens/dwarf.webp',
    system: {
      characteristics: characteristics({
        mu: 14,
        kl: 11,
        in: 12,
        ch: 10,
        ff: 12,
        ge: 12,
        ko: 15,
        kk: 14,
      }),
      status: { wounds: { initial: 8, value: 38 }, size: { value: 'small' } },
      details: {
        species: { value: 'Zwerg' },
        culture: { value: 'Ambosszwerge' },
        career: { value: 'Söldner' },
        experience: { total: 1100, spent: 1100 },
      },
    },
    items: [],
    effects: [],
  },
  { _id: 'archWolf0000001', name: 'Wolf', type: 'creature', system: structuredClone(WOLF.system) },
];
