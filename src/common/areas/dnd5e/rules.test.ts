import { describe, expect, it } from 'vitest';
import {
  describeSlots,
  formatCr,
  parseCr,
  planSpellcasting,
  proficiencyFor,
  randomId,
  rulesFromSetting,
  sizeWord,
  skillFor,
  versionAtLeast,
} from './rules.js';

describe('challenge ratings', () => {
  it('reads the ratings of the rules in numbers and texts', () => {
    expect(parseCr('1/4')).toBe(0.25);
    expect(parseCr('1/8')).toBe(0.125);
    expect(parseCr(0.5)).toBe(0.5);
    expect(parseCr('5')).toBe(5);
    expect(parseCr(30)).toBe(30);
    expect(parseCr(0)).toBe(0);
  });

  it('refuses what the rules do not have instead of storing it', () => {
    for (const bad of [0.3, 31, '1/3', 'abc', -1, 2.5, ''])
      expect(parseCr(bad), String(bad)).toBeNull();
  });

  it('writes fractions back as fractions', () => {
    expect(formatCr(0.25)).toBe('1/4');
    expect(formatCr(12)).toBe('12');
  });

  it('derives the proficiency bonus like dnd5e, at least from 1', () => {
    expect(proficiencyFor(0.25)).toBe(2);
    expect(proficiencyFor(5)).toBe(3);
    expect(proficiencyFor(17)).toBe(6);
  });
});

describe('spellcasting per rules version', () => {
  it('gives a 2024 paladin slots at level 1 and a 2014 paladin none, with a warning', () => {
    const modern = planSpellcasting('paladin', 1, '2024');
    expect(modern).toMatchObject({
      casterLevel: 1,
      slots: { spell1: 2 },
      ability: 'cha',
      warnings: [],
    });
    const legacy = planSpellcasting('paladin', 1, '2014');
    expect(legacy.casterLevel).toBe(0);
    expect(legacy.slots).toEqual({});
    expect(legacy.warnings[0]).toMatch(/no spell slots under the 2014 rules/);
  });

  it('rounds half casters up from level 2 in both versions, as the class tables do', () => {
    expect(planSpellcasting('ranger', 5, '2014').slots).toEqual({ spell1: 4, spell2: 2 });
    expect(planSpellcasting('ranger', 5, '2024').slots).toEqual({ spell1: 4, spell2: 2 });
    expect(planSpellcasting('artificer', 1, '2014').slots).toEqual({ spell1: 2 });
  });

  it('uses the full caster table and the class ability', () => {
    const wizard = planSpellcasting('wizard', 5, '2014');
    expect(wizard).toMatchObject({ kind: 'leveled', ability: 'int', casterLevel: 5 });
    expect(describeSlots(wizard)).toBe('L1: 4, L2: 3, L3: 2');
    expect(planSpellcasting('cleric', 20, '2024').slots).toMatchObject({
      spell6: 2,
      spell7: 2,
      spell9: 1,
    });
  });

  it('gives a warlock pact magic and keeps a chosen ability', () => {
    const warlock = planSpellcasting('warlock', 5, '2014', 'int');
    expect(warlock).toMatchObject({
      kind: 'pact',
      ability: 'int',
      casterLevel: 5,
      pact: { max: 2, level: 3 },
    });
    expect(describeSlots(warlock)).toBe('Pact Magic: 2 slot(s) of level 3');
  });
});

describe('small helpers', () => {
  it('finds skills by name, squeezed name and key', () => {
    expect(skillFor('Sleight of Hand')?.key).toBe('slt');
    expect(skillFor('sleightofhand')?.key).toBe('slt');
    expect(skillFor('ste')?.name).toBe('stealth');
    expect(skillFor('Swimming')).toBeNull();
  });

  it('turns size keys into words', () => {
    expect(sizeWord('sm')).toBe('small');
    expect(sizeWord('grg')).toBe('gargantuan');
    expect(sizeWord(undefined)).toBeNull();
  });

  it('reads the rules setting and versions', () => {
    expect(rulesFromSetting('modern')).toBe('2024');
    expect(rulesFromSetting('legacy')).toBe('2014');
    expect(rulesFromSetting(undefined)).toBeNull();
    expect(versionAtLeast('5.3.3', 5, 3)).toBe(true);
    expect(versionAtLeast('5.2.5', 5, 3)).toBe(false);
    expect(versionAtLeast('6.0.1', 6)).toBe(true);
  });

  it('makes ids of 16 letters and digits', () => {
    expect(randomId()).toMatch(/^[A-Za-z0-9]{16}$/);
  });
});
