import { describe, expect, it } from 'vitest';
import { SystemAdapterRegistry, type SystemAdapter } from './game-systems.js';

describe('adapter questions for condition levels and item use', () => {
  const adapter: SystemAdapter = {
    id: 'staged',
    title: 'Staged System',
    // No effectData and no cast: the system's own toggle does the work.
    conditions: {
      matchesEffect: (effect, condition) =>
        Array.isArray(effect['statuses']) && effect['statuses'].includes(condition.id),
      activeOn: actor =>
        (Array.isArray(actor['items']) ? actor['items'] : []).map(item => ({
          id: String((item as Record<string, unknown>)['slug']),
          level: Number((item as Record<string, unknown>)['level']),
        })),
      levels: condition => (condition.id === 'frightened' ? { max: null } : null),
      levelPlan: (condition, level) => [
        { method: 'setCondition', args: [condition.id, { value: level }] },
      ],
    },
    itemUse: {
      plan: () => ({ method: 'use', options: { consume: true }, args: [{ consume: true }, {}] }),
    },
  };

  const registry = new SystemAdapterRegistry();
  registry.register(adapter, 'test');
  const system = registry.describe('staged');

  it('fills a missing effectData with the generic effect and names it', () => {
    const answer = registry.answer(system, 'conditions');
    expect(answer.fallbackFor).toEqual(['effectData']);
    expect(answer.questions.effectData?.({ id: 'prone', name: 'Prone' })).toEqual({
      name: 'Prone',
      img: null,
      statuses: ['prone'],
    });
  });

  it('passes the new condition questions through untouched', () => {
    const { questions } = registry.answer(system, 'conditions');
    expect(questions.activeOn?.({ items: [{ slug: 'frightened', level: 2 }] })).toEqual([
      { id: 'frightened', level: 2 },
    ]);
    expect(questions.levels?.({ id: 'frightened', name: 'Frightened' })).toEqual({ max: null });
    expect(questions.levels?.({ id: 'prone', name: 'Prone' })).toBeNull();
    expect(questions.levelPlan?.({ id: 'frightened', name: 'Frightened' }, 3, {})).toEqual([
      { method: 'setCondition', args: ['frightened', { value: 3 }] },
    ]);
  });

  it('has no level questions without an adapter', () => {
    const { questions } = registry.answer(registry.describe('other'), 'conditions');
    expect(questions.activeOn).toBeUndefined();
    expect(questions.levelPlan).toBeUndefined();
  });

  it('keeps every argument of an item use plan', () => {
    expect(registry.answer(system, 'itemUse').questions.plan({}, {})).toEqual({
      method: 'use',
      options: { consume: true },
      args: [{ consume: true }, {}],
    });
  });
});
