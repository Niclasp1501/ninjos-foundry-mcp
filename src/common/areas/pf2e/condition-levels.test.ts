/**
 * What the pf2e adapter answers for toggle-token-condition with a level,
 * and how it reads conditions that are items.
 */
import { describe, expect, it } from 'vitest';
import { SystemAdapterRegistry } from '../../game-systems.js';
import { pf2eAdapter } from './adapter.js';
import { conditionLevelPlan } from './conditions.js';

const condition = (slug: string, value: number | null, extra: Record<string, unknown> = {}) => ({
  _id: `${slug}-item`,
  name: slug,
  type: 'condition',
  system: {
    slug,
    value: { isValued: value !== null, value },
    ...extra,
  },
});

const goblin = (...items: unknown[]) => ({ name: 'Goblin', type: 'npc', items });

describe('pf2e conditions for toggle-token-condition', () => {
  const registry = new SystemAdapterRegistry();
  registry.register(pf2eAdapter, 'pf2e');
  const questions = registry.answer(registry.describe('pf2e'), 'conditions').questions;

  it('reads the conditions from the items, with their values', () => {
    expect(
      questions.activeOn?.(goblin(condition('frightened', 2), condition('prone', null)))
    ).toEqual([
      { id: 'frightened', level: 2 },
      { id: 'prone', level: null },
    ]);
  });

  it('knows which conditions have values, without a highest value', () => {
    expect(questions.levels?.({ id: 'frightened', name: 'Frightened' })).toEqual({ max: null });
    expect(questions.levels?.({ id: 'prone', name: 'Prone' })).toBeNull();
    expect(questions.levels?.({ id: 'unknown', name: 'Unknown' })).toBeNull();
  });

  it('plans pf2e methods: increase for a new condition, the item value for a present one, force remove for 0', () => {
    expect(conditionLevelPlan('frightened', 2, goblin())).toEqual([
      { method: 'increaseCondition', args: ['frightened', { value: 2 }] },
    ]);
    expect(conditionLevelPlan('frightened', 3, goblin(condition('frightened', 2)))).toEqual([
      {
        method: 'updateEmbeddedDocuments',
        args: ['Item', [{ _id: 'frightened-item', 'system.value.value': 3 }]],
      },
    ]);
    expect(conditionLevelPlan('frightened', 2, goblin(condition('frightened', 2)))).toEqual([]);
    expect(conditionLevelPlan('frightened', 0, goblin(condition('frightened', 2)))).toEqual([
      { method: 'decreaseCondition', args: ['frightened', { forceRemove: true }] },
    ]);
    expect(conditionLevelPlan('frightened', 0, goblin())).toEqual([]);
    expect(questions.levelPlan?.({ id: 'Flat Footed', name: 'Off-Guard' }, 0, goblin())).toEqual(
      []
    );
  });
});
