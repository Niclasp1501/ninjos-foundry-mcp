import { describe, expect, it } from 'vitest';
import type { CreatureFilterSpec } from './adapter.js';
import { describeFilters, matchesAll, readFilterValue, readFilters } from './filters.js';

const cr: CreatureFilterSpec = {
  name: 'challengeRating',
  kind: 'numberOrRange',
  field: 'cr',
  defaults: { min: 0, max: 30 },
};
const kind: CreatureFilterSpec = { name: 'creatureType', kind: 'text', field: 'kind' };
const casts: CreatureFilterSpec = { name: 'hasSpells', kind: 'boolean', field: 'casts' };
const traits: CreatureFilterSpec = { name: 'traits', kind: 'textList', field: 'traits' };
const defenses: CreatureFilterSpec = { name: 'defensesMin', kind: 'minEach', field: 'defenses' };

describe('readFilterValue', () => {
  it('accepts numbers, numbers in texts, fractions, ranges and ranges as JSON text', () => {
    expect(readFilterValue(cr, 5)).toEqual({ kind: 'exact', value: 5 });
    expect(readFilterValue(cr, '1/4')).toEqual({ kind: 'exact', value: 0.25 });
    expect(readFilterValue(cr, { min: 3 })).toEqual({ kind: 'range', min: 3, max: 30 });
    expect(readFilterValue(cr, '{"min": 2, "max": "4"}')).toEqual({
      kind: 'range',
      min: 2,
      max: 4,
    });
  });

  it('names what could not be read', () => {
    expect(readFilterValue(cr, 'abc')).toMatch(
      /challengeRating must be a number or a range, got "abc"|challengeRating must be/
    );
    expect(readFilterValue(cr, { min: 9, max: 2 })).toMatch(/min 9 above max 2/);
    expect(readFilterValue(casts, 'yes')).toMatch(/true or false/);
  });
});

describe('readFilters and matching', () => {
  it('reports filters the adapter does not declare', () => {
    const reading = readFilters(
      [cr, kind],
      { challengeRating: 3, level: 5 },
      name => `unknown ${name}`
    );
    expect(reading.ignored).toEqual([{ name: 'level', reason: 'unknown level' }]);
    expect(describeFilters(reading.active)).toEqual({ challengeRating: 3 });
  });

  it('compares generically by kind', () => {
    const reading = readFilters(
      [cr, kind, casts, traits, defenses],
      {
        challengeRating: { min: 1, max: 5 },
        creatureType: 'Dragon',
        hasSpells: 'true',
        traits: ['fire'],
        defensesMin: { phy: 12 },
      },
      () => ''
    );
    const row = {
      cr: 4,
      kind: 'dragon',
      casts: true,
      traits: ['Fire', 'Flying'],
      defenses: { phy: 13 },
    };
    expect(matchesAll(reading.active, row)).toBe(true);
    expect(matchesAll(reading.active, { ...row, cr: 6 })).toBe(false);
    expect(matchesAll(reading.active, { ...row, defenses: { phy: 10 } })).toBe(false);
  });
});
