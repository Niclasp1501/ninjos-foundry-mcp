import { describe, expect, it } from 'vitest';
import { entriesNamed, selectEntries, similarNames } from './names.js';
import { interpretReleaseList, releaseListCovers, serializeReleaseList } from './release-list.js';

const listed = (...entries: string[]) => interpretReleaseList(entries);

const entries = [
  { id: 'a', name: 'Wald' },
  { id: 'b', name: 'Waldrand' },
  { id: 'c', name: 'Orc' },
  { id: 'd', name: 'orc' },
  { id: 'e', name: 'Goblin' },
];

describe('entriesNamed', () => {
  it('never matches a part of a name', () => {
    expect(entriesNamed(entries, 'Wald').map(e => e.id)).toEqual(['a']);
    expect(entriesNamed(entries, 'Wal')).toEqual([]);
  });

  it('prefers the exact spelling and otherwise ignores case', () => {
    expect(entriesNamed(entries, 'Orc').map(e => e.id)).toEqual(['c']);
    expect(entriesNamed(entries, 'ORC').map(e => e.id)).toEqual(['c', 'd']);
    expect(entriesNamed(entries, ' goblin ').map(e => e.id)).toEqual(['e']);
  });

  it('keeps to the exact spelling when asked', () => {
    expect(entriesNamed(entries, 'goblin', { caseSensitive: true })).toEqual([]);
  });
});

describe('selectEntries', () => {
  it('reports not found and ambiguous requests and selects each entry once', () => {
    const selection = selectEntries(entries, ['Wald', 'ORC', 'Troll', 'Wald', 'e'], {
      acceptIds: true,
    });
    expect(selection.found.map(e => e.id)).toEqual(['a', 'e']);
    expect(selection.notFound).toEqual(['Troll']);
    expect(selection.ambiguous).toEqual([{ requested: 'ORC', matches: [entries[2], entries[3]] }]);
  });

  it('treats a request that is an id of one entry and the name of another as ambiguous', () => {
    const list = [
      { id: 'x1', name: 'Alpha' },
      { id: 'x2', name: 'x1' },
    ];
    expect(selectEntries(list, ['x1'], { acceptIds: true }).ambiguous).toHaveLength(1);
    expect(selectEntries(list, ['x1']).found.map(e => e.id)).toEqual(['x2']);
  });

  it('offers substring matches only as suggestions', () => {
    expect(similarNames(entries, 'wal')).toEqual(['Wald', 'Waldrand']);
  });
});

describe('release list', () => {
  it('reads commas, line breaks, JSON and lists through the core', () => {
    expect(interpretReleaseList('world.a, mod ;\nsys.b')).toMatchObject({
      mode: 'listed',
      entries: ['world.a', 'mod', 'sys.b'],
      problem: null,
    });
    expect(interpretReleaseList('["world.a","mod"]').entries).toEqual(['world.a', 'mod']);
    expect(interpretReleaseList(['world.a', 'world.a']).entries).toEqual(['world.a']);
    expect(interpretReleaseList('')).toMatchObject({ mode: 'all-unlocked', entries: [] });
  });

  it('releases nothing for a value it cannot read or a setting that is not registered', () => {
    expect(interpretReleaseList({ world: { archive: true } }).problem).toMatch(/not text/);
    expect(interpretReleaseList('[broken').problem).toMatch(/not a list/);
    const unregistered = interpretReleaseList(undefined);
    expect(unregistered.mode).toBe('unregistered');
    expect(releaseListCovers(unregistered, 'world.archive', 'world')).toBe(false);
  });

  it('matches by id, package name or id prefix, never by a part of a name', () => {
    expect(releaseListCovers(listed('my-module'), 'my-module.presets', 'my-module')).toBe(true);
    expect(releaseListCovers(listed('world.archive'), 'world.archive', 'world')).toBe(true);
    expect(releaseListCovers(listed('world'), 'world.archive', 'other')).toBe(true);
    expect(releaseListCovers(listed('world.arch'), 'world.archive', 'world')).toBe(false);
    expect(releaseListCovers(listed(), 'world.archive', 'world')).toBe(false);
  });

  // Until 13.09.2026 this test expected "world.a,mod". The code was right to
  // change: the release window of the previous generation stores comma and
  // space, and the test had
  // not followed.
  it('writes entries separated by comma and space, as the previous generation does, and reads them back unchanged', () => {
    const text = serializeReleaseList(['world.a', ' mod ', '', 'world.a']);
    expect(text).toBe('world.a, mod');
    expect(interpretReleaseList(text).entries).toEqual(['world.a', 'mod']);
  });
});
