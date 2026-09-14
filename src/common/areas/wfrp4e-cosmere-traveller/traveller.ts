/**
 * The Mongoose Traveller 2e adapter (Foundry system `mgt2e` by Mongoose
 * Publishing), answered from plain data. There is exactly one place that
 * brings free actor data into the mgt2e shape: `normalizeActorSystem`.
 *
 * Checked against the public source (Mongoose-Publishing/traveller-foundryvtt,
 * branch main, read 14.09.2026):
 * - characteristics STR, DEX, END, INT, EDU, SOC, CHA, TER, PSI, WLT, LCK,
 *   MRL, STY, RES, FOL, REP and the skills with their specialities, spelled as
 *   the system spells them, "vetinary" included (module/helpers/config.mjs)
 * - `hits` with value, max, damage, tmpDamage; `damage.STR`, `.DEX`, `.END`;
 *   `sophont` with age, species, gender, weight, height, profession,
 *   homeworld; creatures with behaviour and traits; actor and item types, item
 *   `status` and `quantity` (template.json)
 * - checks roll 2D6, with a boon 3D6 keeping the highest two, with a bane the
 *   lowest two, add the characteristic DM, take -3 for an untrained skill,
 *   aim at 8, and the effect is total minus the difficulty
 *   (module/helpers/dice-rolls.mjs)
 *
 * Not verified: the DM table (from the rules, the source reads a prepared
 * `dm`), the skill field `id`, the values "equipped" and "carried" of item
 * status, the name CONFIG.MGT2, and the fields of spacecraft, vehicles and
 * worlds, which are therefore not read.
 */
import type {
  AdapterDocument,
  CharacterSummary,
  CreatureFilterSpec,
  CreatureRow,
  SystemAdapter,
} from '../../game-systems.js';
import {
  at,
  choiceLists,
  formulaWith,
  isRecord,
  num,
  read,
  signed,
  systemOf,
  text,
  type Data,
} from './shared.js';

export const TRAVELLER_ID = 'mgt2e';

export const CHARACTERISTICS = [
  'STR',
  'DEX',
  'END',
  'INT',
  'EDU',
  'SOC',
  'CHA',
  'TER',
  'PSI',
  'WLT',
  'LCK',
  'MRL',
  'STY',
  'RES',
  'FOL',
  'REP',
] as const;

export const CHARACTERISTIC_NAMES: Readonly<Record<string, string>> = {
  STR: 'Strength',
  DEX: 'Dexterity',
  END: 'Endurance',
  INT: 'Intellect',
  EDU: 'Education',
  SOC: 'Social Standing',
  CHA: 'Charm',
  TER: 'Territory',
  PSI: 'Psionic Strength',
  WLT: 'Wealth',
  LCK: 'Luck',
};

/** Skills with specialities, keys as mgt2e writes them (config.mjs). */
export const SPECIALITIES: Readonly<Record<string, readonly string[]>> = {
  animals: ['handling', 'vetinary', 'training'],
  art: ['performer', 'holography', 'instrument', 'visualMedia', 'write'],
  athletics: ['dexterity', 'endurance', 'strength'],
  drive: ['hovercraft', 'mole', 'track', 'walker', 'wheel'],
  electronics: ['comms', 'computers', 'remoteOps', 'sensors'],
  engineer: ['mDrive', 'jDrive', 'lifeSupport', 'power'],
  flyer: ['airship', 'grav', 'ornithopter', 'rotor', 'wing'],
  gunner: ['turret', 'ortillery', 'screen', 'capital'],
  guncombat: ['archaic', 'energy', 'slug'],
  heavyweapons: ['artillery', 'portable', 'vehicle'],
  language: ['galanglic', 'vilani', 'zdetl', 'oynprith', 'trokh', 'gvegh'],
  melee: ['unarmed', 'blade', 'bludgeon', 'natural'],
  pilot: ['smallCraft', 'spacecraft', 'capitalShips'],
  profession: [
    'belter',
    'biologicals',
    'civilEngineering',
    'construction',
    'hydroponics',
    'polymers',
    'robotics',
  ],
  science: [
    'archaeology',
    'astronomy',
    'biology',
    'chemistry',
    'cosmology',
    'cybernetics',
    'economics',
    'genetics',
    'history',
    'linquistics',
    'philosophy',
    'physics',
    'planetology',
    'psionicology',
    'psychology',
    'robotics',
    'sophontology',
    'xenology',
  ],
  seafarer: ['oceanShips', 'personal', 'sail', 'submarine'],
  tactics: ['military', 'naval'],
};

export const ACTOR_TYPES = [
  'traveller',
  'npc',
  'creature',
  'spacecraft',
  'package',
  'vehicle',
  'world',
  'swarm',
  'robot',
] as const;

/** Allowed items per actor type. */
export const ITEMS_PER_ACTOR: Readonly<Record<string, readonly string[]>> = {
  traveller: ['weapon', 'armour', 'augment', 'term', 'associate', 'item', 'software'],
  npc: ['weapon', 'armour', 'augment', 'item', 'software'],
  creature: ['weapon', 'armour', 'augment', 'item', 'software'],
  spacecraft: ['weapon', 'armour', 'augment', 'cargo', 'hardware', 'role', 'software', 'item'],
  world: ['cargo', 'item', 'software', 'worlddata'],
};

/** The characteristic DM of the rules: 0 is -3, 1 to 2 -2, 3 to 5 -1, 6 to 8 0, 9 to 11 +1, 12 to 14 +2, 15 and up +3. */
export function dmFor(value: number): number {
  if (value <= 0) return -3;
  if (value <= 2) return -2;
  if (value <= 5) return -1;
  if (value <= 8) return 0;
  if (value <= 11) return 1;
  if (value <= 14) return 2;
  return 3;
}

export function characteristicKey(value: string | undefined): string | null {
  const wanted = (value ?? '').trim().toUpperCase();
  if ((CHARACTERISTICS as readonly string[]).includes(wanted)) return wanted;
  const byName = Object.entries(CHARACTERISTIC_NAMES).find(
    ([, name]) => name.toUpperCase() === wanted
  );
  return byName ? byName[0] : null;
}

/** A skill key as mgt2e writes it, from any case; unknown names are lower cased. */
export function skillKey(value: string): string {
  const compact = value
    .trim()
    .replace(/[\s_-]+/g, '')
    .toLowerCase();
  return Object.keys(SPECIALITIES).find(key => key.toLowerCase() === compact) ?? compact;
}

export function specialityKey(skill: string, value: string): string | null {
  const compact = value
    .trim()
    .replace(/[\s_-]+/g, '')
    .toLowerCase();
  return SPECIALITIES[skill]?.find(key => key.toLowerCase() === compact) ?? null;
}

export interface CharacteristicValue {
  name: string | null;
  value: number;
  damage: number;
  effective: number;
  dm: number;
}

export function characteristic(system: Data, key: string): CharacteristicValue | null {
  const entry = at(system, `characteristics.${key}`);
  const value = isRecord(entry) ? num(entry['value']) : num(entry);
  if (value === null) return null;
  const damage = num(at(system, `damage.${key}.value`)) ?? 0;
  const effective = value - damage;
  return {
    name: CHARACTERISTIC_NAMES[key] ?? null,
    value,
    damage,
    effective,
    dm: dmFor(effective),
  };
}

export function characteristicsOf(system: Data): Record<string, CharacteristicValue> {
  const out: Record<string, CharacteristicValue> = {};
  for (const key of CHARACTERISTICS) {
    const found = characteristic(system, key);
    if (found) out[key] = found;
  }
  return out;
}

function hitsOf(system: Data): { value: number | null; max: number | null } | null {
  const hits = at(system, 'hits');
  if (isRecord(hits)) return { value: num(hits['value']), max: num(hits['max']) };
  const plain = num(hits);
  return plain === null ? null : { value: plain, max: plain };
}

export function skillsOf(system: Data): Data {
  const skills = at(system, 'skills');
  if (!isRecord(skills)) return {};
  const out: Data = {};
  for (const [key, entry] of Object.entries(skills)) {
    if (!isRecord(entry)) continue;
    const trained = entry['trained'] === true;
    const value = num(entry['value']) ?? 0;
    const specialities: Data = {};
    if (isRecord(entry['specialities'])) {
      for (const [name, spec] of Object.entries(entry['specialities'])) {
        if (!isRecord(spec)) continue;
        const level = num(spec['value']) ?? 0;
        if (spec['trained'] === true || level > 0) specialities[name] = level;
      }
    }
    if (trained || value > 0 || Object.keys(specialities).length)
      out[key] = { value, trained, ...(Object.keys(specialities).length ? { specialities } : {}) };
  }
  return out;
}

// Creature index (2.2 to 2.6) --------------------------------------------------------------------

export function creatureRow(document: AdapterDocument): Record<string, unknown> {
  const system = systemOf(document);
  const characteristics = characteristicsOf(system);
  const hits = hitsOf(system);
  return {
    hits: hits?.max ?? hits?.value ?? 0,
    characteristics: Object.fromEntries(
      Object.entries(characteristics).map(([key, entry]) => [
        key,
        { value: entry.value, dm: entry.dm },
      ])
    ),
    strDm: characteristics['STR']?.dm ?? null,
    dexDm: characteristics['DEX']?.dm ?? null,
    hasPsionics: (characteristics['PSI']?.value ?? 0) > 0,
    species: text(at(system, 'sophont.species')).trim().toLowerCase() || null,
  };
}

export const CREATURE_FILTERS: readonly CreatureFilterSpec[] = [
  { name: 'hits', kind: 'numberOrRange', field: 'hits', defaults: { min: 0, max: 1000 } },
  { name: 'minHits', kind: 'min', field: 'hits' },
  { name: 'hasPsionics', kind: 'boolean', field: 'hasPsionics' },
  { name: 'species', kind: 'partialText', field: 'species' },
];

export function creatureListFields(row: CreatureRow): Record<string, unknown> {
  return {
    hits: row['hits'],
    characteristics: row['characteristics'],
    hasPsionics: row['hasPsionics'],
    species: row['species'],
  };
}

export function creatureSummary(row: CreatureRow): string {
  const dm = (value: unknown) => (typeof value === 'number' ? signed(value) : 'unknown');
  return `${row.type}, ${String(row['hits'] ?? 0)} hits, STR DM ${dm(row['strDm'])}, DEX DM ${dm(row['dexDm'])}, from ${row.packLabel}`;
}

export const INDEX_FIELDS = [
  'system.hits',
  'system.characteristics',
  'system.damage',
  'system.sophont',
];

export function actorStats(entry: AdapterDocument): Record<string, unknown> | null {
  if (!['npc', 'traveller', 'creature'].includes(text(read(entry, 'type')))) return null;
  const system: Data = {
    hits: read(entry, 'system.hits'),
    characteristics: read(entry, 'system.characteristics'),
    damage: read(entry, 'system.damage'),
  };
  const hits = hitsOf(system);
  return {
    actorType: text(read(entry, 'type')),
    species: text(read(entry, 'system.sophont.species')) || null,
    profession: text(read(entry, 'system.sophont.profession')) || null,
    hits,
    characteristics: Object.fromEntries(
      Object.entries(characteristicsOf(system)).map(([key, value]) => [
        key,
        { value: value.effective, dm: value.dm },
      ])
    ),
  };
}

// Characters (2.8) ----------------------------------------------------------------------------------

export function characterSummary(actor: AdapterDocument): CharacterSummary {
  const system = systemOf(actor);
  const type = text(actor['type']);
  const basicInfo: Data = { actorType: type };
  if (['traveller', 'npc', 'package'].includes(type)) {
    for (const field of ['species', 'gender', 'homeworld', 'profession', 'weight', 'height']) {
      const value = at(system, `sophont.${field}`);
      if (value !== undefined && value !== '') basicInfo[field] = value;
    }
    const age = num(at(system, 'sophont.age'));
    if (age !== null && age > 0) basicInfo['age'] = age;
  } else if (type === 'creature') {
    basicInfo['behaviour'] = at(system, 'behaviour') ?? null;
    basicInfo['traits'] = at(system, 'traits') ?? null;
  } else {
    basicInfo['note'] =
      `The fields of a ${type} are not read: their paths are not verified against the mgt2e source.`;
  }
  const description = at(system, 'description');
  if (typeof description === 'string' && description) basicInfo['description'] = description;

  const hits = at(system, 'hits');
  const stats: Data = {
    characteristics: characteristicsOf(system),
    skills: skillsOf(system),
    hits: hitsOf(system),
    damage: isRecord(hits)
      ? { physical: num(hits['damage']) ?? 0, stun: num(hits['tmpDamage']) ?? 0 }
      : null,
    dmNote: 'DMs are computed from the value minus damage by the table of the rules.',
  };
  return { basicInfo, stats };
}

// Rolls (2.13) ------------------------------------------------------------------------------------------

function diceFor(parts: string[]): { dice: string; extra: string } {
  if (parts.includes('boon')) return { dice: '3d6kh2', extra: ' with a boon' };
  if (parts.includes('bane')) return { dice: '3d6kl2', extra: ' with a bane' };
  return { dice: '2d6', extra: '' };
}

const RULE = '8+ succeeds, Effect = total minus 8';

/**
 * rollTarget for `skill`: "pilot", "pilot.smallCraft", optionally with the
 * characteristic and boon or bane after colons: "pilot.smallCraft:DEX:boon".
 * For `characteristic`: "DEX" or "DEX:bane".
 */
export function rollPlan(
  request: { rollType: string; rollTarget?: string; rollModifier?: string },
  actor: AdapterDocument | null
): { formula: string; label: string } {
  const parts = (request.rollTarget ?? '').split(':').map(part => part.trim());
  const flags = parts.slice(1).map(part => part.toLowerCase());
  const { dice, extra } = diceFor(flags);
  const system = actor ? systemOf(actor) : {};

  switch (request.rollType) {
    case 'characteristic': {
      const key = characteristicKey(parts[0]);
      if (!key)
        throw new Error(
          `rollTarget must be a characteristic for a characteristic check: ${CHARACTERISTICS.join(', ')} (optionally ":boon" or ":bane"), got "${request.rollTarget ?? ''}".`
        );
      const value = actor ? characteristic(system, key) : null;
      if (actor && !value) throw new Error(`The actor has no value for the characteristic ${key}.`);
      return {
        formula: formulaWith(dice, value?.dm ?? 0, request.rollModifier),
        label: `${key} check${extra}: ${RULE}`,
      };
    }
    case 'skill': {
      const [skillPart = '', specPart] = (parts[0] ?? '').split('.');
      if (!skillPart.trim())
        throw new Error(
          'A skill check needs the skill in rollTarget, e.g. "pilot.smallCraft:DEX".'
        );
      const skill = skillKey(skillPart);
      const speciality = specPart ? specialityKey(skill, specPart) : null;
      if (specPart && !speciality)
        throw new Error(
          `"${specPart}" is not a speciality of ${skill}. Specialities: ${(SPECIALITIES[skill] ?? []).join(', ') || 'none'}.`
        );
      const characteristicPart = flags.find(flag => characteristicKey(flag));
      const characteristicName = characteristicPart ? characteristicKey(characteristicPart) : null;
      let level = 0;
      let trained = true;
      if (actor) {
        const entry = at(system, `skills.${skill}`);
        trained = isRecord(entry) && entry['trained'] === true;
        const specEntry =
          speciality && isRecord(entry) ? at(entry, `specialities.${speciality}`) : undefined;
        level = trained
          ? speciality
            ? isRecord(specEntry) && specEntry['trained'] === true
              ? (num(specEntry['value']) ?? 0)
              : 0
            : (num(isRecord(entry) ? entry['value'] : undefined) ?? 0)
          : -3;
      }
      const dm =
        characteristicName && actor ? (characteristic(system, characteristicName)?.dm ?? 0) : 0;
      const name = speciality ? `${skill} (${speciality})` : skill;
      return {
        formula: formulaWith(dice, level + dm, request.rollModifier),
        label: `${name}${characteristicName ? ` with ${characteristicName}` : ''} check${extra}${trained ? '' : ', untrained -3'}: ${RULE}`,
      };
    }
    case 'custom': {
      const formula = parts.join(':').trim();
      if (!formula) throw new Error('A custom roll needs its formula in rollTarget, e.g. "2d6+1".');
      return { formula: formulaWith(formula, 0, request.rollModifier), label: 'Custom roll' };
    }
    default:
      throw new Error(
        `The roll type "${request.rollType}" is not a Traveller roll type: characteristic, skill or custom.`
      );
  }
}

// Actor data (2.14, 2.15) ---------------------------------------------------------------------------------

function normalizeSkill(key: string, value: unknown): unknown {
  const specialities = SPECIALITIES[key];
  if (typeof value === 'number') {
    if (specialities) {
      throw new Error(
        `skills.${key} has specialities (${specialities.join(', ')}); give them by name, e.g. { "${key}": { "${specialities[0]}": ${value} } }, ` +
          'because mgt2e takes the skill level from its specialities and a single number would be lost'
      );
    }
    return { value, trained: true, id: key };
  }
  if (!isRecord(value) || !specialities) return value;
  const out: Data = {};
  const specs: Data = isRecord(value['specialities']) ? { ...value['specialities'] } : {};
  for (const [name, entry] of Object.entries(value)) {
    if (name === 'specialities') continue;
    const spec = specialityKey(key, name);
    if (spec) specs[spec] = entry;
    else out[name] = entry;
  }
  const given: Data = {};
  for (const [name, entry] of Object.entries(specs)) {
    const spec = specialityKey(key, name) ?? name;
    given[spec] = typeof entry === 'number' ? { value: entry, trained: true } : entry;
  }
  if (Object.keys(given).length) {
    out['specialities'] = given;
    out['trained'] ??= true;
  }
  return out;
}

/**
 * The one place that brings free data into the mgt2e shape.
 * - Skill keys as mgt2e spells them, in nested objects and in dotted keys.
 * - A skill without specialities as a number: value, trained and its id.
 * - Specialities by name inside the skill, numbers as value and trained,
 *   without id. A skill with specialities as a single number is refused.
 * - Characteristics under their upper case key, a number as value.
 * - On create: skills exist, damage of STR, DEX and END is 0, missing
 *   specialities of a given skill are added with 0, hits from STR plus DEX
 *   plus END for travellers and npcs (7 each when missing), and `details`
 *   moves to `sophont` (career becomes profession, description moves up).
 */
export function normalizeActorSystem(
  system: Record<string, unknown>,
  context: { actorType: string; mode: 'create' | 'update' }
): Record<string, unknown> {
  const out: Data = {};
  for (const [key, value] of Object.entries(system)) {
    const dotted = /^skills\.([^.]+)(\..*)?$/.exec(key);
    if (dotted?.[1]) out[`skills.${skillKey(dotted[1])}${dotted[2] ?? ''}`] = value;
    else out[key] = value;
  }
  if (isRecord(out['skills'])) {
    const skills: Data = {};
    for (const [name, value] of Object.entries(out['skills'])) {
      const key = skillKey(name);
      skills[key] = normalizeSkill(key, value);
    }
    out['skills'] = skills;
  }
  if (isRecord(out['characteristics'])) {
    const characteristics: Data = {};
    for (const [name, value] of Object.entries(out['characteristics'])) {
      const key = characteristicKey(name) ?? name.toUpperCase();
      characteristics[key] =
        typeof value === 'number'
          ? { value, ...(context.mode === 'create' ? { show: true } : {}) }
          : value;
    }
    out['characteristics'] = characteristics;
  }
  if (context.mode !== 'create') return out;

  if (!isRecord(out['skills'])) out['skills'] = {};
  const skills = out['skills'] as Data;
  for (const [key, entry] of Object.entries(skills)) {
    const specs = SPECIALITIES[key];
    if (!specs || !isRecord(entry) || !isRecord(entry['specialities'])) continue;
    const given = entry['specialities'];
    for (const spec of specs) given[spec] ??= { value: 0, trained: false };
  }
  const damage: Data = isRecord(out['damage']) ? { ...out['damage'] } : {};
  for (const key of ['STR', 'DEX', 'END']) damage[key] ??= { value: 0 };
  out['damage'] = damage;
  if (
    (context.actorType === 'traveller' || context.actorType === 'npc') &&
    out['hits'] === undefined
  ) {
    const value = (key: string) => {
      const entry = at(out, `characteristics.${key}`);
      return (isRecord(entry) ? num(entry['value']) : num(entry)) ?? 7;
    };
    const total = value('STR') + value('DEX') + value('END');
    out['hits'] = { value: total, max: total, damage: 0, tmpDamage: 0 };
  }
  if (isRecord(out['details'])) {
    const details: Data = { ...out['details'] };
    const sophont: Data = isRecord(out['sophont']) ? { ...out['sophont'] } : {};
    if (details['career'] !== undefined) {
      sophont['profession'] ??= details['career'];
      delete details['career'];
    }
    if (details['description'] !== undefined) {
      out['description'] ??= details['description'];
      delete details['description'];
    }
    Object.assign(sophont, details);
    out['sophont'] = sophont;
    delete out['details'];
  }
  return out;
}

export const SCHEMA_NOTES = [
  'Mongoose Traveller 2e (mgt2e) actor data:',
  `- Types: ${ACTOR_TYPES.join(', ')}.`,
  `- characteristics.<${CHARACTERISTICS.join('|')}>.value; damage is kept apart under damage.STR, .DEX, .END (value). A number is taken as the value; the DM is derived.`,
  '- hits.value, .max, .damage, .tmpDamage. Without hits a new traveller or npc gets STR plus DEX plus END.',
  '- skills.<key>.value and .trained; a skill without specialities also gets its id. Skills with specialities take them by name and never a single number:',
  ...Object.entries(SPECIALITIES).map(([skill, specs]) => `  ${skill}: ${specs.join(', ')}`),
  '- sophont.species, .gender, .age, .homeworld, .profession, .weight, .height (there is no system.details; it is moved to sophont on create). Creatures: behaviour and traits.',
  ...Object.entries(ITEMS_PER_ACTOR).map(
    ([type, items]) => `- Items on a ${type}: ${items.join(', ')}.`
  ),
  '- Item types: item, weapon, armour, augment, term, associate, cargo, hardware, option, role, software, worlddata. Careers and ranks are term items, not actor fields.',
].join('\n');

export function itemEnums(config: unknown): Record<string, Record<string, readonly string[]>> {
  const block = isRecord(config) ? config['MGT2'] : undefined;
  if (!isRecord(block))
    throw new Error('CONFIG.MGT2 not found; the mgt2e system seems not to be loaded');
  return { config: choiceLists(block, 'CONFIG.MGT2') };
}

// The adapter --------------------------------------------------------------------------------------------------

const status = (item: AdapterDocument) => text(at(item, 'system.status')).toLowerCase();

export const travellerAdapter: SystemAdapter = {
  id: TRAVELLER_ID,
  title: 'Mongoose Traveller Second Edition',
  creatures: {
    indexVersion: 1,
    actorTypes: ['creature', 'npc', 'traveller'],
    invalidatingTypes: ['creature', 'npc', 'traveller'],
    copyableTypes: [...ACTOR_TYPES],
    row: creatureRow,
    power: { name: 'Hits', field: 'hits', range: null },
    filters: CREATURE_FILTERS,
    listFields: creatureListFields,
    summary: creatureSummary,
  },
  compendiumStats: { indexFields: INDEX_FIELDS, actorStats },
  characters: {
    summary: characterSummary,
    itemFields: item => {
      const out: Data = {};
      const quantity = num(at(item, 'system.quantity'));
      if (quantity !== null && quantity !== 1) out['quantity'] = quantity;
      if (status(item)) out['status'] = status(item);
      return out;
    },
  },
  characterSearch: {
    itemTypes: {
      spells: [],
      equipment: ['item', 'weapon', 'armour', 'augment', 'cargo', 'hardware', 'software'],
      features: ['term', 'associate', 'role', 'option'],
      actions: [],
    },
    categories: {
      equipped: {
        description: 'items whose status is "equipped"',
        matches: item => status(item) === 'equipped',
      },
      carried: {
        description: 'items whose status is "carried"',
        matches: item => status(item) === 'carried',
      },
    },
    matchDetails: item => ({
      quantity: num(at(item, 'system.quantity')),
      status: status(item) || null,
      ...(item['type'] === 'weapon'
        ? { skill: at(item, 'system.weapon.skill') ?? at(item, 'system.skill') ?? null }
        : {}),
    }),
  },
  rolls: {
    types: [
      {
        id: 'characteristic',
        description: '2d6 plus the characteristic DM; add ":boon" or ":bane" to rollTarget',
        targets: CHARACTERISTICS,
      },
      {
        id: 'skill',
        description:
          '2d6 plus skill level (untrained -3) plus the DM of a characteristic; rollTarget like "pilot.smallCraft:DEX" or "melee.blade:STR:boon"',
      },
      { id: 'custom', description: 'the formula in rollTarget' },
    ],
    plan: rollPlan,
  },
  actorData: { normalize: normalizeActorSystem, schemaNotes: () => SCHEMA_NOTES },
  worldItems: {
    enums: itemEnums,
    note: () =>
      'These are the choice lists of CONFIG.MGT2 by their path there, not item field paths. mgt2e stores unknown values without complaint and then ignores them.',
  },
};
