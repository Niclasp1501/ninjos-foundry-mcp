import { describe, expect, it } from 'vitest';
import { SystemAdapterRegistry, type SystemAdapter } from './game-systems.js';

describe('compendium search questions of an adapter', () => {
  const adapter: SystemAdapter = {
    id: 'searchy',
    title: 'Searchy',
    compendiumStats: {
      actorStats: () => null,
      searchFilters: [{ name: 'spellcaster', kind: 'boolean', field: 'hasSpells' }],
      estimate: (entry, filters) =>
        filters['size'] === 'large' && entry['size'] !== 'large' ? null : 1,
    },
  };
  const registry = new SystemAdapterRegistry();
  registry.register(adapter, 'test');

  it('passes search filters and the estimate through, and names neither as a fallback', () => {
    const answer = registry.answer(registry.describe('searchy'), 'compendiumStats');
    expect(answer.fallbackFor).toEqual([]);
    expect(answer.questions.searchFilters?.map(filter => filter.name)).toEqual(['spellcaster']);
    expect(answer.questions.estimate?.({ size: 'small' }, { size: 'large' })).toBeNull();
    expect(answer.questions.estimate?.({ size: 'large' }, { size: 'large' })).toBe(1);
  });

  it('offers neither without an adapter', () => {
    const answer = registry.answer(registry.describe('other'), 'compendiumStats');
    expect(answer.questions.searchFilters).toBeUndefined();
    expect(answer.questions.estimate).toBeUndefined();
  });
});
