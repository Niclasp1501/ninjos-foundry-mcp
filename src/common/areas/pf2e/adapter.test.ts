import { describe, expect, it } from 'vitest';
import { SystemAdapterRegistry, type CreatureRow } from '../../game-systems.js';
import {
  actionsOf,
  actorStats,
  characterSummary,
  creatureRow,
  creatureSummary,
  itemEnums,
  normalizeActorSystem,
  pf2eAdapter,
  rollPlan,
  spellcastingEntries,
  strikesOf,
} from './adapter.js';
import { activeConditions, conditionSlug, plannedTarget, reached } from './conditions.js';
import { characterAttributes, proficiencyBonus, sizeWord } from './rules.js';
import { CAVE_WORM_CASTER, GOBLIN_WARRIOR, SPIKED_PIT, VALERIA } from './sample-data.js';

describe('prepared data from the module', () => {
  it('reads armor class and saves pf2e prepared instead of computing them from the build', () => {
    const stored = characterSummary(VALERIA);
    expect(stored.stats['valuesFrom']).toBe('stored');
    expect(stored.stats['computedNote']).toBeDefined();

    const valeria = structuredClone(VALERIA) as Record<string, any>;
    valeria['preparedData'] = true;
    const system = valeria['system'];
    system.attributes = { ...(system.attributes ?? {}), ac: { value: 27 } };
    system.saves = { fortitude: { value: 15 }, reflex: { value: 12 }, will: { value: 11 } };
    const prepared = characterSummary(valeria);
    expect(prepared.basicInfo['armorClass']).toBe(27);
    expect(prepared.stats['saves']).toMatchObject({
      fortitude: { modifier: 15 },
      reflex: { modifier: 12 },
      will: { modifier: 11 },
    });
    expect(prepared.stats['valuesFrom']).toBe('prepared');
  });
});

describe('the pf2e adapter in the registry', () => {
  it('answers every adapter question and is found ignoring case', () => {
    const registry = new SystemAdapterRegistry();
    registry.register(pf2eAdapter, 'pf2e');
    const system = registry.describe('PF2E', '7.4.0');
    expect(system.adapter).toBe(pf2eAdapter);
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
      'level',
      'traits',
      'rarity',
      'creatureType',
      'size',
      'hasSpells',
    ]);
    expect(creatures.questions.copyableTypes).toEqual([
      'npc',
      'character',
      'hazard',
      'loot',
      'familiar',
      'vehicle',
      'party',
      'army',
    ]);
    for (const area of [
      'compendiumStats',
      'characters',
      'spells',
      'characterSearch',
      'itemUse',
      'rolls',
      'actorData',
      'worldItems',
      'compendiums',
    ] as const)
      expect(registry.answer(system, area).fromAdapter, area).toBe(true);
    expect(registry.answer(system, 'conditions').fallbackFor).toEqual(['effectData']);
    expect(pf2eAdapter.tools).toEqual(['pf2e-manage-conditions']);
  });

  it('refuses in a D&D world: its tools belong to pf2e', () => {
    const registry = new SystemAdapterRegistry();
    registry.register(pf2eAdapter, 'pf2e');
    expect(() =>
      registry.requireSystem(registry.describe('dnd5e'), 'pf2e', 'pf2e-manage-conditions')
    ).toThrow(/requires the game system "pf2e". Detected game system: "dnd5e"/);
  });
});

describe('creature rows', () => {
  it('reads level, traits, rarity and size words from stored NPC data', () => {
    expect(creatureRow(GOBLIN_WARRIOR)).toMatchObject({
      level: -1,
      traits: ['goblin', 'humanoid'],
      creatureType: 'humanoid',
      rarity: 'common',
      size: 'small',
      hitPoints: 6,
      armorClass: 16,
      hasSpells: false,
      alignment: null,
    });
    expect(creatureRow(CAVE_WORM_CASTER)).toMatchObject({
      hasSpells: true,
      rarity: 'uncommon',
      alignment: 'CE',
    });
    const row = {
      ...creatureRow(SPIKED_PIT),
      id: 'p',
      name: 'Spiked Pit',
      type: 'hazard',
      packId: 'pf2e.hazards',
      packLabel: 'Hazards',
      img: null,
    } as CreatureRow;
    expect(row['isComplex']).toBe(false);
    expect(creatureSummary(row)).toBe('Level 0 hazard (common) from Hazards');
  });

  it('reads index rows with dotted keys', () => {
    expect(
      actorStats({
        'system.details.level.value': 3,
        'system.traits.value': ['undead'],
        'system.traits.size.value': 'lg',
        'system.attributes.hp': { value: 40, max: 45 },
      })
    ).toMatchObject({
      level: 3,
      creatureType: 'undead',
      size: 'large',
      hitPoints: { value: 40, max: 45 },
    });
    expect(actorStats({ name: 'Longsword' })).toBeNull();
    expect(sizeWord({ value: 'grg' })).toBe('gargantuan');
  });
});

describe('characters', () => {
  it('computes attribute modifiers with partial boosts above +4', () => {
    expect(characterAttributes(VALERIA.system, VALERIA.items).mods).toEqual({
      str: 4,
      dex: 2,
      con: 3,
      int: 0,
      wis: 3,
      cha: 0,
    });
    expect(proficiencyBonus(0, 5)).toBe(0);
    expect(proficiencyBonus(3, 5)).toBe(11);
  });

  it('summarises a character with ancestry, heritage, class, key attribute, ranks and a note', () => {
    const { basicInfo, stats } = characterSummary(VALERIA);
    expect(basicInfo).toMatchObject({
      class: 'Fighter',
      ancestry: 'Human',
      heritage: 'Versatile Human',
      background: 'Guard',
      keyAttribute: 'str',
      level: 5,
      armorClass: 22,
      perception: 12,
      hitPoints: { value: 60, max: 73, temp: 2 },
    });
    expect(stats['saves']).toEqual({
      fortitude: { modifier: 12, rank: 2, rankName: 'expert' },
      reflex: { modifier: 11, rank: 2, rankName: 'expert' },
      will: { modifier: 10, rank: 1, rankName: 'trained' },
    });
    const skills = stats['skills'] as Record<string, Record<string, unknown>>;
    expect(skills['athletics']).toMatchObject({ modifier: 13, rank: 2, trained: true });
    expect(skills['acrobatics']).toMatchObject({ modifier: 9, rank: 1 });
    expect(skills['stealth']).toMatchObject({ modifier: 2, rank: 0, trained: false });
    expect(skills['legal-lore']).toMatchObject({ name: 'Legal Lore', modifier: 7, lore: true });
    expect(stats['resources']).toMatchObject({ heroPoints: { value: 1, max: 3 } });
    expect(String(stats['computedNote'])).toMatch(/Rule elements/);
  });

  it('takes stored numbers of an NPC as they are, with conditions and focus points', () => {
    const { stats } = characterSummary(CAVE_WORM_CASTER);
    expect(stats).toMatchObject({
      perception: { modifier: 9 },
      saves: { will: { modifier: 11 } },
      skills: { religion: { modifier: 11 } },
      resources: { focusPoints: { value: 1, max: 1 } },
      conditions: [{ slug: 'frightened', value: 2 }],
      traits: ['human', 'humanoid'],
      rarity: 'uncommon',
    });
    expect(stats['computedNote']).toBeUndefined();
  });

  it('lists strikes with the multiple attack penalty, actions and toggles', () => {
    expect(strikesOf(VALERIA).map(s => [s.name, s.attacks])).toEqual([
      ['Longsword', [14, 9, 4]],
      ['Dagger', [13, 9, 5]],
    ]);
    const actions = actionsOf(GOBLIN_WARRIOR);
    expect(actions[0]).toMatchObject({
      name: 'Dogslicer',
      type: 'strike',
      attackBonuses: [8, 4, 0],
    });
    expect(actions.find(a => a['name'] === 'Goblin Scuttle')).toMatchObject({
      type: 'reaction',
      actionCost: 'reaction',
    });
    expect(actionsOf(VALERIA).find(a => a['type'] === 'toggle')).toMatchObject({
      name: 'Power Attack',
      option: 'power-attack',
    });
  });
});

describe('spells', () => {
  it('reads entries with tradition, DC, attack, slots, prepared and expended, and focus spells', () => {
    const entries = spellcastingEntries(CAVE_WORM_CASTER);
    expect(entries.map(entry => entry.name)).toEqual(['Divine Prepared Spells', 'Focus Spells']);
    expect(entries[0]).toMatchObject({
      kind: 'prepared',
      tradition: 'divine',
      ability: 'wis',
      dc: 19,
      attack: 11,
      slots: {
        cantrips: { value: 5, max: 5 },
        rank1: { value: 3, max: 3 },
        rank2: { value: 2, max: 2 },
      },
    });
    expect(entries[0]?.spells).toMatchObject([
      { name: 'Divine Lance', level: 0, prepared: true, cost: '2 actions', range: '30 feet' },
      {
        name: 'Heal',
        level: 2,
        prepared: true,
        expended: false,
        area: '30-foot emanation',
        cost: '1 to 3 actions',
      },
    ]);
    expect(entries[1]).toMatchObject({ kind: 'focus', slots: { focus: { value: 1, max: 1 } } });
  });

  it('searches with pf2e categories', () => {
    const categories = pf2eAdapter.characterSearch!.categories;
    const items = VALERIA.items as Array<Record<string, unknown>>;
    expect(items.filter(item => categories['invested']!.matches(item)).map(i => i['name'])).toEqual(
      ['Ring of Sustenance']
    );
    expect(items.filter(item => categories['equipped']!.matches(item)).map(i => i['name'])).toEqual(
      ['Longsword', 'Chain Mail']
    );
    const spells = CAVE_WORM_CASTER.items as Array<Record<string, unknown>>;
    expect(spells.filter(item => categories['cantrip']!.matches(item)).map(i => i['name'])).toEqual(
      ['Divine Lance']
    );
  });
});

describe('rolls', () => {
  it('builds perception, saves, skills, lores and initiative', () => {
    expect(rollPlan({ rollType: 'perception' }, GOBLIN_WARRIOR)).toEqual({
      formula: '1d20+2',
      label: 'Perception check',
    });
    expect(
      rollPlan({ rollType: 'save', rollTarget: 'Fort', rollModifier: '1' }, VALERIA).formula
    ).toBe('1d20+12+1');
    expect(rollPlan({ rollType: 'skill', rollTarget: 'Legal Lore' }, VALERIA)).toEqual({
      formula: '1d20+7',
      label: 'Legal Lore check',
    });
    expect(rollPlan({ rollType: 'skill', rollTarget: 'thievery' }, GOBLIN_WARRIOR)).toMatchObject({
      formula: '1d20+3',
      label: 'Thievery check (untrained)',
    });
    expect(
      rollPlan({ rollType: 'initiative', rollTarget: 'stealth' }, GOBLIN_WARRIOR).formula
    ).toBe('1d20+5');
  });

  it('builds strikes with the multiple attack penalty and flat checks', () => {
    expect(rollPlan({ rollType: 'strike-2', rollTarget: 'dogslicer' }, GOBLIN_WARRIOR)).toEqual({
      formula: '1d20+4',
      label: 'Dogslicer strike (second attack)',
    });
    expect(rollPlan({ rollType: 'strike-3', rollTarget: 'Longsword' }, VALERIA).formula).toBe(
      '1d20+4'
    );
    expect(rollPlan({ rollType: 'flat', rollTarget: '11' }, null)).toEqual({
      formula: '1d20',
      label: 'Flat check DC 11',
    });
  });

  it('names the cause of every refusal', () => {
    expect(() => rollPlan({ rollType: 'ability', rollTarget: 'str' }, VALERIA)).toThrow(
      /no attribute checks/
    );
    expect(() => rollPlan({ rollType: 'strike', rollTarget: 'Axe' }, GOBLIN_WARRIOR)).toThrow(
      /Strikes: "Dogslicer", "Shortbow"/
    );
    expect(() => rollPlan({ rollType: 'flat', rollTarget: '25' }, null)).toThrow(/DC from 1 to 20/);
    expect(() => rollPlan({ rollType: 'skill', rollTarget: 'Sailing Lore' }, VALERIA)).toThrow(
      /"Legal Lore"/
    );
  });
});

describe('using items, actor data, world items', () => {
  it('posts the card and refuses a spell rank', () => {
    expect(
      pf2eAdapter.itemUse!.plan({ type: 'consumable', name: 'Potion' }, { consume: true })
    ).toEqual({ method: 'toChat', options: {} });
    expect(() =>
      pf2eAdapter.itemUse!.plan({ type: 'spell', name: 'Heal' }, { spellLevel: 3 })
    ).toThrow(/spellcasting entry/);
  });

  it('brings short forms into the stored shape per actor type', () => {
    expect(
      normalizeActorSystem(
        {
          level: 4,
          perception: 11,
          saves: { fort: 12 },
          skills: { Stealth: 10 },
          traits: { size: 'large', value: 'undead' },
          attributes: { hp: 60, ac: 21 },
          other: 1,
        },
        'npc'
      )
    ).toEqual({
      details: { level: { value: 4 } },
      perception: { mod: 11 },
      saves: { fortitude: { value: 12 } },
      skills: { stealth: { base: 10 } },
      traits: { size: { value: 'lg' }, value: ['undead'] },
      attributes: { hp: { value: 60, max: 60 }, ac: { value: 21 } },
      other: 1,
    });
    expect(normalizeActorSystem({ skills: { athletics: 2 } }, 'character')).toEqual({
      skills: { athletics: { rank: 2 } },
    });
  });

  it('reads enumerations from CONFIG.PF2E and says when it is missing', () => {
    expect(itemEnums({ PF2E: { weaponGroups: { sword: 'S', axe: 'A' } } })['weapon']).toMatchObject(
      { 'system.group': ['sword', 'axe'] }
    );
    expect(() => itemEnums({})).toThrow(/CONFIG.PF2E is not available/);
  });
});

describe('conditions', () => {
  it('finds conditions as items with their value', () => {
    expect(activeConditions(CAVE_WORM_CASTER)).toEqual([
      { id: 'cursebound0001', slug: 'frightened', name: 'Frightened', value: 2, grantedBy: null },
    ]);
    expect(conditionSlug('Flat Footed')).toBe('off-guard');
    expect(conditionSlug('Off-Guard')).toBe('off-guard');
    expect(conditionSlug('sleepy')).toBeNull();
  });

  it('plans values by the rules: at least 1, and decreasing to 0 removes', () => {
    const frightened = {
      id: 'c',
      slug: 'frightened',
      name: 'Frightened',
      value: 2,
      grantedBy: null,
    };
    expect(
      plannedTarget({ action: 'increase', slug: 'frightened', amount: 1 }, frightened)
    ).toEqual({ present: true, value: 3 });
    expect(
      plannedTarget({ action: 'decrease', slug: 'frightened', amount: 2 }, frightened)
    ).toEqual({ present: false });
    expect(plannedTarget({ action: 'set', slug: 'prone', value: 3 }, null)).toEqual({
      present: true,
      value: null,
    });
    expect(plannedTarget({ action: 'toggle', slug: 'sickened' }, null)).toEqual({
      present: true,
      value: 1,
    });
    expect(reached({ present: true, value: 3 }, frightened)).toBe(false);
  });
});
