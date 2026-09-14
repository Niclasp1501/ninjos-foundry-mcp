import { describe, expect, it } from 'vitest';
import { formulaBounds, PlanError, planRollTable } from './ranges.js';

const texts = (...names: string[]) => names.map(text => ({ text }));

describe('planRollTable', () => {
  it('numbers entries without a range one after another and derives 1dN', () => {
    const plan = planRollTable({ results: texts('a', 'b', 'c', 'd', 'e', 'f') });
    expect(plan.results.map(r => r.range)).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
      [5, 5],
      [6, 6],
    ]);
    expect(plan.formula).toBe('1d6');
    expect(plan.formulaDerived).toBe(true);
    expect(plan.warnings).toEqual([]);
    expect(plan.results.every(r => r.weight === 1)).toBe(true);
  });

  it('continues after the highest range end so far', () => {
    const plan = planRollTable({
      results: [{ text: 'low', range: [1, 3] }, { text: 'next' }, { text: 'top', range: [5, 6] }],
    });
    expect(plan.results.map(r => r.range)).toEqual([
      [1, 3],
      [4, 4],
      [5, 6],
    ]);
    expect(plan.formula).toBe('1d6');
  });

  it('refuses overlapping ranges and names both entries', () => {
    expect(() =>
      planRollTable({
        results: [
          { text: 'one', range: [1, 4] },
          { text: 'two', range: [3, 6] },
        ],
      })
    ).toThrow(/entry 1 "one" \(1-4\) and entry 2 "two" \(3-6\) both cover 3-4/);
  });

  it('refuses an entry that lands on a number an explicit range already took', () => {
    expect(() => planRollTable({ results: [{ text: 'a' }, { text: 'b', range: [1, 2] }] })).toThrow(
      PlanError
    );
  });

  it('creates gaps but reports them', () => {
    const plan = planRollTable({
      results: [
        { text: 'a', range: [1, 2] },
        { text: 'b', range: [5, 6] },
      ],
    });
    expect(plan.warnings).toEqual(['No entry covers 3-4; a roll there draws nothing.']);
  });

  it('reports a formula that rolls past the entries and entries it cannot reach', () => {
    const plan = planRollTable({
      formula: '1d8',
      results: [
        { text: 'a', range: [1, 6] },
        { text: 'b', range: [10, 10] },
      ],
    });
    expect(plan.warnings).toContain('No entry covers 7-9; a roll there draws nothing.');
    expect(plan.warnings.some(w => w.includes('can never roll entry 2 "b" (10)'))).toBe(true);

    const short = planRollTable({ formula: '1d8', results: texts('a', 'b', 'c', 'd', 'e', 'f') });
    expect(short.warnings).toEqual(['The formula 1d8 can roll 7-8, where no entry is.']);
  });

  it('says when a formula is not compared', () => {
    const plan = planRollTable({ formula: '1d6+2', results: texts('a') });
    expect(plan.warnings[0]).toMatch(/not a plain dice formula/);
  });

  it('refuses broken entries with their position', () => {
    expect(() => planRollTable({ results: [] })).toThrow('results needs at least one entry');
    expect(() => planRollTable({ results: [{ text: '  ' }] })).toThrow('results[0].text');
    expect(() => planRollTable({ results: [{ text: 'a', range: [1] }] })).toThrow(
      'results[0].range must be exactly two whole numbers'
    );
    expect(() => planRollTable({ results: [{ text: 'a', range: [3, 1] }] })).toThrow(
      'starts after it ends'
    );
    expect(() => planRollTable({ results: [{ text: 'a', weight: 0 }] })).toThrow(
      'results[0].weight'
    );
    expect(() => planRollTable({ results: [{ text: 'a', range: [-2, 0] }] })).toThrow(
      'No formula can be derived'
    );
  });
});

describe('formulaBounds', () => {
  it('reads plain dice formulas only', () => {
    expect(formulaBounds('1d6')).toEqual([1, 6]);
    expect(formulaBounds('2d6')).toEqual([2, 12]);
    expect(formulaBounds('d20')).toEqual([1, 20]);
    expect(formulaBounds('1d6+1')).toBeNull();
  });
});
