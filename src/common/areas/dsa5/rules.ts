/**
 * Rules and data paths of Das Schwarze Auge 5 as the dsa5 system for Foundry
 * stores them (Plushtoast/dsa5-foundryVTT, branch foundry14, system 8.1.5 for
 * Foundry 14). Nothing here touches Foundry; every function takes plain data.
 *
 * Sources, all in the public system repository:
 * - characteristics: modules/data/actor/templates/characteristics.js stores
 *   initial, species, modifier and advances; the value is derived in
 *   modules/data/baseactor.js as initial + advances + modifier + gear.
 * - life, astral and karma energy: templates/status.js stores value (the
 *   current points), initial, advances, modifier; baseactor.js derives the
 *   maximum (characters and NPCs: initial + 2 x KO for life energy).
 * - experience: templates/details.js, experience.total and .spent; the grades
 *   are the start budgets of DSA5.startXP in modules/config/config-dsa5.js and
 *   EXPERIENCE_GRADES in modules/system/helpers/utility-dsa5.js.
 * - combat techniques: combatskill.js; the base values follow the rule book
 *   (attack: technique value plus (MU - 8) / 3; parry: half the technique
 *   value rounded up plus (best guide characteristic - 8) / 3; ranged: FF).
 */

export type Data = Record<string, unknown>;

export const isRecord = (value: unknown): value is Data =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const text = (value: unknown): string => (typeof value === 'string' ? value : '');

export function num(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** A dotted path inside nested data. */
export function at(value: unknown, path: string): unknown {
  let node: unknown = value;
  for (const part of path.split('.')) {
    if (!isRecord(node)) return undefined;
    node = node[part];
  }
  return node;
}

/** An index row field: flat with the dotted key (as some indexes carry it), else nested. */
export function read(entry: unknown, path: string): unknown {
  if (isRecord(entry) && entry[path] !== undefined) return entry[path];
  return at(entry, path);
}

export const CHARACTERISTIC_KEYS = ['mu', 'kl', 'in', 'ch', 'ff', 'ge', 'ko', 'kk'] as const;
export type CharacteristicKey = (typeof CHARACTERISTIC_KEYS)[number];

export const CHARACTERISTIC_NAMES: Readonly<Record<CharacteristicKey, { de: string; en: string }>> =
  {
    mu: { de: 'Mut', en: 'Courage' },
    kl: { de: 'Klugheit', en: 'Sagacity' },
    in: { de: 'Intuition', en: 'Intuition' },
    ch: { de: 'Charisma', en: 'Charisma' },
    ff: { de: 'Fingerfertigkeit', en: 'Dexterity' },
    ge: { de: 'Gewandtheit', en: 'Agility' },
    ko: { de: 'Konstitution', en: 'Constitution' },
    kk: { de: 'Körperkraft', en: 'Strength' },
  };

/** A characteristic by key (MU, mu), German or English name, ignoring case. */
export function characteristicFor(target: string): CharacteristicKey | null {
  const wanted = target.trim().toLowerCase();
  if ((CHARACTERISTIC_KEYS as readonly string[]).includes(wanted))
    return wanted as CharacteristicKey;
  for (const key of CHARACTERISTIC_KEYS) {
    const names = CHARACTERISTIC_NAMES[key];
    if (names.de.toLowerCase() === wanted || names.en.toLowerCase() === wanted) return key;
  }
  return null;
}

/**
 * Experience levels as start budgets in adventure points (DSA5.startXP).
 * A hero at or above a budget has that level; below 1000 is level 1.
 */
export const EXPERIENCE_LEVELS: ReadonlyArray<{
  level: number;
  from: number;
  de: string;
  en: string;
}> = [
  { level: 1, from: 0, de: 'Unerfahren', en: 'Inexperienced' },
  { level: 2, from: 1000, de: 'Durchschnittlich', en: 'Average' },
  { level: 3, from: 1100, de: 'Erfahren', en: 'Experienced' },
  { level: 4, from: 1200, de: 'Kompetent', en: 'Competent' },
  { level: 5, from: 1400, de: 'Meisterlich', en: 'Masterful' },
  { level: 6, from: 1700, de: 'Brillant', en: 'Brilliant' },
  { level: 7, from: 2100, de: 'Legendär', en: 'Legendary' },
];

export function experienceLevel(total: number): (typeof EXPERIENCE_LEVELS)[number] {
  let found = EXPERIENCE_LEVELS[0] as (typeof EXPERIENCE_LEVELS)[number];
  for (const entry of EXPERIENCE_LEVELS) if (total >= entry.from) found = entry;
  return found;
}

/** dsa5 size categories and the words of the neutral size filter. */
export const SIZE_WORDS: Readonly<Record<string, string>> = {
  tiny: 'tiny',
  small: 'small',
  average: 'medium',
  big: 'large',
  giant: 'huge',
};
/** The filter words back to dsa5, plus the German names. */
export const SIZE_KEYS: Readonly<Record<string, string>> = {
  tiny: 'tiny',
  winzig: 'tiny',
  small: 'small',
  klein: 'small',
  medium: 'average',
  average: 'average',
  mittel: 'average',
  large: 'big',
  big: 'big',
  groß: 'big',
  gross: 'big',
  huge: 'giant',
  giant: 'giant',
  riesig: 'giant',
};

/** Species values the original offered for the filter, kept as allowed values. */
export const SPECIES_VALUES = [
  'mensch',
  'elf',
  'halbelf',
  'zwerg',
  'goblin',
  'ork',
  'halborc',
  'achaz',
  'troll',
  'oger',
  'drache',
  'dämon',
  'elementar',
  'untot',
  'tier',
  'chimäre',
] as const;

export const SPELL_TYPES = ['spell', 'ritual', 'magictrick'] as const;
export const LITURGY_TYPES = ['liturgy', 'ceremony', 'blessing'] as const;
export const MAGIC_TYPES: readonly string[] = [...SPELL_TYPES, ...LITURGY_TYPES];
export const EQUIPMENT_TYPES = [
  'meleeweapon',
  'rangeweapon',
  'armor',
  'equipment',
  'ammunition',
  'consumable',
  'poison',
  'plant',
  'book',
] as const;
export const FEATURE_TYPES = [
  'advantage',
  'disadvantage',
  'specialability',
  'trait',
  'species',
  'culture',
  'career',
] as const;

/** Compendium ids of the system itself (system.json of 8.1.5). */
export const SYSTEM_PACKS = { skills: ['dsa5.skills', 'dsa5.skillsen'] } as const;

/** The stored parts of a characteristic and its value without gear and effects. */
export function characteristicOf(
  system: Data,
  key: CharacteristicKey
): { value: number; initial: number; advances: number; modifier: number; species: number } {
  const entry = at(system, `characteristics.${key}`);
  const part = (name: string, fallback: number) =>
    isRecord(entry) ? (num(entry[name]) ?? fallback) : fallback;
  const initial = part('initial', 8);
  const advances = part('advances', 0);
  const modifier = part('modifier', 0);
  const species = part('species', 0);
  return { value: initial + advances + modifier, initial, advances, modifier, species };
}

export interface EnergyValue {
  value: number;
  max: number;
}

/**
 * Life energy (LeP): the stored value is the current points; the maximum is
 * derived. Characters and NPCs: initial + 2 x KO + modifier + advances;
 * creatures: initial + modifier + advances.
 */
export function lifePoints(actor: Data): EnergyValue | null {
  const system = isRecord(actor['system']) ? actor['system'] : {};
  const wounds = at(system, 'status.wounds');
  if (!isRecord(wounds)) return null;
  const initial = num(wounds['initial']) ?? 0;
  const base =
    actor['type'] === 'creature' ? initial : initial + 2 * characteristicOf(system, 'ko').value;
  const max = base + (num(wounds['modifier']) ?? 0) + (num(wounds['advances']) ?? 0);
  return { value: num(wounds['value']) ?? max, max };
}

/**
 * Astral (AsP) or karma energy (KaP). Characters and NPCs add the guide
 * characteristic of their tradition times the energy factor; creatures only
 * their stored base. Null without a tradition or points.
 */
export function energy(actor: Data, kind: 'astral' | 'karma'): EnergyValue | null {
  const system = isRecord(actor['system']) ? actor['system'] : {};
  const stored = at(system, `status.${kind}energy`);
  if (!isRecord(stored)) return null;
  const branch = kind === 'astral' ? 'magical' : 'clerical';
  let base = num(stored['initial']) ?? 0;
  if (actor['type'] !== 'creature') {
    const guide = text(at(system, `guidevalue.${branch}`)).toLowerCase();
    const key = characteristicFor(guide);
    if (key) {
      const factor = num(at(system, `energyfactor.${branch}`)) ?? 1;
      base += Math.round(characteristicOf(system, key).value * factor);
    }
  }
  const max =
    base +
    (num(stored['modifier']) ?? 0) +
    (num(stored['advances']) ?? 0) -
    (num(stored['permanentLoss']) ?? 0);
  if (max <= 0) return null;
  return { value: num(stored['value']) ?? max, max };
}

export const floorThird = (value: number) => Math.max(0, Math.floor((value - 8) / 3));

/** Attack and parry base of a combat technique by the rule book, from stored characteristics. */
export function combatTechniqueValues(
  system: Data,
  technique: Data
): { value: number; attack: number; parry: number | null; ranged: boolean } {
  const value = num(at(technique, 'system.talentValue.value')) ?? 6;
  const ranged = (num(at(technique, 'system.weapontype.value')) ?? 0) !== 0;
  const courage = characteristicOf(system, 'mu').value;
  const dexterity = characteristicOf(system, 'ff').value;
  const attack = value + floorThird(ranged ? dexterity : courage);
  if (ranged) return { value, attack, parry: null, ranged };
  const guides = text(at(technique, 'system.guidevalue.value'))
    .split('/')
    .map(part => characteristicFor(part))
    .filter((key): key is CharacteristicKey => key !== null);
  const best = guides.length
    ? Math.max(...guides.map(key => characteristicOf(system, key).value))
    : 8;
  return { value, attack, parry: Math.ceil(value / 2) + floorThird(best), ranged };
}

/** Dodge (Ausweichen) by the rule book: half of GE, rounded up, plus the stored modifier. */
export function dodgeOf(system: Data): number {
  return (
    Math.ceil(characteristicOf(system, 'ge').value / 2) +
    (num(at(system, 'status.dodge.modifier')) ?? 0)
  );
}

/** Initiative base by the rule book: (MU + GE) / 2 rounded up, plus the stored modifier. */
export function initiativeOf(system: Data): number {
  return (
    Math.ceil((characteristicOf(system, 'mu').value + characteristicOf(system, 'ge').value) / 2) +
    (num(at(system, 'status.initiative.modifier')) ?? 0)
  );
}

export const sameName = (a: unknown, b: unknown) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  a.trim().toLowerCase() === b.trim().toLowerCase();
