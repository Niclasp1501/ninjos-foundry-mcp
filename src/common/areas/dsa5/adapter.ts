/**
 * The DSA5 adapter: what the system neutral packages ask about Das Schwarze
 * Auge 5, answered from plain data.
 *
 * It reads plain data. Data from the module carries what DSA5 prepared
 * (`preparedData`), read first for the summary. Otherwise values the system
 * derives (characteristic values, the maxima of LeP, AsP and KaP, attack,
 * parry, dodge) are computed here from the stored parts by the rules and named
 * as computed, because gear, conditions and active effects are not in stored
 * data.
 */
import type {
  ActorCall,
  AdapterDocument,
  CharacterSummary,
  ConditionInfo,
  CreatureFilterSpec,
  CreatureRow,
  RollPlan,
  RollRequest,
  SpellInfo,
  SpellcastingEntry,
  SystemAdapter,
} from '../../game-systems.js';
import { isPreparedData } from '../../game-systems.js';
import {
  CHARACTERISTIC_KEYS,
  CHARACTERISTIC_NAMES,
  EQUIPMENT_TYPES,
  FEATURE_TYPES,
  LITURGY_TYPES,
  MAGIC_TYPES,
  SIZE_KEYS,
  SIZE_WORDS,
  SPECIES_VALUES,
  SPELL_TYPES,
  SYSTEM_PACKS,
  at,
  characteristicFor,
  characteristicOf,
  combatTechniqueValues,
  dodgeOf,
  energy,
  experienceLevel,
  initiativeOf,
  isRecord,
  lifePoints,
  num,
  read,
  sameName,
  text,
  type CharacteristicKey,
  type Data,
  type EnergyValue,
} from './rules.js';
import { estimateEntry } from './compendium-estimate.js';

export const DSA5_TOOLS = ['list-dsa5-archetypes', 'create-dsa5-character-from-archetype'] as const;

export const COMPUTED_NOTE =
  'Characteristic values, LeP, AsP and KaP maxima, attack, parry, dodge and initiative are computed from the stored values by the rules; gear, conditions and active effects are not included.';

const sys = (document: AdapterDocument): Data =>
  isRecord(document['system']) ? document['system'] : {};
const itemsOf = (actor: AdapterDocument): Data[] =>
  Array.isArray(actor['items']) ? actor['items'].filter(isRecord) : [];
const idOf = (document: Data): string => text(document['_id']) || text(document['id']);
const ofType = (actor: AdapterDocument, types: readonly string[]) =>
  itemsOf(actor).filter(item => types.includes(text(item['type'])));

function experienceOf(system: Data): { total: number; spent: number } {
  return {
    total: num(at(system, 'details.experience.total')) ?? 0,
    spent: num(at(system, 'details.experience.spent')) ?? 0,
  };
}

/** Species of a hero or NPC; a creature names its class instead. */
function speciesOf(document: AdapterDocument): string {
  const system = sys(document);
  const stored = text(at(system, 'details.species.value'));
  if (stored) return stored;
  const item = ofType(document, ['species'])[0];
  if (item) return text(item['name']);
  return text(at(system, 'creatureClass.value'));
}

function detail(document: AdapterDocument, field: 'culture' | 'career'): string {
  const stored = text(at(sys(document), `details.${field}.value`));
  if (stored) return stored;
  const item = ofType(document, [field])[0];
  return item ? text(item['name']) : '';
}

function armorOf(actor: AdapterDocument): number {
  const worn = ofType(actor, ['armor']).filter(item => at(item, 'system.worn.value') === true);
  return (
    worn.reduce((sum, item) => sum + (num(at(item, 'system.protection.value')) ?? 0), 0) +
    (num(at(sys(actor), 'totalArmor')) ?? 0)
  );
}

// Creature index (2.2 to 2.6) ----------------------------------------------------------------

export function creatureRow(document: AdapterDocument): Record<string, unknown> {
  const system = sys(document);
  const experience = experienceOf(system);
  const size = text(at(system, 'status.size.value')).toLowerCase();
  const astral = energy(document as Data, 'astral');
  const karma = energy(document as Data, 'karma');
  return {
    // Creatures carry no adventure points and so no experience level.
    level: experience.total > 0 ? experienceLevel(experience.total).level : null,
    experiencePoints: experience.total,
    species: speciesOf(document).toLowerCase() || 'unknown',
    culture: detail(document, 'culture').toLowerCase() || null,
    profession: detail(document, 'career').toLowerCase() || null,
    size: SIZE_WORDS[size] ?? 'medium',
    sizeCategory: size || 'average',
    lifePoints: lifePoints(document as Data)?.max ?? 0,
    astralEnergy: astral?.max ?? 0,
    karmaEnergy: karma?.max ?? 0,
    dodge: dodgeOf(system),
    armor: armorOf(document),
    hasSpells: ofType(document, SPELL_TYPES).length > 0,
    hasLiturgies: ofType(document, LITURGY_TYPES).length > 0,
    traits: ofType(document, ['trait']).map(item => text(item['name'])),
  };
}

export const CREATURE_FILTERS: readonly CreatureFilterSpec[] = [
  { name: 'level', kind: 'numberOrRange', field: 'level', defaults: { min: 1, max: 7 } },
  { name: 'species', kind: 'text', field: 'species', values: SPECIES_VALUES },
  { name: 'culture', kind: 'partialText', field: 'culture' },
  { name: 'profession', kind: 'partialText', field: 'profession' },
  { name: 'size', kind: 'text', field: 'size', values: Object.values(SIZE_WORDS) },
  { name: 'hasSpells', kind: 'boolean', field: 'hasSpells' },
  { name: 'hasLiturgies', kind: 'boolean', field: 'hasLiturgies' },
  {
    name: 'experiencePoints',
    kind: 'numberOrRange',
    field: 'experiencePoints',
    defaults: { min: 0, max: 100000 },
  },
];

export function creatureListFields(row: CreatureRow): Record<string, unknown> {
  const out: Data = {};
  for (const key of [
    'level',
    'experiencePoints',
    'species',
    'culture',
    'profession',
    'size',
    'lifePoints',
    'astralEnergy',
    'karmaEnergy',
    'dodge',
    'armor',
    'hasSpells',
    'hasLiturgies',
  ])
    out[key] = row[key] ?? null;
  return out;
}

export function creatureSummary(row: CreatureRow): string {
  const level = num(row['level']);
  const species = text(row['species']) || 'unknown';
  const grade = level
    ? `Experience level ${level} (${experienceLevel(num(row['experiencePoints']) ?? 0).en.toLowerCase()}) `
    : '';
  return `${grade}${species} ${row.type} from ${row.packLabel}`;
}

export const INDEX_FIELDS = [
  'system.details.species.value',
  'system.details.culture.value',
  'system.details.career.value',
  'system.details.experience.total',
  'system.creatureClass.value',
  'system.status.wounds',
  'system.status.size.value',
  'system.characteristics.ko',
];

export function actorStats(entry: AdapterDocument): Record<string, unknown> | null {
  const wounds = read(entry, 'system.status.wounds');
  const species =
    text(read(entry, 'system.details.species.value')) ||
    text(read(entry, 'system.creatureClass.value'));
  if (!isRecord(wounds) && !species) return null;
  const total = num(read(entry, 'system.details.experience.total')) ?? 0;
  const size = text(read(entry, 'system.status.size.value')).toLowerCase();
  const ko = read(entry, 'system.characteristics.ko');
  const life = isRecord(wounds)
    ? lifePoints({
        type: entry['type'],
        system: { status: { wounds }, characteristics: isRecord(ko) ? { ko } : {} },
      })
    : null;
  return {
    species: species || null,
    culture: text(read(entry, 'system.details.culture.value')) || null,
    profession: text(read(entry, 'system.details.career.value')) || null,
    experienceLevel: total > 0 ? experienceLevel(total).level : null,
    lifePoints: life,
    size: size ? (SIZE_WORDS[size] ?? size) : null,
  };
}

// Characters (2.8) ----------------------------------------------------------------------

export function conditionsOf(actor: AdapterDocument): Array<Record<string, unknown>> {
  const effects = Array.isArray(actor['effects']) ? actor['effects'].filter(isRecord) : [];
  return effects.flatMap(effect => {
    const statuses = Array.isArray(effect['statuses'])
      ? effect['statuses'].filter((s): s is string => typeof s === 'string')
      : [];
    if (!statuses.length) return [];
    const level = num(at(effect, 'system.condition.value'));
    const max = num(at(effect, 'system.condition.max'));
    return [
      {
        id: statuses[0],
        name: text(effect['name']),
        level: level ?? null,
        max: max ?? null,
      },
    ];
  });
}

function skillList(
  actor: AdapterDocument,
  types: readonly string[]
): Array<Record<string, unknown>> {
  return ofType(actor, types)
    .map(item => ({
      name: text(item['name']),
      type: text(item['type']),
      value: num(at(item, 'system.talentValue.value')) ?? 0,
      check: [1, 2, 3]
        .map(n => text(at(item, `system.characteristic${n}.value`)).toUpperCase())
        .filter(Boolean)
        .join('/'),
      ...(text(at(item, 'system.group.value'))
        ? { group: text(at(item, 'system.group.value')) }
        : {}),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function characterSummary(actor: AdapterDocument): CharacterSummary {
  const system = sys(actor);
  const plain = actor as Data;
  const experience = experienceOf(system);
  const grade = experience.total > 0 ? experienceLevel(experience.total) : null;
  // Module data carries what DSA5 prepared (gear and effects included); stored data is computed.
  const prepared = isPreparedData(actor);
  let computed = !prepared;
  const ready = (path: string, fallback: number): number => {
    const value = prepared ? num(at(system, path)) : null;
    if (value !== null) return value;
    computed = true;
    return fallback;
  };
  const withMax = (entry: EnergyValue | null, path: string): EnergyValue | null =>
    entry ? { ...entry, max: ready(path, entry.max) } : null;
  const life = withMax(lifePoints(plain), 'status.wounds.max');
  const astral = withMax(energy(plain, 'astral'), 'status.astralenergy.max');
  const karma = withMax(energy(plain, 'karma'), 'status.karmaenergy.max');
  const initiative = ready('status.initiative.value', initiativeOf(system));
  const dodge = ready('status.dodge.value', dodgeOf(system));
  const characteristics: Data = {};
  for (const key of CHARACTERISTIC_KEYS) {
    const part = characteristicOf(system, key);
    characteristics[key.toUpperCase()] = {
      value: ready(`characteristics.${key}.value`, part.value),
      initial: part.initial,
      advances: part.advances,
      modifier: part.modifier,
      name: CHARACTERISTIC_NAMES[key],
    };
  }
  const identity = {
    species: speciesOf(actor) || null,
    culture: detail(actor, 'culture') || null,
    profession: detail(actor, 'career') || null,
  };
  const basicInfo: Data = {
    lifePoints: life,
    ...(astral ? { astralEnergy: astral } : {}),
    ...(karma ? { karmaEnergy: karma } : {}),
    experienceLevel: grade ? { level: grade.level, de: grade.de, en: grade.en } : null,
    ...identity,
  };
  const stats: Data = {
    valuesFrom: prepared ? 'prepared' : 'stored',
    ...(computed ? { computedNote: COMPUTED_NOTE } : {}),
    ...(grade
      ? {
          experience: {
            total: experience.total,
            spent: experience.spent,
            available: experience.total - experience.spent,
            level: grade.level,
            name: { de: grade.de, en: grade.en },
          },
        }
      : {}),
    lifePoints: life,
    ...(astral ? { astralEnergy: astral } : {}),
    ...(karma ? { karmaEnergy: karma } : {}),
    fatePoints: num(at(system, 'status.fatePoints.value')),
    characteristics,
    initiative,
    speed: num(at(system, 'status.speed.initial')),
    dodge,
    armor: armorOf(actor),
    identity: {
      ...identity,
      size: text(at(system, 'status.size.value')) || null,
      tradition: {
        magical: text(at(system, 'tradition.magical')) || null,
        clerical: text(at(system, 'tradition.clerical')) || null,
      },
      feature: {
        magical: text(at(system, 'feature.magical')) || null,
        clerical: text(at(system, 'feature.clerical')) || null,
      },
    },
    skills: skillList(actor, ['skill']),
    combatTechniques: ofType(actor, ['combatskill'])
      .map(item => ({ name: text(item['name']), ...combatTechniqueValues(system, item) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    spells: skillList(actor, SPELL_TYPES),
    liturgies: skillList(actor, LITURGY_TYPES),
    conditions: conditionsOf(actor),
  };
  return { basicInfo, stats };
}

export function itemFields(item: AdapterDocument): Record<string, unknown> {
  const system = sys(item);
  const out: Data = {};
  const quantity = num(at(system, 'quantity.value'));
  if (quantity !== null && quantity !== 1) out['quantity'] = quantity;
  if (typeof at(system, 'worn.value') === 'boolean') out['equipped'] = at(system, 'worn.value');
  const value = num(at(system, 'talentValue.value'));
  if (value !== null && ['skill', 'combatskill', ...MAGIC_TYPES].includes(text(item['type'])))
    out['value'] = value;
  return out;
}

// Spells (2.9) --------------------------------------------------------------------------------

function spellInfo(item: Data, resource: 'AsP' | 'KaP'): SpellInfo {
  const system = sys(item);
  const cost = num(at(system, 'AsPCost.value'));
  const time = num(at(system, 'castingTime.value'));
  const feature = text(system['feature']);
  const value = num(at(system, 'talentValue.value'));
  return {
    id: idOf(item),
    name: text(item['name']),
    level: null,
    traits: [
      ...(feature ? [feature] : []),
      ...(value !== null ? [`value ${value}`] : []),
      ...([1, 2, 3].some(n => text(at(system, `characteristic${n}.value`)))
        ? [
            `check ${[1, 2, 3].map(n => text(at(system, `characteristic${n}.value`)).toUpperCase()).join('/')}`,
          ]
        : []),
    ],
    cost:
      [cost !== null ? `${cost} ${resource}` : '', time !== null ? `casting time ${time}` : '']
        .filter(Boolean)
        .join(', ') || null,
    range: text(at(system, 'range.value')) || null,
    target: text(at(system, 'targetCategory.value')) || null,
    area: text(at(system, 'distribution.value')) || null,
  };
}

const byName = (a: SpellInfo, b: SpellInfo) => a.name.localeCompare(b.name);

export function spellcastingEntries(actor: AdapterDocument): SpellcastingEntry[] {
  const plain = actor as Data;
  const astral = energy(plain, 'astral');
  const karma = energy(plain, 'karma');
  const groups: Array<{
    id: string;
    name: string;
    kind: string;
    types: readonly string[];
    resource: 'AsP' | 'KaP';
  }> = [
    { id: 'spells', name: 'Spells', kind: 'arcane', types: ['spell'], resource: 'AsP' },
    { id: 'rituals', name: 'Rituals', kind: 'ritual', types: ['ritual'], resource: 'AsP' },
    { id: 'cantrips', name: 'Cantrips', kind: 'arcane', types: ['magictrick'], resource: 'AsP' },
    {
      id: 'liturgies',
      name: 'Liturgical chants and ceremonies',
      kind: 'divine',
      types: ['liturgy', 'ceremony'],
      resource: 'KaP',
    },
    { id: 'blessings', name: 'Blessings', kind: 'divine', types: ['blessing'], resource: 'KaP' },
  ];
  const system = sys(actor);
  return groups.flatMap(group => {
    const items = ofType(actor, group.types);
    if (!items.length) return [];
    const pool = group.resource === 'AsP' ? astral : karma;
    const branch = group.resource === 'AsP' ? 'magical' : 'clerical';
    return [
      {
        id: group.id,
        name: group.name,
        kind: group.kind,
        tradition: text(at(system, `tradition.${branch}`)) || null,
        ability:
          text(at(system, `guidevalue.${branch}`))
            .toUpperCase()
            .replace('-', '') || null,
        slots: pool ? { [group.resource === 'AsP' ? 'asp' : 'kap']: pool } : {},
        spells: items.map(item => spellInfo(item, group.resource)).sort(byName),
      },
    ];
  });
}

export function matchDetails(item: AdapterDocument): Record<string, unknown> {
  const type = text(item['type']);
  if (MAGIC_TYPES.includes(type)) {
    const info = spellInfo(item as Data, LITURGY_TYPES.includes(type as never) ? 'KaP' : 'AsP');
    return {
      value: num(at(item, 'system.talentValue.value')),
      cost: info.cost,
      range: info.range,
      target: info.target,
      duration: text(at(item, 'system.duration.value')) || null,
      traits: info.traits,
    };
  }
  return itemFields(item);
}

// Conditions (2.12) ------------------------------------------------------------------------------------

/**
 * The effect dsa5 itself creates for a condition (DSA5StatusEffects.createEffect
 * in modules/status/status_effects.js): the entry of CONFIG.statusEffects with
 * its `system.changes`, the status id, and for a condition with levels
 * `system.condition` at level 1, set by hand (manual 1, auto 0).
 */
export function conditionEffectData(condition: ConditionInfo): Record<string, unknown> {
  const own = isRecord(condition['system']) ? structuredClone(condition['system']) : {};
  const levels = isRecord(own['condition']) ? own['condition'] : null;
  const system: Data = { ...own, condition: {} };
  if (levels && num(levels['max']) !== null) {
    const max = num(levels['max']) as number;
    system['condition'] = { ...levels, manual: 1, auto: 0, value: Math.min(1, max) };
  }
  return {
    name: condition.name,
    img: condition.img ?? null,
    description: condition.description ?? '',
    statuses: [condition.id],
    system,
    ...(condition.id === 'dead' ? { flags: { core: { overlay: true } } } : {}),
  };
}

/**
 * The calls that bring a condition with levels to `level` on a dsa5
 * actor, through Foundry's embedded document methods on the condition effect.
 * The level set by hand is `manual`; the value is what the sheet shows.
 * Assumption, as for conditionEffectData: dsa5 reads `system.condition.value`
 * and keeps `auto` for levels its own rules add.
 */
export function conditionLevelPlan(
  condition: ConditionInfo,
  level: number,
  actor: AdapterDocument
): ActorCall[] {
  const effects = Array.isArray(actor['effects']) ? actor['effects'].filter(isRecord) : [];
  const own = effects.filter(
    effect => Array.isArray(effect['statuses']) && effect['statuses'].includes(condition.id)
  );
  if (level <= 0) {
    const ids = own.map(effect => text(effect['_id'])).filter(Boolean);
    return ids.length ? [{ method: 'deleteEmbeddedDocuments', args: ['ActiveEffect', ids] }] : [];
  }
  const effect = own[0];
  if (!effect) {
    const data = conditionEffectData(condition);
    const system = isRecord(data['system']) ? data['system'] : {};
    const levels = isRecord(system['condition']) ? system['condition'] : {};
    return [
      {
        method: 'createEmbeddedDocuments',
        args: [
          'ActiveEffect',
          [
            {
              ...data,
              system: { ...system, condition: { ...levels, manual: level, auto: 0, value: level } },
            },
          ],
        ],
      },
    ];
  }
  if (num(at(effect, 'system.condition.value')) === level) return [];
  const auto = num(at(effect, 'system.condition.auto')) ?? 0;
  return [
    {
      method: 'updateEmbeddedDocuments',
      args: [
        'ActiveEffect',
        [
          {
            _id: text(effect['_id']),
            'system.condition.manual': Math.max(0, level - auto),
            'system.condition.value': level,
          },
        ],
      ],
    },
  ];
}

// Rolls (2.13) --------------------------------------------------------------------------------------------

/** A number modifier from "+2", "-1" or "3"; anything else is refused, never appended to a formula. */
export function parseModifier(modifier: string | undefined): number {
  const raw = (modifier ?? '').trim();
  if (!raw) return 0;
  if (!/^[+-]?\s*\d+$/.test(raw))
    throw new Error(
      `rollModifier must be a whole number such as "+2" or "-1" in DSA5, got "${raw}": a DSA5 check adds the modifier to the target values, not to the dice.`
    );
  return Number(raw.replace(/\s+/g, ''));
}

const signed = (value: number) => (value >= 0 ? `+${value}` : `${value}`);

function characteristicValue(actor: AdapterDocument, key: CharacteristicKey): number {
  const rolled = num(at(actor['rollData'], `characteristics.${key}.value`));
  return rolled ?? characteristicOf(sys(actor), key).value;
}

function namedItem(
  actor: AdapterDocument,
  types: readonly string[],
  target: string,
  what: string
): Data {
  const candidates = ofType(actor, types);
  const found = candidates.filter(item => sameName(item['name'], target));
  if (found.length === 1) return found[0] as Data;
  if (found.length > 1)
    throw new Error(
      `${what} "${target}" is ambiguous: the actor has ${found.length} items of that name.`
    );
  const names = candidates.map(item => `"${text(item['name'])}"`).slice(0, 40);
  throw new Error(
    `rollTarget must be the exact name of one of the actor's ${what.toLowerCase()}s, got "${target}". ` +
      (names.length ? `Available: ${names.join(', ')}.` : `The actor has none.`)
  );
}

/** Attack or parry of a weapon or combat technique by name. */
function weaponValues(
  actor: AdapterDocument,
  target: string
): { name: string; attack: number; parry: number | null } {
  const system = sys(actor);
  const techniques = ofType(actor, ['combatskill']);
  const weapons = ofType(actor, ['meleeweapon', 'rangeweapon']);
  const weapon = weapons.find(item => sameName(item['name'], target));
  if (weapon) {
    const techniqueName = text(at(weapon, 'system.combatskill.value'));
    const technique = techniques.find(item => sameName(item['name'], techniqueName));
    if (!technique)
      throw new Error(
        `The weapon "${text(weapon['name'])}" uses the combat technique "${techniqueName}", which the actor does not have.`
      );
    const base = combatTechniqueValues(system, technique);
    const ranged = weapon['type'] === 'rangeweapon';
    return {
      name: text(weapon['name']),
      attack: base.attack + (ranged ? 0 : (num(at(weapon, 'system.atmod.value')) ?? 0)),
      parry:
        ranged || base.parry === null
          ? null
          : base.parry + (num(at(weapon, 'system.pamod.value')) ?? 0),
    };
  }
  const technique = namedItem(actor, ['combatskill'], target, 'Weapon or combat technique');
  const base = combatTechniqueValues(system, technique);
  return { name: text(technique['name']), attack: base.attack, parry: base.parry };
}

export function rollPlan(request: RollRequest, actor: AdapterDocument | null): RollPlan {
  const type = request.rollType;
  const target = (request.rollTarget ?? '').trim();
  if (type === 'custom') {
    if (!target)
      throw new Error('A custom roll needs its formula in rollTarget, e.g. "1d20" or "3d20".');
    const extra = (request.rollModifier ?? '').trim();
    const formula = !extra
      ? target
      : /^[+-]/.test(extra)
        ? `${target}${extra}`
        : `${target}+${extra}`;
    return { formula, label: 'Custom roll' };
  }
  const modifier = parseModifier(request.rollModifier);
  const withModifier = modifier ? `, modifier ${signed(modifier)} included` : '';
  switch (type) {
    case 'ability': {
      const key = characteristicFor(target);
      if (!key)
        throw new Error(
          `rollTarget must be a characteristic for a DSA5 characteristic check: ${CHARACTERISTIC_KEYS.map(k => k.toUpperCase()).join(', ')} or its German or English name, got "${target}".`
        );
      const label = `${key.toUpperCase()} check`;
      if (!actor) return { formula: '1d20', label };
      const value = characteristicValue(actor, key) + modifier;
      return { formula: '1d20', label: `${label}: 1d20 at most ${value}${withModifier}` };
    }
    case 'skill': {
      if (!target)
        throw new Error(
          'rollTarget must be the name of a skill, spell, ritual, liturgical chant or ceremony.'
        );
      if (!actor) return { formula: '3d20', label: `${target} check` };
      const item = namedItem(
        actor,
        ['skill', 'spell', 'ritual', 'liturgy', 'ceremony'],
        target,
        'Skill'
      );
      const keys = [1, 2, 3].map(n =>
        characteristicFor(text(at(item, `system.characteristic${n}.value`)))
      );
      if (keys.some(key => key === null))
        throw new Error(
          `"${text(item['name'])}" does not name three characteristics to check against.`
        );
      const parts = (keys as CharacteristicKey[]).map(
        key => `${key.toUpperCase()} ${characteristicValue(actor, key) + modifier}`
      );
      const points = num(at(item, 'system.talentValue.value')) ?? 0;
      return {
        formula: '3d20',
        label: `${text(item['name'])} check: 3d20 against ${parts.join(', ')}${withModifier}, ${points} skill points to spend`,
      };
    }
    case 'attack':
    case 'parry': {
      if (!target)
        throw new Error(`rollTarget must name the weapon or combat technique for the ${type}.`);
      if (!actor) return { formula: '1d20', label: `${target} ${type}` };
      const values = weaponValues(actor, target);
      const value = type === 'attack' ? values.attack : values.parry;
      if (value === null)
        throw new Error(`"${values.name}" is a ranged weapon or technique and has no parry.`);
      return {
        formula: '1d20',
        label: `${values.name} ${type}: 1d20 at most ${value + modifier}${withModifier}`,
      };
    }
    case 'dodge': {
      if (!actor) return { formula: '1d20', label: 'Dodge' };
      return {
        formula: '1d20',
        label: `Dodge: 1d20 at most ${dodgeOf(sys(actor)) + modifier}${withModifier}`,
      };
    }
    case 'initiative': {
      const rolled = actor ? num(at(actor['rollData'], 'status.initiative.value')) : null;
      const base = actor ? (rolled ?? initiativeOf(sys(actor))) : 0;
      const total = base + modifier;
      return { formula: total ? `1d6${signed(total)}` : '1d6', label: 'Initiative' };
    }
    default:
      throw new Error(
        `The roll type "${type}" is not a DSA5 roll type: ability, skill, attack, parry, dodge, initiative or custom.`
      );
  }
}

// Actor data (2.14, 2.15) ------------------------------------------------------------------------------------------

function firstOf(source: Data, keys: readonly string[]): unknown {
  for (const key of keys) if (source[key] !== undefined) return source[key];
  return undefined;
}

function ensure(target: Data, path: string): Data {
  let node = target;
  for (const part of path.split('.')) {
    if (!isRecord(node[part])) node[part] = {};
    node = node[part] as Data;
  }
  return node;
}

/** {current|value, max} or a number, as current points; the maximum only for types whose base is stored. */
function energyInto(out: Data, raw: unknown, path: string, actorType: string): void {
  const pool = ensure(out, path);
  const current = isRecord(raw) ? (num(raw['current']) ?? num(raw['value'])) : num(raw);
  const max = isRecord(raw) ? num(raw['max']) : null;
  if (current !== null) pool['value'] = current;
  if (max !== null && actorType === 'creature') pool['initial'] = max;
}

/**
 * Short forms brought into the paths of the dsa5 data model. Derived values
 * are never written: a characteristic given as a number becomes its initial
 * value, not `value`; a maximum of LeP, AsP or KaP is the stored base only for
 * creatures (for heroes and NPCs it is derived from KO and the tradition).
 * Unknown keys stay as given.
 */
export function normalizeActorSystem(
  system: Record<string, unknown>,
  context: { actorType: string; mode: 'create' | 'update' }
): Record<string, unknown> {
  const out: Data = structuredClone(system);
  const rawCharacteristics = firstOf(out, ['characteristics', 'eigenschaften']);
  delete out['eigenschaften'];
  if (isRecord(rawCharacteristics)) {
    const characteristics: Data = {};
    for (const [key, value] of Object.entries(rawCharacteristics)) {
      const known = characteristicFor(key);
      const name = known ?? key;
      if (typeof value === 'number' || (typeof value === 'string' && num(value) !== null)) {
        characteristics[name] = { initial: num(value) };
      } else if (isRecord(value)) {
        const entry: Data = { ...value };
        const given = num(entry['value']);
        delete entry['value'];
        if (given !== null && num(entry['initial']) === null)
          entry['initial'] = given - (num(entry['advances']) ?? 0) - (num(entry['modifier']) ?? 0);
        characteristics[name] = entry;
      } else characteristics[name] = value;
    }
    out['characteristics'] = characteristics;
  }

  const status = isRecord(out['status']) ? out['status'] : null;
  const life = firstOf(out, ['lifePoints', 'lep', 'LeP', 'wounds']) ?? status?.['lifePoints'];
  if (life !== undefined) {
    delete out['lifePoints'];
    delete out['lep'];
    delete out['LeP'];
    if (!isRecord(out['wounds'])) delete out['wounds'];
    else delete out['wounds'];
    if (status) delete status['lifePoints'];
    energyInto(out, life, 'status.wounds', context.actorType);
  }
  const pools: Array<[readonly string[], string]> = [
    [['astralEnergy', 'astralenergy', 'asp', 'AsP'], 'status.astralenergy'],
    [['karmaEnergy', 'karmaenergy', 'kap', 'KaP'], 'status.karmaenergy'],
  ];
  for (const [keys, path] of pools) {
    const raw =
      firstOf(out, keys) ??
      (status
        ? firstOf(
            status,
            keys.filter(k => k !== path.split('.')[1])
          )
        : undefined);
    if (raw === undefined) continue;
    for (const key of keys) {
      delete out[key];
      if (status && key !== path.split('.')[1]) delete status[key];
    }
    energyInto(out, raw, path, context.actorType);
  }
  const fate = firstOf(out, ['fatePoints', 'schicksalspunkte']);
  if (fate !== undefined) {
    delete out['fatePoints'];
    delete out['schicksalspunkte'];
    const value = isRecord(fate) ? (num(fate['value']) ?? num(fate['current'])) : num(fate);
    if (value !== null) ensure(out, 'status.fatePoints')['value'] = value;
  }

  const details: Array<[readonly string[], string]> = [
    [['species'], 'species'],
    [['culture'], 'culture'],
    [['profession', 'career'], 'career'],
    [['socialstate', 'socialStatus'], 'socialstate'],
  ];
  const identity = isRecord(out['identity']) ? out['identity'] : {};
  for (const [keys, field] of details) {
    const raw = firstOf(out, keys) ?? firstOf(identity, keys);
    if (raw === undefined) continue;
    for (const key of keys) {
      delete out[key];
      delete identity[key];
    }
    const value = isRecord(raw) ? raw['value'] : raw;
    ensure(out, `details.${field}`)['value'] =
      field === 'socialstate' ? (num(value) ?? value) : value;
  }
  if (isRecord(out['identity']) && !Object.keys(out['identity']).length) delete out['identity'];
  if (isRecord(out['experience'])) {
    const experience = ensure(out, 'details.experience');
    for (const key of ['total', 'spent']) {
      const value = num(out['experience'][key]);
      if (value !== null) experience[key] = value;
    }
    delete out['experience'];
  }

  const speed = out['speed'];
  if (speed !== undefined) {
    delete out['speed'];
    const value = isRecord(speed) ? num(speed['value']) : num(speed);
    if (value !== null) ensure(out, 'status.speed')['initial'] = value;
  }
  const armor = firstOf(out, ['armour', 'armor']);
  if (armor !== undefined) {
    delete out['armour'];
    delete out['armor'];
    const value = isRecord(armor) ? num(armor['value']) : num(armor);
    if (value !== null) out['totalArmor'] = value;
  }
  if (typeof out['size'] === 'string') {
    const size = SIZE_KEYS[out['size'].toLowerCase()] ?? out['size'];
    delete out['size'];
    ensure(out, 'status.size')['value'] = size;
  }
  return out;
}

export const SCHEMA_NOTES = [
  'Das Schwarze Auge 5 (dsa5 8.x) actor data:',
  '- Types: character (hero), npc, creature; also group and vehicle. Heroes from archetypes: list-dsa5-archetypes, create-dsa5-character-from-archetype.',
  '- characteristics.<mu|kl|in|ch|ff|ge|ko|kk>.initial, .advances, .modifier. The value is derived (initial + advances + modifier); a number or {value} is accepted and stored as initial.',
  '- status.wounds.value is the current life energy (LeP). The maximum is derived: heroes and NPCs initial + 2 x KO + advances + modifier, creatures initial + advances + modifier. "lifePoints" is accepted; a maximum is only stored for creatures.',
  '- status.astralenergy.value and status.karmaenergy.value (AsP, KaP), with the tradition in tradition.magical / tradition.clerical and the guide characteristic in guidevalue.magical / guidevalue.clerical. "astralEnergy", "asp", "karmaEnergy", "kap" are accepted.',
  '- status.fatePoints.value, status.speed.initial, status.size.value (tiny, small, average, big, giant), totalArmor. Dodge and initiative are derived.',
  '- details.species.value, details.culture.value, details.career.value (the profession; "profession" is accepted), details.socialstate.value (0 to 5), details.experience.total and .spent (adventure points), details.age.value, gender, haircolor, eyecolor, height, weight, biography.value.',
  '- creature: creatureClass.value, behaviour.value, specialRules.value, description.value.',
  '- Items: skill, combatskill, spell, liturgy, ceremony, ritual, magictrick, blessing, meleeweapon, rangeweapon, armor, equipment, advantage, disadvantage, specialability, trait, species, culture, career. Skills carry system.talentValue.value and characteristic1 to 3.',
].join('\n');

// World items (2.16) ---------------------------------------------------------------------------------------------------

const keysOf = (value: unknown): string[] =>
  value instanceof Set ? [...value].map(String) : isRecord(value) ? Object.keys(value) : [];

export function itemEnums(config: unknown): Record<string, Record<string, readonly string[]>> {
  const dsa = isRecord(config) ? config['DSA5'] : undefined;
  if (!isRecord(dsa))
    throw new Error('CONFIG.DSA5 is not available; the dsa5 system seems not to be loaded');
  return {
    skill: {
      'system.group.value': keysOf(dsa['skillGroups']),
      'system.characteristic1.value': keysOf(dsa['characteristics']),
      'system.StF.value': keysOf(dsa['StFs']),
    },
    combatskill: { 'system.guidevalue.value': keysOf(dsa['combatskillsGuidevalues']) },
    meleeweapon: { 'system.reach.value': keysOf(dsa['meleeRanges']) },
    rangeweapon: { 'system.ammunitiongroup.value': keysOf(dsa['ammunitiongroups']) },
    equipment: { 'system.equipmentType.value': keysOf(dsa['equipmentTypes']) },
    spell: { 'system.resistanceModifier.value': keysOf(dsa['magicResistanceModifiers']) },
  };
}

// The adapter ---------------------------------------------------------------------------------------------------------------

export const dsa5Adapter: SystemAdapter = {
  id: 'dsa5',
  title: 'Das Schwarze Auge 5',
  creatures: {
    indexVersion: 1,
    actorTypes: ['character', 'npc', 'creature'],
    invalidatingTypes: ['character', 'npc', 'creature'],
    copyableTypes: ['character', 'npc', 'creature'],
    row: creatureRow,
    power: { name: 'Experience level', field: 'level', range: { min: 1, max: 7 } },
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
  characters: { summary: characterSummary, itemFields },
  spells: { itemTypes: MAGIC_TYPES, entries: spellcastingEntries },
  characterSearch: {
    itemTypes: {
      spells: MAGIC_TYPES,
      equipment: EQUIPMENT_TYPES,
      features: FEATURE_TYPES,
      actions: [],
    },
    categories: {
      equipped: {
        description: 'weapons, armor and equipment that are worn',
        matches: item => at(item, 'system.worn.value') === true,
      },
      arcane: {
        description: 'spells, rituals and cantrips',
        matches: item => (SPELL_TYPES as readonly string[]).includes(text(item['type'])),
      },
      divine: {
        description: 'liturgical chants, ceremonies and blessings',
        matches: item => (LITURGY_TYPES as readonly string[]).includes(text(item['type'])),
      },
    },
    matchDetails,
  },
  itemUse: {
    // A check or a spell opens the system's own roll dialog; anything else is posted to the chat.
    plan: item => {
      const type = text(item['type']);
      const checked = ['skill', 'combatskill', 'meleeweapon', 'rangeweapon', ...MAGIC_TYPES];
      return checked.includes(type)
        ? { method: 'setupEffect', options: {} }
        : { method: 'postItem', options: {} };
    },
  },
  conditions: {
    effectData: conditionEffectData,
    matchesEffect: (effect, condition) =>
      Array.isArray(effect['statuses']) && effect['statuses'].includes(condition.id),
    // The levels live on the condition effect, as get-character already reads them.
    activeOn: actor =>
      conditionsOf(actor).map(entry => ({
        id: text(entry['id']),
        level: typeof entry['level'] === 'number' ? entry['level'] : null,
      })),
    levels: condition => {
      const max = num(at(condition, 'system.condition.max'));
      return max === null || max === undefined ? null : { max };
    },
    levelPlan: conditionLevelPlan,
  },
  rolls: {
    types: [
      {
        id: 'ability',
        description: 'characteristic check: 1d20 at most the characteristic value',
        targets: CHARACTERISTIC_KEYS.map(key => key.toUpperCase()),
      },
      {
        id: 'skill',
        description:
          'skill, spell, ritual, liturgical chant or ceremony check: 3d20 against its three characteristics, the skill points make up for the excess; rollTarget is the item name',
      },
      {
        id: 'attack',
        description:
          '1d20 at most the attack value of the weapon or combat technique named in rollTarget',
      },
      {
        id: 'parry',
        description:
          '1d20 at most the parry value of the melee weapon or combat technique named in rollTarget',
      },
      { id: 'dodge', description: '1d20 at most the dodge value' },
      { id: 'initiative', description: '1d6 plus the initiative base' },
      { id: 'custom', description: 'the formula in rollTarget' },
    ],
    plan: rollPlan,
  },
  actorData: { normalize: normalizeActorSystem, schemaNotes: () => SCHEMA_NOTES },
  worldItems: {
    enums: itemEnums,
    note: () =>
      'DSA5 stores most choices as keys of CONFIG.DSA5; a value outside these lists is kept but no rule of the system uses it.',
  },
  compendiums: {
    defaults: { Item: [...SYSTEM_PACKS.skills] },
    priority: packId => (packId.startsWith('dsa5.') ? 2 : packId.startsWith('dsa5-') ? 1 : 0),
  },
  tools: DSA5_TOOLS,
};
