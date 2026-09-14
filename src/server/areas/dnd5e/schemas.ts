/**
 * Input schemas of the three NPC builder tools.
 *
 * Names, types, enumerations, bounds, defaults and required fields are those
 * of the tool directory of the previous generation (a test compares them); the descriptions
 * are written for this rewrite and say what the tools really do, e.g. that an
 * actor is found by id or exact name and never by part of its name.
 */
import {
  ABILITY_KEYS,
  CREATURE_TYPE_KEYS,
  SIZE_KEYS,
  SKILL_NAMES,
  SPELLCASTING_CLASSES,
} from '../../../common/areas/dnd5e/rules.js';
import {
  ACTIVATION_TYPES,
  AREA_TYPES,
  DIE_SIZES,
  FEATURE_TYPES,
  WEAPON_CLASSES,
} from '../../../common/areas/dnd5e/feature-data.js';

type Schema = Record<string, unknown>;

const word = (description: string, extra: Schema = {}): Schema => ({
  type: 'string',
  description,
  ...extra,
});
const amount = (description: string, extra: Schema = {}): Schema => ({
  type: 'number',
  description,
  ...extra,
});
const yesNo = (description: string, fallback: boolean): Schema => ({
  type: 'boolean',
  description,
  default: fallback,
});
const oneOf = (
  values: readonly (string | number)[],
  description: string,
  extra: Schema = {}
): Schema => ({
  type: typeof values[0] === 'number' ? 'number' : 'string',
  enum: [...values],
  description,
  ...extra,
});
const many = (items: Schema, description: string, extra: Schema = {}): Schema => ({
  type: 'array',
  description,
  items,
  ...extra,
});
const record = (
  properties: Record<string, Schema>,
  required: readonly string[],
  description?: string
): Schema => ({
  type: 'object',
  ...(description ? { description } : {}),
  properties,
  required: [...required],
});

const abilityList = [...ABILITY_KEYS];
const feet = (what: string, fallback = 0): Schema =>
  amount(`${what} in feet; 0 means none`, { minimum: 0, default: fallback });
const words = (description: string): Schema =>
  many({ type: 'string' }, description, { default: [] });

const actorRef =
  'The actor: its id, its exact name (case does not matter) or the id of one of its tokens. Parts of a name are not matched';

const damagePart = record(
  {
    number: amount('How many dice', { minimum: 1 }),
    denomination: oneOf(DIE_SIZES, 'Faces of each die'),
    type: word(
      'Damage type key such as "fire" or "piercing"; other words are stored with a warning'
    ),
  },
  ['number', 'denomination', 'type']
);

// dnd5e-create-npc --------------------------------------------------------------------------------

export const createNpcSchema: Schema = {
  type: 'object',
  properties: {
    name: word('Name of the new NPC; refused when any actor already has it, ignoring case'),
    creatureType: oneOf(
      'humanoid undead beast dragon aberration construct elemental fey fiend giant monstrosity ooze plant celestial swarm'.split(
        ' '
      ),
      `Creature type, one of ${CREATURE_TYPE_KEYS.length} dnd5e keys. dnd5e has no type "swarm": it is stored as a custom type with a warning`
    ),
    creatureSubtype: word('Subtype such as "goblinoid"', { default: '' }),
    size: oneOf(Object.keys(SIZE_KEYS), 'Size; stored as the dnd5e key (sm, med, lg, grg)'),
    alignment: word('Alignment as text, e.g. "chaotic evil"', { default: '' }),
    cr: {
      description:
        'Challenge rating: 0, 1/8, 1/4, 1/2 or a whole number up to 30, as number or text. Anything else is refused',
      oneOf: [
        { type: 'string', pattern: '^\\d+(\\/[248])?$' },
        { type: 'number', minimum: 0 },
      ],
    },
    hpAverage: amount('Hit points, stored as current and maximum', { minimum: 1 }),
    hpFormula: word('Hit dice formula, e.g. "3d8+6"'),
    acMode: oneOf(
      ['default', 'flat'],
      '"default" lets dnd5e calculate the armor class; "flat" stores acValue'
    ),
    acValue: amount('Armor class for acMode "flat"', { minimum: 0, maximum: 30 }),
    abilities: record(
      Object.fromEntries(
        abilityList.map(key => [
          key,
          amount(`${key.toUpperCase()} score`, { minimum: 1, maximum: 30 }),
        ])
      ),
      abilityList,
      'All six ability scores'
    ),
    savingThrows: many(
      oneOf(abilityList, 'Ability'),
      'Abilities whose saving throws are proficient',
      { default: [] }
    ),
    walkSpeed: feet('Walking speed', 30),
    flySpeed: feet('Flying speed'),
    swimSpeed: feet('Swimming speed'),
    climbSpeed: feet('Climbing speed'),
    burrowSpeed: feet('Burrowing speed'),
    hover: yesNo('The creature hovers while flying', false),
    darkvision: feet('Darkvision'),
    blindsight: feet('Blindsight'),
    tremorsense: feet('Tremorsense'),
    truesight: feet('Truesight'),
    specialSenses: word('Other senses as text', { default: '' }),
    skills: many(
      record(
        {
          skill: oneOf(SKILL_NAMES, 'Skill'),
          proficiency: oneOf(
            ['proficient', 'expert'],
            'Proficient adds the proficiency bonus once, expert twice'
          ),
        },
        ['skill', 'proficiency']
      ),
      'Skills with proficiency or expertise',
      { default: [] }
    ),
    damageImmunities: words(
      'Damage type keys the NPC is immune to; unknown words go into the custom text with a warning'
    ),
    damageResistances: words(
      'Damage type keys the NPC resists; unknown words go into the custom text with a warning'
    ),
    damageVulnerabilities: words(
      'Damage type keys the NPC is vulnerable to; unknown words go into the custom text with a warning'
    ),
    conditionImmunities: words(
      'Condition keys such as "charmed"; unknown words go into the custom text with a warning'
    ),
    languages: words(
      'Languages by key or English name, e.g. "Common" or "goblin"; unknown ones go into the custom text with a warning'
    ),
    languagesCustom: word('Free text for languages, e.g. "telepathy 60 ft."', { default: '' }),
    biography: word('Biography as HTML', { default: '' }),
    sourceBook: word('Source book, e.g. "MM"', { default: '' }),
    sourcePage: word('Page in the source book', { default: '' }),
    sourceRules: oneOf(
      ['2014', '2024'],
      'Rules version of the source; the world setting of dnd5e when left out',
      { default: '2014' }
    ),
  },
  required: ['name', 'creatureType', 'size', 'cr', 'abilities', 'hpAverage', 'hpFormula', 'acMode'],
};

// dnd5e-add-feature -----------------------------------------------------------------------------------

const onlyFor = (modes: string) => ` Used by: ${modes}.`;

export const addFeatureSchema: Schema = {
  type: 'object',
  properties: {
    featureType: oneOf(
      FEATURE_TYPES,
      'What to add; each kind reads only its own parameters and names the ones it ignored'
    ),
    actorIdentifier: word(`${actorRef}. Needed by every kind`),
    featureName: word(
      `Name of the new item; refused when the actor has an item of that name, ignoring case.${onlyFor('passive, save, attack, attack-with-save, aura')}`
    ),
    description: word(
      `Description as HTML.${onlyFor('passive, save, attack, attack-with-save, aura')}`,
      { default: '' }
    ),
    activationType: oneOf(
      ACTIVATION_TYPES,
      `How it is used in the action economy.${onlyFor('save, attack, attack-with-save, aura')}`,
      { default: 'action' }
    ),
    damageParts: many(
      damagePart,
      `Damage. For an attack the first part is the weapon damage and further parts add to it.${onlyFor('save, attack, attack-with-save, aura')}`,
      { minItems: 1 }
    ),
    saveAbility: oneOf(
      abilityList,
      `Ability of the saving throw.${onlyFor('save, attack-with-save')}`
    ),
    saveDC: amount(`Fixed difficulty class of the save.${onlyFor('save, attack-with-save')}`, {
      minimum: 1,
      maximum: 30,
    }),
    halfOnSave: yesNo(`Half damage on a successful save; otherwise none.${onlyFor('save')}`, true),
    saveDamageParts: many(
      damagePart,
      `Damage of the separate save that follows a hit.${onlyFor('attack-with-save')}`,
      { minItems: 1 }
    ),
    saveOnSave: oneOf(
      ['half', 'none'],
      `Damage of that save on a success.${onlyFor('attack-with-save')}`,
      { default: 'none' }
    ),
    areaType: oneOf(
      AREA_TYPES,
      `Template shape. An emanation is stored as a radius; a line gets a width, a cylinder a height, a cube its side in every direction.${onlyFor('save (optional), aura (required)')}`,
      { default: '' }
    ),
    areaSize: amount(
      `Size of the template in areaUnits (length of a line, radius of a sphere).${onlyFor('save with areaType, aura')}`,
      { exclusiveMinimum: 0 }
    ),
    areaUnits: oneOf(['ft', 'm'], `Units of areaSize.${onlyFor('save, aura')}`, { default: 'ft' }),
    affectsType: oneOf(
      ['creature', 'object', 'space', ''],
      `What the area affects.${onlyFor('save, aura')}`,
      { default: 'creature' }
    ),
    attackType: oneOf(
      ['melee', 'ranged'],
      `Melee uses reachFt, ranged needs rangeFt.${onlyFor('attack, attack-with-save')}`
    ),
    weaponClass: oneOf(
      WEAPON_CLASSES,
      `Weapon category; "natural" for claws and bites.${onlyFor('attack, attack-with-save')}`,
      { default: 'natural' }
    ),
    abilityModifier: oneOf(
      abilityList,
      `Ability for attack and damage. Left out: the better of STR and DEX for a natural weapon or one with the property "fin", as dnd5e allows them, else STR in melee and DEX at range. Written into the attack under both rules versions.${onlyFor('attack, attack-with-save')}`
    ),
    attackBonus: amount(
      `Extra bonus to hit, not to damage.${onlyFor('attack, attack-with-save')}`,
      { minimum: 0, maximum: 10, default: 0 }
    ),
    proficient: yesNo(
      `Whether the proficiency bonus is added to hit; false stores a non-proficient weapon.${onlyFor('attack, attack-with-save')}`,
      true
    ),
    equipped: yesNo(`Whether the weapon is equipped.${onlyFor('attack, attack-with-save')}`, true),
    reachFt: amount(`Reach in feet.${onlyFor('melee attack, attack-with-save')}`, {
      minimum: 5,
      default: 5,
    }),
    rangeFt: amount(
      `Normal range in feet, needed for a ranged attack.${onlyFor('attack, attack-with-save')}`,
      { minimum: 1 }
    ),
    longRangeFt: amount(
      `Long range in feet, greater than rangeFt.${onlyFor('ranged attack, attack-with-save')}`,
      { minimum: 1 }
    ),
    properties: many(
      { type: 'string' },
      `dnd5e weapon property keys such as "fin", "lgt", "rch", "thr"; unknown keys are stored with a warning.${onlyFor('attack, attack-with-save')}`,
      { default: [] }
    ),
    spellcastingClass: oneOf(
      SPELLCASTING_CLASSES,
      `Class whose table gives the spell slots; warlock uses pact magic.${onlyFor('spellcasting')}`
    ),
    spellcastingLevel: amount(`Class level from 1 to 20.${onlyFor('spellcasting')}`, {
      minimum: 1,
      maximum: 20,
    }),
    spellcastingAbility: oneOf(
      abilityList,
      `Casting ability; left out, INT for wizard and artificer, WIS for cleric, druid and ranger, CHA for bard, paladin, sorcerer and warlock.${onlyFor('spellcasting')}`
    ),
    spellNames: many(
      { type: 'string', minLength: 1 },
      `English spell names, matched whole and ignoring case.${onlyFor('spells')}`,
      { minItems: 1, maxItems: 50 }
    ),
    compendiumPacks: many(
      { type: 'string', minLength: 1 },
      `Item compendiums to search, first match wins. Left out: the standard spell compendium of the world's rules version (dnd5e.spells for 2014, dnd5e.spells24 for 2024).${onlyFor('spells')}`,
      { default: ['dnd5e.spells'] }
    ),
    sourceRules: oneOf(
      ['2014', '2024'],
      `Rules version. Decides the slots of paladin and ranger at level 1 and is stored as the source of an item; the world setting of dnd5e when left out.${onlyFor('passive, save, attack, attack-with-save, aura, spellcasting')}`,
      { default: '2014' }
    ),
    sourceBook: word(
      `Source book, e.g. "MM".${onlyFor('passive, save, attack, attack-with-save, aura')}`,
      { default: '' }
    ),
    sourcePage: word(
      `Page in the source book.${onlyFor('passive, save, attack, attack-with-save, aura')}`,
      { default: '' }
    ),
  },
  required: ['featureType', 'actorIdentifier'],
};

// dnd5e-add-features-from-compendium ----------------------------------------------------------------------

export const addFeaturesFromCompendiumSchema: Schema = {
  type: 'object',
  properties: {
    actorIdentifier: word(actorRef),
    featureNames: many(
      { type: 'string', minLength: 1 },
      'English names of class or monster features, matched whole and ignoring case; at most 50',
      {
        minItems: 1,
        maxItems: 50,
      }
    ),
    compendiumPacks: many(
      { type: 'string', minLength: 1 },
      "Item compendiums to search, first match wins. Left out: the standard feature compendiums of the world's rules version (dnd5e.monsterfeatures and dnd5e.classfeatures for 2014, dnd5e.monsterfeatures24 for 2024; 2024 class features live inside the class items)",
      { default: ['dnd5e.monsterfeatures', 'dnd5e.classfeatures'] }
    ),
  },
  required: ['actorIdentifier', 'featureNames'],
};
