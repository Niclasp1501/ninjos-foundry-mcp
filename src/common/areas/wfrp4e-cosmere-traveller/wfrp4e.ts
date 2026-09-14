/**
 * The Warhammer Fantasy Roleplay 4e adapter (Foundry system `wfrp4e` by
 * moo-man), answered from plain data.
 *
 * Checked against the public source (moo-man/WFRP4e-FoundryVTT, branch
 * master, read 14.09.2026):
 * - characteristics ws to fel with initial, modifier, advances, bonusMod;
 *   value = initial + modifier + advances, bonus = floor(value / 10) + bonusMod
 *   (model/actor/components/characteristics.js)
 * - status.wounds, advantage, criticalWounds, corruption, and for characters
 *   fate, fortune, resilience, resolve (components/status.js)
 * - details.species.value and .subspecies, size.value ("avg"), move.value,
 *   biography.value, experience total and spent, class, status standing and
 *   tier (components/details.js)
 * - the current career is the career item with `current.value` true
 *   (model/actor/character.js); `settings.autoCalc.wounds` recomputes max
 *   wounds (model/actor/standard.js)
 * - a test rolls 1d100, succeeds at or under the target, and its success
 *   levels are tens of the target minus tens of the roll
 *   (system/rolls/test-wfrp4e.js)
 *
 * Not verified, marked as assumptions where used: item paths (skill
 * advances, characteristic and total, spell cn, lore, range, target, prayer
 * god, quantity, equipped), the size keys besides "avg", conditions as
 * effects with statuses, and the name of the CONFIG block.
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
import {
  at,
  choiceLists,
  idOf,
  isRecord,
  itemsOf,
  num,
  numberValue,
  numericModifier,
  read,
  sameName,
  systemOf,
  text,
  textValue,
  type Data,
} from './shared.js';

export const WFRP4E_ID = 'wfrp4e';
export const WFRP4E_TOOLS = ['wfrp4e-update-actor', 'wfrp4e-add-items'] as const;

export const CHARACTERISTIC_KEYS = [
  'ws',
  'bs',
  's',
  't',
  'i',
  'ag',
  'dex',
  'int',
  'wp',
  'fel',
] as const;
export type CharacteristicKey = (typeof CHARACTERISTIC_KEYS)[number];

export const CHARACTERISTIC_NAMES: Readonly<Record<CharacteristicKey, string>> = {
  ws: 'Weapon Skill',
  bs: 'Ballistic Skill',
  s: 'Strength',
  t: 'Toughness',
  i: 'Initiative',
  ag: 'Agility',
  dex: 'Dexterity',
  int: 'Intelligence',
  wp: 'Willpower',
  fel: 'Fellowship',
};

/** System size keys and the words the filter takes. Only "avg" is confirmed in the source. */
export const SIZE_WORDS: Readonly<Record<string, string>> = {
  tny: 'tiny',
  ltl: 'little',
  sml: 'small',
  avg: 'average',
  lrg: 'large',
  enor: 'enormous',
  mnst: 'monstrous',
};

/** Item types that carry a quantity (for wfrp4e-add-items). */
export const GEAR_TYPES = [
  'weapon',
  'armour',
  'trapping',
  'ammunition',
  'container',
  'money',
  'cargo',
] as const;

/** The value derived tables show as a career in prepared data; never a value. */
const CIRCULAR = '[Circular Reference]';

function clean(value: string): string | null {
  const trimmed = value.trim();
  return trimmed && trimmed !== CIRCULAR ? trimmed : null;
}

export function sizeWord(value: unknown): string | null {
  const key = textValue(value).trim().toLowerCase();
  if (!key) return null;
  return SIZE_WORDS[key] ?? (Object.values(SIZE_WORDS).includes(key) ? key : key);
}

export function sizeKey(word: string): string {
  const lower = word.trim().toLowerCase();
  const found = Object.entries(SIZE_WORDS).find(([, name]) => name === lower);
  return found ? found[0] : lower;
}

/** A characteristic key from a key or its English name ("WS", "weapon skill"). */
export function characteristicKey(value: string | undefined): CharacteristicKey | null {
  const wanted = (value ?? '').trim().toLowerCase();
  if ((CHARACTERISTIC_KEYS as readonly string[]).includes(wanted))
    return wanted as CharacteristicKey;
  const byName = CHARACTERISTIC_KEYS.find(
    key => CHARACTERISTIC_NAMES[key].toLowerCase() === wanted
  );
  return byName ?? null;
}

export interface CharacteristicValue {
  name: string;
  value: number;
  bonus: number;
  initial: number;
  advances: number;
  modifier: number;
  /** True when value and bonus were computed from the stored parts. */
  computed: boolean;
}

/** One characteristic: prepared value and bonus when the data has them, else the system's formula. */
export function characteristic(system: Data, key: CharacteristicKey): CharacteristicValue {
  const entry = at(system, `characteristics.${key}`);
  const part = (field: string) => (isRecord(entry) ? (num(entry[field]) ?? 0) : 0);
  const initial = part('initial');
  const modifier = part('modifier');
  const advances = part('advances');
  const preparedValue = isRecord(entry) ? num(entry['value']) : null;
  const preparedBonus = isRecord(entry) ? num(entry['bonus']) : null;
  const value = preparedValue ?? initial + modifier + advances;
  const bonus = preparedBonus ?? Math.floor(value / 10) + part('bonusMod');
  return {
    name: CHARACTERISTIC_NAMES[key],
    value,
    bonus,
    initial,
    advances,
    modifier,
    computed: preparedValue === null || preparedBonus === null,
  };
}

export function characteristicsOf(system: Data): Record<CharacteristicKey, CharacteristicValue> {
  return Object.fromEntries(
    CHARACTERISTIC_KEYS.map(key => [key, characteristic(system, key)])
  ) as Record<CharacteristicKey, CharacteristicValue>;
}

export interface SkillValue {
  id: string;
  name: string;
  characteristic: CharacteristicKey | null;
  advances: number;
  total: number;
  computed: boolean;
}

/** A skill item: total from the item when prepared, else characteristic plus advances plus modifier. */
export function skillValue(item: Data, system: Data): SkillValue {
  const data = systemOf(item);
  const key = characteristicKey(textValue(data['characteristic']));
  const advances = numberValue(data['advances']) ?? 0;
  const modifier = numberValue(data['modifier']) ?? 0;
  const prepared = numberValue(data['total']);
  const base = key ? characteristic(system, key).value : 0;
  return {
    id: idOf(item),
    name: text(item['name']),
    characteristic: key,
    advances,
    total: prepared ?? base + advances + modifier,
    computed: prepared === null,
  };
}

export function currentCareer(actor: AdapterDocument): Data | null {
  return (
    itemsOf(actor).find(
      item => item['type'] === 'career' && at(item, 'system.current.value') === true
    ) ?? null
  );
}

function equippedOf(item: Data): boolean | null {
  for (const field of ['equipped', 'worn']) {
    const value = at(item, `system.${field}`);
    if (typeof value === 'boolean') return value;
    if (isRecord(value) && typeof value['value'] === 'boolean') return value['value'];
  }
  return null;
}

// Creature index (2.2 to 2.6) ---------------------------------------------------------

export function creatureRow(document: AdapterDocument): Record<string, unknown> {
  const system = systemOf(document);
  const items = itemsOf(document);
  const characteristics = characteristicsOf(system);
  return {
    species: textValue(at(system, 'details.species')).trim().toLowerCase() || 'unknown',
    size: sizeWord(at(system, 'details.size')) ?? 'average',
    wounds: num(at(system, 'status.wounds.max')) ?? num(at(system, 'status.wounds.value')) ?? 0,
    characteristics: Object.fromEntries(
      CHARACTERISTIC_KEYS.map(key => [key, characteristics[key].value])
    ),
    hasSpells: items.some(item => item['type'] === 'spell'),
    hasPrayers: items.some(item => item['type'] === 'prayer'),
    traits: items.filter(item => item['type'] === 'trait').map(item => text(item['name'])),
  };
}

export const CREATURE_FILTERS: readonly CreatureFilterSpec[] = [
  { name: 'species', kind: 'partialText', field: 'species' },
  { name: 'size', kind: 'text', field: 'size', values: Object.values(SIZE_WORDS) },
  { name: 'hasSpells', kind: 'boolean', field: 'hasSpells' },
  { name: 'hasPrayers', kind: 'boolean', field: 'hasPrayers' },
  { name: 'traits', kind: 'textList', field: 'traits' },
];

export function creatureListFields(row: CreatureRow): Record<string, unknown> {
  return {
    species: row['species'],
    size: row['size'],
    wounds: row['wounds'],
    characteristics: row['characteristics'],
    hasSpells: row['hasSpells'],
    hasPrayers: row['hasPrayers'],
    traits: row['traits'],
  };
}

export function creatureSummary(row: CreatureRow): string {
  return `${String(row['species'] ?? 'unknown')} ${row.type} (${String(row['size'] ?? 'average')}), ${String(row['wounds'] ?? 0)} wounds, from ${row.packLabel}`;
}

export const INDEX_FIELDS = [
  'system.details.species',
  'system.details.size',
  'system.status.wounds',
  'system.characteristics',
];

export function actorStats(entry: AdapterDocument): Record<string, unknown> | null {
  const species = read(entry, 'system.details.species');
  const wounds = read(entry, 'system.status.wounds');
  if (species === undefined && wounds === undefined) return null;
  const characteristics = read(entry, 'system.characteristics');
  return {
    species: textValue(species) || null,
    size: sizeWord(read(entry, 'system.details.size')),
    wounds: isRecord(wounds) ? { value: num(wounds['value']), max: num(wounds['max']) } : null,
    characteristics: isRecord(characteristics)
      ? Object.fromEntries(
          CHARACTERISTIC_KEYS.map(key => [key, characteristic({ characteristics }, key).value])
        )
      : null,
  };
}

// Characters (2.8) --------------------------------------------------------------------------

export function characterSummary(actor: AdapterDocument): CharacterSummary {
  const system = systemOf(actor);
  const items = itemsOf(actor);
  const characteristics = characteristicsOf(system);
  const wounds = {
    value: num(at(system, 'status.wounds.value')),
    max: num(at(system, 'status.wounds.max')),
  };
  const career = currentCareer(actor);
  const move = {
    value: num(at(system, 'details.move.value')),
    walk: num(at(system, 'details.move.walk')),
    run: num(at(system, 'details.move.run')),
  };
  const basicInfo: Data = {
    wounds,
    move: move.value,
    species: clean(textValue(at(system, 'details.species'))),
    subspecies: clean(text(at(system, 'details.species.subspecies'))),
    career: career ? text(career['name']) : null,
    class: clean(textValue(at(system, 'details.class'))),
    size: sizeWord(at(system, 'details.size')),
  };
  const pool = (path: string) => num(at(system, `${path}.value`));
  const skills = items
    .filter(item => item['type'] === 'skill')
    .map(item => skillValue(item, system))
    .sort((a, b) => a.name.localeCompare(b.name));
  const stats: Data = {
    characteristics,
    wounds,
    advantage: { value: pool('status.advantage'), max: num(at(system, 'status.advantage.max')) },
    fate: pool('status.fate'),
    fortune: pool('status.fortune'),
    resilience: pool('status.resilience'),
    resolve: pool('status.resolve'),
    corruption: { value: pool('status.corruption'), max: num(at(system, 'status.corruption.max')) },
    criticalWounds: {
      value: pool('status.criticalWounds'),
      max: num(at(system, 'status.criticalWounds.max')),
    },
    move,
    identity: {
      species: basicInfo['species'],
      subspecies: basicInfo['subspecies'],
      career: basicInfo['career'],
      careerLevel: clean(textValue(at(system, 'details.careerlevel'))),
      class: basicInfo['class'],
      status:
        clean(text(at(system, 'details.status.standing'))) ??
        clean(text(at(system, 'details.status.value'))),
    },
    size: basicInfo['size'],
    experience: isRecord(at(system, 'details.experience'))
      ? {
          total: num(at(system, 'details.experience.total')) ?? 0,
          spent: num(at(system, 'details.experience.spent')) ?? 0,
          current:
            (num(at(system, 'details.experience.total')) ?? 0) -
            (num(at(system, 'details.experience.spent')) ?? 0),
        }
      : null,
    skills,
    spellcasting: {
      spells: items.filter(item => item['type'] === 'spell').length,
      prayers: items.filter(item => item['type'] === 'prayer').length,
    },
    computedNote:
      'Characteristic values, bonuses and skill totals come from prepared data when present, otherwise from the stored parts by the system formula; talents and effects are then not included.',
  };
  return { basicInfo, stats };
}

export function itemFields(item: AdapterDocument): Record<string, unknown> {
  const system = systemOf(item);
  const out: Data = {};
  const quantity = numberValue(system['quantity']);
  if (quantity !== null && quantity !== 1) out['quantity'] = quantity;
  const equipped = equippedOf(item as Data);
  if (equipped !== null) out['equipped'] = equipped;
  if (item['type'] === 'skill') out['advances'] = numberValue(system['advances']) ?? 0;
  if (item['type'] === 'career') out['current'] = at(system, 'current.value') === true;
  if (item['type'] === 'spell') out['cn'] = numberValue(system['cn']);
  return out;
}

// Spells (2.9) -----------------------------------------------------------------------------

function spellInfo(item: Data): SpellInfo {
  const system = systemOf(item);
  const cn = numberValue(system['cn']);
  return {
    id: idOf(item),
    name: text(item['name']),
    cost: item['type'] === 'spell' && cn !== null ? `CN ${cn}` : null,
    range: clean(textValue(system['range'])),
    target: clean(textValue(system['target'])),
  };
}

const byName = (a: SpellInfo, b: SpellInfo) => a.name.localeCompare(b.name);

export function spellcastingEntries(actor: AdapterDocument): SpellcastingEntry[] {
  const groups = new Map<string, SpellcastingEntry>();
  for (const item of itemsOf(actor)) {
    if (item['type'] !== 'spell' && item['type'] !== 'prayer') continue;
    const spell = item['type'] === 'spell';
    const group = clean(textValue(at(item, spell ? 'system.lore' : 'system.god')));
    const name = spell
      ? group
        ? `Lore of ${group.replace(/^\w/, letter => letter.toUpperCase())}`
        : 'Spells'
      : group
        ? `Prayers (${group})`
        : 'Prayers';
    const entry = groups.get(name) ?? {
      id: `${spell ? 'lore' : 'prayers'}:${(group ?? '').toLowerCase()}`,
      name,
      kind: spell ? 'arcane' : 'divine',
      tradition: spell ? 'arcane' : 'divine',
      spells: [],
    };
    entry.spells.push(spellInfo(item));
    groups.set(name, entry);
  }
  return [...groups.values()]
    .map(entry => ({ ...entry, spells: entry.spells.sort(byName) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Rolls (2.13) -----------------------------------------------------------------------------

function successRule(target: number): string {
  return `1d100 at or under ${target} succeeds (01 to 05 always succeed and 96 to 00 always fail by the system default); SL = tens of ${target} minus tens of the roll`;
}

export function rollPlan(
  request: { rollType: string; rollTarget?: string; rollModifier?: string },
  actor: AdapterDocument | null
): { formula: string; label: string } {
  const modifier = numericModifier(
    request.rollModifier,
    'in WFRP4e a modifier changes the target number, not the roll'
  );
  const system = actor ? systemOf(actor) : {};
  const rollData = actor ? actor['rollData'] : undefined;
  const withModifier = (base: number) => base + (modifier ?? 0);
  const modifierText = modifier ? ` (${modifier > 0 ? '+' : ''}${modifier} applied)` : '';

  switch (request.rollType) {
    case 'characteristic': {
      const key = characteristicKey(request.rollTarget);
      if (!key)
        throw new Error(
          `rollTarget must be a characteristic for a characteristic test: ${CHARACTERISTIC_KEYS.join(', ')} or its English name, got "${request.rollTarget ?? ''}".`
        );
      const name = CHARACTERISTIC_NAMES[key];
      if (!actor) return { formula: '1d100', label: `${name} test against the sheet value` };
      const prepared = num(at(rollData, `characteristics.${key}.value`));
      const target = withModifier(prepared ?? characteristic(system, key).value);
      return { formula: '1d100', label: `${name} test${modifierText}: ${successRule(target)}` };
    }
    case 'skill': {
      const wanted = (request.rollTarget ?? '').trim();
      if (!wanted)
        throw new Error('A skill test needs the skill name in rollTarget, e.g. "Perception".');
      if (!actor) return { formula: '1d100', label: `${wanted} test against the sheet value` };
      const skills = itemsOf(actor).filter(item => item['type'] === 'skill');
      const found = skills.filter(item => sameName(item['name'], wanted));
      if (found.length !== 1) {
        throw new Error(
          found.length
            ? `The actor has ${found.length} skills named "${wanted}"; rename one on the sheet first.`
            : `The actor has no skill named "${wanted}". An untrained basic skill is tested on its characteristic: use rollType "characteristic". ` +
                `Skills of the actor: ${skills.map(item => `"${text(item['name'])}"`).join(', ') || 'none'}.`
        );
      }
      const skill = skillValue(found[0] as Data, system);
      const target = withModifier(skill.total);
      return {
        formula: '1d100',
        label: `${skill.name} test${modifierText}: ${successRule(target)}`,
      };
    }
    case 'custom': {
      const formula = (request.rollTarget ?? '').trim();
      if (!formula) throw new Error('A custom roll needs its formula in rollTarget, e.g. "1d10".');
      return { formula, label: `Custom roll${modifierText}` };
    }
    default:
      throw new Error(
        `The roll type "${request.rollType}" is not a WFRP4e roll type: characteristic, skill or custom.`
      );
  }
}

// Actor data (2.14, 2.15) -----------------------------------------------------------------------

/**
 * Short forms brought into the wfrp4e shape: a characteristic as a number
 * (its initial value) and under its English name, wounds as a number,
 * species, biography and size as text, move as a number. Everything else
 * stays as given.
 */
export function normalizeActorSystem(system: Record<string, unknown>): Record<string, unknown> {
  const out: Data = { ...system };
  if (isRecord(out['characteristics'])) {
    const characteristics: Data = {};
    for (const [name, value] of Object.entries(out['characteristics'])) {
      const key = characteristicKey(name) ?? name;
      characteristics[key] = typeof value === 'number' ? { initial: value } : value;
    }
    out['characteristics'] = characteristics;
  }
  if (isRecord(out['status']) && typeof out['status']['wounds'] === 'number') {
    const wounds = out['status']['wounds'];
    out['status'] = { ...out['status'], wounds: { value: wounds, max: wounds } };
  }
  if (isRecord(out['details'])) {
    const details: Data = { ...out['details'] };
    for (const field of ['species', 'biography', 'gender', 'class']) {
      if (typeof details[field] === 'string') details[field] = { value: details[field] };
    }
    if (typeof details['move'] === 'number') details['move'] = { value: details['move'] };
    if (typeof details['size'] === 'string') details['size'] = { value: sizeKey(details['size']) };
    out['details'] = details;
  }
  return out;
}

export const SCHEMA_NOTES = [
  'Warhammer Fantasy Roleplay 4e (wfrp4e) actor data:',
  '- Types: character, npc, creature, vehicle. Change stat blocks with wfrp4e-update-actor, add skills, talents, trappings and careers with wfrp4e-add-items.',
  '- characteristics.<ws|bs|s|t|i|ag|dex|int|wp|fel>.initial, .advances, .modifier. The value and bonus are derived (initial + modifier + advances, tens plus bonusMod); never write them. A number is taken as initial.',
  '- status.wounds.value and .max; with settings.autoCalc.wounds on, wfrp4e recomputes max from the bonuses. status.advantage, criticalWounds, corruption; characters also fate, fortune, resilience, resolve (each .value).',
  '- details.species.value and .subspecies, details.size.value (tny, ltl, sml, avg, lrg, enor, mnst; words such as "large" are accepted), details.move.value, details.biography.value, details.experience.total and .spent.',
  '- Skills, talents, careers, spells and prayers are items. The current career is the career item with system.current.value true; details.career is not the place to set it.',
].join('\n');

export function itemEnums(config: unknown): Record<string, Record<string, readonly string[]>> {
  const block = isRecord(config) ? config['WFRP4E'] : undefined;
  if (!isRecord(block))
    throw new Error(
      'CONFIG.WFRP4E is not available: the wfrp4e system seems not to be loaded, or keeps its configuration elsewhere'
    );
  return { config: choiceLists(block, 'CONFIG.WFRP4E') };
}

// The adapter ------------------------------------------------------------------------------------

export const wfrp4eAdapter: SystemAdapter = {
  id: WFRP4E_ID,
  title: 'Warhammer Fantasy Roleplay Fourth Edition',
  creatures: {
    indexVersion: 1,
    actorTypes: ['npc', 'character', 'creature'],
    invalidatingTypes: ['npc', 'character', 'creature'],
    copyableTypes: ['character', 'npc', 'creature', 'vehicle'],
    row: creatureRow,
    filters: CREATURE_FILTERS,
    listFields: creatureListFields,
    summary: creatureSummary,
  },
  compendiumStats: { indexFields: INDEX_FIELDS, actorStats },
  characters: { summary: characterSummary, itemFields },
  spells: { itemTypes: ['spell', 'prayer'], entries: spellcastingEntries },
  characterSearch: {
    itemTypes: {
      spells: ['spell', 'prayer'],
      equipment: [...GEAR_TYPES],
      features: [
        'skill',
        'talent',
        'trait',
        'career',
        'psychology',
        'mutation',
        'disease',
        'injury',
        'critical',
        'disorder',
      ],
      actions: [],
    },
    categories: {
      equipped: {
        description: 'weapons and armour that are equipped or worn',
        matches: item => equippedOf(item as Data) === true,
      },
    },
    matchDetails: item => {
      if (item['type'] === 'spell' || item['type'] === 'prayer') {
        const info = spellInfo(item as Data);
        return { cost: info.cost, range: info.range, target: info.target };
      }
      return itemFields(item);
    },
  },
  // Conditions are recognised by their status only, never by a hand made effect of the same name.
  // Assumption: wfrp4e marks its condition effects with statuses. effectData stays the core's.
  conditions: {
    matchesEffect: (effect, condition) =>
      Array.isArray(effect['statuses']) && effect['statuses'].includes(condition.id),
  },
  rolls: {
    types: [
      {
        id: 'characteristic',
        description: '1d100 against the characteristic; rollModifier is added to the target',
        targets: CHARACTERISTIC_KEYS,
      },
      {
        id: 'skill',
        description:
          '1d100 against the skill total; rollTarget is the exact skill name of the actor',
      },
      { id: 'custom', description: 'the formula in rollTarget' },
    ],
    plan: rollPlan,
  },
  actorData: { normalize: normalizeActorSystem, schemaNotes: () => SCHEMA_NOTES },
  worldItems: {
    enums: itemEnums,
    note: () =>
      'These are the choice lists of CONFIG.WFRP4E by their path there, not item field paths. Item paths of wfrp4e keep most values under .value (e.g. system.quantity.value).',
  },
  compendiums: {
    priority: packId =>
      packId.startsWith('wfrp4e-core') ? 2 : packId.startsWith('wfrp4e') ? 1 : 0,
  },
  tools: WFRP4E_TOOLS,
};
