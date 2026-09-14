import { describe, expect, it } from 'vitest';
import { SystemAdapterRegistry, type CreatureRow, type SystemAdapter } from '../../game-systems.js';
import { choiceLists } from './shared.js';
import { cosmereAdapter, derived, skillKey as cosmereSkill } from './cosmere.js';
import {
  COSMERE_CHASMFIEND,
  COSMERE_SHARDBEARER,
  TRAVELLER_KESSA,
  TRAVELLER_KIAN,
  WFRP_BRUNHILDE,
  WFRP_CORE_ITEMS,
  WFRP_GIANT_RAT,
  WFRP_OTHER_ITEMS,
} from './sample-data.js';
import {
  dmFor,
  normalizeActorSystem as normalizeTraveller,
  travellerAdapter,
} from './traveller.js';
import { characteristic, wfrp4eAdapter } from './wfrp4e.js';
import {
  checkAddArguments,
  checkUpdateArguments,
  groupedTemplate,
  itemData,
  matchItem,
  orderPacks,
  planUpdate,
  unmatched,
} from './wfrp4e-tools.js';

/** Every text an adapter hands to the model or the table, joined. */
function derivedText(adapters: SystemAdapter[]): string {
  return adapters
    .map(adapter =>
      [
        adapter.title,
        adapter.actorData?.schemaNotes?.(),
        adapter.worldItems?.note?.(),
        ...(adapter.rolls?.types.map(type => type.description) ?? []),
        ...Object.values(adapter.characterSearch?.categories ?? {}).map(
          category => category.description
        ),
      ].join('\n')
    )
    .join('\n');
}

const registry = () => {
  const r = new SystemAdapterRegistry();
  for (const adapter of [wfrp4eAdapter, cosmereAdapter, travellerAdapter])
    r.register(adapter, 'wfrp4e-cosmere-traveller');
  return r;
};
const row = (data: Record<string, unknown>, fields: Record<string, unknown>): CreatureRow => ({
  id: 'x',
  name: 'x',
  type: String(data['type']),
  packId: 'p',
  packLabel: 'Pack',
  img: null,
  ...fields,
});

describe('registry', () => {
  it('answers only in the matching system and refuses the rest with SYSTEM_NOT_SUPPORTED', () => {
    const r = registry();
    expect(r.describe('WFRP4E').adapter).toBe(wfrp4eAdapter);
    expect(r.describe('cosmere-rpg').adapter).toBe(cosmereAdapter);
    expect(r.describe('mgt2e').adapter).toBe(travellerAdapter);
    expect(r.describe('dnd5e').adapter).toBeNull();
    expect(r.describe('wfrp4e').capabilities).toEqual({
      creatureIndex: true,
      characterStats: true,
      spells: true,
      powerMeasure: false,
    });
    expect(r.describe('cosmere-rpg').capabilities.powerMeasure).toBe(true);
    expect(() => r.require(r.describe('cosmere-rpg'), 'spells', 'Spell lists')).toThrow(
      /Spell lists is not supported for the game system "cosmere-rpg": its adapter "Cosmere Roleplaying Game" does not answer it/
    );
    expect(() => r.require(r.describe('mgt2e'), 'itemUse', 'Using items')).toThrow(
      /SYSTEM_NOT_SUPPORTED|not supported/
    );
    expect(r.answer(r.describe('mgt2e'), 'itemUse').fromAdapter).toBe(false);
  });

  it('keeps the neutral filters in front of each system filter', () => {
    const r = registry();
    const names = r
      .answer(r.describe('wfrp4e'), 'creatures')
      .questions.filters.map(filter => filter.name);
    expect(names).toEqual([
      'name',
      'actorType',
      'packId',
      'species',
      'size',
      'hasSpells',
      'hasPrayers',
      'traits',
    ]);
  });

  it('writes texts without dashes as sentence dashes', () => {
    expect(derivedText([wfrp4eAdapter, cosmereAdapter, travellerAdapter])).not.toMatch(/[–—]/);
  });
});

describe('WFRP4e', () => {
  it('computes a characteristic by the formula of the data model and prefers prepared values', () => {
    expect(characteristic(WFRP_BRUNHILDE.system, 'ws')).toMatchObject({
      value: 47,
      bonus: 4,
      computed: true,
    });
    expect(
      characteristic({ characteristics: { ws: { initial: 30, value: 52, bonus: 5 } } }, 'ws')
    ).toMatchObject({ value: 52, bonus: 5, computed: false });
  });

  it('builds index rows with size words, wounds and traits', () => {
    const data = wfrp4eAdapter.creatures!.row(WFRP_GIANT_RAT);
    expect(data).toMatchObject({
      species: 'rat',
      size: 'small',
      wounds: 5,
      hasSpells: false,
      traits: ['Bite', 'Skittish'],
    });
    expect(wfrp4eAdapter.creatures!.summary!(row(WFRP_GIANT_RAT, data))).toBe(
      'rat creature (small), 5 wounds, from Pack'
    );
    expect(wfrp4eAdapter.creatures!.copyableTypes).toContain('creature');
  });

  it('summarises a character with the current career item, never the circular reference', () => {
    const { basicInfo, stats } = wfrp4eAdapter.characters!.summary(WFRP_BRUNHILDE);
    expect(basicInfo).toMatchObject({
      career: 'Soldier',
      species: 'Dwarf',
      wounds: { value: 13, max: 15 },
      size: 'average',
    });
    expect(JSON.stringify({ basicInfo, stats })).not.toContain('Circular');
    expect(stats['experience']).toEqual({ total: 350, spent: 200, current: 150 });
    expect(stats['skills']).toEqual([
      expect.objectContaining({ name: 'Melee (Basic)', total: 52, characteristic: 'ws' }),
      expect.objectContaining({ name: 'Perception', total: 41, characteristic: 'i' }),
    ]);
  });

  it('groups spells by lore and prayers by god with CN as cost', () => {
    expect(wfrp4eAdapter.spells!.entries(WFRP_BRUNHILDE)).toEqual([
      expect.objectContaining({
        name: 'Lore of Petty',
        kind: 'arcane',
        spells: [expect.objectContaining({ name: 'Dart', cost: 'CN 0' })],
      }),
      expect.objectContaining({ name: 'Prayers (Grungni)', kind: 'divine' }),
    ]);
    const equipped = wfrp4eAdapter.characterSearch!.categories['equipped']!;
    expect(
      WFRP_BRUNHILDE.items.filter(item => equipped.matches(item)).map(item => item.name)
    ).toEqual(['Hand Axe']);
  });

  it('plans percentile tests with the target and the SL rule, modifier on the target', () => {
    const rolls = wfrp4eAdapter.rolls!;
    const actor = { ...WFRP_BRUNHILDE, rollData: null };
    expect(
      rolls.plan(
        { rollType: 'characteristic', rollTarget: 'Weapon Skill', rollModifier: '+20' },
        actor
      )
    ).toEqual({
      formula: '1d100',
      label: expect.stringMatching(
        /Weapon Skill test \(\+20 applied\): 1d100 at or under 67 succeeds.*SL = tens of 67 minus tens of the roll/
      ),
    });
    expect(rolls.plan({ rollType: 'skill', rollTarget: 'perception' }, actor).label).toMatch(
      /at or under 41/
    );
    expect(() => rolls.plan({ rollType: 'skill', rollTarget: 'Swim' }, actor)).toThrow(
      /no skill named "Swim".*rollType "characteristic"/
    );
    expect(() =>
      rolls.plan({ rollType: 'characteristic', rollTarget: 'ws', rollModifier: '1d10' }, actor)
    ).toThrow(/changes the target number/);
    expect(() => rolls.plan({ rollType: 'save', rollTarget: 'ws' }, actor)).toThrow(
      /not a WFRP4e roll type/
    );
  });

  it('normalises short forms and reads CONFIG choice lists', () => {
    expect(
      wfrp4eAdapter.actorData!.normalize!(
        {
          characteristics: { WS: 40 },
          details: { size: 'large', move: 4 },
          status: { wounds: 12 },
        },
        { actorType: 'npc', mode: 'create' }
      )
    ).toEqual({
      characteristics: { ws: { initial: 40 } },
      details: { size: { value: 'lrg' }, move: { value: 4 } },
      status: { wounds: { value: 12, max: 12 } },
    });
    expect(
      wfrp4eAdapter.worldItems!.enums({
        WFRP4E: { weaponGroups: { basic: 'Basic', flail: 'Flail' } },
      })
    ).toEqual({
      config: { 'CONFIG.WFRP4E.weaponGroups': ['basic', 'flail'] },
    });
    expect(() => wfrp4eAdapter.worldItems!.enums({})).toThrow(/CONFIG.WFRP4E is not available/);
    expect(choiceLists).toBeTypeOf('function');
  });
});

describe('wfrp4e-update-actor planning', () => {
  it('names unknown keys and an empty call', () => {
    expect(checkUpdateArguments({ actor: 'a' })).toEqual([
      'Nothing to update: provide characteristics, wounds, skills, career, movement and/or biography.',
    ]);
    expect(
      checkUpdateArguments({
        actor: 'a',
        characteristics: { str: { initial: 3 }, ws: { initial: 3.5 } },
      })
    ).toEqual([
      'Unknown characteristic key(s): str. Valid keys: ws, bs, s, t, i, ag, dex, int, wp, fel.',
      'characteristics.ws.initial: must be a whole number, got 3.5',
    ]);
  });

  it('plans actor fields, skill advances and the career switch, and warns on skipped and derived values', () => {
    const plan = planUpdate(WFRP_BRUNHILDE, {
      characteristics: { ws: { advances: 10 } },
      wounds: { max: 18 },
      skills: [
        { name: 'perception', advances: 15 },
        { name: 'Swim', advances: 3 },
      ],
      career: 'rat catcher',
      biography: 'New',
    });
    expect(plan.actor).toEqual({
      'system.characteristics.ws.advances': 10,
      'system.status.wounds.max': 18,
      'system.details.biography.value': 'New',
    });
    expect(plan.items).toEqual([
      { _id: 'skPercept', 'system.advances.value': 15 },
      { _id: 'crSoldier', 'system.current.value': false },
      { _id: 'crRat', 'system.current.value': true },
    ]);
    expect(plan.applied).toContainEqual({ field: 'career', from: 'Soldier', to: 'Rat Catcher' });
    expect(plan.applied).toContainEqual({
      field: 'biography',
      from: { length: 22 },
      to: { length: 3 },
    });
    expect(plan.warnings).toEqual([
      expect.stringMatching(/recomputes maximum wounds.*autoCalc.wounds to false/),
      'Skill "Swim" is not on the actor and was skipped; add it with wfrp4e-add-items.',
    ]);
    expect(unmatched(plan, WFRP_BRUNHILDE).map(entry => entry.path)).toContain(
      'system.characteristics.ws.advances'
    );
  });
});

describe('wfrp4e-add-items matching', () => {
  const packs = orderPacks([
    { id: 'homebrew.items', label: 'Homebrew', entries: WFRP_OTHER_ITEMS },
    { id: 'wfrp4e-core.items', label: 'Core', entries: WFRP_CORE_ITEMS },
  ]);

  it('searches wfrp4e-core first and names other compendiums with the name', () => {
    expect(packs.map(pack => pack.id)).toEqual(['wfrp4e-core.items', 'homebrew.items']);
    expect(matchItem({ name: 'hand axe' }, packs)).toMatchObject({
      kind: 'found',
      candidate: { packId: 'wfrp4e-core.items', id: 'cAxe' },
      alsoIn: ['homebrew.items'],
    });
  });

  it('copies a grouped template, never guesses between types or twins, and reports misses', () => {
    expect(groupedTemplate('Entertain (Taunt)')).toBe('Entertain ()');
    expect(matchItem({ name: 'Entertain (Taunt)' }, packs)).toMatchObject({
      kind: 'found',
      grouped: true,
      candidate: { id: 'cEntertain' },
    });
    expect(matchItem({ name: 'Blessed' }, packs)).toMatchObject({
      kind: 'ambiguous',
      reason: expect.stringMatching(/talent, trait/),
    });
    expect(matchItem({ name: 'Blessed', type: 'trait' }, packs)).toMatchObject({
      kind: 'found',
      candidate: { id: 'cBlessedR' },
    });
    expect(matchItem({ name: 'Twin Blade' }, packs)).toMatchObject({
      kind: 'ambiguous',
      candidates: [expect.anything(), expect.anything()],
    });
    expect(matchItem({ name: 'Lute' }, packs)).toEqual({ kind: 'notFound' });
  });

  it('applies advances, quantity and setCurrent only where they belong', () => {
    const skill = itemData(
      { name: 'Entertain (Taunt)', advances: 5, quantity: 2 },
      WFRP_CORE_ITEMS[0]!
    );
    expect(skill.data).toMatchObject({
      name: 'Entertain (Taunt)',
      type: 'skill',
      system: { advances: { value: 5 }, characteristic: { value: 'fel' } },
    });
    expect(skill.warnings).toEqual([
      '"Entertain (Taunt)": quantity only applies to weapon, armour, trapping, ammunition, container, money, cargo and was ignored for a skill.',
    ]);
    expect(itemData({ name: 'Lute' }, null).data).toEqual({
      name: 'Lute',
      type: 'trapping',
      system: {},
    });
    expect(checkAddArguments({ actor: 'a', items: [] }).problems).toEqual([
      'items: list at least one item',
    ]);
  });
});

describe('Cosmere', () => {
  it('reads derived fields as the data model decides: override when switched on, plus bonus', () => {
    expect(derived({ derived: 4, override: 9, useOverride: false, bonus: 1 })).toBe(5);
    expect(derived({ derived: 4, override: 9, useOverride: true, bonus: 1 })).toBe(10);
    expect(derived(7)).toBe(7);
  });

  it('builds the adversary row with tier, role and defenses', () => {
    const data = cosmereAdapter.creatures!.row(COSMERE_CHASMFIEND);
    expect(data).toMatchObject({
      tier: 3,
      role: 'boss',
      creatureType: 'animal',
      subtype: 'greatshell',
      size: 'gargantuan',
      hitPoints: 180,
      defenses: { phy: 18, cog: 13, spi: 14 },
      deflect: 2,
      walkSpeed: 30,
      hasInvestiture: false,
    });
    expect(cosmereAdapter.creatures!.summary!(row(COSMERE_CHASMFIEND, data))).toBe(
      'Tier 3 boss animal from Pack'
    );
    expect(
      cosmereAdapter.compendiumStats!.actorStats({
        type: 'adversary',
        'system.tier': 3,
        'system.role': 'boss',
      })
    ).toMatchObject({ tier: 3, role: 'boss' });
  });

  it('computes missing defenses and skill modifiers by the rules and says so', () => {
    const { basicInfo, stats } = cosmereAdapter.characters!.summary(COSMERE_SHARDBEARER);
    expect(basicInfo).toMatchObject({ level: 3, investiture: { value: 2, max: 3 } });
    expect(stats['defenses']).toEqual({ phy: 16, cog: 14, spi: 15 });
    expect(stats['skills']).toMatchObject({ agi: { rank: 2, mod: 6 }, prs: { rank: 1, mod: 3 } });
    expect(stats['computedNote']).toMatch(/computed by the rules/);
    expect(cosmereSkill('Heavy Weaponry')).toBe('hwp');
    expect(cosmereSkill('persuasion')).toBe('prs');
  });

  it('plans d20 tests and adds the plot die when the stakes are raised', () => {
    const plan = cosmereAdapter.rolls!.plan;
    expect(plan({ rollType: 'skill', rollTarget: 'Agility' }, COSMERE_SHARDBEARER)).toEqual({
      formula: '1d20+6',
      label: 'Agility test',
    });
    expect(
      plan({ rollType: 'skill-plot', rollTarget: 'prs', rollModifier: '+2' }, COSMERE_SHARDBEARER)
        .formula
    ).toBe('1d20+3+2+1dp');
    expect(() => plan({ rollType: 'ability', rollTarget: 'str' }, null)).toThrow(
      /not a Cosmere RPG roll type/
    );
    expect(
      cosmereAdapter.actorData!.normalize!(
        { attributes: { Strength: 3 }, skills: { Athletics: 2 }, resources: { hea: 10 } },
        { actorType: 'adversary', mode: 'create' }
      )
    ).toEqual({
      attributes: { str: { value: 3 } },
      skills: { ath: { rank: 2 } },
      resources: { hea: { value: 10 } },
    });
  });
});

describe('Traveller', () => {
  it('uses the DM table of the rules on the value minus damage', () => {
    expect([0, 2, 5, 8, 11, 14, 15].map(dmFor)).toEqual([-3, -2, -1, 0, 1, 2, 3]);
    const { stats, basicInfo } = travellerAdapter.characters!.summary(TRAVELLER_KESSA);
    expect(stats['characteristics']).toMatchObject({
      DEX: { value: 10, damage: 3, effective: 7, dm: 0 },
      EDU: { dm: 1 },
    });
    expect(stats['skills']).toEqual({
      pilot: { value: 2, trained: true, specialities: { smallCraft: 2 } },
      vaccsuit: { value: 1, trained: true },
    });
    expect(basicInfo).toMatchObject({
      actorType: 'traveller',
      species: 'Human',
      profession: 'Scout',
      age: 34,
    });
  });

  it('indexes creatures with hits and DMs, without a creature type the system does not have', () => {
    const data = travellerAdapter.creatures!.row(TRAVELLER_KIAN);
    expect(data).toMatchObject({ hits: 32, strDm: 2, dexDm: 1, hasPsionics: false });
    expect(data).not.toHaveProperty('creatureType');
    expect(travellerAdapter.creatures!.summary!(row(TRAVELLER_KIAN, data))).toBe(
      'creature, 32 hits, STR DM +2, DEX DM +1, from Pack'
    );
  });

  it('plans 2d6 checks with skill, characteristic DM, boon and the untrained penalty', () => {
    const plan = travellerAdapter.rolls!.plan;
    expect(
      plan({ rollType: 'skill', rollTarget: 'pilot.smallcraft:DEX:boon' }, TRAVELLER_KESSA)
    ).toEqual({
      formula: '3d6kh2+2',
      label: 'pilot (smallCraft) with DEX check with a boon: 8+ succeeds, Effect = total minus 8',
    });
    expect(plan({ rollType: 'skill', rollTarget: 'admin:EDU' }, TRAVELLER_KESSA)).toMatchObject({
      formula: '2d6-2',
      label: expect.stringMatching(/untrained -3/),
    });
    expect(
      plan({ rollType: 'characteristic', rollTarget: 'EDU:bane' }, TRAVELLER_KESSA).formula
    ).toBe('3d6kl2+1');
    expect(() =>
      plan({ rollType: 'skill', rollTarget: 'pilot.starship' }, TRAVELLER_KESSA)
    ).toThrow(/not a speciality of pilot/);
  });

  it('normalises in one place: skill keys, specialities without id, and refuses a lost number', () => {
    const out = normalizeTraveller(
      {
        skills: { GunCombat: { slug: 1 }, Admin: 2 },
        characteristics: { str: 8, dex: 6 },
        details: { career: 'Navy', description: 'Pilot' },
      },
      { actorType: 'traveller', mode: 'create' }
    );
    expect(out['skills']).toEqual({
      guncombat: {
        trained: true,
        specialities: {
          slug: { value: 1, trained: true },
          archaic: { value: 0, trained: false },
          energy: { value: 0, trained: false },
        },
      },
      admin: { value: 2, trained: true, id: 'admin' },
    });
    expect(out).toMatchObject({
      hits: { value: 21, max: 21 },
      sophont: { profession: 'Navy' },
      description: 'Pilot',
      damage: { STR: { value: 0 } },
    });
    expect(out).not.toHaveProperty('details');
    expect(
      normalizeTraveller({ 'skills.Pilot.value': 1 }, { actorType: 'npc', mode: 'update' })
    ).toEqual({ 'skills.pilot.value': 1 });
    expect(() =>
      normalizeTraveller({ skills: { animals: 1 } }, { actorType: 'npc', mode: 'update' })
    ).toThrow(/handling, vetinary, training/);
    expect(
      travellerAdapter.characterSearch!.categories['carried']!.matches(TRAVELLER_KESSA.items[1]!)
    ).toBe(true);
  });
});
