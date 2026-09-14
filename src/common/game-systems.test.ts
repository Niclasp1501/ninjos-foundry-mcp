import { describe, expect, it } from 'vitest';
import {
  NEUTRAL_CREATURE_FILTERS,
  SystemAdapterRegistry,
  SystemNotSupportedError,
  type SystemAdapter,
} from './game-systems.js';

/** A made-up system, so these tests carry no knowledge of a real one. */
const sample: SystemAdapter = {
  id: 'sample',
  title: 'Sample System',
  handles: id => id === 'sample-legacy',
  creatures: {
    indexVersion: 1,
    actorTypes: ['beast'],
    row: document => ({
      rank: Number((document['system'] as { rank?: number } | undefined)?.rank ?? 0),
    }),
    power: { name: 'Rank', field: 'rank', range: { min: 1, max: 4 } },
    filters: [{ name: 'rank', kind: 'numberOrRange', field: 'rank', defaults: { min: 1, max: 4 } }],
  },
};

describe('SystemAdapterRegistry', () => {
  it('finds an adapter by its id ignoring case, then by what it takes over', () => {
    const registry = new SystemAdapterRegistry();
    registry.register(sample, 'sample-area');
    expect(registry.find('SAMPLE')).toBe(sample);
    expect(registry.find('sample-legacy')).toBe(sample);
    expect(registry.find('other')).toBeNull();
  });

  it('accepts the same adapter twice and names both owners for another one with that id', () => {
    const registry = new SystemAdapterRegistry();
    registry.register(sample, 'a');
    expect(() => registry.register(sample, 'a')).not.toThrow();
    expect(() => registry.register({ id: 'Sample', title: 'Copy' }, 'b')).toThrow(
      'The game system adapter "Sample" of area "b" is already registered by area "a"'
    );
    expect(registry.list()).toHaveLength(1);
  });

  it('describes a system with and without an adapter, capabilities from what it implements', () => {
    const registry = new SystemAdapterRegistry();
    registry.register(sample);
    expect(registry.describe('Sample', '2.0')).toMatchObject({
      id: 'sample',
      rawId: 'Sample',
      version: '2.0',
      title: 'Sample System',
      capabilities: {
        creatureIndex: true,
        powerMeasure: true,
        spells: false,
        characterStats: false,
      },
    });
    expect(registry.describe('homebrew')).toMatchObject({
      id: 'homebrew',
      adapter: null,
      title: 'homebrew',
    });
    expect(registry.describe(undefined)).toMatchObject({ id: 'unknown', rawId: 'unknown' });
  });

  it('completes an adapter area with the fallbacks and says which ones', () => {
    const registry = new SystemAdapterRegistry();
    registry.register(sample);
    const answer = registry.answer(registry.describe('sample'), 'creatures');
    expect(answer.fromAdapter).toBe(true);
    expect(answer.fallbackFor).toEqual(['listFields', 'summary']);
    expect(answer.questions.filters.map(filter => filter.name)).toEqual([
      ...NEUTRAL_CREATURE_FILTERS.map(filter => filter.name),
      'rank',
    ]);
    const row = {
      id: 'x',
      name: 'Wolf',
      type: 'beast',
      packId: 'p.a',
      packLabel: 'Beasts',
      img: null,
    };
    expect(answer.questions.summary?.(row)).toBe('beast from Beasts');
  });

  it('answers without an adapter from the fallbacks only', () => {
    const registry = new SystemAdapterRegistry();
    const system = registry.describe('homebrew');
    const spells = registry.answer(system, 'spells');
    expect(spells).toMatchObject({ fromAdapter: false, fallbackFor: ['itemTypes', 'entries'] });
    expect(spells.questions.entries({})).toEqual([]);
    expect(registry.answer(system, 'creatures').questions.filters).toEqual(
      NEUTRAL_CREATURE_FILTERS
    );
    expect(registry.answer(system, 'actorData').questions.schemaNotes?.()).toContain('"homebrew"');
    const characters = registry.answer(system, 'characters').questions;
    expect(characters.summary({ name: 'Ada', type: 'hero', system: { hp: 3 } })).toEqual({
      basicInfo: { name: 'Ada', type: 'hero' },
      stats: {},
    });
  });

  it('builds only custom rolls without an adapter and refuses the rest naming the system', () => {
    const registry = new SystemAdapterRegistry();
    const rolls = registry.answer(registry.describe('homebrew'), 'rolls').questions;
    expect(
      rolls.plan({ rollType: 'custom', rollTarget: '1d100', rollModifier: '5' }, null)
    ).toEqual({
      formula: '1d100+5',
      label: 'Custom roll',
    });
    expect(() => rolls.plan({ rollType: 'skill', rollTarget: 'athletics' }, null)).toThrow(
      /"skill" is not supported for the game system "homebrew"/
    );
    expect(() => rolls.plan({ rollType: 'custom' }, null)).toThrow(/needs its formula/);
  });

  it('sets and finds conditions by their status without an adapter', () => {
    const registry = new SystemAdapterRegistry();
    const conditions = registry.answer(registry.describe('homebrew'), 'conditions').questions;
    const prone = { id: 'prone', name: 'Prone', img: 'icons/prone.svg' };
    expect(conditions.effectData?.(prone)).toEqual({
      name: 'Prone',
      img: 'icons/prone.svg',
      statuses: ['prone'],
    });
    expect(conditions.matchesEffect?.({ statuses: ['prone'] }, prone)).toBe(true);
    expect(conditions.matchesEffect?.({ name: 'Blinded' }, prone)).toBe(false);
  });

  it('refuses what only an adapter can answer, naming the system and the known adapters', () => {
    const registry = new SystemAdapterRegistry();
    registry.register(sample);
    expect(() =>
      registry.require(registry.describe('homebrew'), 'creatures', 'The creature index')
    ).toThrow(
      'The creature index is not supported for the game system "homebrew": Ninjo\'s Foundry MCP has no adapter for it (adapters exist for sample).'
    );
    expect(() => registry.require(registry.describe('sample'), 'spells', 'Reading spells')).toThrow(
      /its adapter "Sample System" does not answer it/
    );
    expect(registry.require(registry.describe('sample'), 'creatures', 'x')).toBe(sample.creatures);
  });

  it('holds a tool of one system to that system', () => {
    const registry = new SystemAdapterRegistry();
    registry.register(sample);
    expect(() =>
      registry.requireSystem(registry.describe('sample-legacy'), 'sample', 'sample-tool')
    ).not.toThrow();
    let caught: unknown;
    try {
      registry.requireSystem(registry.describe('homebrew'), 'sample', 'sample-tool');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SystemNotSupportedError);
    expect(caught).toMatchObject({
      code: 'WRONG_SYSTEM',
      message: 'sample-tool requires the game system "sample". Detected game system: "homebrew".',
    });
  });
});
