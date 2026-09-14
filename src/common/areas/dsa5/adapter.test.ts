import { describe, expect, it } from 'vitest';
import { SystemAdapterRegistry } from '../../game-systems.js';
import {
  conditionEffectData,
  creatureRow,
  dsa5Adapter,
  normalizeActorSystem,
  rollPlan,
  spellcastingEntries,
} from './adapter.js';
import { checkCustomization, customizationMismatches, heroData } from './archetype.js';
import { ALRIK, ARCHETYPES, WOLF } from './sample-data.js';
import { combatTechniqueValues, energy, experienceLevel, lifePoints } from './rules.js';

type Json = Record<string, any>;

describe('prepared data from the module', () => {
  it('reads characteristic values and maxima DSA5 prepared, and says where they came from', () => {
    const summary = (actor: Json) => dsa5Adapter.characters?.summary(actor) as Json;
    expect(summary(ALRIK).stats['valuesFrom']).toBe('stored');

    const alrik = structuredClone(ALRIK) as Json;
    alrik['preparedData'] = true;
    alrik['system'].characteristics.mu.value = 17;
    alrik['system'].status.wounds.max = 41;
    const prepared = summary(alrik);
    expect(prepared.stats.characteristics.MU.value).toBe(17);
    expect(prepared.basicInfo.lifePoints).toMatchObject({ max: 41 });
    expect(prepared.stats['valuesFrom']).toBe('prepared');
  });
});

describe('the adapter in the core registry', () => {
  it('answers every area DSA5 knows and claims no capability it lacks', () => {
    const registry = new SystemAdapterRegistry();
    registry.register(dsa5Adapter, 'dsa5');
    const system = registry.describe('DSA5', '8.1.5');
    expect(system.title).toBe('Das Schwarze Auge 5');
    expect(system.capabilities).toEqual({
      creatureIndex: true,
      characterStats: true,
      spells: true,
      powerMeasure: true,
    });
    for (const area of [
      'creatures',
      'compendiumStats',
      'characters',
      'spells',
      'characterSearch',
      'itemUse',
      'conditions',
      'rolls',
      'actorData',
      'worldItems',
      'compendiums',
    ] as const)
      expect(registry.answer(system, area).fromAdapter, area).toBe(true);
    const filters = registry.answer(system, 'creatures').questions.filters.map(f => f.name);
    expect(filters).toEqual([
      'name',
      'actorType',
      'packId',
      'level',
      'species',
      'culture',
      'profession',
      'size',
      'hasSpells',
      'hasLiturgies',
      'experiencePoints',
    ]);
    expect(registry.answer(system, 'conditions').fallbackFor).toEqual([]);
  });
});

describe('rules from the data model', () => {
  it('uses the start budgets as experience levels', () => {
    expect(
      [0, 999, 1000, 1100, 1399, 1400, 2100, 5000].map(ap => experienceLevel(ap).level)
    ).toEqual([1, 1, 2, 3, 4, 5, 7, 7]);
  });

  it('reads current LeP from value and derives the maximum per actor type', () => {
    expect(lifePoints(ALRIK)).toEqual({ value: 25, max: 5 + 2 * 12 });
    expect(lifePoints(WOLF)).toEqual({ value: 22, max: 22 });
    expect(energy(ALRIK, 'astral')).toEqual({ value: 30, max: 34 });
    expect(energy(ALRIK, 'karma')).toBeNull();
  });

  it('computes attack and parry of combat techniques by the rule book', () => {
    const [daggers, crossbows] = ALRIK.items.filter(item => item.type === 'combatskill');
    expect(combatTechniqueValues(ALRIK.system, daggers as Json)).toEqual({
      value: 8,
      attack: 9,
      parry: 5,
      ranged: false,
    });
    expect(combatTechniqueValues(ALRIK.system, crossbows as Json)).toMatchObject({
      attack: 8,
      parry: null,
    });
  });
});

describe('creatures and characters', () => {
  it('builds index rows with level, species and derived pools, and none for creatures without AP', () => {
    expect(creatureRow(ALRIK)).toMatchObject({
      level: 3,
      species: 'mensch',
      culture: 'mittelreich',
      profession: 'gildenmagier',
      size: 'medium',
      lifePoints: 29,
      astralEnergy: 34,
      armor: 1,
      hasSpells: true,
    });
    expect(creatureRow(WOLF)).toMatchObject({
      level: null,
      species: 'tier',
      size: 'small',
      lifePoints: 22,
    });
  });

  it('summarises a hero with attributes, pools, skills, spells and condition levels', () => {
    const { basicInfo, stats } = dsa5Adapter.characters!.summary(ALRIK) as {
      basicInfo: Json;
      stats: Json;
    };
    expect(basicInfo).toMatchObject({
      lifePoints: { value: 25, max: 29 },
      astralEnergy: { value: 30, max: 34 },
      experienceLevel: { level: 3, de: 'Erfahren' },
      species: 'Mensch',
      profession: 'Gildenmagier',
    });
    expect(basicInfo['karmaEnergy']).toBeUndefined();
    expect(Object.keys(stats['characteristics'])).toEqual([
      'MU',
      'KL',
      'IN',
      'CH',
      'FF',
      'GE',
      'KO',
      'KK',
    ]);
    expect(stats['experience']).toMatchObject({ total: 1100, spent: 1050, available: 50 });
    expect(stats['skills'][0]).toMatchObject({ name: 'Klettern', value: 4, check: 'MU/GE/KK' });
    expect(stats['spells'][0]).toMatchObject({ name: 'Ignifaxius', value: 6 });
    expect(stats['conditions']).toEqual([{ id: 'inpain', name: 'Schmerz', level: 2, max: 4 }]);
    expect(stats['dodge']).toBe(7);
  });

  it('groups spells with their pool and no invented grades', () => {
    const entries = spellcastingEntries(ALRIK);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      name: 'Spells',
      kind: 'arcane',
      tradition: 'Gildenmagier',
      ability: 'KL',
      slots: { asp: { value: 30, max: 34 } },
    });
    expect(entries[0]?.spells[0]).toMatchObject({
      level: null,
      cost: '8 AsP, casting time 2',
      range: '32 Schritt',
    });
  });
});

describe('conditions', () => {
  it('builds the effect dsa5 creates, with level 1 for conditions that have levels', () => {
    const pain = {
      id: 'inpain',
      name: 'Schmerz',
      img: 'icons/svg/blood.svg',
      system: {
        condition: { value: 1, max: 4 },
        changes: [{ key: 'system.condition.inpain', type: 'add', value: 1 }],
      },
    };
    expect(conditionEffectData(pain)).toMatchObject({
      statuses: ['inpain'],
      system: {
        condition: { value: 1, max: 4, manual: 1, auto: 0 },
        changes: [{ key: 'system.condition.inpain' }],
      },
    });
    expect(conditionEffectData({ id: 'prone', name: 'Liegend' })).toMatchObject({
      statuses: ['prone'],
      system: { condition: {} },
    });
    const matches = dsa5Adapter.conditions!.matchesEffect!;
    expect(matches({ name: 'Schmerz' }, pain)).toBe(false);
    expect(matches({ statuses: ['inpain'] }, pain)).toBe(true);
  });
});

describe('rolls', () => {
  it('builds a 3d20 skill check against the three characteristics with the modifier on the targets', () => {
    expect(
      rollPlan({ rollType: 'skill', rollTarget: 'klettern', rollModifier: '+1' }, ALRIK)
    ).toEqual({
      formula: '3d20',
      label:
        'Klettern check: 3d20 against MU 14, GE 14, KK 12, modifier +1 included, 4 skill points to spend',
    });
  });

  it('checks characteristics, attack, parry and dodge with 1d20 and prefers roll data', () => {
    expect(rollPlan({ rollType: 'ability', rollTarget: 'Klugheit' }, ALRIK).label).toBe(
      'KL check: 1d20 at most 14'
    );
    expect(
      rollPlan(
        { rollType: 'ability', rollTarget: 'mu' },
        { ...ALRIK, rollData: { characteristics: { mu: { value: 15 } } } }
      ).label
    ).toBe('MU check: 1d20 at most 15');
    expect(rollPlan({ rollType: 'attack', rollTarget: 'Dolch' }, ALRIK).label).toBe(
      'Dolch attack: 1d20 at most 9'
    );
    expect(rollPlan({ rollType: 'parry', rollTarget: 'Dolch' }, ALRIK).label).toBe(
      'Dolch parry: 1d20 at most 4'
    );
    expect(() => rollPlan({ rollType: 'parry', rollTarget: 'Armbrüste' }, ALRIK)).toThrow(
      /has no parry/
    );
    expect(rollPlan({ rollType: 'dodge' }, ALRIK).label).toBe('Dodge: 1d20 at most 7');
    expect(rollPlan({ rollType: 'initiative' }, ALRIK).formula).toBe('1d6+13');
  });

  it('refuses what DSA5 does not have and a formula as modifier', () => {
    expect(() => rollPlan({ rollType: 'save', rollTarget: 'mu' }, ALRIK)).toThrow(
      /not a DSA5 roll type/
    );
    expect(() => rollPlan({ rollType: 'skill', rollTarget: 'Schwimmen' }, ALRIK)).toThrow(
      /Available: "Klettern"/
    );
    expect(() =>
      rollPlan({ rollType: 'ability', rollTarget: 'mu', rollModifier: '1d6' }, ALRIK)
    ).toThrow(/whole number/);
  });
});

describe('actor data', () => {
  it('writes initial values and current points, never derived values', () => {
    const out = normalizeActorSystem(
      {
        eigenschaften: { MU: 14, ko: { value: 13, advances: 1 } },
        lifePoints: { current: 20, max: 30 },
        asp: 12,
        profession: 'Söldner',
        species: { value: 'Zwerg' },
        experience: { total: 1100, spent: 900 },
        size: 'small',
        armour: 2,
        custom: { kept: true },
      },
      { actorType: 'character', mode: 'create' }
    ) as Json;
    expect(out['characteristics']).toEqual({
      mu: { initial: 14 },
      ko: { initial: 12, advances: 1 },
    });
    expect(out['status']).toMatchObject({
      wounds: { value: 20 },
      astralenergy: { value: 12 },
      size: { value: 'small' },
    });
    expect(out['status'].wounds.initial).toBeUndefined();
    expect(out['details']).toMatchObject({
      career: { value: 'Söldner' },
      species: { value: 'Zwerg' },
      experience: { total: 1100, spent: 900 },
    });
    expect(out['totalArmor']).toBe(2);
    expect(out['custom']).toEqual({ kept: true });
    expect(out['lifePoints']).toBeUndefined();
    const creature = normalizeActorSystem(
      { lifePoints: 30 },
      { actorType: 'creature', mode: 'create' }
    ) as Json;
    expect(creature['status'].wounds).toEqual({ value: 30 });
    const withMax = normalizeActorSystem(
      { lifePoints: { max: 40 } },
      { actorType: 'creature', mode: 'create' }
    ) as Json;
    expect(withMax['status'].wounds).toEqual({ initial: 40 });
  });

  it('reads enums from CONFIG.DSA5 and names the cause without it', () => {
    expect(() => dsa5Adapter.worldItems!.enums({})).toThrow(/CONFIG.DSA5 is not available/);
    expect(
      dsa5Adapter.worldItems!.enums({
        DSA5: { skillGroups: { body: 'x' }, meleeRanges: { short: 's' } },
      })
    ).toMatchObject({
      skill: { 'system.group.value': ['body'] },
      meleeweapon: { 'system.reach.value': ['short'] },
    });
  });
});

describe('archetype customization', () => {
  it('names every wrong value, writes the rest as text and reads mismatches back', () => {
    const checked = checkCustomization({
      age: 5,
      gender: 'other',
      eyeColor: ' blau ',
      height: 180,
      profession: 'Magier',
      mood: 'x',
    });
    expect(checked.problems).toEqual([
      'customization.age must be from 12 to 100, got 5',
      'customization.gender must be one of male, female, diverse, got "other"',
    ]);
    expect(checked.ignored).toEqual(['mood']);
    expect(checked.values).toEqual({
      'details.eyecolor.value': 'blau',
      'details.height.value': '180',
      'details.career.value': 'Magier',
    });
    const hero = heroData(ARCHETYPES[0] as Json, {
      name: 'Rahjada',
      folder: 'f1',
      origin: 'Compendium.x.Actor.y',
      values: checked.values,
    }) as Json;
    expect(hero['_id']).toBeUndefined();
    expect(hero['ownership']).toBeUndefined();
    expect(hero['_stats']).toEqual({ compendiumSource: 'Compendium.x.Actor.y' });
    expect(hero['prototypeToken'].name).toBe('Rahjada');
    expect(hero['system'].details.career.value).toBe('Magier');
    expect(customizationMismatches(hero, checked.values)).toEqual([]);
    expect(customizationMismatches({ system: {} }, { 'details.age.value': '30' })).toEqual([
      { path: 'system.details.age.value', expected: '30', stored: null },
    ]);
  });
});
