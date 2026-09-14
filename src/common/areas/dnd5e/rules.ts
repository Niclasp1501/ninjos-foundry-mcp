/**
 * D&D 5e knowledge that server and module share: keys of the dnd5e system,
 * challenge ratings, sizes, skills, spell slot progression.
 *
 * Checked against the public dnd5e source of release 5.3.3 (the version the
 * table runs on Foundry 14) and the SRD 5.1 and 5.2 tables. Free of Foundry
 * and of Node, so every rule here is tested without either.
 */

export type Data = Record<string, unknown>;
export type RulesVersion = '2014' | '2024';

export const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
export type AbilityKey = (typeof ABILITY_KEYS)[number];

/** The fourteen creature types of CONFIG.DND5E.creatureTypes. */
export const CREATURE_TYPE_KEYS: readonly string[] =
  'aberration beast celestial construct dragon elemental fey fiend giant humanoid monstrosity ooze plant undead'.split(
    ' '
  );

/** Written size word and the key dnd5e stores. */
export const SIZE_KEYS: Readonly<Record<string, string>> = {
  tiny: 'tiny',
  small: 'sm',
  medium: 'med',
  large: 'lg',
  huge: 'huge',
  gargantuan: 'grg',
};

/** Keys of CONFIG.DND5E.damageTypes. */
export const DAMAGE_TYPE_KEYS: readonly string[] =
  'acid bludgeoning cold fire force lightning necrotic piercing poison psychic radiant slashing thunder'.split(
    ' '
  );

/** Keys of CONFIG.DND5E.conditionTypes that a creature can be immune to. */
export const CONDITION_KEYS: readonly string[] = (
  'blinded charmed deafened diseased exhaustion frightened grappled incapacitated invisible ' +
  'paralyzed petrified poisoned prone restrained stunned unconscious'
).split(' ');

/**
 * Language keys of the SRD, used when CONFIG.DND5E.languages cannot be read.
 * The module prefers the running configuration, which also knows the labels.
 */
export const FALLBACK_LANGUAGE_KEYS: readonly string[] = (
  'common dwarvish elvish giant gnomish goblin halfling orc abyssal celestial draconic deep ' +
  'infernal primordial aquan auran ignan terran sylvan undercommon druidic cant'
).split(' ');

/** English skill name to the dnd5e key and its default ability. */
export const SKILLS: Readonly<Record<string, { key: string; ability: AbilityKey }>> = {
  acrobatics: { key: 'acr', ability: 'dex' },
  'animal handling': { key: 'ani', ability: 'wis' },
  arcana: { key: 'arc', ability: 'int' },
  athletics: { key: 'ath', ability: 'str' },
  deception: { key: 'dec', ability: 'cha' },
  history: { key: 'his', ability: 'int' },
  insight: { key: 'ins', ability: 'wis' },
  intimidation: { key: 'itm', ability: 'cha' },
  investigation: { key: 'inv', ability: 'int' },
  medicine: { key: 'med', ability: 'wis' },
  nature: { key: 'nat', ability: 'int' },
  perception: { key: 'prc', ability: 'wis' },
  performance: { key: 'prf', ability: 'cha' },
  persuasion: { key: 'per', ability: 'cha' },
  religion: { key: 'rel', ability: 'int' },
  'sleight of hand': { key: 'slt', ability: 'dex' },
  stealth: { key: 'ste', ability: 'dex' },
  survival: { key: 'sur', ability: 'wis' },
};

/** The English names as the tool schema offers them: capitalised, "of" in lower case. */
export const SKILL_NAMES = Object.keys(SKILLS).map(name =>
  name.replace(/\b\w+/g, part =>
    part === 'of' ? part : part.charAt(0).toUpperCase() + part.slice(1)
  )
);

/** A skill by English name (with or without spaces, any case) or by its key. */
export function skillFor(given: string): { name: string; key: string; ability: AbilityKey } | null {
  const wanted = given.trim().toLowerCase();
  const squeezed = wanted.replace(/\s+/g, '');
  for (const [name, skill] of Object.entries(SKILLS)) {
    if (name === wanted || name.replace(/\s+/g, '') === squeezed || skill.key === wanted)
      return { name, ...skill };
  }
  return null;
}

export function isRecord(value: unknown): value is Data {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function at(value: unknown, path: string): unknown {
  let node = value;
  for (const part of path.split('.')) {
    if (!isRecord(node)) return undefined;
    // Index rows of some Foundry versions carry dotted keys instead of nesting.
    node = part in node ? node[part] : undefined;
  }
  return node;
}

/** A value from nested data or from an index row with dotted keys. */
export function read(value: unknown, path: string): unknown {
  const nested = at(value, path);
  if (nested !== undefined) return nested;
  return isRecord(value) ? value[path] : undefined;
}

export function num(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function abilityMod(score: unknown): number {
  const value = num(score) ?? 10;
  return Math.floor((value - 10) / 2);
}

/** The proficiency bonus dnd5e derives from level or challenge rating (at least 1). */
export function proficiencyFor(levelOrCr: number): number {
  return 2 + Math.floor((Math.max(levelOrCr, 1) - 1) / 4);
}

// Challenge rating ----------------------------------------------------------------

/** The challenge ratings of the rules: 0, 1/8, 1/4, 1/2 and 1 to 30. */
export const VALID_CRS: readonly number[] = [
  0,
  0.125,
  0.25,
  0.5,
  ...Array.from({ length: 30 }, (_, i) => i + 1),
];

/**
 * A challenge rating from a number or a text such as "5", "1/4" or "0.5".
 * Null for anything the rules do not have (0.3, 31, "abc"), so a typo never
 * becomes a creature with a made up strength.
 */
export function parseCr(given: unknown): number | null {
  let value: number | null = null;
  if (typeof given === 'number') value = given;
  else if (typeof given === 'string') {
    const fraction = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(given);
    value = fraction ? Number(fraction[1]) / Number(fraction[2]) : num(given);
  }
  if (value === null || !Number.isFinite(value)) return null;
  return VALID_CRS.find(cr => Math.abs(cr - value) < 1e-9) ?? null;
}

/** 0.125 as "1/8", 5 as "5". */
export function formatCr(cr: unknown): string {
  const value = num(cr);
  if (value === null) return '?';
  if (value === 0.125) return '1/8';
  if (value === 0.25) return '1/4';
  if (value === 0.5) return '1/2';
  return String(value);
}

/** A stored challenge rating as a number, fractions in texts included; null when unreadable. */
export function crValue(stored: unknown): number | null {
  if (typeof stored === 'string') {
    const fraction = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(stored);
    if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  }
  return num(stored);
}

// Sizes -----------------------------------------------------------------------------

/** The written word for a stored size key ("sm" becomes "small"). Unknown keys stay as they are. */
export function sizeWord(stored: unknown): string | null {
  if (typeof stored !== 'string' || !stored) return null;
  const lower = stored.toLowerCase();
  return Object.entries(SIZE_KEYS).find(([, key]) => key === lower)?.[0] ?? lower;
}

// Spellcasting ----------------------------------------------------------------------

export type SpellcastingClass =
  | 'artificer'
  | 'bard'
  | 'cleric'
  | 'druid'
  | 'paladin'
  | 'ranger'
  | 'sorcerer'
  | 'warlock'
  | 'wizard';

/** The casting ability of each class; its keys in alphabetical order are the classes of the tool. */
export const CLASS_ABILITY: Readonly<Record<SpellcastingClass, AbilityKey>> = {
  artificer: 'int',
  bard: 'cha',
  cleric: 'wis',
  druid: 'wis',
  paladin: 'cha',
  ranger: 'wis',
  sorcerer: 'cha',
  warlock: 'cha',
  wizard: 'int',
};

export const SPELLCASTING_CLASSES = Object.keys(CLASS_ABILITY) as readonly SpellcastingClass[];

/**
 * Spell slots of a full caster by caster level 1 to 20 (SRD 5.1 and 5.2 agree).
 * One group per caster level, one digit per spell level 1 to 9.
 */
const FULL_CASTER_SLOTS: readonly (readonly number[])[] = (
  '2 3 42 43 432 433 4331 4332 43331 43332 433321 433321 4333211 4333211 43332111 43332111 ' +
  '433321111 433331111 433332111 433332211'
)
  .split(' ')
  .map(group => [...group].map(Number));

/**
 * Pact magic by warlock level 1 to 20: slots, then their level. The count
 * grows at levels 2, 11 and 17; the level every odd level until 9.
 */
const PACT_SLOTS: readonly (readonly [number, number])[] = Array.from(
  { length: 20 },
  (_, index) => {
    const level = index + 1;
    const count = level >= 17 ? 4 : level >= 11 ? 3 : level >= 2 ? 2 : 1;
    return [count, Math.min(Math.ceil(level / 2), 5)] as const;
  }
);

export interface SpellcastingPlan {
  kind: 'leveled' | 'pact';
  ability: AbilityKey;
  /**
   * The number dnd5e reads for an NPC without class items:
   * `system.attributes.spell.level`. For leveled casters it is the full caster
   * level of the class level, for a warlock the warlock level.
   */
  casterLevel: number;
  /** What that gives, for the answer. */
  slots: Record<string, number>;
  pact: { max: number; level: number } | null;
  warnings: string[];
}

/**
 * The spellcasting of one class at one level, per rules version.
 *
 * Half casters (paladin, ranger) are where the versions differ: under 2014
 * they have no slots at level 1 and the caster level of a single class is
 * half the class level rounded up from level 2; under 2024 they have slots
 * from level 1, half rounded up. The artificer rounds up in both.
 */
export function planSpellcasting(
  spellClass: SpellcastingClass,
  level: number,
  rules: RulesVersion,
  ability?: AbilityKey
): SpellcastingPlan {
  const warnings: string[] = [];
  const chosen = ability ?? CLASS_ABILITY[spellClass];
  if (spellClass === 'warlock') {
    const [count, slotLevel] = PACT_SLOTS[level - 1] ?? [0, 0];
    return {
      kind: 'pact',
      ability: chosen,
      casterLevel: level,
      slots: {},
      pact: { max: count, level: slotLevel },
      warnings,
    };
  }
  let casterLevel = level;
  if (spellClass === 'paladin' || spellClass === 'ranger') {
    if (rules === '2014' && level === 1) {
      casterLevel = 0;
      warnings.push(
        `A ${spellClass} of level 1 has no spell slots under the 2014 rules; they start at level 2 (under 2024 they start at level 1).`
      );
    } else casterLevel = Math.ceil(level / 2);
  } else if (spellClass === 'artificer') {
    casterLevel = Math.ceil(level / 2);
  }
  const slots: Record<string, number> = {};
  (FULL_CASTER_SLOTS[casterLevel - 1] ?? []).forEach((count, index) => {
    slots[`spell${index + 1}`] = count;
  });
  return { kind: 'leveled', ability: chosen, casterLevel, slots, pact: null, warnings };
}

/** "L1: 4, L2: 3" or "Pact Magic: 2 slot(s) of level 3". */
export function describeSlots(plan: Pick<SpellcastingPlan, 'kind' | 'slots' | 'pact'>): string {
  if (plan.kind === 'pact' && plan.pact)
    return `Pact Magic: ${plan.pact.max} slot(s) of level ${plan.pact.level}`;
  const parts = Object.entries(plan.slots).map(([key, count]) => `L${key.slice(5)}: ${count}`);
  return parts.length ? parts.join(', ') : 'no spell slots';
}

// Standard compendiums ------------------------------------------------------------------

export const STANDARD_PACKS: Readonly<
  Record<RulesVersion, { spells: string[]; features: string[]; monsters: string[] }>
> = {
  '2014': {
    spells: ['dnd5e.spells'],
    features: ['dnd5e.monsterfeatures', 'dnd5e.classfeatures'],
    monsters: ['dnd5e.monsters'],
  },
  '2024': {
    spells: ['dnd5e.spells24'],
    features: ['dnd5e.monsterfeatures24'],
    monsters: ['dnd5e.actors24'],
  },
};

/** The rules version of a world from the dnd5e setting "rulesVersion" ("modern" or "legacy"). */
export function rulesFromSetting(value: unknown): RulesVersion | null {
  if (value === 'modern') return '2024';
  if (value === 'legacy') return '2014';
  return null;
}

// Ids -------------------------------------------------------------------------------------

const ID_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** A Foundry style id of 16 letters and digits, as activities need them. */
export function randomId(random: () => number = Math.random): string {
  let id = '';
  for (let i = 0; i < 16; i += 1) id += ID_LETTERS[Math.floor(random() * ID_LETTERS.length)];
  return id;
}

/** Version text "5.3.3" as comparable numbers. */
export function versionAtLeast(
  version: string | null | undefined,
  major: number,
  minor = 0
): boolean {
  if (!version) return false;
  const [a = 0, b = 0] = version.split('.').map(part => Number.parseInt(part, 10) || 0);
  return a > major || (a === major && b >= minor);
}

/** "a, b and c". */
export function quote(values: readonly string[]): string {
  return values.map(value => `"${value}"`).join(', ');
}

/** Names compare the same way on every path of this package: trimmed, ignoring case. */
export function sameName(a: unknown, b: unknown): boolean {
  return (
    typeof a === 'string' &&
    typeof b === 'string' &&
    a.trim().toLowerCase() === b.trim().toLowerCase()
  );
}
