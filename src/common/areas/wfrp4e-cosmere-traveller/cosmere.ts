/**
 * The Cosmere RPG adapter (Foundry system `cosmere-rpg` by the Metalworks),
 * answered from plain data.
 *
 * Checked against the public source (the-metalworks/cosmere-rpg, branch
 * main, read 14.09.2026):
 * - attribute keys str, spd, int, wil, awa, pre; groups phy, cog, spi; skill
 *   keys and their attributes; roles minion, rival, boss; sizes; resources
 *   hea, foc, inv; actor types character and adversary (types/cosmere.ts,
 *   config.ts). The attribute stays `pre`: `prs` is the skill Persuasion.
 * - a derived field stores `derived`, `override`, `useOverride` and for
 *   numbers `bonus`; the value is the override when `useOverride` is set,
 *   else the derived value, plus the bonus (data/fields/derived-value-field.ts)
 * - attributes with `value` and `bonus`, skills with `rank` and derived
 *   `mod` = attribute value + attribute bonus + rank, defenses 10 plus the
 *   attributes of the group, resources with `value`, derived `max`, `bonus`,
 *   `tier`, `type.id`, `type.subtype`, `size`, `deflect`,
 *   `movement.walk.rate` (data/actor/common.ts), adversary `role`
 * - skill tests roll 1d20 plus the modifier; the plot die is a die term with
 *   the denomination `p`, so a formula writes it as 1dp (dice/d20-roll.ts,
 *   dice/plot-die.ts)
 *
 * Not verified: `system.level`, conditions as effects with statuses, and
 * whether an older stored form keeps plain numbers (read as well).
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
  systemOf,
  text,
  type Data,
} from './shared.js';

export const COSMERE_ID = 'cosmere-rpg';

export const ATTRIBUTES = ['str', 'spd', 'int', 'wil', 'awa', 'pre'] as const;
export type Attribute = (typeof ATTRIBUTES)[number];

export const ATTRIBUTE_NAMES: Readonly<Record<Attribute, string>> = {
  str: 'Strength',
  spd: 'Speed',
  int: 'Intellect',
  wil: 'Willpower',
  awa: 'Awareness',
  pre: 'Presence',
};

export const DEFENSE_GROUPS: Readonly<Record<'phy' | 'cog' | 'spi', readonly Attribute[]>> = {
  phy: ['str', 'spd'],
  cog: ['int', 'wil'],
  spi: ['awa', 'pre'],
};

export const SKILLS: Readonly<Record<string, { name: string; attribute: Attribute }>> = {
  agi: { name: 'Agility', attribute: 'spd' },
  ath: { name: 'Athletics', attribute: 'str' },
  hwp: { name: 'Heavy Weaponry', attribute: 'str' },
  lwp: { name: 'Light Weaponry', attribute: 'spd' },
  stl: { name: 'Stealth', attribute: 'spd' },
  thv: { name: 'Thievery', attribute: 'spd' },
  cra: { name: 'Crafting', attribute: 'int' },
  ded: { name: 'Deduction', attribute: 'int' },
  lor: { name: 'Lore', attribute: 'int' },
  med: { name: 'Medicine', attribute: 'int' },
  dis: { name: 'Discipline', attribute: 'wil' },
  inm: { name: 'Intimidation', attribute: 'wil' },
  all: { name: 'Allomancy', attribute: 'wil' },
  ins: { name: 'Insight', attribute: 'awa' },
  prc: { name: 'Perception', attribute: 'awa' },
  sur: { name: 'Survival', attribute: 'awa' },
  dec: { name: 'Deception', attribute: 'pre' },
  lea: { name: 'Leadership', attribute: 'pre' },
  prs: { name: 'Persuasion', attribute: 'pre' },
};

export const ROLES = ['minion', 'rival', 'boss'] as const;
export const SIZES = ['small', 'medium', 'large', 'huge', 'gargantuan'] as const;

/** A skill key from its key or English name ("Heavy Weaponry", "heavyweapons", "hwp"). */
export function skillKey(value: string | undefined): string | null {
  const wanted = (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
  if (SKILLS[wanted]) return wanted;
  const found = Object.entries(SKILLS).find(
    ([, skill]) =>
      skill.name.toLowerCase().replace(/\s+/g, '') === wanted ||
      skill.name
        .toLowerCase()
        .replace(/weaponry$/, 'weapons')
        .replace(/\s+/g, '') === wanted
  );
  return found ? found[0] : null;
}

/**
 * The value of a derived field: override when `useOverride` is on and the
 * override is a number, else the derived value, plus a numeric bonus. A plain
 * number or `{ value }` of older data is read as it is.
 */
export function derived(field: unknown): number | null {
  const plain = num(field);
  if (plain !== null) return plain;
  if (!isRecord(field)) return null;
  const override = num(field['override']);
  const base =
    field['useOverride'] === true && override !== null
      ? override
      : (num(field['derived']) ?? num(field['value']));
  if (base === null) return null;
  return base + (num(field['bonus']) ?? 0);
}

function attributeTotal(system: Data, key: Attribute): number {
  return (
    (num(at(system, `attributes.${key}.value`)) ?? 0) +
    (num(at(system, `attributes.${key}.bonus`)) ?? 0)
  );
}

export function skillModifier(
  system: Data,
  key: string
): { mod: number; rank: number; computed: boolean } {
  const rank = num(at(system, `skills.${key}.rank`)) ?? 0;
  const stored = derived(at(system, `skills.${key}.mod`));
  if (stored !== null) return { mod: stored, rank, computed: false };
  const skill = SKILLS[key];
  return {
    mod: (skill ? attributeTotal(system, skill.attribute) : 0) + rank,
    rank,
    computed: true,
  };
}

export function defenses(system: Data): {
  phy: number;
  cog: number;
  spi: number;
  computed: boolean;
} {
  let computed = false;
  const value = (group: 'phy' | 'cog' | 'spi') => {
    const stored = derived(at(system, `defenses.${group}`));
    if (stored !== null) return stored;
    computed = true;
    return 10 + DEFENSE_GROUPS[group].reduce((sum, key) => sum + attributeTotal(system, key), 0);
  };
  const result = { phy: value('phy'), cog: value('cog'), spi: value('spi') };
  return { ...result, computed };
}

function resource(system: Data, key: 'hea' | 'foc' | 'inv') {
  const entry = at(system, `resources.${key}`);
  if (!isRecord(entry)) return null;
  return {
    value: num(entry['value']),
    max: derived(entry['max']),
    bonus: num(entry['bonus']) ?? 0,
  };
}

const lower = (value: unknown, fallback: string) => text(value).trim().toLowerCase() || fallback;

// Creature index (2.2 to 2.6) ---------------------------------------------------------------

export function creatureRow(document: AdapterDocument): Record<string, unknown> {
  const system = systemOf(document);
  const defense = defenses(system);
  const investiture = resource(system, 'inv')?.max ?? 0;
  return {
    tier: num(at(system, 'tier')) ?? 0,
    ...(num(at(system, 'level')) !== null ? { level: num(at(system, 'level')) } : {}),
    role: lower(at(system, 'role'), 'unknown'),
    creatureType:
      at(system, 'type.id') === 'custom'
        ? lower(at(system, 'type.custom'), 'custom')
        : lower(at(system, 'type.id'), 'unknown'),
    subtype: text(at(system, 'type.subtype')) || null,
    size: lower(at(system, 'size'), 'medium'),
    hitPoints: resource(system, 'hea')?.max ?? 0,
    focus: resource(system, 'foc')?.max ?? 0,
    investiture,
    hasInvestiture: investiture > 0,
    defenses: { phy: defense.phy, cog: defense.cog, spi: defense.spi },
    deflect: derived(at(system, 'deflect')) ?? 0,
    walkSpeed: derived(at(system, 'movement.walk.rate')),
  };
}

export const CREATURE_FILTERS: readonly CreatureFilterSpec[] = [
  { name: 'tier', kind: 'numberOrRange', field: 'tier', defaults: { min: 0, max: 99 } },
  { name: 'role', kind: 'text', field: 'role', values: ROLES },
  { name: 'creatureType', kind: 'text', field: 'creatureType' },
  { name: 'size', kind: 'text', field: 'size', values: SIZES },
  { name: 'hasInvestiture', kind: 'boolean', field: 'hasInvestiture' },
  {
    name: 'hitPoints',
    kind: 'numberOrRange',
    field: 'hitPoints',
    defaults: { min: 0, max: 100000 },
  },
  { name: 'defensesMin', kind: 'minEach', field: 'defenses' },
  { name: 'deflectMin', kind: 'min', field: 'deflect' },
];

export function creatureListFields(row: CreatureRow): Record<string, unknown> {
  const defense = isRecord(row['defenses']) ? row['defenses'] : {};
  return {
    tier: row['tier'],
    role: row['role'],
    creatureType: row['creatureType'],
    subtype: row['subtype'],
    size: row['size'],
    hitPoints: row['hitPoints'],
    focus: row['focus'],
    investiture: row['investiture'],
    defenses: { physical: defense['phy'], cognitive: defense['cog'], spiritual: defense['spi'] },
    deflect: row['deflect'],
    walkSpeed: row['walkSpeed'],
  };
}

export function creatureSummary(row: CreatureRow): string {
  return `Tier ${String(row['tier'] ?? 0)} ${String(row['role'] ?? 'unknown')} ${String(row['creatureType'] ?? 'unknown')} from ${row.packLabel}`;
}

export const INDEX_FIELDS = [
  'system.tier',
  'system.role',
  'system.type',
  'system.size',
  'system.resources',
  'system.defenses',
  'system.deflect',
];

export function actorStats(entry: AdapterDocument): Record<string, unknown> | null {
  const tier = read(entry, 'system.tier');
  const resources = read(entry, 'system.resources');
  if (tier === undefined && resources === undefined) return null;
  const system: Data = {
    tier,
    role: read(entry, 'system.role'),
    type: read(entry, 'system.type'),
    size: read(entry, 'system.size'),
    resources,
    defenses: read(entry, 'system.defenses'),
    deflect: read(entry, 'system.deflect'),
  };
  const row = creatureRow({ system });
  const health = resource(system, 'hea');
  return {
    tier: row['tier'],
    role: row['role'],
    creatureType: row['creatureType'],
    subtype: row['subtype'],
    size: row['size'],
    health: health ? { value: health.value, max: health.max } : null,
    defenses: row['defenses'],
    deflect: row['deflect'],
    investiture: row['investiture'],
  };
}

// Characters (2.8) --------------------------------------------------------------------------------

export function characterSummary(actor: AdapterDocument): CharacterSummary {
  const system = systemOf(actor);
  const defense = defenses(system);
  const skills: Data = {};
  let skillsComputed = false;
  for (const key of Object.keys(SKILLS)) {
    if (!isRecord(at(system, `skills.${key}`))) continue;
    const skill = skillModifier(system, key);
    skillsComputed ||= skill.computed;
    skills[key] = { name: SKILLS[key]?.name, rank: skill.rank, mod: skill.mod };
  }
  const basicInfo: Data = {
    level: num(at(system, 'level')),
    tier: num(at(system, 'tier')),
    ...(actor['type'] === 'adversary' ? { role: text(at(system, 'role')) || null } : {}),
    health: resource(system, 'hea'),
    focus: resource(system, 'foc'),
    investiture: resource(system, 'inv'),
    deflect: derived(at(system, 'deflect')),
  };
  const stats: Data = {
    attributes: Object.fromEntries(
      ATTRIBUTES.map(key => [key, num(at(system, `attributes.${key}.value`)) ?? 0])
    ),
    defenses: { phy: defense.phy, cog: defense.cog, spi: defense.spi },
    skills,
    size: text(at(system, 'size')) || null,
    walkSpeed: derived(at(system, 'movement.walk.rate')),
    ...(defense.computed || skillsComputed
      ? {
          computedNote:
            'Some defenses or skill modifiers were not in the data and are computed by the rules (10 plus the attributes of the group; attribute plus bonus plus rank); talents and effects are not included.',
        }
      : {}),
  };
  return { basicInfo, stats };
}

// Rolls (2.13) --------------------------------------------------------------------------------------

export function rollPlan(
  request: { rollType: string; rollTarget?: string; rollModifier?: string },
  actor: AdapterDocument | null
): { formula: string; label: string } {
  const { rollType } = request;
  if (rollType === 'custom') {
    const formula = (request.rollTarget ?? '').trim();
    if (!formula) throw new Error('A custom roll needs its formula in rollTarget, e.g. "1d20+2".');
    return { formula: formulaWith(formula, 0, request.rollModifier), label: 'Custom roll' };
  }
  if (rollType !== 'skill' && rollType !== 'skill-plot') {
    throw new Error(
      `The roll type "${rollType}" is not a Cosmere RPG roll type: skill, skill-plot or custom.`
    );
  }
  const key = skillKey(request.rollTarget);
  if (!key) {
    throw new Error(
      `rollTarget must be a Cosmere skill, by key or English name (${Object.entries(SKILLS)
        .map(([id, skill]) => `${skill.name} ${id}`)
        .join(', ')}), got "${request.rollTarget ?? ''}".`
    );
  }
  const name = SKILLS[key]?.name ?? key;
  const plot = rollType === 'skill-plot';
  const mod = actor ? skillModifier(systemOf(actor), key).mod : 0;
  const base = formulaWith('1d20', mod, request.rollModifier);
  return {
    formula: plot ? `${base}+1dp` : base,
    label: plot ? `${name} test, raising the stakes with the plot die` : `${name} test`,
  };
}

// Actor data (2.14, 2.15) ---------------------------------------------------------------------------------

/**
 * Short forms: an attribute as a number (its value), a skill by English name
 * and as a number (its rank), a resource as a number (its current value).
 * Derived fields are never written flat. Everything else stays.
 */
export function normalizeActorSystem(system: Record<string, unknown>): Record<string, unknown> {
  const out: Data = { ...system };
  if (isRecord(out['attributes'])) {
    const attributes: Data = {};
    for (const [name, value] of Object.entries(out['attributes'])) {
      const key =
        ATTRIBUTES.find(
          id =>
            id === name.toLowerCase() || ATTRIBUTE_NAMES[id].toLowerCase() === name.toLowerCase()
        ) ?? name;
      attributes[key] = typeof value === 'number' ? { value } : value;
    }
    out['attributes'] = attributes;
  }
  if (isRecord(out['skills'])) {
    const skills: Data = {};
    for (const [name, value] of Object.entries(out['skills'])) {
      skills[skillKey(name) ?? name] = typeof value === 'number' ? { rank: value } : value;
    }
    out['skills'] = skills;
  }
  if (isRecord(out['resources'])) {
    const resources: Data = {};
    for (const [key, value] of Object.entries(out['resources']))
      resources[key] = typeof value === 'number' ? { value } : value;
    out['resources'] = resources;
  }
  return out;
}

export const SCHEMA_NOTES = [
  'Cosmere RPG (cosmere-rpg) actor data:',
  '- Types: character, adversary. Adversaries carry system.tier and system.role (minion, rival, boss).',
  '- attributes.<str|spd|int|wil|awa|pre>.value (0 to 10) and .bonus. A number is taken as the value.',
  '- skills.<key>.rank (keys agi, ath, hwp, lwp, stl, thv, cra, ded, lor, med, dis, inm, all, ins, prc, sur, dec, lea, prs; English names are accepted). The modifier is derived.',
  '- resources.hea, .foc, .inv with .value and .bonus; the maximum is derived. defenses.phy, .cog, .spi, deflect and movement.walk.rate are derived as well.',
  '- A derived field stores derived, override, useOverride and bonus. To fix a value by hand set override and useOverride true; never write derived.',
  '- type.id (humanoid, animal, custom) with type.custom and type.subtype; size small, medium, large, huge, gargantuan. Surges and talents are items.',
].join('\n');

export function itemEnums(config: unknown): Record<string, Record<string, readonly string[]>> {
  const block = isRecord(config) ? config['COSMERE'] : undefined;
  if (!isRecord(block))
    throw new Error(
      'CONFIG.COSMERE is not available; the cosmere-rpg system seems not to be loaded'
    );
  return { config: choiceLists(block, 'CONFIG.COSMERE') };
}

// The adapter ------------------------------------------------------------------------------------------------

export const cosmereAdapter: SystemAdapter = {
  id: COSMERE_ID,
  title: 'Cosmere Roleplaying Game',
  creatures: {
    indexVersion: 1,
    actorTypes: ['adversary'],
    invalidatingTypes: ['adversary'],
    copyableTypes: ['adversary', 'character'],
    row: creatureRow,
    power: { name: 'Tier', field: 'tier', range: { min: 1, max: 4 } },
    filters: CREATURE_FILTERS,
    listFields: creatureListFields,
    summary: creatureSummary,
  },
  compendiumStats: { indexFields: INDEX_FIELDS, actorStats },
  characters: { summary: characterSummary },
  // Assumption: cosmere-rpg marks condition effects with statuses; recognised only by them.
  conditions: {
    matchesEffect: (effect, condition) =>
      Array.isArray(effect['statuses']) && effect['statuses'].includes(condition.id),
  },
  rolls: {
    types: [
      {
        id: 'skill',
        description: '1d20 plus the skill modifier; rollTarget is the skill key or English name',
        targets: Object.keys(SKILLS),
      },
      {
        id: 'skill-plot',
        description: 'the same skill test with the plot die added (raising the stakes)',
        targets: Object.keys(SKILLS),
      },
      { id: 'custom', description: 'the formula in rollTarget; the plot die is written 1dp' },
    ],
    plan: rollPlan,
  },
  actorData: { normalize: normalizeActorSystem, schemaNotes: () => SCHEMA_NOTES },
  worldItems: {
    enums: itemEnums,
    note: () =>
      'These are the choice lists of CONFIG.COSMERE by their path there, not item field paths.',
  },
  compendiums: { priority: packId => (packId.startsWith('cosmere-rpg') ? 1 : 0) },
};
