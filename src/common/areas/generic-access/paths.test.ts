import { describe, expect, it } from 'vitest';
import {
  canonicalPath,
  diffValues,
  fingerprint,
  foundryChanges,
  matchesCondition,
  parsePath,
  PathError,
  planUpdate,
  readPath,
  reportValue,
  selectFields,
} from './paths.js';

const actor = () => ({
  name: 'Grok',
  system: {
    attributes: { hp: { value: 10, max: 10 } },
    skills: [
      { name: 'climb', value: 1 },
      { name: 'swim', value: 2 },
    ],
  },
  flags: { other: { a: 1 } },
});

describe('paths', () => {
  it('reads dotted paths, list positions in both spellings and *', () => {
    expect(parsePath('system.skills[1].name')).toEqual(['system', 'skills', '1', 'name']);
    expect(canonicalPath('system.skills[1].name')).toBe('system.skills.1.name');
    expect(readPath(actor(), 'system.skills.1.name')).toEqual({ found: true, value: 'swim' });
    expect(readPath(actor(), 'system.skills[*].name')).toEqual({
      found: true,
      value: ['climb', 'swim'],
    });
    expect(readPath(actor(), 'system.skills.5.name')).toEqual({ found: false });
    expect(readPath({ 'system.cr': 2 }, 'system.cr')).toEqual({ found: true, value: 2 });
  });

  it('refuses empty parts, bad brackets and reserved names', () => {
    expect(() => parsePath('a..b')).toThrow(PathError);
    expect(() => parsePath('a[x]')).toThrow(/brackets/);
    expect(() => parsePath('__proto__.x')).toThrow(/reserved/);
  });

  it('selects fields and names the missing ones', () => {
    expect(selectFields(actor(), ['name', 'system.nope'])).toEqual({
      fields: { name: 'Grok' },
      missing: ['system.nope'],
    });
  });
});

describe('planUpdate', () => {
  it('merges objects like Foundry and sends only the difference', () => {
    const plan = planUpdate(actor(), {
      changes: { 'system.attributes': { hp: { value: 7 } }, name: 'Grok' },
    });
    expect(plan.changes).toEqual({ 'system.attributes.hp.value': 7 });
    expect(plan.diff).toEqual([{ path: 'system.attributes.hp.value', before: 10, after: 7 }]);
  });

  it('replaces an object named in replace, with deletions Foundry understands', () => {
    const plan = planUpdate(actor(), {
      changes: { 'system.attributes': { hp: { value: 3 } } },
      replace: ['system.attributes'],
    });
    expect(plan.expected['system']).toMatchObject({ attributes: { hp: { value: 3 } } });
    expect(plan.changes).toEqual({
      'system.attributes.hp.-=max': null,
      'system.attributes.hp.value': 3,
    });
  });

  it('changes one list entry and sends the whole list', () => {
    const plan = planUpdate(actor(), { changes: { 'system.skills[1].value': 5 } });
    expect(plan.changes).toEqual({
      'system.skills': [
        { name: 'climb', value: 1 },
        { name: 'swim', value: 5 },
      ],
    });
  });

  it('removes keys and list entries', () => {
    const plan = planUpdate(actor(), { remove: ['system.skills.0', 'flags.other'] });
    expect(plan.changes).toEqual({
      'system.skills': [{ name: 'swim', value: 2 }],
      'flags.-=other': null,
    });
  });

  it('refuses what cannot be applied, before anything is planned', () => {
    expect(() => planUpdate(actor(), { changes: { 'system.skills.9.value': 1 } })).toThrow(
      /outside/
    );
    expect(() => planUpdate(actor(), { changes: { a: 1 }, replace: ['b'] })).toThrow(/replace/);
    expect(() => planUpdate(actor(), { changes: { name: 'x' }, remove: ['name'] })).toThrow(
      /both removed and set/
    );
    expect(() => planUpdate(actor(), { changes: { name: 'x', 'name[0]': 1 } })).toThrow();
    expect(() => planUpdate(actor(), { remove: ['system.nope'] })).toThrow(/nothing/);
  });

  it("refuses Foundry's update operators anywhere, so protected fields cannot be removed unseen", () => {
    expect(() => planUpdate(actor(), { changes: { 'flags.-=ninjos-foundry-mcp': null } })).toThrow(
      /operator "-="/
    );
    expect(() =>
      planUpdate(actor(), { changes: { flags: { '==ninjos-foundry-mcp': {} } } })
    ).toThrow(/operator "=="/);
    expect(() => planUpdate(actor(), { changes: { list: [{ '-=x': null }] } })).toThrow(PathError);
    expect(() => planUpdate(actor(), { remove: ['flags.-=other'] })).toThrow(/operator/);
  });
});

describe('diff and conditions', () => {
  it('lists every changed leaf', () => {
    expect(diffValues({ a: { b: 1, c: [1, 2] } }, { a: { b: 2, c: [1] } })).toEqual([
      { path: 'a.b', before: 1, after: 2 },
      { path: 'a.c.1', before: 2 },
    ]);
    expect(foundryChanges({ a: 1, b: 2 }, { a: 1 })).toEqual({ '-=b': null });
  });

  it('matches conditions, with * passing when any entry passes', () => {
    const data = actor();
    expect(
      matchesCondition(data, { path: 'system.attributes.hp.value', op: 'gte', value: 10 })
    ).toBe(true);
    expect(matchesCondition(data, { path: 'system.skills.*.name', op: 'eq', value: 'swim' })).toBe(
      true
    );
    expect(matchesCondition(data, { path: 'system.skills.*.name', op: 'ne', value: 'swim' })).toBe(
      false
    );
    expect(matchesCondition(data, { path: 'name', op: 'contains', value: 'rok' })).toBe(true);
    expect(matchesCondition(data, { path: 'name', op: 'in', value: ['A', 'Grok'] })).toBe(true);
    expect(matchesCondition(data, { path: 'system.nope', op: 'exists', value: false })).toBe(true);
    expect(matchesCondition(data, { path: 'name', op: 'gt', value: 5 })).toBe(false);
  });

  it('gives a stable fingerprint and shortens large report values', () => {
    expect(fingerprint('abc')).toBe(fingerprint('abc'));
    expect(fingerprint('abc')).not.toBe(fingerprint('abd'));
    expect(reportValue('x'.repeat(50), 10)).toMatchObject({ shortened: true, chars: 52 });
  });
});
