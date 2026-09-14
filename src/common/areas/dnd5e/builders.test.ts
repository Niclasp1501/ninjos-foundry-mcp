import { describe, expect, it } from 'vitest';
import { buildFeatureItem, checkFeatureArguments } from './feature-data.js';
import { buildNpcData } from './npc-data.js';
import { at } from './rules.js';

const languages = {
  keys: ['common', 'goblin', 'cant'],
  byLabel: { common: 'common', "thieves' cant": 'cant' },
};

const npcArgs = {
  name: 'Bandit Captain',
  creatureType: 'humanoid',
  size: 'medium',
  cr: '2',
  hpAverage: 65,
  hpFormula: '10d8+20',
  acMode: 'flat',
  acValue: 15,
  abilities: { str: 15, dex: 16, con: 14, int: 14, wis: 11, cha: 14 },
  savingThrows: ['str', 'dex'],
  skills: [
    { skill: 'Athletics', proficiency: 'proficient' },
    { skill: 'Deception', proficiency: 'expert' },
  ],
  languages: ['Common', "Thieves' Cant", 'Elvish Sign'],
  damageResistances: ['fire', 'magic'],
  darkvision: 60,
};

describe('NPC data', () => {
  it('builds dnd5e 5.3 data and never writes proficiency bonus or experience', () => {
    const build = buildNpcData(npcArgs, { systemVersion: '5.3.3', languages });
    expect(build.problems).toEqual([]);
    const system = build.data['system'];
    expect(at(system, 'details.cr')).toBe(2);
    expect(at(system, 'traits.size')).toBe('med');
    expect(at(system, 'attributes.ac')).toEqual({ calc: 'flat', flat: 15 });
    expect(at(system, 'abilities.str')).toEqual({ value: 15, proficient: 1 });
    expect(at(system, 'skills.dec')).toEqual({ value: 2 });
    expect(at(system, 'attributes.senses.ranges.darkvision')).toBe(60);
    expect(at(system, 'attributes.movement.walk')).toBe(30);
    expect(at(system, 'attributes.prof')).toBeUndefined();
    expect(at(system, 'details.xp')).toBeUndefined();
    expect(at(system, 'traits.languages.value')).toEqual(['common', 'cant']);
    expect(at(system, 'traits.languages.custom')).toBe('Elvish Sign');
    expect(at(system, 'traits.dr')).toEqual({ value: ['fire'], custom: 'magic' });
    expect(build.warnings.join(' ')).toMatch(/"Elvish Sign" is not a key of dnd5e/);
    expect(build.warnings.join(' ')).toMatch(/"magic" is not a key/);
  });

  it('puts speeds and senses where the dnd5e version expects them', () => {
    const newer = buildNpcData(npcArgs, { systemVersion: '6.0.1', languages });
    expect(at(newer.data['system'], 'attributes.movement.speeds.walk')).toBe(30);
    const older = buildNpcData(npcArgs, { systemVersion: '5.2.5', languages });
    expect(at(older.data['system'], 'attributes.senses.darkvision')).toBe(60);
  });

  it('refuses a challenge rating the rules do not have, and a flat armor class without a value', () => {
    const build = buildNpcData(
      { ...npcArgs, cr: 0.3, acValue: undefined },
      { systemVersion: '5.3.3', languages }
    );
    expect(build.problems.join(' ')).toMatch(/cr must be a challenge rating of the rules/);
    expect(build.problems.join(' ')).toMatch(/acMode "flat" needs acValue/);
  });

  it('stores a swarm as a custom type and says why', () => {
    const build = buildNpcData(
      { ...npcArgs, creatureType: 'swarm' },
      { systemVersion: '5.3.3', languages }
    );
    expect(at(build.data['system'], 'details.type')).toMatchObject({
      value: 'custom',
      custom: 'Swarm',
    });
    expect(build.warnings.join(' ')).toMatch(/no creature type "swarm"/);
  });

  it('takes the world rules when sourceRules is not given', () => {
    const build = buildNpcData(npcArgs, { systemVersion: '5.3.3', languages, worldRules: '2024' });
    expect(at(build.data['system'], 'source.rules')).toBe('2024');
    expect(at(build.data['system'], 'details.source')).toBeUndefined();
  });
});

const damage = [{ number: 2, denomination: 6, type: 'slashing' }];
const ids = () => {
  let n = 0;
  return () => ((n += 7) % 62) / 62;
};

describe('feature arguments', () => {
  it('names missing and ignored parameters per kind', () => {
    const check = checkFeatureArguments({
      featureType: 'attack',
      actorIdentifier: 'x',
      featureName: 'Bow',
      attackType: 'ranged',
      saveDC: 12,
      damageParts: damage,
    });
    expect(check.problems).toEqual(['rangeFt is required for a ranged attack']);
    expect(check.ignored).toEqual(['saveDC']);
    expect(checkFeatureArguments({ featureType: 'aura', actorIdentifier: 'x' }).problems).toEqual([
      'featureName is required for featureType "aura"',
      'damageParts is required for featureType "aura"',
      'areaType is required for featureType "aura"',
      'areaSize is required for featureType "aura"',
    ]);
    expect(checkFeatureArguments({ featureType: 'fly' }).problems[0]).toMatch(
      /featureType must be one of/
    );
  });

  it('accepts what a server of the previous generation adds', () => {
    const check = checkFeatureArguments({
      featureType: 'spellcasting',
      actorIdentifier: 'x',
      spellcastingClass: 'wizard',
      spellcastingLevel: 3,
      effectiveAbility: 'int',
      serverDefaults: [],
    });
    expect(check).toMatchObject({ problems: [], ignored: [] });
  });
});

describe('feature items', () => {
  it('writes the attack ability and proficiency as given, and the base damage once', () => {
    const build = buildFeatureItem(
      {
        featureType: 'attack',
        featureName: 'Claw',
        attackType: 'melee',
        proficient: false,
        damageParts: [...damage, { number: 1, denomination: 4, type: 'fire' }],
        sourceRules: '2014',
      },
      { random: ids() }
    );
    expect(build.problems).toEqual([]);
    const system = build.item['system'];
    expect(build.item['type']).toBe('weapon');
    expect(at(system, 'proficient')).toBe(0);
    expect(at(system, 'damage.base')).toMatchObject({
      number: 2,
      denomination: 6,
      types: ['slashing'],
    });
    expect(at(system, 'range')).toEqual({ value: null, long: null, reach: 5, units: 'ft' });
    const [activity] = Object.values(
      at(system, 'activities') as Record<string, Record<string, unknown>>
    );
    expect(at(activity, 'attack.ability')).toBe('str');
    expect(at(activity, 'damage.includeBase')).toBe(true);
    expect((at(activity, 'damage.parts') as unknown[]).length).toBe(1);
    expect(build.details).toMatchObject({
      ability: 'str',
      abilitySource: 'default',
      proficient: false,
    });
  });

  it('picks the better of STR and DEX for a finesse weapon', () => {
    const build = buildFeatureItem(
      {
        featureType: 'attack',
        featureName: 'Rapier',
        attackType: 'melee',
        properties: ['fin', 'zzz'],
        damageParts: damage,
        effectiveAbility: 'str',
      },
      { abilities: { str: 10, dex: 18 } }
    );
    expect(build.details).toMatchObject({ ability: 'dex', abilitySource: 'finesse' });
    expect(build.warnings.join(' ')).toMatch(/"zzz" are not dnd5e weapon property keys/);
  });

  it('picks the better of STR and DEX for a natural weapon, as dnd5e allows it', () => {
    const build = buildFeatureItem(
      {
        featureType: 'attack',
        featureName: 'Bite',
        attackType: 'melee',
        damageParts: damage,
        effectiveAbility: 'str',
      },
      { abilities: { str: 8, dex: 14 } }
    );
    expect(build.details).toMatchObject({ ability: 'dex', abilitySource: 'natural weapon' });
    const given = buildFeatureItem(
      {
        featureType: 'attack',
        featureName: 'Bite',
        attackType: 'melee',
        damageParts: damage,
        abilityModifier: 'str',
      },
      { abilities: { str: 8, dex: 14 } }
    );
    expect(given.details).toMatchObject({ ability: 'str', abilitySource: 'given' });
  });

  it('refuses a long range that is not longer', () => {
    const build = buildFeatureItem({
      featureType: 'attack',
      featureName: 'Bow',
      attackType: 'ranged',
      rangeFt: 80,
      longRangeFt: 60,
      damageParts: damage,
    });
    expect(build.problems).toContain('longRangeFt must be greater than rangeFt');
  });

  it('builds a save with its source rules and a line with a width', () => {
    const build = buildFeatureItem(
      {
        featureType: 'save',
        featureName: 'Acid Spray',
        saveAbility: 'dex',
        saveDC: 13,
        damageParts: [{ number: 4, denomination: 8, type: 'acid' }],
        areaType: 'line',
        areaSize: 30,
        halfOnSave: false,
      },
      { worldRules: '2024' }
    );
    expect(build.problems).toEqual([]);
    const system = build.item['system'];
    expect(at(system, 'source.rules')).toBe('2024');
    expect(at(system, 'type')).toEqual({ value: 'monster', subtype: '' });
    const [activity] = Object.values(
      at(system, 'activities') as Record<string, Record<string, unknown>>
    );
    expect(at(activity, 'save')).toEqual({
      ability: ['dex'],
      dc: { calculation: '', formula: '13' },
    });
    expect(at(activity, 'damage.onSave')).toBe('none');
    expect(at(activity, 'target.template')).toMatchObject({ type: 'line', size: '30', width: '5' });
  });

  it('gives cubes and cylinders their other dimensions and turns an emanation into a radius', () => {
    const area = (areaType: string) =>
      buildFeatureItem({
        featureType: 'aura',
        featureName: 'Heat',
        damageParts: [{ number: 1, denomination: 6, type: 'fire' }],
        areaType,
        areaSize: 10,
      });
    const template = (areaType: string) =>
      at(
        Object.values(
          at(area(areaType).item['system'], 'activities') as Record<string, unknown>
        )[0],
        'target.template'
      );
    expect(template('cube')).toMatchObject({ type: 'cube', size: '10', width: '', height: '' });
    expect(template('cylinder')).toMatchObject({ type: 'cylinder', height: '10' });
    expect(template('emanation')).toMatchObject({ type: 'radius', size: '10' });
    expect(area('emanation').warnings.join(' ')).toMatch(/no emanation template/);
  });

  it('adds a second, separate save to an attack with save', () => {
    const build = buildFeatureItem({
      featureType: 'attack-with-save',
      featureName: 'Sting',
      attackType: 'melee',
      damageParts: [{ number: 1, denomination: 6, type: 'piercing' }],
      saveAbility: 'con',
      saveDC: 11,
      saveDamageParts: [{ number: 2, denomination: 6, type: 'venom' }],
      saveOnSave: 'half',
    });
    const activities = Object.values(
      at(build.item['system'], 'activities') as Record<string, Record<string, unknown>>
    );
    expect(activities.map(entry => entry['type'])).toEqual(['attack', 'save']);
    expect(at(activities[1], 'damage.onSave')).toBe('half');
    expect(build.warnings.join(' ')).toMatch(
      /"venom" in saveDamageParts are not dnd5e damage types/
    );
  });
});
