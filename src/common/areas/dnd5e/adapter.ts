/**
 * The D&D 5e adapter: everything the system neutral packages ask about dnd5e,
 * answered from plain data.
 *
 * It reads plain data, never Foundry documents. Data from the module carries
 * the values dnd5e prepared (`preparedData`, src/module/prepared-data.ts);
 * those are read first. Without them, derived values (ability modifiers,
 * proficiency bonus, skill totals) are computed here from the stored values by
 * the rules, and named as computed where a reader could take them for what
 * dnd5e shows after active effects.
 *
 * Paths follow dnd5e 5.3 (Foundry 14): `attributes.spell.level` for NPC
 * casters, `senses.ranges`, `resources.legact.max`, spells with `method`
 * and `prepared`. Older and newer places are read as well where they differ.
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
import { SEARCH_FILTERS, estimateEntry } from './compendium-estimate.js';
import {
  ABILITY_KEYS,
  CREATURE_TYPE_KEYS,
  SIZE_KEYS,
  SKILLS,
  STANDARD_PACKS,
  abilityMod,
  at,
  crValue,
  formatCr,
  isRecord,
  num,
  parseCr,
  proficiencyFor,
  read,
  sizeWord,
  skillFor,
  type Data,
} from './rules.js';

export const DND5E_TOOLS = [
  'dnd5e-create-npc',
  'dnd5e-add-feature',
  'dnd5e-add-features-from-compendium',
] as const;

const sys = (document: AdapterDocument): Data =>
  isRecord(document['system']) ? document['system'] : {};
const itemsOf = (actor: AdapterDocument): Data[] =>
  Array.isArray(actor['items']) ? actor['items'].filter(isRecord) : [];
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const idOf = (document: Data): string => text(document['_id']) || text(document['id']);

function classesOf(actor: AdapterDocument): Data[] {
  return itemsOf(actor).filter(item => item['type'] === 'class');
}

function totalLevel(actor: AdapterDocument): number | null {
  const classes = classesOf(actor);
  if (!classes.length) return null;
  return classes.reduce((sum, item) => sum + (num(at(item, 'system.levels')) ?? 0), 0);
}

/** Level for characters, challenge rating for NPCs, as dnd5e takes it for the proficiency bonus. */
function proficiencyOf(actor: AdapterDocument): number {
  const level = totalLevel(actor) ?? num(at(actor, 'system.details.level')) ?? 0;
  const cr = crValue(at(actor, 'system.details.cr')) ?? 0;
  return proficiencyFor(Math.max(level, cr, 1));
}

function creatureType(system: Data): string {
  const type = at(system, 'details.type');
  const value = isRecord(type) ? text(type['value']) : text(type);
  if (value === 'custom' && isRecord(type)) return text(type['custom']).toLowerCase() || 'custom';
  return value.toLowerCase() || 'unknown';
}

/** A flat or natural armor class is stored; every other calculation is derived and not in the data. */
function armorClass(system: Data): number | null {
  const ac = at(system, 'attributes.ac');
  if (!isRecord(ac)) return null;
  if (typeof ac['value'] === 'number') return ac['value'];
  return ['flat', 'natural'].includes(text(ac['calc'])) ? num(ac['flat']) : null;
}

function spellLevelOf(system: Data): number {
  return num(at(system, 'attributes.spell.level')) ?? num(at(system, 'details.spellLevel')) ?? 0;
}

// Creature index (2.2 to 2.6) ---------------------------------------------------------------

/** The dnd5e fields of one creature. Absent values get the standard values. */
export function creatureRow(document: AdapterDocument): Record<string, unknown> {
  const system = sys(document);
  const hp = at(system, 'attributes.hp');
  const spells = itemsOf(document).filter(item => item['type'] === 'spell').length;
  const legendary = num(at(system, 'resources.legact.max')) ?? 0;
  const resistances = num(at(system, 'resources.legres.max')) ?? 0;
  return {
    challengeRating: crValue(at(system, 'details.cr')) ?? 0,
    creatureType: creatureType(system),
    size: sizeWord(at(system, 'traits.size')) ?? 'medium',
    hitPoints: (isRecord(hp) ? (num(hp['max']) ?? num(hp['value'])) : null) ?? 0,
    armorClass: armorClass(system),
    alignment: text(at(system, 'details.alignment')).toLowerCase() || 'unaligned',
    // Values above 0 only: dnd5e keeps these fields at 0 on every NPC.
    hasSpells: spellLevelOf(system) > 0 || spells > 0,
    hasLegendaryActions: legendary > 0 || resistances > 0,
    legendaryActions: legendary,
    level: totalLevel(document),
  };
}

export const CREATURE_FILTERS: readonly CreatureFilterSpec[] = [
  {
    name: 'challengeRating',
    kind: 'numberOrRange',
    field: 'challengeRating',
    defaults: { min: 0, max: 30 },
  },
  { name: 'creatureType', kind: 'text', field: 'creatureType', values: CREATURE_TYPE_KEYS },
  { name: 'size', kind: 'text', field: 'size', values: Object.keys(SIZE_KEYS) },
  { name: 'alignment', kind: 'partialText', field: 'alignment' },
  { name: 'hasSpells', kind: 'boolean', field: 'hasSpells' },
  { name: 'hasLegendaryActions', kind: 'boolean', field: 'hasLegendaryActions' },
];

export function creatureListFields(row: CreatureRow): Record<string, unknown> {
  return {
    challengeRating: row['challengeRating'],
    creatureType: row['creatureType'],
    size: row['size'],
    hitPoints: row['hitPoints'],
    armorClass: row['armorClass'],
    alignment: row['alignment'],
    hasSpells: row['hasSpells'],
    hasLegendaryActions: row['hasLegendaryActions'],
  };
}

export function creatureSummary(row: CreatureRow): string {
  return `CR ${formatCr(row['challengeRating'])} ${String(row['creatureType'] ?? 'unknown')} from ${row.packLabel}`;
}

/** Index fields to request, and the key values read from an index row or full data. */
export const INDEX_FIELDS = [
  'system.details.cr',
  'system.details.type',
  'system.details.alignment',
  'system.attributes.hp',
  'system.attributes.ac',
  'system.traits.size',
  'system.resources.legact',
];

export function actorStats(entry: AdapterDocument): Record<string, unknown> | null {
  const cr = read(entry, 'system.details.cr');
  if (cr === undefined && read(entry, 'system.attributes.hp') === undefined) return null;
  const hp = read(entry, 'system.attributes.hp');
  const type = read(entry, 'system.details.type');
  const ac = read(entry, 'system.attributes.ac');
  return {
    challengeRating: crValue(cr),
    creatureType: creatureType({ details: { type } }),
    hitPoints: isRecord(hp) ? { value: num(hp['value']), max: num(hp['max']) } : null,
    armorClass: armorClass({ attributes: { ac } }),
    size: sizeWord(read(entry, 'system.traits.size')),
    alignment: text(read(entry, 'system.details.alignment')) || null,
  };
}

// Characters (2.8) ---------------------------------------------------------------------------------

/** Counts the derived values that had to be computed because the data did not hold them. */
interface Derivation {
  prepared: boolean;
  computed: number;
}

/** A value Foundry prepared (module data only), else the computed one, counted. */
function derivedValue(derivation: Derivation | null, ready: unknown, computed: number): number {
  const value = derivation?.prepared ? num(ready) : null;
  if (value !== null) return value;
  if (derivation) derivation.computed += 1;
  return computed;
}

function abilitiesOf(
  system: Data,
  proficiency: number,
  derivation: Derivation | null = null
): Data {
  const out: Data = {};
  for (const key of ABILITY_KEYS) {
    const entry = at(system, `abilities.${key}`);
    const value = isRecord(entry) ? (num(entry['value']) ?? 10) : 10;
    const saveProficient = isRecord(entry) && (num(entry['proficient']) ?? 0) > 0;
    const mod = derivedValue(derivation, at(entry, 'mod'), abilityMod(value));
    // dnd5e 5.x prepares the save as an object with `value` (attributes.mjs).
    const save = at(entry, 'save');
    out[key] = {
      value,
      mod,
      saveProficient,
      save: derivedValue(
        derivation,
        isRecord(save) ? save['value'] : save,
        mod + (saveProficient ? proficiency : 0)
      ),
    };
  }
  return out;
}

function skillsOf(
  system: Data,
  abilities: Data,
  proficiency: number,
  derivation: Derivation | null = null
): Data {
  const out: Data = {};
  for (const [name, skill] of Object.entries(SKILLS)) {
    const entry = at(system, `skills.${skill.key}`);
    const level = isRecord(entry) ? (num(entry['value']) ?? 0) : 0;
    const ability = (isRecord(entry) && text(entry['ability'])) || skill.ability;
    const mod = (at(abilities, `${ability}.mod`) as number | undefined) ?? 0;
    out[skill.key] = {
      name,
      ability,
      proficiency: level,
      total: derivedValue(derivation, at(entry, 'total'), mod + Math.floor(level * proficiency)),
    };
  }
  return out;
}

const PREPARED_NOTE =
  'Values come from the data Foundry prepared for this actor, active effects and items included.';
const STORED_NOTE =
  'Modifiers, saves and skill totals are computed from the stored scores by the rules; active effects and items are not included.';

export function characterSummary(actor: AdapterDocument): CharacterSummary {
  const system = sys(actor);
  const npc = actor['type'] === 'npc';
  const derivation: Derivation = { prepared: isPreparedData(actor), computed: 0 };
  const proficiency = derivedValue(derivation, at(system, 'attributes.prof'), proficiencyOf(actor));
  const hp = at(system, 'attributes.hp');
  const hitPoints = isRecord(hp)
    ? { value: num(hp['value']), max: num(hp['max']), temp: num(hp['temp']) ?? 0 }
    : null;
  const items = itemsOf(actor);
  const race = items.find(item => item['type'] === 'race');
  const background = items.find(item => item['type'] === 'background');
  // A subclass is an item of its own that names its class by `classIdentifier`.
  const subclasses = items.filter(item => item['type'] === 'subclass');
  const classes = classesOf(actor).map(item => {
    const identifier = text(at(item, 'system.identifier')) || text(item['name']).toLowerCase();
    const subclass = subclasses.find(sub => text(at(sub, 'system.classIdentifier')) === identifier);
    return {
      name: text(item['name']),
      levels: num(at(item, 'system.levels')) ?? 0,
      subclass: subclass ? text(subclass['name']) : null,
    };
  });
  const level = derivation.prepared
    ? (num(at(system, 'details.level')) ?? totalLevel(actor))
    : totalLevel(actor);
  const cr = crValue(at(system, 'details.cr'));
  const abilities = abilitiesOf(system, proficiency, derivation);
  const skills = skillsOf(system, abilities, proficiency, derivation);
  const basicInfo: Data = {
    hitPoints,
    armorClass: armorClass(system),
    armorClassCalculation: text(at(system, 'attributes.ac.calc')) || 'default',
    level,
    classes,
    race: race ? text(race['name']) : text(at(system, 'details.race')) || null,
    background: background ? text(background['name']) : null,
    ...(npc ? { challengeRating: formatCr(cr) } : {}),
  };
  const stats: Data = {
    challengeRating: npc ? cr : null,
    level,
    hitPoints,
    armorClass: armorClass(system),
    proficiencyBonus: proficiency,
    valuesFrom: derivation.prepared ? 'prepared' : 'stored',
    ...(!derivation.prepared
      ? { computedNote: STORED_NOTE }
      : derivation.computed > 0
        ? {
            computedNote: `${PREPARED_NOTE} ${derivation.computed} derived value(s) were missing there and are computed from the stored scores by the rules.`,
          }
        : {}),
    abilities,
    skills,
    spellcasting: {
      ability: text(at(system, 'attributes.spellcasting')) || null,
      casterLevel: spellLevelOf(system) || null,
      hasSpells: items.some(item => item['type'] === 'spell'),
    },
  };
  if (npc) {
    stats['creatureType'] = creatureType(system);
    stats['size'] = sizeWord(at(system, 'traits.size'));
    stats['alignment'] = text(at(system, 'details.alignment')) || null;
    const legact = at(system, 'resources.legact');
    const max = isRecord(legact) ? (num(legact['max']) ?? 0) : 0;
    const spent = isRecord(legact) ? (num(legact['spent']) ?? 0) : 0;
    stats['legendaryActions'] =
      max > 0 ? { max, spent, available: Math.max(max - spent, 0) } : null;
  }
  return { basicInfo, stats };
}

export function itemFields(item: AdapterDocument): Record<string, unknown> {
  const system = sys(item);
  const out: Data = {};
  const quantity = num(system['quantity']);
  if (quantity !== null && quantity !== 1) out['quantity'] = quantity;
  if (typeof system['equipped'] === 'boolean') out['equipped'] = system['equipped'];
  if (text(system['attunement']))
    out['attunement'] = { required: system['attunement'], attuned: system['attuned'] === true };
  if (item['type'] === 'spell') out['level'] = num(system['level']);
  return out;
}

export function actionsOf(actor: AdapterDocument): Array<Record<string, unknown>> {
  return itemsOf(actor).flatMap(item => {
    const activities = at(item, 'system.activities');
    if (!isRecord(activities)) return [];
    return Object.values(activities)
      .filter(isRecord)
      .map(activity => ({
        name: text(activity['name'])
          ? `${text(item['name'])}: ${text(activity['name'])}`
          : text(item['name']),
        type: text(activity['type']),
        activation: text(at(activity, 'activation.type')) || null,
        itemId: idOf(item),
        activityId: idOf(activity),
      }));
  });
}

// Spells (2.9) --------------------------------------------------------------------------------------

function rangeText(system: Data): string | null {
  const range = system['range'];
  if (!isRecord(range)) return null;
  const units = text(range['units']);
  if (units === 'self') return 'Self';
  if (units === 'touch') return 'Touch';
  if (text(range['special'])) return text(range['special']);
  const value = num(range['value']);
  return value !== null && units ? `${value} ${units}` : units || null;
}

function targetText(system: Data): string | null {
  const affects = at(system, 'target.affects');
  if (isRecord(affects) && text(affects['type'])) {
    const count = num(affects['count']);
    const type = text(affects['type']);
    if (type === 'self') return 'self';
    return count ? `${count} ${type}${count === 1 ? '' : 's'}` : type;
  }
  return isRecord(at(system, 'target.template')) && text(at(system, 'target.template.type'))
    ? 'area'
    : null;
}

function areaText(system: Data): string | null {
  const template = at(system, 'target.template');
  if (!isRecord(template) || !text(template['type'])) return null;
  return `${text(template['size'])}-${text(template['units']) || 'ft'} ${text(template['type'])}`;
}

function activationText(system: Data): string | null {
  const activation = system['activation'];
  if (!isRecord(activation) || !text(activation['type'])) return null;
  const value = num(activation['value']);
  return value && value !== 1 ? `${value} ${text(activation['type'])}` : text(activation['type']);
}

/** Always ready without preparing: cantrips and spells of these methods. */
const READY_METHODS = ['atwill', 'innate', 'pact', 'ritual', 'always'];

function isPrepared(system: Data): boolean {
  const method = text(system['method']) || text(at(system, 'preparation.mode'));
  const prepared = system['prepared'] ?? at(system, 'preparation.prepared');
  return (
    (num(system['level']) ?? 0) === 0 ||
    READY_METHODS.includes(method) ||
    prepared === true ||
    (num(prepared) ?? 0) > 0
  );
}

function spellInfo(item: Data): SpellInfo {
  const system = sys(item);
  return {
    id: idOf(item),
    name: text(item['name']),
    level: num(system['level']),
    prepared: isPrepared(system),
    cost: activationText(system),
    range: rangeText(system),
    target: targetText(system),
    area: areaText(system),
  };
}

/** Which class a spell belongs to: `sourceItem` of 5.3 ("class:wizard") or the older `sourceClass`. */
function classIdentifierOf(spell: Data): string {
  const sourceItem = text(at(spell, 'system.sourceItem'));
  if (sourceItem) return sourceItem.replace(/^class:/, '');
  return text(at(spell, 'system.sourceClass'));
}

function slotsOf(system: Data, pact: boolean): NonNullable<SpellcastingEntry['slots']> {
  const spells = system['spells'];
  if (!isRecord(spells)) return {};
  const keys = pact ? ['pact'] : Array.from({ length: 9 }, (_, i) => `spell${i + 1}`);
  const out: NonNullable<SpellcastingEntry['slots']> = {};
  for (const key of keys) {
    const slot = spells[key];
    if (!isRecord(slot)) continue;
    const value = num(slot['value']) ?? 0;
    const override = num(slot['override']);
    // Stored data has no derived maximum; the override is the maximum when set.
    const max = override ?? num(slot['max']) ?? value;
    if (value > 0 || max > 0) out[key.replace('spell', 'level')] = { value, max };
  }
  return out;
}

const bySpellLevel = (a: SpellInfo, b: SpellInfo) =>
  (a.level ?? 0) - (b.level ?? 0) || a.name.localeCompare(b.name);

export function spellcastingEntries(actor: AdapterDocument): SpellcastingEntry[] {
  const system = sys(actor);
  const spells = itemsOf(actor).filter(item => item['type'] === 'spell');
  const casters = classesOf(actor).filter(item => {
    const progression = text(at(item, 'system.spellcasting.progression'));
    return progression && progression !== 'none';
  });
  const entries: SpellcastingEntry[] = [];
  const claimed = new Set<Data>();
  for (const cls of casters) {
    const identifier = text(at(cls, 'system.identifier')) || text(cls['name']).toLowerCase();
    const own = spells.filter(spell => classIdentifierOf(spell) === identifier);
    own.forEach(spell => claimed.add(spell));
    const progression = text(at(cls, 'system.spellcasting.progression'));
    entries.push({
      id: idOf(cls),
      name: `${text(cls['name'])} Spellcasting`,
      kind: progression === 'pact' ? 'pact' : progression,
      ability: text(at(cls, 'system.spellcasting.ability')) || null,
      slots: slotsOf(system, progression === 'pact'),
      spells: own.map(spellInfo).sort(bySpellLevel),
    });
  }
  // Spells without a class, or every spell when there is no caster class.
  const rest = spells.filter(spell => !claimed.has(spell));
  if (rest.length || (!casters.length && spellLevelOf(system) > 0)) {
    entries.push({
      id: 'spellcasting',
      name: casters.length ? 'Other Spellcasting' : 'Spellcasting',
      kind: casters.length ? 'unassigned' : 'innate or npc',
      ability: text(at(system, 'attributes.spellcasting')) || null,
      slots: casters.length ? {} : { ...slotsOf(system, false), ...slotsOf(system, true) },
      spells: rest.map(spellInfo).sort(bySpellLevel),
    });
  }
  return entries;
}

// Search inside a character (2.10) ------------------------------------------------------------------------

export function matchDetails(item: AdapterDocument): Record<string, unknown> {
  const system = sys(item);
  if (item['type'] === 'spell') {
    return {
      level: num(system['level']),
      prepared: isPrepared(system),
      range: rangeText(system),
      target: targetText(system),
      area: areaText(system),
      activation: activationText(system),
    };
  }
  const out: Data = { ...itemFields(item) };
  const activation = activationText(system);
  if (activation) out['activation'] = activation;
  const range = rangeText(system);
  if (range) out['range'] = range;
  return out;
}

// Rolls (2.13) ------------------------------------------------------------------------------------------------

function join(base: string, bonus: number, modifier?: string): string {
  let formula = bonus ? `${base}${bonus > 0 ? '+' : ''}${bonus}` : base;
  const extra = (modifier ?? '').trim();
  if (extra) formula += /^[+-]/.test(extra) ? extra : `+${extra}`;
  return formula;
}

function abilityKeyFor(target: string | undefined): string | null {
  const wanted = (target ?? '').trim().toLowerCase();
  const names: Record<string, string> = {
    strength: 'str',
    dexterity: 'dex',
    constitution: 'con',
    intelligence: 'int',
    wisdom: 'wis',
    charisma: 'cha',
  };
  if ((ABILITY_KEYS as readonly string[]).includes(wanted)) return wanted;
  return names[wanted] ?? null;
}

/** Roll data from the actor (getRollData, derived) when the module sent it, else computed from stored scores. */
function rolled(actor: AdapterDocument, path: string): number | null {
  return num(at(actor['rollData'], path));
}

export function rollPlan(
  request: { rollType: string; rollTarget?: string; rollModifier?: string },
  actor: AdapterDocument | null
): { formula: string; label: string } {
  const type = request.rollType;
  const target = request.rollTarget;
  if (type === 'custom') {
    const formula = (target ?? '').trim();
    if (!formula) throw new Error('A custom roll needs its formula in rollTarget, e.g. "2d6+3".');
    return { formula: join(formula, 0, request.rollModifier), label: 'Custom roll' };
  }
  const system = actor ? sys(actor) : {};
  const proficiency = actor ? (rolled(actor, 'attributes.prof') ?? proficiencyOf(actor)) : 0;
  const abilities = abilitiesOf(system, proficiency);
  const mod = (key: string) =>
    (actor && rolled(actor, `abilities.${key}.mod`)) ??
    (at(abilities, `${key}.mod`) as number | undefined) ??
    0;

  switch (type) {
    case 'ability':
    case 'save': {
      const key = abilityKeyFor(target);
      if (!key)
        throw new Error(
          `rollTarget must be an ability for a ${type} roll: ${ABILITY_KEYS.join(', ')} or its English name, got "${target ?? ''}".`
        );
      if (!actor)
        return {
          formula: join('1d20', 0, request.rollModifier),
          label: `${key.toUpperCase()} ${type === 'save' ? 'save' : 'check'}`,
        };
      // dnd5e 5.x prepares the save as an object with `value` (attributes.mjs); older data has a number.
      const savedSave = at(actor['rollData'], `abilities.${key}.save`);
      const rolledSave = num(isRecord(savedSave) ? savedSave['value'] : savedSave);
      const bonus =
        type === 'save'
          ? (rolledSave ?? (at(abilities, `${key}.saveProficient`) ? proficiency : 0) + mod(key))
          : mod(key);
      return {
        formula: join('1d20', bonus, request.rollModifier),
        label: `${key.toUpperCase()} ${type === 'save' ? 'saving throw' : 'check'}`,
      };
    }
    case 'skill': {
      const skill = skillFor(target ?? '');
      if (!skill)
        throw new Error(
          `rollTarget must be one of the 18 skills (e.g. "Stealth", "Sleight of Hand" or "ste"), got "${target ?? ''}".`
        );
      const label = `${skill.name.replace(/\b\w/g, l => l.toUpperCase())} check`;
      if (!actor) return { formula: join('1d20', 0, request.rollModifier), label };
      const total =
        rolled(actor, `skills.${skill.key}.total`) ??
        (at(skillsOf(system, abilities, proficiency), `${skill.key}.total`) as
          number | undefined) ??
        0;
      return { formula: join('1d20', total, request.rollModifier), label };
    }
    case 'initiative': {
      const bonus = actor
        ? (rolled(actor, 'attributes.init.total') ??
          mod('dex') + (num(at(system, 'attributes.init.bonus')) ?? 0))
        : 0;
      return { formula: join('1d20', bonus, request.rollModifier), label: 'Initiative' };
    }
    case 'attack': {
      if (!actor) return { formula: join('1d20', 0, request.rollModifier), label: 'Attack' };
      const weapon = namedWeapon(actor, target, 'An attack roll');
      const attack = attackActivity(weapon);
      const ability = weaponAbility(weapon, attack, mod);
      const proficient = num(at(weapon, 'system.proficient')) !== 0 ? proficiency : 0;
      const bonus =
        mod(ability) +
        proficient +
        (num(at(attack, 'attack.bonus')) ?? 0) +
        (num(at(weapon, 'system.magicalBonus')) ?? 0);
      return {
        formula: join('1d20', bonus, request.rollModifier),
        label: `${text(weapon['name'])} attack`,
      };
    }
    case 'damage': {
      // The base damage of the named weapon, with the modifier of the
      // ability its attack uses and its magical bonus, as dnd5e adds both to weapon damage.
      if (!actor)
        throw new Error(
          'A damage roll needs an actor, because the formula comes from the weapon named in rollTarget.'
        );
      const weapon = namedWeapon(actor, target, 'A damage roll');
      const name = text(weapon['name']);
      const base = at(weapon, 'system.damage.base');
      const custom = at(base, 'custom');
      let dice = '';
      if (isRecord(custom) && custom['enabled'] === true) dice = text(custom['formula']).trim();
      if (!dice) {
        const count = num(at(base, 'number'));
        const faces = num(at(base, 'denomination'));
        if (!count || !faces)
          throw new Error(
            `"${name}" has no base damage in system.damage.base (number and denomination), so no damage formula can be built.`
          );
        dice = `${count}d${faces}`;
      }
      const extra = text(at(base, 'bonus')).trim();
      if (extra) dice = /^[+-]/.test(extra) ? `${dice}${extra}` : `${dice}+${extra}`;
      const flat =
        mod(weaponAbility(weapon, attackActivity(weapon), mod)) +
        (num(at(weapon, 'system.magicalBonus')) ?? 0);
      return { formula: join(dice, flat, request.rollModifier), label: `${name} damage` };
    }
    default:
      throw new Error(
        `The roll type "${type}" is not a D&D 5e roll type: ability, skill, save, attack, damage, initiative or custom.`
      );
  }
}

/** The weapon of the actor with exactly this name, ignoring case, or an error that lists the weapons. */
function namedWeapon(actor: AdapterDocument, target: string | undefined, roll: string): Data {
  const weapons = itemsOf(actor).filter(item => item['type'] === 'weapon');
  const wanted = (target ?? '').trim().toLowerCase();
  const weapon = weapons.find(item => text(item['name']).toLowerCase() === wanted);
  if (!weapon) {
    throw new Error(
      `${roll} needs the exact name of one of the actor's weapons in rollTarget. ` +
        (weapons.length
          ? `Weapons: ${weapons.map(item => `"${text(item['name'])}"`).join(', ')}.`
          : 'The actor has no weapon.')
    );
  }
  return weapon;
}

function attackActivity(weapon: Data): Data | undefined {
  return Object.values((at(weapon, 'system.activities') as Data | undefined) ?? {})
    .filter(isRecord)
    .find(activity => activity['type'] === 'attack');
}

/** The ability of a weapon attack: the one the activity names, else finesse picks the better, ranged dex, melee str. */
function weaponAbility(
  weapon: Data,
  attack: Data | undefined,
  mod: (key: string) => number
): string {
  const ranged =
    text(at(attack, 'attack.type.value')) === 'ranged' ||
    /R$/.test(text(at(weapon, 'system.type.value')));
  const properties = at(weapon, 'system.properties');
  const finesse = Array.isArray(properties) && properties.includes('fin');
  const chosen = text(at(attack, 'attack.ability'));
  if ((ABILITY_KEYS as readonly string[]).includes(chosen)) return chosen;
  if (finesse) return mod('dex') > mod('str') ? 'dex' : 'str';
  return ranged ? 'dex' : 'str';
}

// Actor data (2.14, 2.15) ---------------------------------------------------------------------------------------------------

/**
 * Short forms the model uses, brought into dnd5e's shape: an ability as a
 * number, a size as a word, a challenge rating as a fraction, a creature
 * type as a text, a skill by its English name or as a number. Everything else
 * stays as given.
 */
export function normalizeActorSystem(system: Record<string, unknown>): Record<string, unknown> {
  const out: Data = { ...system };
  if (isRecord(out['abilities'])) {
    const abilities: Data = { ...out['abilities'] };
    for (const [key, value] of Object.entries(abilities)) {
      if (typeof value === 'number') abilities[key] = { value };
    }
    out['abilities'] = abilities;
  }
  if (isRecord(out['traits']) && typeof out['traits']['size'] === 'string') {
    const size = out['traits']['size'].toLowerCase();
    out['traits'] = { ...out['traits'], size: SIZE_KEYS[size] ?? size };
  }
  if (isRecord(out['details'])) {
    const details: Data = { ...out['details'] };
    if (typeof details['cr'] === 'string') {
      const cr = parseCr(details['cr']);
      if (cr === null)
        throw new Error(
          `details.cr "${details['cr']}" is not a challenge rating (0, 1/8, 1/4, 1/2 or 1 to 30)`
        );
      details['cr'] = cr;
    }
    if (typeof details['type'] === 'string')
      details['type'] = { value: details['type'].toLowerCase() };
    out['details'] = details;
  }
  if (isRecord(out['skills'])) {
    const skills: Data = {};
    for (const [key, value] of Object.entries(out['skills'])) {
      const skill = skillFor(key);
      skills[skill?.key ?? key] = typeof value === 'number' ? { value } : value;
    }
    out['skills'] = skills;
  }
  return out;
}

export const SCHEMA_NOTES = [
  'D&D 5e (dnd5e 5.x) actor data:',
  '- Types: character, npc, vehicle, group. NPC building tools: dnd5e-create-npc, dnd5e-add-feature.',
  '- abilities.<str|dex|con|int|wis|cha>.value (1 to 30), .proficient (0 or 1) for saving throws. A number is accepted as the value.',
  '- attributes.hp.value, .max, .temp, .formula (formula for NPCs). attributes.ac.calc ("default", "flat", "natural") with attributes.ac.flat.',
  '- attributes.movement.walk, .fly, .swim, .climb, .burrow, .hover (dnd5e 6 moves speeds to movement.speeds). attributes.senses.ranges.darkvision and the other senses (since 5.3).',
  '- attributes.spellcasting (ability key); NPC caster level attributes.spell.level, which dnd5e turns into spell slots.',
  '- details.cr (number; "1/4" is accepted), details.type.value (creature type key), details.alignment, details.biography.value. traits.size: tiny, sm, med, lg, huge, grg ("large" is accepted).',
  '- traits.languages.value (keys such as "common"), traits.di, dr, dv, ci each with value (keys) and custom (text).',
  '- skills.<key>.value: 0, 0.5, 1 or 2 (half, proficient, expertise); English skill names are accepted as keys.',
  '- Never write attributes.prof or details.xp: dnd5e derives both.',
].join('\n');

// World items (2.16) ---------------------------------------------------------------------------------------------------------------

const keysOf = (value: unknown): string[] => (isRecord(value) ? Object.keys(value) : []);

export function itemEnums(config: unknown): Record<string, Record<string, readonly string[]>> {
  const dnd = isRecord(config) ? config['DND5E'] : undefined;
  if (!isRecord(dnd))
    throw new Error('CONFIG.DND5E is not available; the dnd5e system seems not to be loaded');
  const damage = keysOf(dnd['damageTypes']);
  return {
    weapon: {
      'system.type.value': keysOf(dnd['weaponTypes']),
      'system.properties': keysOf(dnd['itemProperties']),
      'system.damage.base.types': damage,
      'system.mastery': keysOf(dnd['weaponMasteries']),
    },
    equipment: {
      'system.type.value': [...keysOf(dnd['armorTypes']), ...keysOf(dnd['miscEquipmentTypes'])],
    },
    consumable: { 'system.type.value': keysOf(dnd['consumableTypes']) },
    tool: { 'system.type.value': keysOf(dnd['toolTypes']) },
    loot: { 'system.type.value': keysOf(dnd['lootTypes']) },
    feat: { 'system.type.value': keysOf(dnd['featureTypes']) },
    spell: {
      'system.school': keysOf(dnd['spellSchools']),
      'system.level': keysOf(dnd['spellLevels']),
      'system.method': keysOf(dnd['spellcasting']),
      'system.properties': ['vocal', 'somatic', 'material', 'concentration', 'ritual'],
    },
    activity: {
      'activation.type': keysOf(dnd['activityActivationTypes']),
      'damage.parts.types': damage,
    },
  };
}

// The adapter ---------------------------------------------------------------------------------------------------------------------------

export const dnd5eAdapter: SystemAdapter = {
  id: 'dnd5e',
  title: 'Dungeons & Dragons Fifth Edition',
  creatures: {
    indexVersion: 1,
    actorTypes: ['npc', 'character'],
    invalidatingTypes: ['npc', 'character'],
    copyableTypes: ['npc', 'character', 'vehicle', 'group'],
    row: creatureRow,
    power: { name: 'Challenge Rating', field: 'challengeRating', range: { min: 0, max: 30 } },
    filters: CREATURE_FILTERS,
    describeFilters: filters =>
      Object.entries(filters)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => `${key} ${JSON.stringify(value)}`)
        .join(', '),
    listFields: creatureListFields,
    summary: creatureSummary,
  },
  compendiumStats: {
    indexFields: INDEX_FIELDS,
    actorStats,
    searchFilters: SEARCH_FILTERS,
    estimate: estimateEntry,
  },
  characters: { summary: characterSummary, itemFields, actions: actionsOf },
  spells: { itemTypes: ['spell'], entries: spellcastingEntries },
  characterSearch: {
    itemTypes: {
      spells: ['spell'],
      equipment: ['weapon', 'equipment', 'consumable', 'container', 'backpack', 'loot', 'tool'],
      features: ['feat', 'race', 'background', 'class', 'subclass'],
      actions: [],
    },
    categories: {
      cantrip: {
        description: 'spells of level 0',
        matches: item => item['type'] === 'spell' && num(at(item, 'system.level')) === 0,
      },
      prepared: {
        description:
          'spells ready to cast: prepared, cantrips, and at will, innate, pact or ritual spells',
        matches: item => item['type'] === 'spell' && isPrepared(sys(item)),
      },
      equipped: {
        description: 'items that are equipped',
        matches: item => at(item, 'system.equipped') === true,
      },
      invested: {
        description: 'items that need attunement and are attuned',
        matches: item =>
          text(at(item, 'system.attunement')) !== '' && at(item, 'system.attuned') === true,
      },
    },
    matchDetails,
  },
  // 2.12: no effect data of its own, so tokens-dice toggles through Foundry's toggleStatusEffect,
  // which dnd5e hooks into. Only the matching differs from the generic answer: dnd5e knows a
  // condition by its status, never by a hand made effect that merely shares the name.
  // effectData stays out; the registry fills it and names it in fallbackFor.
  conditions: {
    matchesEffect: (effect, condition) =>
      Array.isArray(effect['statuses']) && effect['statuses'].includes(condition.id),
  },
  itemUse: {
    plan: (item, request) => {
      const activities = at(item, 'system.activities');
      if (!isRecord(activities) || !Object.keys(activities).length) return null;
      const consume = request.consume !== false;
      const options: Data = {
        consume: { action: consume, resources: consume, spellSlot: consume },
      };
      if (request.spellLevel !== undefined) {
        if (item['type'] !== 'spell')
          throw new Error('spellLevel only applies to spells; this item is not a spell');
        const base = num(at(item, 'system.level')) ?? 0;
        if (
          request.spellLevel < base ||
          request.spellLevel > 9 ||
          !Number.isInteger(request.spellLevel)
        )
          throw new Error(
            `spellLevel ${request.spellLevel} is not possible for a spell of level ${base}: use ${base} to 9`
          );
        if (request.spellLevel > 0) options['spell'] = { slot: `spell${request.spellLevel}` };
      }
      // Item5e#use(config, dialog, message): `configure: false` skips the usage dialog.
      return { method: 'use', options, args: [options, { configure: false }] };
    },
  },
  rolls: {
    types: [
      { id: 'ability', description: '1d20 plus the ability modifier', targets: ABILITY_KEYS },
      {
        id: 'skill',
        description: '1d20 plus the skill total; rollTarget is the English skill name',
        targets: Object.keys(SKILLS),
      },
      { id: 'save', description: '1d20 plus the saving throw bonus', targets: ABILITY_KEYS },
      { id: 'attack', description: '1d20 plus the attack bonus of the weapon named in rollTarget' },
      {
        id: 'damage',
        description:
          'the base damage of the weapon named in rollTarget plus its ability modifier and magical bonus',
      },
      { id: 'initiative', description: '1d20 plus the initiative bonus' },
      { id: 'custom', description: 'the formula in rollTarget' },
    ],
    plan: rollPlan,
  },
  actorData: { normalize: normalizeActorSystem, schemaNotes: () => SCHEMA_NOTES },
  worldItems: {
    enums: itemEnums,
    note: () =>
      'Values outside these lists are stored by dnd5e but no rule uses them. Activities (system.activities) carry attacks, saves and damage; dnd5e-add-feature builds them.',
  },
  compendiums: {
    defaults: {
      Item: [
        ...STANDARD_PACKS['2014'].spells,
        ...STANDARD_PACKS['2024'].spells,
        ...STANDARD_PACKS['2014'].features,
        ...STANDARD_PACKS['2024'].features,
      ],
      Actor: [
        ...STANDARD_PACKS['2014'].monsters,
        ...STANDARD_PACKS['2024'].monsters,
        'dnd5e.heroes',
      ],
    },
    priority: packId => (packId.startsWith('dnd5e.') ? 1 : 0),
  },
  tools: DND5E_TOOLS,
};
