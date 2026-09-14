/**
 * Items for dnd5e-add-feature: which parameters each featureType uses, and
 * the item data with its activities in the shape of dnd5e 5.x.
 *
 * Decisions on the rule faults of the previous generation:
 * - `proficient` is written as given (1 or 0), never always on.
 * - The attack ability is written into the activity under both rule versions.
 *   dnd5e takes an explicitly set ability first in either version; leaving it
 *   empty under 2014 made natural weapons use the higher of Strength and
 *   Dexterity, not the ability the answer named.
 * - A save carries its source and rules like every other feature.
 * - Templates of lines, cubes and cylinders get width and height.
 * - Every name, damage type and property is checked here, once.
 */
import {
  ABILITY_KEYS,
  DAMAGE_TYPE_KEYS,
  abilityMod,
  isRecord,
  num,
  quote,
  randomId,
  type AbilityKey,
  type Data,
  type RulesVersion,
} from './rules.js';

export const FEATURE_TYPES = [
  'passive',
  'save',
  'attack',
  'attack-with-save',
  'aura',
  'spellcasting',
  'spells',
] as const;
export type FeatureType = (typeof FEATURE_TYPES)[number];

export const ACTIVATION_TYPES = [
  'action',
  'bonus',
  'reaction',
  'legendary',
  'lair',
  'special',
] as const;
export const AREA_TYPES = [
  'cone',
  'cube',
  'cylinder',
  'emanation',
  'line',
  'radius',
  'sphere',
  '',
] as const;
export const WEAPON_CLASSES = ['natural', 'simpleM', 'martialM', 'simpleR', 'martialR'] as const;
export const DIE_SIZES = [4, 6, 8, 10, 12, 20, 100] as const;
/** Weapon property keys of CONFIG.DND5E.itemProperties that a weapon may carry. */
export const WEAPON_PROPERTIES = [
  'ada',
  'amm',
  'fin',
  'fir',
  'foc',
  'hvy',
  'lgt',
  'lod',
  'mgc',
  'rch',
  'rel',
  'ret',
  'sil',
  'spc',
  'thr',
  'two',
  'ver',
] as const;

const SOURCE = ['sourceRules', 'sourceBook', 'sourcePage'];
const NAMED = ['featureName', 'description'];
const ATTACK = [
  ...NAMED,
  'activationType',
  'attackType',
  'weaponClass',
  'abilityModifier',
  'attackBonus',
  'proficient',
  'equipped',
  'reachFt',
  'rangeFt',
  'longRangeFt',
  'damageParts',
  'properties',
  ...SOURCE,
];
const AREA = ['areaType', 'areaSize', 'areaUnits', 'affectsType'];

/** What each featureType reads, and what it cannot do without. */
export const FEATURE_PARAMETERS: Readonly<
  Record<FeatureType, { uses: string[]; needs: string[] }>
> = {
  passive: { uses: [...NAMED, ...SOURCE], needs: ['featureName'] },
  save: {
    uses: [
      ...NAMED,
      'activationType',
      'saveAbility',
      'saveDC',
      'damageParts',
      'halfOnSave',
      ...AREA,
      ...SOURCE,
    ],
    needs: ['featureName', 'saveAbility', 'saveDC', 'damageParts'],
  },
  attack: { uses: ATTACK, needs: ['featureName', 'attackType', 'damageParts'] },
  'attack-with-save': {
    uses: [...ATTACK, 'saveAbility', 'saveDC', 'saveDamageParts', 'saveOnSave'],
    needs: ['featureName', 'attackType', 'damageParts', 'saveAbility', 'saveDC', 'saveDamageParts'],
  },
  aura: {
    uses: [...NAMED, 'activationType', 'damageParts', ...AREA, ...SOURCE],
    needs: ['featureName', 'damageParts', 'areaType', 'areaSize'],
  },
  spellcasting: {
    uses: ['spellcastingClass', 'spellcastingLevel', 'spellcastingAbility', 'sourceRules'],
    needs: ['spellcastingClass', 'spellcastingLevel'],
  },
  spells: { uses: ['spellNames', 'compendiumPacks'], needs: ['spellNames'] },
};

/** Always accepted: the selector, the actor, and what a server of the previous generation adds. */
const ALWAYS = ['featureType', 'actorIdentifier', 'effectiveAbility', 'serverDefaults'];

export interface FeatureCheck {
  featureType: FeatureType | null;
  problems: string[];
  /** Given parameters the chosen featureType does not use. */
  ignored: string[];
}

function given(args: Data, key: string): boolean {
  const value = args[key];
  return value !== undefined && value !== null && !(key === 'areaType' && value === '');
}

/** Selector, required parameters per featureType, and what is ignored. */
export function checkFeatureArguments(args: Data): FeatureCheck {
  const raw = args['featureType'];
  const featureType = (FEATURE_TYPES as readonly unknown[]).includes(raw)
    ? (raw as FeatureType)
    : null;
  if (!featureType)
    return {
      featureType,
      problems: [
        `featureType must be one of ${FEATURE_TYPES.join(', ')}, got ${JSON.stringify(raw)}`,
      ],
      ignored: [],
    };
  const plan = FEATURE_PARAMETERS[featureType];
  const problems = plan.needs
    .filter(key => !given(args, key))
    .map(key => `${key} is required for featureType "${featureType}"`);
  if (
    (featureType === 'attack' || featureType === 'attack-with-save') &&
    args['attackType'] === 'ranged' &&
    !given(args, 'rangeFt')
  )
    problems.push(`rangeFt is required for a ranged attack`);
  if (featureType === 'save' && given(args, 'areaType') && !given(args, 'areaSize'))
    problems.push('areaSize is required when areaType is set');
  const ignored = Object.keys(args).filter(
    key => args[key] !== undefined && !ALWAYS.includes(key) && !plan.uses.includes(key)
  );
  return { featureType, problems, ignored };
}

// Building ---------------------------------------------------------------------------------

export interface FeatureContext {
  random?: () => number;
  /** Ability scores of the actor, to pick Strength or Dexterity for finesse weapons. */
  abilities?: Partial<Record<AbilityKey, number>>;
  /** The world's rules version, when sourceRules is not given. */
  worldRules?: RulesVersion | null;
}

export interface FeatureBuild {
  item: Data;
  problems: string[];
  warnings: string[];
  /** What the answer reports about the item beyond its name. */
  details: Data;
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function damageParts(
  value: unknown,
  field: string,
  problems: string[],
  warnings: string[]
): Data[] {
  if (!Array.isArray(value) || !value.length) {
    problems.push(`${field} must list at least one damage part`);
    return [];
  }
  const unknown: string[] = [];
  const parts = value.map((part, index) => {
    const number = isRecord(part) ? num(part['number']) : null;
    const denomination = isRecord(part) ? num(part['denomination']) : null;
    const type =
      isRecord(part) && typeof part['type'] === 'string' ? part['type'].trim().toLowerCase() : '';
    if (number === null || number < 1 || !Number.isInteger(number))
      problems.push(`${field}[${index}].number must be a whole number of at least 1`);
    if (denomination === null || !(DIE_SIZES as readonly number[]).includes(denomination))
      problems.push(`${field}[${index}].denomination must be one of ${DIE_SIZES.join(', ')}`);
    if (!type) problems.push(`${field}[${index}].type must name a damage type`);
    else if (!(DAMAGE_TYPE_KEYS as readonly string[]).includes(type) && !unknown.includes(type))
      unknown.push(type);
    return {
      number: number ?? 1,
      denomination: denomination ?? 6,
      bonus: '',
      types: type ? [type] : [],
      custom: { enabled: false, formula: '' },
      scaling: { mode: '', number: 1, formula: '' },
    };
  });
  if (unknown.length) {
    warnings.push(
      `Damage type(s) ${quote(unknown)} in ${field} are not dnd5e damage types: stored, but resistances and immunities will not apply to them. Known: ${DAMAGE_TYPE_KEYS.join(', ')}.`
    );
  }
  return parts;
}

function activation(args: Data, problems: string[]): Data {
  const type = args['activationType'] === undefined ? 'action' : args['activationType'];
  if (!(ACTIVATION_TYPES as readonly unknown[]).includes(type))
    problems.push(`activationType must be one of ${ACTIVATION_TYPES.join(', ')}`);
  const counted = ['action', 'bonus', 'reaction', 'legendary'].includes(String(type));
  return { type, value: counted ? 1 : null, condition: '', override: false };
}

function source(args: Data, context: FeatureContext, problems: string[]): Data {
  const rules = args['sourceRules'];
  if (rules !== undefined && rules !== '2014' && rules !== '2024')
    problems.push(`sourceRules must be "2014" or "2024", got ${JSON.stringify(rules)}`);
  return {
    book: text(args['sourceBook']),
    page: text(args['sourcePage']),
    custom: '',
    rules: rules === '2014' || rules === '2024' ? rules : (context.worldRules ?? '2014'),
  };
}

const EMPTY_TEMPLATE = {
  count: '',
  contiguous: false,
  type: '',
  size: '',
  width: '',
  height: '',
  units: 'ft',
};

/**
 * The template of an area. dnd5e has no emanation among its template types;
 * it becomes a radius. Which field holds what follows
 * CONFIG.DND5E.areaTargetTypes and TargetField.templateDimensions of 5.3.3:
 * `size` is the radius, length or side, `width` the width of a line, `height`
 * the height of a cylinder. A cube has its side in `size` and nothing else.
 */
function template(
  args: Data,
  required: boolean,
  problems: string[],
  warnings: string[]
): { template: Data; affects: Data; area: string | null } {
  const type = args['areaType'] === undefined ? '' : args['areaType'];
  const units = args['areaUnits'] === undefined ? 'ft' : args['areaUnits'];
  const affectsType = args['affectsType'] === undefined ? 'creature' : args['affectsType'];
  if (!(AREA_TYPES as readonly unknown[]).includes(type))
    problems.push(`areaType must be one of ${AREA_TYPES.filter(Boolean).join(', ')}`);
  if (units !== 'ft' && units !== 'm') problems.push('areaUnits must be "ft" or "m"');
  if (!['creature', 'object', 'space', ''].includes(String(affectsType)))
    problems.push('affectsType must be creature, object, space or empty');
  const affects = { count: '', type: affectsType, choice: false, special: '' };
  if (!type) {
    if (required) problems.push('areaType is required');
    return { template: { ...EMPTY_TEMPLATE, units }, affects, area: null };
  }
  const size = num(args['areaSize']);
  if (size === null || size <= 0) {
    problems.push('areaSize must be a number above 0');
    return { template: { ...EMPTY_TEMPLATE, units }, affects, area: null };
  }
  let stored = String(type);
  let width = '';
  let height = '';
  if (type === 'emanation') {
    stored = 'radius';
    warnings.push(
      'dnd5e has no emanation template; it was stored as a radius of the same size, centred on a point rather than around the creature.'
    );
  } else if (type === 'line') {
    width = units === 'm' ? '1.5' : '5';
    warnings.push(`The line got the usual width of ${width} ${units}; areaSize is its length.`);
  } else if (type === 'cylinder') {
    height = String(size);
    warnings.push(
      `The cylinder got a height equal to its radius (${size} ${units}); change it on the sheet if the feature says otherwise.`
    );
  }
  return {
    template: {
      count: '',
      contiguous: false,
      type: stored,
      size: String(size),
      width,
      height,
      units,
    },
    affects,
    area: `${size}-${units} ${type}`,
  };
}

function activity(type: string, random: () => number, body: Data): Data {
  const id = randomId(random);
  return {
    _id: id,
    type,
    sort: 0,
    consumption: { scaling: { allowed: false }, spellSlot: true, targets: [] },
    description: {},
    duration: { units: 'inst', concentration: false, override: false },
    effects: [],
    range: { override: false },
    target: {
      template: { ...EMPTY_TEMPLATE },
      affects: { count: '', type: '', choice: false, special: '' },
      override: false,
      prompt: true,
    },
    uses: { spent: 0, recovery: [] },
    ...body,
  };
}

function saveBody(
  args: Data,
  damageField: string,
  onSave: string,
  problems: string[],
  warnings: string[]
): Data {
  const ability = args['saveAbility'];
  if (!(ABILITY_KEYS as readonly unknown[]).includes(ability))
    problems.push(`saveAbility must be one of ${ABILITY_KEYS.join(', ')}`);
  const dc = num(args['saveDC']);
  if (dc === null || dc < 1 || dc > 30 || !Number.isInteger(dc))
    problems.push('saveDC must be a whole number from 1 to 30');
  return {
    save: { ability: [ability], dc: { calculation: '', formula: String(dc ?? '') } },
    damage: { onSave, parts: damageParts(args[damageField], damageField, problems, warnings) },
  };
}

function nameOf(args: Data, problems: string[]): string {
  const name = text(args['featureName']).trim();
  if (!name) problems.push('featureName must be a non-empty text');
  return name;
}

function feat(
  name: string,
  args: Data,
  context: FeatureContext,
  problems: string[],
  activities: Data[]
): Data {
  return {
    name,
    type: 'feat',
    system: {
      description: { value: text(args['description']), chat: '' },
      source: source(args, context, problems),
      type: { value: 'monster', subtype: '' },
      activities: Object.fromEntries(activities.map(entry => [entry['_id'] as string, entry])),
    },
  };
}

/** The item for passive, save, attack, attack-with-save or aura. */
export function buildFeatureItem(args: Data, context: FeatureContext = {}): FeatureBuild {
  const random = context.random ?? Math.random;
  const problems: string[] = [];
  const warnings: string[] = [];
  const featureType = args['featureType'];
  const name = nameOf(args, problems);
  const details: Data = { featureType };

  if (featureType === 'passive') {
    return { item: feat(name, args, context, problems, []), problems, warnings, details };
  }

  if (featureType === 'save' || featureType === 'aura') {
    const act = activation(args, problems);
    const area = template(args, featureType === 'aura', problems, warnings);
    const body: Data =
      featureType === 'save'
        ? saveBody(
            args,
            'damageParts',
            args['halfOnSave'] === false ? 'none' : 'half',
            problems,
            warnings
          )
        : {
            damage: {
              critical: { allow: false },
              parts: damageParts(args['damageParts'], 'damageParts', problems, warnings),
            },
          };
    const entry = activity(featureType === 'save' ? 'save' : 'damage', random, {
      activation: act,
      target: { template: area.template, affects: area.affects, override: false, prompt: true },
      ...body,
    });
    details['activation'] = act['type'];
    details['area'] = area.area;
    if (featureType === 'save') {
      details['save'] = `DC ${String(args['saveDC'])} ${String(args['saveAbility'])}`;
      details['onSave'] = (body['damage'] as Data)['onSave'];
    } else {
      warnings.push(
        'An aura is a damage activity someone has to use; no lasting aura or active effect was created.'
      );
    }
    return { item: feat(name, args, context, problems, [entry]), problems, warnings, details };
  }

  if (featureType === 'attack' || featureType === 'attack-with-save') {
    const attackType = args['attackType'];
    if (attackType !== 'melee' && attackType !== 'ranged')
      problems.push('attackType must be "melee" or "ranged"');
    const ranged = attackType === 'ranged';
    const weaponClass = args['weaponClass'] === undefined ? 'natural' : args['weaponClass'];
    if (!(WEAPON_CLASSES as readonly unknown[]).includes(weaponClass))
      problems.push(`weaponClass must be one of ${WEAPON_CLASSES.join(', ')}`);

    const properties = Array.isArray(args['properties'])
      ? args['properties']
          .filter((entry): entry is string => typeof entry === 'string')
          .map(entry => entry.trim())
      : [];
    const strange = properties.filter(
      entry => !(WEAPON_PROPERTIES as readonly string[]).includes(entry)
    );
    if (strange.length)
      warnings.push(
        `Weapon propert(ies) ${quote(strange)} are not dnd5e weapon property keys: stored, but dnd5e does not apply them. Known: ${WEAPON_PROPERTIES.join(', ')}.`
      );

    // The ability: given; else, for a finesse or natural weapon, the better of Strength and
    // Dexterity, which is what dnd5e 5.3.3 itself allows those weapons (weapon.mjs,
    // availableAbilities); else what the server computed (both generations send it); else
    // Strength in melee, Dexterity at range. It is always written, because an explicit key
    // wins in attack-data.mjs under both rules versions and the answer can then name it.
    let ability: unknown = args['abilityModifier'];
    let abilitySource = 'given';
    const eitherAbility = properties.includes('fin') || weaponClass === 'natural';
    if (ability === undefined && eitherAbility && context.abilities) {
      const str = abilityMod(context.abilities.str);
      const dex = abilityMod(context.abilities.dex);
      ability = dex > str ? 'dex' : 'str';
      abilitySource = properties.includes('fin') ? 'finesse' : 'natural weapon';
    }
    if (ability === undefined && args['effectiveAbility'] !== undefined) {
      ability = args['effectiveAbility'];
      abilitySource = 'server default';
    }
    if (ability === undefined) {
      ability = ranged ? 'dex' : 'str';
      abilitySource = 'default';
    }
    if (!(ABILITY_KEYS as readonly unknown[]).includes(ability))
      problems.push(`abilityModifier must be one of ${ABILITY_KEYS.join(', ')}`);

    const bonus = args['attackBonus'] === undefined ? 0 : num(args['attackBonus']);
    if (bonus === null || bonus < 0 || bonus > 10)
      problems.push('attackBonus must be a number from 0 to 10');

    const reach = args['reachFt'] === undefined ? 5 : num(args['reachFt']);
    const range = num(args['rangeFt']);
    const long = num(args['longRangeFt']);
    if (!ranged && (reach === null || reach < 5)) problems.push('reachFt must be at least 5');
    if (ranged && (range === null || range < 1))
      problems.push('rangeFt must be at least 1 for a ranged attack');
    if (long !== null && (range === null || long <= range))
      problems.push('longRangeFt must be greater than rangeFt');
    if (!ranged && (args['rangeFt'] !== undefined || args['longRangeFt'] !== undefined))
      warnings.push('rangeFt and longRangeFt were ignored: a melee attack uses reachFt.');

    const parts = damageParts(args['damageParts'], 'damageParts', problems, warnings);
    const [base, ...extra] = parts;
    const proficient = args['proficient'] === false ? 0 : 1;

    const attack = activity('attack', random, {
      activation: activation(args, problems),
      attack: {
        ability,
        bonus: bonus ? String(bonus) : '',
        critical: { threshold: null },
        flat: false,
        type: { value: ranged ? 'ranged' : 'melee', classification: 'weapon' },
      },
      // The first part is the weapon's base damage, which the activity includes; never twice.
      damage: { critical: {}, includeBase: true, parts: extra },
    });
    const activities = [attack];
    if (featureType === 'attack-with-save') {
      const onSave = args['saveOnSave'] === 'half' ? 'half' : 'none';
      if (
        args['saveOnSave'] !== undefined &&
        args['saveOnSave'] !== 'half' &&
        args['saveOnSave'] !== 'none'
      )
        problems.push('saveOnSave must be "half" or "none"');
      activities.push(
        activity('save', random, {
          activation: activation(args, problems),
          ...saveBody(args, 'saveDamageParts', onSave, problems, warnings),
        })
      );
      details['save'] =
        `DC ${String(args['saveDC'])} ${String(args['saveAbility'])}, ${onSave} damage on a success`;
    }

    details['attack'] = `${ranged ? 'ranged' : 'melee'} ${String(weaponClass)}`;
    details['ability'] = ability;
    details['abilitySource'] = abilitySource;
    details['proficient'] = proficient === 1;
    details['attackBonus'] = bonus ?? 0;
    details['reach'] = ranged ? null : reach;
    details['range'] = ranged ? { normal: range, long } : null;

    const item: Data = {
      name,
      type: 'weapon',
      system: {
        description: { value: text(args['description']), chat: '' },
        source: source(args, context, problems),
        quantity: 1,
        equipped: args['equipped'] !== false,
        proficient,
        type: { value: weaponClass, baseItem: '' },
        properties,
        range: ranged
          ? { value: range, long, reach: null, units: 'ft' }
          : { value: null, long: null, reach, units: 'ft' },
        damage: {
          base: base ?? null,
          versatile: {
            number: null,
            denomination: null,
            bonus: '',
            types: [],
            custom: { enabled: false, formula: '' },
            scaling: { mode: '', number: null, formula: '' },
          },
        },
        activities: Object.fromEntries(activities.map(entry => [entry['_id'] as string, entry])),
      },
    };
    return { item, problems, warnings, details };
  }

  problems.push(`featureType "${String(featureType)}" does not build an item`);
  return { item: {}, problems, warnings, details };
}
