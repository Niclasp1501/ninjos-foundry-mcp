/**
 * The Pathfinder Second Edition adapter: what the system neutral packages ask
 * about pf2e, answered from plain data.
 *
 * It reads plain data. NPCs and hazards store their final numbers, so those
 * are exact. A character stores only its build: ranks, boosts and the
 * ancestry, background and class items. Data from the module carries what pf2e
 * prepared (`preparedData`), read first; otherwise its modifiers are computed
 * here by the rules and marked as computed, because rule elements, item
 * bonuses, feats and conditions are not in the stored data.
 */
import type {
  AdapterDocument,
  CharacterSummary,
  CreatureFilterSpec,
  CreatureRow,
  SpellInfo,
  SpellcastingEntry,
  SystemAdapter,
} from '../../game-systems.js';
import { isPreparedData } from '../../game-systems.js';
import { estimateEntry } from './compendium-estimate.js';
import { activeConditions, conditionLevelPlan, conditionSlug, isValued } from './conditions.js';
import {
  ATTRIBUTES,
  CREATURE_TYPES,
  RANK_NAMES,
  RARITIES,
  SAVES,
  SIZE_KEYS,
  SIZE_WORDS,
  SKILLS,
  STANDARD_PACKS,
  actionCost,
  at,
  attackPenalties,
  attributeKey,
  characterAttributes,
  creatureTypeOf,
  isRecord,
  num,
  proficiencyBonus,
  read,
  saveKey,
  sizeWord,
  text,
  texts,
  type Attribute,
  type Data,
} from './rules.js';

export const PF2E_TOOLS = ['pf2e-manage-conditions'] as const;

const sys = (document: AdapterDocument): Data =>
  isRecord(document['system']) ? document['system'] : {};
const itemsOf = (document: AdapterDocument): Data[] =>
  Array.isArray(document['items']) ? document['items'].filter(isRecord) : [];
const idOf = (document: Data): string => text(document['_id']) || text(document['id']);
const traitsOf = (document: Data): string[] => texts(at(document, 'system.traits.value'));
const ofType = (document: AdapterDocument, type: string) =>
  itemsOf(document).filter(item => item['type'] === type);

export const COMPUTED_NOTE =
  'Character modifiers are computed by the rules from the stored build (attribute boosts, ranks, class, ancestry, ' +
  'background, equipped armor and weapons). Rule elements, feats, item bonuses and conditions are not included; ' +
  'the sheet in Foundry shows the final numbers.';

/**
 * A number Foundry prepared, read from module data only (`isPreparedData`):
 * the first of `paths` under `system` that holds one. Null for stored data.
 */
function preparedModifier(actor: AdapterDocument, paths: readonly string[]): number | null {
  if (!isPreparedData(actor)) return null;
  const system = sys(actor);
  for (const path of paths) {
    const value = num(at(system, path));
    if (value !== null) return value;
  }
  return null;
}

// Characters: the build ----------------------------------------------------------------------

interface Build {
  level: number;
  mods: Record<Attribute, number>;
  attributeSource: 'manual' | 'build' | 'stored';
  rank(kind: 'skill' | 'save' | 'perception', key: string): number;
  weaponRank(category: string): number;
  armorRank(category: string): number;
}

function characterBuild(actor: AdapterDocument): Build {
  const system = sys(actor);
  const items = itemsOf(actor);
  const level = num(at(system, 'details.level.value')) ?? 1;
  const { mods, source } = characterAttributes(system, items);
  const cls = items.find(item => item['type'] === 'class');
  const background = items.find(item => item['type'] === 'background');
  const trained = new Set([
    ...texts(at(cls, 'system.trainedSkills.value')),
    ...texts(at(background, 'system.trainedSkills.value')),
  ]);
  return {
    level,
    mods,
    attributeSource: source,
    rank: (kind, key) => {
      if (kind === 'perception') return num(at(cls, 'system.perception')) ?? 0;
      if (kind === 'save') return num(at(cls, `system.savingThrows.${key}`)) ?? 0;
      const stored = num(at(system, `skills.${key}.rank`)) ?? 0;
      return Math.max(stored, trained.has(key) ? 1 : 0);
    },
    weaponRank: category =>
      Math.max(
        num(at(cls, `system.attacks.${category}`)) ?? 0,
        num(at(system, `proficiencies.attacks.${category}.rank`)) ?? 0
      ),
    armorRank: category => num(at(cls, `system.defenses.${category}`)) ?? 0,
  };
}

function characterArmorClass(actor: AdapterDocument, build: Build): number {
  const armor = ofType(actor, 'armor').find(item => at(item, 'system.equipped.inSlot') === true);
  const category = armor ? text(at(armor, 'system.category')) || 'unarmored' : 'unarmored';
  const cap = armor ? num(at(armor, 'system.dexCap')) : null;
  const dex = cap === null ? build.mods.dex : Math.min(build.mods.dex, cap);
  const bonus = armor
    ? (num(at(armor, 'system.acBonus')) ?? 0) + (num(at(armor, 'system.runes.potency')) ?? 0)
    : 0;
  return 10 + dex + proficiencyBonus(build.armorRank(category), build.level) + bonus;
}

function characterMaxHp(actor: AdapterDocument, build: Build): number | null {
  const ancestry = ofType(actor, 'ancestry')[0];
  const cls = ofType(actor, 'class')[0];
  if (!cls) return null;
  const perLevel = (num(at(cls, 'system.hp')) ?? 0) + build.mods.con;
  return (num(at(ancestry, 'system.hp')) ?? 0) + perLevel * build.level;
}

// Strikes ---------------------------------------------------------------------------------------

export interface Strike {
  name: string;
  itemId: string;
  traits: string[];
  bonus: number;
  /** First, second and third attack with the multiple attack penalty. */
  attacks: [number, number, number];
  computed: boolean;
}

function withPenalties(bonus: number, traits: readonly string[]): [number, number, number] {
  const [second, third] = attackPenalties(traits.includes('agile'));
  return [bonus, bonus + second, bonus + third];
}

export function strikesOf(actor: AdapterDocument): Strike[] {
  if (actor['type'] === 'character') {
    const build = characterBuild(actor);
    return ofType(actor, 'weapon')
      .filter(item => text(at(item, 'system.equipped.carryType')) !== 'dropped')
      .map(item => {
        const traits = traitsOf(item);
        const ranged = at(item, 'system.range') !== null && at(item, 'system.range') !== undefined;
        const attribute: Attribute = ranged
          ? 'dex'
          : traits.includes('finesse') && build.mods.dex > build.mods.str
            ? 'dex'
            : 'str';
        const category = text(at(item, 'system.category')) || 'simple';
        const bonus =
          build.mods[attribute] +
          proficiencyBonus(build.weaponRank(category), build.level) +
          Math.max(
            num(at(item, 'system.runes.potency')) ?? 0,
            num(at(item, 'system.bonus.value')) ?? 0
          );
        return {
          name: text(item['name']),
          itemId: idOf(item),
          traits,
          bonus,
          attacks: withPenalties(bonus, traits),
          computed: true,
        };
      });
  }
  return ofType(actor, 'melee').map(item => {
    const traits = traitsOf(item);
    const bonus = num(at(item, 'system.bonus.value')) ?? 0;
    return {
      name: text(item['name']),
      itemId: idOf(item),
      traits,
      bonus,
      attacks: withPenalties(bonus, traits),
      computed: false,
    };
  });
}

// Statistics shared by summary and rolls ------------------------------------------------------------

interface Statistic {
  modifier: number;
  rank?: number;
}

function statistics(actor: AdapterDocument): {
  perception: Statistic;
  saves: Record<string, Statistic>;
  skills: Record<string, Statistic & { name: string; lore?: boolean }>;
  computed: boolean;
} {
  const system = sys(actor);
  if (actor['type'] === 'character') {
    const build = characterBuild(actor);
    let computed = false;
    const stat = (
      kind: 'skill' | 'save' | 'perception',
      key: string,
      attribute: Attribute,
      paths: readonly string[]
    ): Statistic => {
      const rank = build.rank(kind, key);
      const ready = preparedModifier(actor, paths);
      if (ready !== null) return { modifier: ready, rank };
      computed = true;
      return { modifier: build.mods[attribute] + proficiencyBonus(rank, build.level), rank };
    };
    const skillPaths = (slug: string) => [
      `skills.${slug}.totalModifier`,
      `skills.${slug}.value`,
      `skills.${slug}.mod`,
    ];
    const skills: Record<string, Statistic & { name: string; lore?: boolean }> = {};
    for (const [slug, attribute] of Object.entries(SKILLS))
      skills[slug] = { name: slug, ...stat('skill', slug, attribute, skillPaths(slug)) };
    for (const lore of ofType(actor, 'lore')) {
      const rank = num(at(lore, 'system.proficient.value')) ?? 0;
      const slug = slugOf(text(lore['name']));
      const ready = preparedModifier(actor, skillPaths(slug));
      if (ready === null) computed = true;
      skills[slug] = {
        name: text(lore['name']),
        lore: true,
        rank,
        modifier: ready ?? build.mods.int + proficiencyBonus(rank, build.level),
      };
    }
    const perception = stat('perception', 'perception', 'wis', [
      'perception.totalModifier',
      'perception.mod',
      'perception.value',
      'attributes.perception.value',
    ]);
    const saves = Object.fromEntries(
      Object.entries(SAVES).map(([save, attribute]) => [
        save,
        stat('save', save, attribute, [`saves.${save}.totalModifier`, `saves.${save}.value`]),
      ])
    );
    return { perception, saves, skills, computed };
  }
  const skills: Record<string, Statistic & { name: string; lore?: boolean }> = {};
  const storedSkills = isRecord(system['skills']) ? system['skills'] : {};
  for (const [slug, entry] of Object.entries(storedSkills)) {
    const base = num(at(entry, 'base')) ?? num(at(entry, 'value'));
    if (base !== null) skills[slug] = { name: slug, modifier: base };
  }
  for (const lore of ofType(actor, 'lore')) {
    const mod = num(at(lore, 'system.mod.value'));
    if (mod !== null)
      skills[slugOf(text(lore['name']))] = { name: text(lore['name']), modifier: mod, lore: true };
  }
  const saves: Record<string, Statistic> = {};
  for (const save of Object.keys(SAVES)) {
    const value = num(at(system, `saves.${save}.value`));
    if (value !== null) saves[save] = { modifier: value };
  }
  return {
    perception: {
      modifier:
        num(at(system, 'perception.mod')) ?? num(at(system, 'attributes.perception.value')) ?? 0,
    },
    saves,
    skills,
    computed: false,
  };
}

const slugOf = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// Creature index (2.2 to 2.6) -------------------------------------------------------------------------

function alignmentOf(system: Data): string | null {
  const stored = at(system, 'details.alignment');
  const value = isRecord(stored) ? text(stored['value']) : text(stored);
  return value ? value.toUpperCase() : null;
}

/** The pf2e fields of one creature or hazard. */
export function creatureRow(document: AdapterDocument): Record<string, unknown> {
  const system = sys(document);
  const traits = texts(at(system, 'traits.value'));
  const hp = at(system, 'attributes.hp');
  const items = itemsOf(document);
  return {
    level: num(at(system, 'details.level.value')) ?? 0,
    traits,
    creatureType: creatureTypeOf(traits),
    rarity: text(at(system, 'traits.rarity')) || 'common',
    size: sizeWord(at(system, 'traits.size')) ?? 'medium',
    hitPoints: (isRecord(hp) ? (num(hp['max']) ?? num(hp['value'])) : null) ?? 0,
    armorClass: num(at(system, 'attributes.ac.value')),
    hasSpells: items.some(item => item['type'] === 'spellcastingEntry' || item['type'] === 'spell'),
    // Removed with the remaster; older data still carries it.
    alignment: alignmentOf(system),
    ...(document['type'] === 'hazard'
      ? { isComplex: at(system, 'details.isComplex') === true }
      : {}),
  };
}

export const CREATURE_FILTERS: readonly CreatureFilterSpec[] = [
  { name: 'level', kind: 'numberOrRange', field: 'level', defaults: { min: -1, max: 25 } },
  { name: 'traits', kind: 'textList', field: 'traits' },
  { name: 'rarity', kind: 'text', field: 'rarity', values: RARITIES },
  { name: 'creatureType', kind: 'text', field: 'creatureType', values: CREATURE_TYPES },
  { name: 'size', kind: 'text', field: 'size', values: Object.values(SIZE_WORDS) },
  { name: 'hasSpells', kind: 'boolean', field: 'hasSpells' },
];

export function creatureListFields(row: CreatureRow): Record<string, unknown> {
  const fields: Data = {};
  for (const key of [
    'level',
    'creatureType',
    'traits',
    'rarity',
    'size',
    'hitPoints',
    'armorClass',
    'hasSpells',
    'alignment',
  ])
    fields[key] = row[key] ?? null;
  return fields;
}

export function creatureSummary(row: CreatureRow): string {
  const what = row.type === 'hazard' ? 'hazard' : String(row['creatureType'] ?? 'unknown');
  return `Level ${String(row['level'] ?? 0)} ${what} (${String(row['rarity'] ?? 'common')}) from ${row.packLabel}`;
}

export const INDEX_FIELDS = [
  'system.details.level.value',
  'system.traits.value',
  'system.traits.rarity',
  'system.traits.size.value',
  'system.attributes.hp',
  'system.attributes.ac.value',
  'system.details.alignment',
];

/** Key values for search-compendium and get-compendium-item, from an index row or full data. */
export function actorStats(entry: AdapterDocument): Record<string, unknown> | null {
  const level = num(read(entry, 'system.details.level.value'));
  const hp = read(entry, 'system.attributes.hp');
  if (level === null && hp === undefined) return null;
  const traits = texts(read(entry, 'system.traits.value'));
  const size = read(entry, 'system.traits.size.value') ?? read(entry, 'system.traits.size');
  const alignment = read(entry, 'system.details.alignment');
  return {
    level,
    traits,
    creatureType: creatureTypeOf(traits),
    rarity: text(read(entry, 'system.traits.rarity')) || 'common',
    size: sizeWord(size),
    hitPoints: isRecord(hp) ? { value: num(hp['value']), max: num(hp['max']) } : null,
    armorClass: num(read(entry, 'system.attributes.ac.value')),
    alignment: alignmentOf({ details: { alignment } }),
  };
}

// Characters (2.8) --------------------------------------------------------------------------------

const rankName = (rank: number | undefined) =>
  rank === undefined ? undefined : (RANK_NAMES[rank] ?? String(rank));

export function characterSummary(actor: AdapterDocument): CharacterSummary {
  const system = sys(actor);
  const type = text(actor['type']);
  const items = itemsOf(actor);
  const named = (itemType: string) => {
    const item = items.find(entry => entry['type'] === itemType);
    return item ? text(item['name']) : null;
  };
  const hp = at(system, 'attributes.hp');
  const creature = type === 'character' || type === 'npc' || type === 'familiar';
  const stats = creature || type === 'hazard' ? statistics(actor) : null;
  const build = type === 'character' ? characterBuild(actor) : null;
  const level = num(at(system, 'details.level.value'));
  const preparedMods = ATTRIBUTES.map(a => preparedModifier(actor, [`abilities.${a}.mod`]));
  const modsPrepared = build !== null && preparedMods.every(mod => mod !== null);
  const mods: Record<string, number | null> = build
    ? modsPrepared
      ? Object.fromEntries(ATTRIBUTES.map((a, index) => [a, preparedMods[index] ?? null]))
      : build.mods
    : Object.fromEntries(ATTRIBUTES.map(a => [a, num(at(system, `abilities.${a}.mod`))]));
  const storedMax = isRecord(hp) ? num(hp['max']) : null;
  const hitPoints = isRecord(hp)
    ? {
        value: num(hp['value']),
        max: storedMax ?? (build ? characterMaxHp(actor, build) : null),
        temp: num(hp['temp']) ?? 0,
      }
    : null;
  const preparedArmorClass = build ? preparedModifier(actor, ['attributes.ac.value']) : null;
  const armorClass = build
    ? (preparedArmorClass ?? characterArmorClass(actor, build))
    : num(at(system, 'attributes.ac.value'));
  const buildComputed =
    build !== null &&
    (!modsPrepared ||
      preparedArmorClass === null ||
      storedMax === null ||
      stats?.computed === true);
  const cls = items.find(item => item['type'] === 'class');
  const keyAttribute = attributeKey(
    text(at(cls, 'system.keyAbility.selected')) || text(at(system, 'details.keyability.value'))
  );
  const withRank = (stat: Statistic) => ({
    modifier: stat.modifier,
    ...(stat.rank !== undefined ? { rank: stat.rank, rankName: rankName(stat.rank) } : {}),
  });

  const basicInfo: Data = {
    hitPoints,
    armorClass,
    level,
    ...(type === 'character'
      ? {
          class: named('class'),
          ancestry: named('ancestry'),
          heritage: named('heritage'),
          background: named('background'),
          keyAttribute,
        }
      : {}),
    ...(stats ? { perception: stats.perception.modifier } : {}),
  };
  const out: Data = {
    level,
    hitPoints,
    armorClass,
    attributes: Object.fromEntries(ATTRIBUTES.map(a => [a, { mod: mods[a] ?? null }])),
  };
  if (stats) {
    out['perception'] = withRank(stats.perception);
    out['saves'] = Object.fromEntries(
      Object.entries(stats.saves).map(([key, stat]) => [key, withRank(stat)])
    );
    out['skills'] = Object.fromEntries(
      Object.entries(stats.skills).map(([key, stat]) => [
        key,
        {
          name: stat.name,
          ...withRank(stat),
          trained: stat.rank === undefined ? undefined : stat.rank > 0,
          ...(stat.lore ? { lore: true } : {}),
        },
      ])
    );
  }
  const focus = at(system, 'resources.focus');
  const entries = items.filter(item => item['type'] === 'spellcastingEntry');
  out['resources'] = {
    focusPoints: isRecord(focus)
      ? { value: num(focus['value']) ?? 0, max: num(focus['max']) ?? (entries.length ? null : 0) }
      : null,
    heroPoints: isRecord(at(system, 'resources.heroPoints'))
      ? {
          value: num(at(system, 'resources.heroPoints.value')) ?? 0,
          max: num(at(system, 'resources.heroPoints.max')) ?? 3,
        }
      : null,
  };
  out['spellcasting'] = {
    entries: entries.length,
    spells: items.filter(item => item['type'] === 'spell').length,
  };
  out['conditions'] = activeConditions(actor).map(c => ({
    slug: c.slug,
    name: c.name,
    value: c.value,
  }));
  if (type !== 'character') {
    const traits = texts(at(system, 'traits.value'));
    out['traits'] = traits;
    out['creatureType'] = creatureTypeOf(traits);
    out['size'] = sizeWord(at(system, 'traits.size'));
    out['rarity'] = text(at(system, 'traits.rarity')) || 'common';
    out['alignment'] = alignmentOf(system);
  }
  if (type === 'hazard') {
    out['stealth'] = num(at(system, 'attributes.stealth.value'));
    out['hardness'] = num(at(system, 'attributes.hardness'));
    out['isComplex'] = at(system, 'details.isComplex') === true;
  }
  if (build) {
    out['attributeSource'] = modsPrepared ? 'prepared' : build.attributeSource;
    out['valuesFrom'] = isPreparedData(actor) ? 'prepared' : 'stored';
    if (buildComputed) out['computedNote'] = COMPUTED_NOTE;
  }
  return { basicInfo, stats: out };
}

export function itemFields(item: AdapterDocument): Record<string, unknown> {
  const system = sys(item);
  const out: Data = {};
  const quantity = num(system['quantity']);
  if (quantity !== null && quantity !== 1) out['quantity'] = quantity;
  const level = num(at(system, 'level.value'));
  if (level !== null)
    out['level'] =
      item['type'] === 'spell' ? (num(at(system, 'location.heightenedLevel')) ?? level) : level;
  const traits = texts(at(system, 'traits.value'));
  if (traits.length) out['traits'] = traits;
  const rarity = text(at(system, 'traits.rarity'));
  if (rarity && rarity !== 'common') out['rarity'] = rarity;
  const equipped = system['equipped'];
  if (isRecord(equipped) && text(equipped['carryType'])) {
    out['equipped'] = {
      carryType: equipped['carryType'],
      ...(equipped['invested'] === true ? { invested: true } : {}),
    };
  }
  const cost = actionCost(
    at(system, 'actions.value') ?? at(system, 'time.value'),
    at(system, 'actionType.value')
  );
  if (cost) out['actionCost'] = cost;
  if (item['type'] === 'condition') out['value'] = num(at(system, 'value.value'));
  return out;
}

/** Actions, strikes with the multiple attack penalty, and toggles from rule elements. */
export function actionsOf(actor: AdapterDocument): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const strike of strikesOf(actor)) {
    out.push({
      name: strike.name,
      type: 'strike',
      itemId: strike.itemId,
      traits: strike.traits,
      actionCost: '1 action',
      attackBonuses: strike.attacks,
      ...(strike.computed ? { computed: true } : {}),
    });
  }
  for (const item of itemsOf(actor)) {
    const kind = text(at(item, 'system.actionType.value'));
    if ((item['type'] === 'action' || item['type'] === 'feat') && kind && kind !== 'passive') {
      out.push({
        name: text(item['name']),
        type: kind,
        itemId: idOf(item),
        traits: traitsOf(item),
        actionCost: actionCost(at(item, 'system.actions.value'), kind),
      });
    }
    const rules = at(item, 'system.rules');
    if (!Array.isArray(rules)) continue;
    for (const rule of rules.filter(isRecord)) {
      if (rule['key'] === 'RollOption' && rule['toggleable'] === true) {
        out.push({
          name: text(rule['label']) || text(rule['option']),
          type: 'toggle',
          itemId: idOf(item),
          option: text(rule['option']),
          active: rule['value'] === true,
        });
      } else if (rule['key'] === 'ChoiceSet') {
        out.push({
          name: `${text(item['name'])}: ${text(rule['prompt']) || text(rule['flag']) || 'choice'}`,
          type: 'choice',
          itemId: idOf(item),
          selection: rule['selection'] ?? null,
        });
      }
    }
  }
  return out;
}

// Spells (2.9) -------------------------------------------------------------------------------------------

function spellInfo(
  item: Data,
  preparedIds: Map<string, { prepared: number; expended: number }> | null
): SpellInfo & Data {
  const system = sys(item);
  const traits = texts(at(system, 'traits.value'));
  const area = system['area'];
  const id = idOf(item);
  const slots = preparedIds?.get(id);
  return {
    id,
    name: text(item['name']),
    level: traits.includes('cantrip')
      ? 0
      : (num(at(system, 'location.heightenedLevel')) ?? num(at(system, 'level.value'))),
    rank: num(at(system, 'location.heightenedLevel')) ?? num(at(system, 'level.value')),
    ...(preparedIds
      ? {
          prepared: !!slots && slots.prepared > slots.expended,
          expended: !!slots && slots.expended >= slots.prepared && slots.prepared > 0,
        }
      : {}),
    traits,
    cost: actionCost(at(system, 'time.value')),
    range: text(at(system, 'range.value')) || null,
    target: text(at(system, 'target.value')) || null,
    area:
      isRecord(area) && num(area['value']) !== null
        ? `${num(area['value'])}-foot ${text(area['type'])}`
        : null,
    ...(at(system, 'location.signature') === true ? { signature: true } : {}),
    ...(isRecord(at(system, 'location.uses')) ? { uses: at(system, 'location.uses') } : {}),
  };
}

const byRank = (a: SpellInfo, b: SpellInfo) =>
  (a.level ?? 0) - (b.level ?? 0) || a.name.localeCompare(b.name);

export function spellcastingEntries(actor: AdapterDocument): SpellcastingEntry[] {
  const system = sys(actor);
  const spells = ofType(actor, 'spell');
  const claimed = new Set<Data>();
  const entries: SpellcastingEntry[] = [];
  for (const entry of ofType(actor, 'spellcastingEntry')) {
    const id = idOf(entry);
    const mode = text(at(entry, 'system.prepared.value')) || 'unknown';
    const own = spells.filter(spell => text(at(spell, 'system.location.value')) === id);
    own.forEach(spell => claimed.add(spell));
    const slots: NonNullable<SpellcastingEntry['slots']> = {};
    const prepared = new Map<string, { prepared: number; expended: number }>();
    if (mode === 'prepared' || mode === 'spontaneous') {
      for (let rank = 0; rank <= 10; rank++) {
        const slot = at(entry, `system.slots.slot${rank}`);
        if (!isRecord(slot)) continue;
        const max = num(slot['max']) ?? 0;
        if (max > 0)
          slots[rank === 0 ? 'cantrips' : `rank${rank}`] = { value: num(slot['value']) ?? 0, max };
        for (const chosen of Array.isArray(slot['prepared'])
          ? slot['prepared'].filter(isRecord)
          : []) {
          const spellId = text(chosen['id']);
          if (!spellId) continue;
          const count = prepared.get(spellId) ?? { prepared: 0, expended: 0 };
          count.prepared += 1;
          if (chosen['expended'] === true) count.expended += 1;
          prepared.set(spellId, count);
        }
      }
    }
    if (mode === 'focus') {
      slots['focus'] = {
        value: num(at(system, 'resources.focus.value')) ?? 0,
        max: num(at(system, 'resources.focus.max')) ?? 0,
      };
    }
    entries.push({
      id,
      name: text(entry['name']),
      kind: mode,
      tradition: text(at(entry, 'system.tradition.value')) || null,
      ability: text(at(entry, 'system.ability.value')) || null,
      dc: num(at(entry, 'system.spelldc.dc')),
      attack: num(at(entry, 'system.spelldc.value')),
      slots,
      spells: own
        .map(spell => spellInfo(spell, mode === 'prepared' ? prepared : null))
        .sort(byRank),
    });
  }
  const rest = spells.filter(spell => !claimed.has(spell));
  const focus = rest.filter(spell => traitsOf(spell).includes('focus'));
  const rituals = rest.filter(
    spell =>
      !focus.includes(spell) &&
      at(spell, 'system.ritual') !== null &&
      at(spell, 'system.ritual') !== undefined
  );
  const other = rest.filter(spell => !focus.includes(spell) && !rituals.includes(spell));
  if (focus.length) {
    entries.push({
      id: 'focus',
      name: 'Focus Spells',
      kind: 'focus',
      slots: {
        focus: {
          value: num(at(system, 'resources.focus.value')) ?? 0,
          max: num(at(system, 'resources.focus.max')) ?? 0,
        },
      },
      spells: focus.map(spell => spellInfo(spell, null)).sort(byRank),
    });
  }
  if (rituals.length)
    entries.push({
      id: 'rituals',
      name: 'Rituals',
      kind: 'ritual',
      spells: rituals.map(s => spellInfo(s, null)).sort(byRank),
    });
  if (other.length)
    entries.push({
      id: 'unassigned',
      name: 'Other Spells',
      kind: 'unassigned',
      spells: other.map(s => spellInfo(s, null)).sort(byRank),
    });
  return entries;
}

// Search inside a character (2.10) ----------------------------------------------------------------------------

const carried = (item: AdapterDocument) => {
  const carry = text(at(item, 'system.equipped.carryType'));
  return carry !== '' && carry !== 'dropped';
};

export function matchDetails(item: AdapterDocument): Record<string, unknown> {
  if (item['type'] === 'spell') {
    const { id: _id, name: _name, ...rest } = spellInfo(item as Data, null);
    return { ...rest, traditions: texts(at(item, 'system.traits.traditions')) };
  }
  return itemFields(item);
}

// Rolls (2.13) -------------------------------------------------------------------------------------------------

function join(bonus: number, modifier?: string): string {
  let formula = bonus ? `1d20${bonus > 0 ? '+' : ''}${bonus}` : '1d20';
  const extra = (modifier ?? '').trim();
  if (extra) formula += /^[+-]/.test(extra) ? extra : `+${extra}`;
  return formula;
}

function capital(word: string): string {
  return word.replace(/(^|[\s-])\w/g, letter => letter.toUpperCase());
}

export function rollPlan(
  request: { rollType: string; rollTarget?: string; rollModifier?: string },
  actor: AdapterDocument | null
): { formula: string; label: string } {
  const target = (request.rollTarget ?? '').trim();
  const stats = actor ? statistics(actor) : null;
  switch (request.rollType) {
    case 'custom':
      if (!target) throw new Error('A custom roll needs its formula in rollTarget, e.g. "2d6+4".');
      return {
        formula: `${target}${request.rollModifier?.trim() ? (/^[+-]/.test(request.rollModifier.trim()) ? request.rollModifier.trim() : `+${request.rollModifier.trim()}`) : ''}`,
        label: 'Custom roll',
      };
    case 'flat': {
      const dc = num(target);
      if (dc === null || dc < 1 || dc > 20)
        throw new Error(
          `A flat check needs its DC from 1 to 20 in rollTarget, e.g. "11", got "${target}".`
        );
      return { formula: '1d20', label: `Flat check DC ${dc}` };
    }
    case 'perception':
      return {
        formula: join(stats?.perception.modifier ?? 0, request.rollModifier),
        label: 'Perception check',
      };
    case 'initiative': {
      const skill = target ? stats?.skills[slugOf(target)] : undefined;
      if (target && target.toLowerCase() !== 'perception' && stats && !skill)
        throw new Error(
          `Initiative uses Perception or a skill of the actor; "${target}" is neither.`
        );
      const bonus = skill ? skill.modifier : (stats?.perception.modifier ?? 0);
      return {
        formula: join(bonus, request.rollModifier),
        label: skill ? `Initiative (${capital(skill.name)})` : 'Initiative',
      };
    }
    case 'save': {
      const save = saveKey(target);
      if (!save)
        throw new Error(
          `rollTarget must be a saving throw for a save: fortitude, reflex or will, got "${target}".`
        );
      if (stats && !stats.saves[save]) throw new Error(`The actor has no ${save} save.`);
      return {
        formula: join(stats?.saves[save]?.modifier ?? 0, request.rollModifier),
        label: `${capital(save)} save`,
      };
    }
    case 'skill': {
      const slug = slugOf(target);
      const known = Object.keys(SKILLS).includes(slug);
      if (!slug)
        throw new Error(
          'rollTarget must name a skill for a skill check, e.g. "stealth" or "Legal Lore".'
        );
      if (!stats) {
        if (!known)
          throw new Error(
            `"${target}" is not one of the sixteen skills; lore skills need an actor.`
          );
        return { formula: join(0, request.rollModifier), label: `${capital(slug)} check` };
      }
      const skill = stats.skills[slug];
      if (!skill) {
        if (!known) {
          const lores = Object.values(stats.skills)
            .filter(s => s.lore)
            .map(s => `"${s.name}"`);
          throw new Error(
            `The actor has no skill "${target}". Skills are the sixteen of the rules${lores.length ? ` and ${lores.join(', ')}` : ''}.`
          );
        }
        // An NPC without an entry for a skill rolls it untrained: the attribute modifier alone.
        const mod = num(at(actor, `system.abilities.${SKILLS[slug]}.mod`)) ?? 0;
        return {
          formula: join(mod, request.rollModifier),
          label: `${capital(slug)} check (untrained)`,
        };
      }
      return {
        formula: join(skill.modifier, request.rollModifier),
        label: `${capital(skill.name)} check`,
      };
    }
    case 'strike':
    case 'strike-2':
    case 'strike-3': {
      if (!actor)
        throw new Error('A strike needs the actor whose weapon or attack is named in rollTarget.');
      const strikes = strikesOf(actor);
      const strike = strikes.find(entry => entry.name.toLowerCase() === target.toLowerCase());
      if (!strike)
        throw new Error(
          `A strike needs the exact name of one of the actor's weapons or attacks in rollTarget. ` +
            (strikes.length
              ? `Strikes: ${strikes.map(s => `"${s.name}"`).join(', ')}.`
              : 'The actor has no strike.')
        );
      const step = request.rollType === 'strike' ? 0 : request.rollType === 'strike-2' ? 1 : 2;
      const label = ['', ' (second attack)', ' (third attack)'][step] ?? '';
      return {
        formula: join(strike.attacks[step] ?? strike.bonus, request.rollModifier),
        label: `${strike.name} strike${label}`,
      };
    }
    default:
      throw new Error(
        `The roll type "${request.rollType}" is not a Pathfinder 2e roll type: perception, save, skill, strike, strike-2, strike-3, flat, initiative or custom. ` +
          'Pathfinder 2e has no attribute checks.'
      );
  }
}

// Actor data (2.14, 2.15) ---------------------------------------------------------------------------------------------

const wrap = (value: unknown, key: string) =>
  typeof value === 'number' || typeof value === 'string' ? { [key]: value } : value;

/** Short forms brought into the stored shape of pf2e. Everything else stays as given. */
export function normalizeActorSystem(
  system: Record<string, unknown>,
  actorType: string
): Record<string, unknown> {
  const out: Data = { ...system };
  const npcLike = actorType !== 'character';
  if (out['level'] !== undefined) {
    const details: Data = isRecord(out['details']) ? { ...out['details'] } : {};
    if (details['level'] === undefined) details['level'] = wrap(out['level'], 'value');
    delete out['level'];
    out['details'] = details;
  }
  if (isRecord(out['details']) && typeof out['details']['level'] === 'number')
    out['details'] = { ...out['details'], level: { value: out['details']['level'] } };
  if (isRecord(out['traits'])) {
    const traits: Data = { ...out['traits'] };
    if (typeof traits['size'] === 'string') {
      const size = traits['size'].toLowerCase();
      traits['size'] = { value: SIZE_KEYS[size] ?? size };
    }
    if (typeof traits['value'] === 'string') traits['value'] = [traits['value']];
    if (typeof traits['rarity'] === 'string') traits['rarity'] = traits['rarity'].toLowerCase();
    out['traits'] = traits;
  }
  if (npcLike && isRecord(out['abilities'])) {
    out['abilities'] = Object.fromEntries(
      Object.entries(out['abilities']).map(([key, value]) => [
        attributeKey(key) ?? key,
        wrap(value, 'mod'),
      ])
    );
  }
  if (npcLike && typeof out['perception'] === 'number')
    out['perception'] = { mod: out['perception'] };
  if (npcLike && isRecord(out['saves'])) {
    out['saves'] = Object.fromEntries(
      Object.entries(out['saves']).map(([key, value]) => [
        saveKey(key) ?? key,
        wrap(value, 'value'),
      ])
    );
  }
  if (isRecord(out['skills'])) {
    out['skills'] = Object.fromEntries(
      Object.entries(out['skills']).map(([key, value]) => [
        slugOf(key),
        wrap(value, npcLike ? 'base' : 'rank'),
      ])
    );
  }
  if (isRecord(out['attributes'])) {
    const attributes: Data = { ...out['attributes'] };
    if (typeof attributes['ac'] === 'number') attributes['ac'] = { value: attributes['ac'] };
    if (typeof attributes['hp'] === 'number')
      attributes['hp'] = npcLike
        ? { value: attributes['hp'], max: attributes['hp'] }
        : { value: attributes['hp'] };
    out['attributes'] = attributes;
  }
  return out;
}

export const SCHEMA_NOTES = [
  'Pathfinder 2e (pf2e system) actor data:',
  '- Types: character, npc, hazard, loot, familiar, vehicle, party, army.',
  '- NPC: details.level.value (-1 to 25), attributes.hp.value and .max, attributes.ac.value, perception.mod, saves.fortitude|reflex|will.value, skills.<slug>.base, abilities.<str|dex|con|int|wis|cha>.mod. Numbers are accepted for each of these.',
  '- NPC traits: traits.value (list, creature type traits such as "humanoid"), traits.rarity (common, uncommon, rare, unique), traits.size.value (tiny, sm, med, lg, huge, grg; "large" is accepted).',
  '- Character: details.level.value, details.keyability.value, skills.<slug>.rank (0 untrained to 4 legendary), attributes.hp.value and .temp, build.attributes.boosts.<1|5|10|15|20> (lists of attributes). Hit point maximum, armor class, saves and perception are derived from ancestry, class and equipment: do not write them.',
  '- Ancestry, heritage, background, class, spells, feats, strikes (NPC type "melee") and conditions are items, not system fields. Use pf2e-manage-conditions for conditions such as frightened 2.',
  '- Alignment was removed by the remaster; write traits such as "holy" or "unholy" instead.',
].join('\n');

// World items (2.16) --------------------------------------------------------------------------------------------------

const keysOf = (value: unknown): string[] => (isRecord(value) ? Object.keys(value) : []);

export function itemEnums(config: unknown): Record<string, Record<string, readonly string[]>> {
  const pf2e = isRecord(config) ? config['PF2E'] : undefined;
  if (!isRecord(pf2e))
    throw new Error('CONFIG.PF2E is not available; the pf2e system seems not to be loaded');
  const rarities = keysOf(pf2e['rarityTraits']);
  return {
    weapon: {
      'system.category': keysOf(pf2e['weaponCategories']),
      'system.group': keysOf(pf2e['weaponGroups']),
      'system.traits.value': keysOf(pf2e['weaponTraits']),
      'system.damage.damageType': keysOf(pf2e['damageTypes']),
      'system.traits.rarity': rarities,
    },
    armor: {
      'system.category': keysOf(pf2e['armorCategories']),
      'system.group': keysOf(pf2e['armorGroups']),
    },
    consumable: {
      'system.category': keysOf(pf2e['consumableCategories']),
      'system.traits.value': keysOf(pf2e['consumableTraits']),
    },
    equipment: {
      'system.traits.value': keysOf(pf2e['equipmentTraits']),
      'system.traits.rarity': rarities,
    },
    feat: {
      'system.category': keysOf(pf2e['featCategories']),
      'system.actionType.value': keysOf(pf2e['actionTypes']),
    },
    action: {
      'system.actionType.value': keysOf(pf2e['actionTypes']),
      'system.traits.value': keysOf(pf2e['actionTraits']),
    },
    spell: {
      'system.traits.value': keysOf(pf2e['spellTraits']),
      'system.traits.traditions': keysOf(pf2e['magicTraditions']),
      'system.traits.rarity': rarities,
    },
    spellcastingEntry: {
      'system.prepared.value': keysOf(pf2e['preparationType']),
      'system.tradition.value': keysOf(pf2e['magicTraditions']),
    },
  };
}

// The adapter --------------------------------------------------------------------------------------------------------------

export const pf2eAdapter: SystemAdapter = {
  id: 'pf2e',
  title: 'Pathfinder Second Edition',
  creatures: {
    indexVersion: 1,
    actorTypes: ['npc', 'character', 'hazard'],
    invalidatingTypes: ['npc', 'character', 'hazard'],
    copyableTypes: ['npc', 'character', 'hazard', 'loot', 'familiar', 'vehicle', 'party', 'army'],
    row: creatureRow,
    power: { name: 'Level', field: 'level', range: { min: -1, max: 25 } },
    filters: CREATURE_FILTERS,
    describeFilters: filters =>
      Object.entries(filters)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => `${key} ${JSON.stringify(value)}`)
        .join(', '),
    listFields: creatureListFields,
    summary: creatureSummary,
  },
  compendiumStats: { indexFields: INDEX_FIELDS, actorStats, estimate: estimateEntry },
  characters: { summary: characterSummary, itemFields, actions: actionsOf },
  spells: { itemTypes: ['spell'], entries: spellcastingEntries },
  characterSearch: {
    itemTypes: {
      spells: ['spell'],
      equipment: [
        'weapon',
        'armor',
        'shield',
        'equipment',
        'consumable',
        'treasure',
        'backpack',
        'book',
        'ammo',
      ],
      features: ['feat', 'ancestry', 'heritage', 'class', 'background', 'deity', 'lore'],
      actions: ['action'],
    },
    categories: {
      cantrip: {
        description: 'spells with the cantrip trait',
        matches: item => item['type'] === 'spell' && traitsOf(item as Data).includes('cantrip'),
      },
      focus: {
        description: 'spells with the focus trait',
        matches: item => item['type'] === 'spell' && traitsOf(item as Data).includes('focus'),
      },
      ritual: {
        description: 'ritual spells',
        matches: item => item['type'] === 'spell' && isRecord(at(item, 'system.ritual')),
      },
      signature: {
        description: 'signature spells of a spontaneous caster',
        matches: item => at(item, 'system.location.signature') === true,
      },
      equipped: {
        description: 'items worn in their slot or held in hand',
        matches: item =>
          at(item, 'system.equipped.inSlot') === true ||
          text(at(item, 'system.equipped.carryType')) === 'held',
      },
      carried: {
        description: 'physical items worn, held or stowed, not dropped',
        matches: carried,
      },
      invested: {
        description: 'magic items that are invested',
        matches: item => at(item, 'system.equipped.invested') === true,
      },
    },
    matchDetails,
  },
  itemUse: {
    // Every pf2e item posts its card with toChat, where its buttons (cast, strike, consume) live.
    // The one argument use-item passes is taken as the click event, which toChat only reads for the roll mode.
    plan: (item, request) => {
      if (request.spellLevel !== undefined)
        throw new Error(
          `spellLevel cannot be applied in Pathfinder 2e through use-item: a spell is cast at a rank through its spellcasting entry, ` +
            `and the card of "${text(item['name'])}" offers the ranks it can be heightened to.`
        );
      return { method: 'toChat', options: {} };
    },
  },
  // 2.12: pf2e keeps conditions as items; toggleStatusEffect of pf2e routes a condition slug to its
  // own condition handling. There is no effect data of its own.
  conditions: {
    matchesEffect: (effect, condition) =>
      Array.isArray(effect['statuses']) && effect['statuses'].includes(condition.id),
    // Conditions are items, so they are read from the items, with their value.
    activeOn: actor =>
      activeConditions(actor).map(condition => ({ id: condition.slug, level: condition.value })),
    levels: condition => {
      const slug = conditionSlug(condition.id);
      return slug && isValued(slug) ? { max: null } : null;
    },
    levelPlan: (condition, level, actor) => conditionLevelPlan(condition.id, level, actor),
  },
  rolls: {
    types: [
      { id: 'perception', description: '1d20 plus Perception' },
      { id: 'save', description: '1d20 plus the saving throw', targets: Object.keys(SAVES) },
      {
        id: 'skill',
        description: '1d20 plus the skill modifier; rollTarget is the skill or the name of a lore',
        targets: Object.keys(SKILLS),
      },
      {
        id: 'strike',
        description: 'first attack with the weapon or NPC attack named in rollTarget',
      },
      { id: 'strike-2', description: 'second attack: -5, or -4 with the agile trait' },
      { id: 'strike-3', description: 'third and later attacks: -10, or -8 with the agile trait' },
      { id: 'flat', description: 'flat check 1d20 without modifiers; rollTarget is the DC' },
      { id: 'initiative', description: '1d20 plus Perception, or the skill named in rollTarget' },
      { id: 'custom', description: 'the formula in rollTarget' },
    ],
    plan: rollPlan,
  },
  actorData: {
    normalize: (system, context) => normalizeActorSystem(system, context.actorType),
    schemaNotes: () => SCHEMA_NOTES,
  },
  worldItems: {
    enums: itemEnums,
    note: () =>
      'Values outside these lists are stored by pf2e but do nothing. Rule elements (system.rules) carry most automation.',
  },
  compendiums: {
    defaults: { Actor: STANDARD_PACKS.Actor, Item: STANDARD_PACKS.Item },
    priority: packId => (packId.startsWith('pf2e.') ? 1 : 0),
  },
  tools: PF2E_TOOLS,
};
