import { describe, expect, it } from 'vitest';
import { SystemAdapterRegistry, type CreatureRow } from '../../game-systems.js';
import {
  characterSummary,
  creatureRow,
  creatureSummary,
  dnd5eAdapter,
  itemEnums,
  normalizeActorSystem,
  rollPlan,
  spellcastingEntries,
} from './adapter.js';
import { GOBLIN, MIRA, YOUNG_DRAGON } from './sample-data.js';

describe('the D&D 5e adapter in the registry', () => {
  it('answers every area it claims', () => {
    const registry = new SystemAdapterRegistry();
    registry.register(dnd5eAdapter, 'dnd5e');
    const system = registry.describe('DnD5e', '5.3.3');
    expect(system.capabilities).toEqual({
      creatureIndex: true,
      characterStats: true,
      spells: true,
      powerMeasure: true,
    });
    const creatures = registry.answer(system, 'creatures');
    expect(creatures.fallbackFor).toEqual([]);
    expect(creatures.questions.filters.map(filter => filter.name)).toEqual([
      'name',
      'actorType',
      'packId',
      'challengeRating',
      'creatureType',
      'size',
      'alignment',
      'hasSpells',
      'hasLegendaryActions',
    ]);
    expect(creatures.questions.copyableTypes).toContain('vehicle');
    const conditions = registry.answer(system, 'conditions');
    // Own matching, Foundry's toggle: tokens-dice uses toggleStatusEffect when effectData is a fallback.
    expect(conditions).toMatchObject({ fromAdapter: true, fallbackFor: ['effectData'] });
    const prone = { id: 'prone', name: 'Prone' };
    expect(conditions.questions.matchesEffect?.({ statuses: ['prone'] }, prone)).toBe(true);
    expect(conditions.questions.matchesEffect?.({ name: 'Prone', statuses: [] }, prone)).toBe(
      false
    );
    expect(dnd5eAdapter.tools).toEqual([
      'dnd5e-create-npc',
      'dnd5e-add-feature',
      'dnd5e-add-features-from-compendium',
    ]);
  });
});

describe('creature rows', () => {
  it('reads a stored SRD goblin with words for sizes and no made up armor class', () => {
    expect(creatureRow(GOBLIN)).toMatchObject({
      challengeRating: 0.25,
      creatureType: 'humanoid',
      size: 'small',
      hitPoints: 7,
      armorClass: null,
      alignment: 'neutral evil',
      hasSpells: false,
      hasLegendaryActions: false,
    });
  });

  it('counts legendary actions and spellcasting only above 0', () => {
    expect(creatureRow(YOUNG_DRAGON)).toMatchObject({
      hasLegendaryActions: true,
      hasSpells: true,
      armorClass: 18,
      size: 'large',
    });
    const row = {
      ...creatureRow(YOUNG_DRAGON),
      id: 'd',
      name: 'Dragon',
      type: 'npc',
      packId: 'p',
      packLabel: 'Monsters',
      img: null,
    } as CreatureRow;
    expect(creatureSummary(row)).toBe('CR 10 dragon from Monsters');
  });
});

describe('characters and spells', () => {
  it('summarises an NPC with computed totals', () => {
    const summary = characterSummary(GOBLIN);
    expect(summary.basicInfo).toMatchObject({
      hitPoints: { value: 7, max: 7, temp: 0 },
      challengeRating: '1/4',
    });
    expect(summary.stats).toMatchObject({
      creatureType: 'humanoid',
      size: 'small',
      proficiencyBonus: 2,
      legendaryActions: null,
    });
    expect((summary.stats['skills'] as Record<string, unknown>)['ste']).toMatchObject({
      total: 6,
      proficiency: 2,
    });
  });

  it('lists spells of a class and spells without a class', () => {
    const entries = spellcastingEntries(MIRA);
    expect(entries.map(entry => entry.name)).toEqual(['Wizard Spellcasting', 'Other Spellcasting']);
    expect(entries[0]).toMatchObject({ ability: 'int', slots: { level1: { value: 3, max: 4 } } });
    expect(entries[0]?.spells.map(spell => spell.name)).toEqual(['Magic Missile']);
    expect(entries[1]?.spells).toMatchObject([
      { name: 'Light', level: 0, prepared: true, range: 'Touch' },
    ]);
    expect(characterSummary(MIRA).basicInfo).toMatchObject({
      level: 3,
      classes: [{ name: 'Wizard', levels: 3 }],
    });
  });
});

describe('rolls', () => {
  it('builds formulas from roll data when the module sends it, else from scores', () => {
    expect(rollPlan({ rollType: 'skill', rollTarget: 'Stealth' }, GOBLIN).formula).toBe('1d20+6');
    expect(
      rollPlan({ rollType: 'save', rollTarget: 'dexterity', rollModifier: '1d4' }, GOBLIN).formula
    ).toBe('1d20+2+1d4');
    expect(
      rollPlan(
        { rollType: 'ability', rollTarget: 'str' },
        { ...GOBLIN, rollData: { abilities: { str: { mod: 5 } } } }
      ).formula
    ).toBe('1d20+5');
    expect(rollPlan({ rollType: 'initiative' }, null)).toEqual({
      formula: '1d20',
      label: 'Initiative',
    });
  });

  it('takes the prepared save of dnd5e 5.x from the roll data', () => {
    const actor = { ...GOBLIN, rollData: { abilities: { dex: { mod: 2, save: { value: 7 } } } } };
    expect(rollPlan({ rollType: 'save', rollTarget: 'dex' }, actor).formula).toBe('1d20+7');
  });

  it('gives an attack the bonus of the named weapon', () => {
    expect(rollPlan({ rollType: 'attack', rollTarget: 'scimitar' }, GOBLIN)).toEqual({
      formula: '1d20+4',
      label: 'Scimitar attack',
    });
    expect(() => rollPlan({ rollType: 'attack', rollTarget: 'Axe' }, GOBLIN)).toThrow(
      /Weapons: "Scimitar"/
    );
  });

  it('gives damage the base dice of the named weapon plus the ability of its attack', () => {
    // Scimitar 1d6, finesse: dexterity 14 (+2) is better than strength 8.
    expect(rollPlan({ rollType: 'damage', rollTarget: 'Scimitar' }, GOBLIN)).toEqual({
      formula: '1d6+2',
      label: 'Scimitar damage',
    });
    expect(
      rollPlan({ rollType: 'damage', rollTarget: 'scimitar', rollModifier: '1d4' }, GOBLIN).formula
    ).toBe('1d6+2+1d4');
    expect(() => rollPlan({ rollType: 'damage', rollTarget: 'Axe' }, GOBLIN)).toThrow(
      /A damage roll needs the exact name.*Weapons: "Scimitar"/
    );
    expect(() => rollPlan({ rollType: 'damage', rollTarget: 'Scimitar' }, null)).toThrow(
      /needs an actor/
    );
    const custom = structuredClone(GOBLIN);
    const scimitar = (custom['items'] as Array<Record<string, any>>)[0] as Record<string, any>;
    scimitar['system']['damage']['base'] = {
      custom: { enabled: true, formula: '2d4' },
      bonus: '1',
    };
    scimitar['system']['magicalBonus'] = 1;
    expect(rollPlan({ rollType: 'damage', rollTarget: 'Scimitar' }, custom).formula).toBe(
      '2d4+1+3'
    );
    expect(dnd5eAdapter.rolls?.types.map(type => type.id)).toContain('damage');
  });

  it('refuses unknown targets with the valid ones', () => {
    expect(() => rollPlan({ rollType: 'skill', rollTarget: 'Swimming' }, GOBLIN)).toThrow(
      /18 skills/
    );
    expect(() => rollPlan({ rollType: 'custom' }, GOBLIN)).toThrow(/formula in rollTarget/);
  });
});

describe('using items', () => {
  const plan = dnd5eAdapter.itemUse?.plan;
  const fireball = { type: 'spell', system: { level: 3, activities: { a: { type: 'save' } } } };
  it('passes consumption and the slot of a higher level', () => {
    const options = {
      consume: { action: false, resources: false, spellSlot: false },
      spell: { slot: 'spell5' },
    };
    expect(plan?.(fireball, { consume: false, spellLevel: 5 })).toEqual({
      method: 'use',
      options,
      // Item5e#use(config, dialog): the second argument skips the usage dialog.
      args: [options, { configure: false }],
    });
    expect(plan?.({ type: 'loot', system: {} }, {})).toBeNull();
  });
  it('refuses a level below the spell and a level for a non spell', () => {
    expect(() => plan?.(fireball, { spellLevel: 2 })).toThrow(
      /not possible for a spell of level 3/
    );
    expect(() =>
      plan?.({ type: 'weapon', system: { activities: { a: {} } } }, { spellLevel: 2 })
    ).toThrow(/only applies to spells/);
  });
});

describe('actor data and world items', () => {
  it('brings short forms into the dnd5e shape and refuses a wrong challenge rating', () => {
    expect(
      normalizeActorSystem({
        abilities: { str: 18 },
        traits: { size: 'large' },
        details: { cr: '1/2', type: 'fey' },
        skills: { Stealth: 1 },
        other: 1,
      })
    ).toEqual({
      abilities: { str: { value: 18 } },
      traits: { size: 'lg' },
      details: { cr: 0.5, type: { value: 'fey' } },
      skills: { ste: { value: 1 } },
      other: 1,
    });
    expect(() => normalizeActorSystem({ details: { cr: '2/3' } })).toThrow(
      /not a challenge rating/
    );
  });

  it('reads enumerations from CONFIG and says when dnd5e is not loaded', () => {
    const enums = itemEnums({
      DND5E: { weaponTypes: { natural: {}, simpleM: {} }, damageTypes: { fire: {} } },
    });
    expect(enums['weapon']).toMatchObject({
      'system.type.value': ['natural', 'simpleM'],
      'system.damage.base.types': ['fire'],
    });
    expect(() => itemEnums(undefined)).toThrow(/CONFIG.DND5E is not available/);
  });
});
