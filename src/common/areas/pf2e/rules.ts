/**
 * Pathfinder Second Edition: keys, paths and the arithmetic of the rules the
 * adapter needs, free of Foundry. Paths follow the source data of the pf2e
 * system as published on GitHub (branch v14-dev, read on 14.09.2026).
 */

export type Data = Record<string, unknown>;

export const isRecord = (value: unknown): value is Data =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A dotted path into plain data. */
export function at(value: unknown, path: string): unknown {
  let node = value;
  for (const part of path.split('.')) node = isRecord(node) ? node[part] : undefined;
  return node;
}

/** A dotted path in an index row, nested or with the dotted key itself. */
export function read(entry: unknown, path: string): unknown {
  if (isRecord(entry) && entry[path] !== undefined) return entry[path];
  return at(entry, path);
}

export function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value)))
    return Number(value);
  return null;
}

export const text = (value: unknown): string => (typeof value === 'string' ? value : '');

export const texts = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

export const ATTRIBUTES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
export type Attribute = (typeof ATTRIBUTES)[number];
const ATTRIBUTE_NAMES: Record<string, Attribute> = {
  strength: 'str',
  dexterity: 'dex',
  constitution: 'con',
  intelligence: 'int',
  wisdom: 'wis',
  charisma: 'cha',
};

export function attributeKey(value: string): Attribute | null {
  const lower = value.trim().toLowerCase();
  if ((ATTRIBUTES as readonly string[]).includes(lower)) return lower as Attribute;
  return ATTRIBUTE_NAMES[lower] ?? null;
}

/** The sixteen skills of the remaster and the attribute each uses. */
export const SKILLS: Readonly<Record<string, Attribute>> = {
  acrobatics: 'dex',
  arcana: 'int',
  athletics: 'str',
  crafting: 'int',
  deception: 'cha',
  diplomacy: 'cha',
  intimidation: 'cha',
  medicine: 'wis',
  nature: 'wis',
  occultism: 'int',
  performance: 'cha',
  religion: 'wis',
  society: 'int',
  stealth: 'dex',
  survival: 'wis',
  thievery: 'dex',
};

export const SAVES: Readonly<Record<string, Attribute>> = {
  fortitude: 'con',
  reflex: 'dex',
  will: 'wis',
};
const SAVE_SHORT: Record<string, string> = { fort: 'fortitude', ref: 'reflex' };

export function saveKey(value: string): string | null {
  const lower = value.trim().toLowerCase();
  if (SAVES[lower]) return lower;
  return SAVE_SHORT[lower] ?? null;
}

export const RANK_NAMES = ['untrained', 'trained', 'expert', 'master', 'legendary'] as const;

/** Proficiency bonus with level (Player Core, "Proficiency"): untrained adds nothing. */
export function proficiencyBonus(rank: number, level: number): number {
  return rank > 0 ? 2 * rank + level : 0;
}

/** Sizes as stored ("sm", "med") and as the filters take them. */
export const SIZE_WORDS: Readonly<Record<string, string>> = {
  tiny: 'tiny',
  sm: 'small',
  med: 'medium',
  lg: 'large',
  huge: 'huge',
  grg: 'gargantuan',
};
export const SIZE_KEYS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(SIZE_WORDS).map(([key, word]) => [word, key])
);

export function sizeWord(value: unknown): string | null {
  const raw = isRecord(value) ? text(value['value']) : text(value);
  if (!raw) return null;
  return SIZE_WORDS[raw] ?? (SIZE_KEYS[raw] ? raw : null);
}

export const RARITIES = ['common', 'uncommon', 'rare', 'unique'] as const;

/** Creature type traits, first match wins (plus the remaster's spirit and time). */
export const CREATURE_TYPES = [
  'aberration',
  'animal',
  'astral',
  'beast',
  'celestial',
  'construct',
  'dragon',
  'dream',
  'elemental',
  'ethereal',
  'fey',
  'fiend',
  'fungus',
  'giant',
  'humanoid',
  'monitor',
  'ooze',
  'plant',
  'spirit',
  'time',
  'undead',
] as const;

export function creatureTypeOf(traits: readonly string[]): string {
  const lower = traits.map(trait => trait.toLowerCase());
  return CREATURE_TYPES.find(type => lower.includes(type)) ?? 'unknown';
}

/** Actor types of pf2e 7 and later. */
export const ACTOR_TYPES = [
  'character',
  'npc',
  'hazard',
  'loot',
  'familiar',
  'vehicle',
  'party',
  'army',
] as const;

/** Three action glyph values as stored in `time.value` or `actions.value`. */
export function actionCost(value: unknown, type?: unknown): string | null {
  const kind = text(type);
  if (kind === 'reaction') return 'reaction';
  if (kind === 'free') return 'free action';
  if (kind === 'passive') return null;
  const raw = typeof value === 'number' ? String(value) : text(value).trim();
  if (!raw) return null;
  if (raw === '1') return '1 action';
  if (raw === '2' || raw === '3') return `${raw} actions`;
  if (raw === 'reaction') return 'reaction';
  if (raw === 'free') return 'free action';
  if (/^1 to 3$|^1-3$/.test(raw)) return '1 to 3 actions';
  return raw;
}

/** Multiple attack penalty of the second and third attack (Player Core, "Multiple Attack Penalty"). */
export function attackPenalties(agile: boolean): [number, number] {
  return agile ? [-4, -8] : [-5, -10];
}

/** Standard compendium ids of the pf2e system. */
export const STANDARD_PACKS = {
  Actor: [
    'pf2e.pathfinder-monster-core',
    'pf2e.pathfinder-monster-core-2',
    'pf2e.pathfinder-npc-core',
    'pf2e.pathfinder-bestiary',
    'pf2e.pathfinder-bestiary-2',
    'pf2e.pathfinder-bestiary-3',
    'pf2e.hazards',
    'pf2e.iconics',
  ],
  Item: [
    'pf2e.spells-srd',
    'pf2e.feats-srd',
    'pf2e.equipment-srd',
    'pf2e.actionspf2e',
    'pf2e.conditionitems',
    'pf2e.classfeatures',
    'pf2e.ancestries',
    'pf2e.heritages',
    'pf2e.backgrounds',
    'pf2e.classes',
  ],
} as const;

// Attribute modifiers of a character ---------------------------------------------------

export interface AttributeResult {
  mods: Record<Attribute, number>;
  source: 'manual' | 'build';
}

function applyBoost(mods: Record<Attribute, number>, key: unknown): void {
  const attribute = attributeKey(text(key));
  if (!attribute) return;
  // A boost raises a modifier below +4 by 1, from +4 on by half (Player Core, "Attribute Boosts").
  mods[attribute] += mods[attribute] >= 4 ? 0.5 : 1;
}

function applyFlaw(mods: Record<Attribute, number>, key: unknown): void {
  const attribute = attributeKey(text(key));
  if (attribute) mods[attribute] -= 1;
}

function selected(choices: unknown): string[] {
  if (!isRecord(choices)) return [];
  return Object.values(choices).flatMap(choice => {
    if (!isRecord(choice)) return [];
    const pick = text(choice['selected']);
    if (pick) return [pick];
    const fixed = texts(choice['value']);
    return fixed.length === 1 ? fixed : [];
  });
}

/**
 * Attribute modifiers from the stored build: ancestry, background, class key
 * attribute, the boosts of levels 1, 5, 10, 15 and 20 the character has
 * reached, and an apex attribute. Manual entry keeps the stored modifiers.
 */
export function characterAttributes(system: Data, items: readonly Data[]): AttributeResult {
  const stored = system['abilities'];
  const manual = at(system, 'build.attributes.manual') === true;
  if (manual && isRecord(stored)) {
    const mods = Object.fromEntries(
      ATTRIBUTES.map(a => [a, num(at(stored, `${a}.mod`)) ?? 0])
    ) as Record<Attribute, number>;
    return { mods, source: 'manual' };
  }
  const mods = Object.fromEntries(ATTRIBUTES.map(a => [a, 0])) as Record<Attribute, number>;
  const level = num(at(system, 'details.level.value')) ?? 1;
  const ancestry = items.find(item => item['type'] === 'ancestry');
  if (ancestry) {
    const alternate = texts(at(ancestry, 'system.alternateAncestryBoosts'));
    if (alternate.length) alternate.forEach(key => applyBoost(mods, key));
    else selected(at(ancestry, 'system.boosts')).forEach(key => applyBoost(mods, key));
    if (!alternate.length)
      selected(at(ancestry, 'system.flaws')).forEach(key => applyFlaw(mods, key));
    texts(at(ancestry, 'system.voluntary.flaws')).forEach(key => applyFlaw(mods, key));
    applyBoost(mods, at(ancestry, 'system.voluntary.boost'));
  }
  const background = items.find(item => item['type'] === 'background');
  if (background) selected(at(background, 'system.boosts')).forEach(key => applyBoost(mods, key));
  const cls = items.find(item => item['type'] === 'class');
  applyBoost(
    mods,
    text(at(cls, 'system.keyAbility.selected')) || at(system, 'details.keyability.value')
  );
  for (const step of [1, 5, 10, 15, 20]) {
    if (step > level) continue;
    texts(at(system, `build.attributes.boosts.${step}`)).forEach(key => applyBoost(mods, key));
  }
  const apex = attributeKey(text(at(system, 'build.attributes.apex')));
  if (apex) mods[apex] = Math.max(mods[apex] + 1, 4);
  for (const a of ATTRIBUTES) mods[a] = Math.floor(mods[a]);
  return { mods, source: 'build' };
}
