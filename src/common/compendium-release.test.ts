import { describe, expect, it } from 'vitest';
import {
  interpretReleaseList,
  releaseDecision,
  releaseEntryMatches,
  releaseListCovers,
  serializeReleaseList,
} from './compendium-release.js';

describe('interpretReleaseList', () => {
  it('reads the empty list as every unlocked compendium', () => {
    expect(interpretReleaseList('')).toMatchObject({
      mode: 'all-unlocked',
      entries: [],
      problem: null,
    });
    expect(interpretReleaseList(null)).toMatchObject({ mode: 'all-unlocked' });
    expect(interpretReleaseList(' , ;')).toMatchObject({ mode: 'all-unlocked' });
  });

  it('reads separated text, a JSON list and a list, without duplicates', () => {
    expect(interpretReleaseList('world.archive; my-module\nworld.archive').entries).toEqual([
      'world.archive',
      'my-module',
    ]);
    expect(interpretReleaseList('["world.a", "dnd5e"]')).toMatchObject({
      mode: 'listed',
      entries: ['world.a', 'dnd5e'],
    });
    expect(interpretReleaseList(['world.a'])).toMatchObject({ mode: 'listed' });
  });

  it('never releases more from a value it cannot read', () => {
    expect(interpretReleaseList('[oops')).toMatchObject({ mode: 'damaged', entries: [] });
    expect(interpretReleaseList(42).problem).toMatch(/number/);
    expect(interpretReleaseList(['a', 1]).mode).toBe('damaged');
    expect(interpretReleaseList(undefined)).toMatchObject({ mode: 'unregistered' });
  });

  it('writes entries back separated by a comma and a space, as the previous window stored them', () => {
    expect(serializeReleaseList([' world.a ', 'dnd5e', 'world.a', ''])).toBe('world.a, dnd5e');
    expect(serializeReleaseList([])).toBe('');
    const text = serializeReleaseList(['world.a', 'my-module']);
    expect(interpretReleaseList(text).entries).toEqual(['world.a', 'my-module']);
  });
});

describe('releaseDecision', () => {
  it('allows everything on an empty list, but nothing counts as listed', () => {
    expect(releaseDecision(interpretReleaseList(''), 'world.a', 'world')).toEqual({
      allowed: true,
      onList: false,
      reason: null,
    });
  });

  it('matches a filled list by id or by package', () => {
    const list = interpretReleaseList('world.archive, my-module');
    expect(releaseDecision(list, 'world.archive', 'world')).toMatchObject({
      allowed: true,
      onList: true,
    });
    expect(releaseDecision(list, 'my-module.spells', 'my-module')).toMatchObject({ onList: true });
    const refused = releaseDecision(list, 'world.other', 'world');
    expect(refused.allowed).toBe(false);
    expect(refused.reason).toContain('"world.other" is not on the release list');
  });

  it('matches an entry that is the start of the id and a dot, whatever the package is called', () => {
    const list = interpretReleaseList('my-module, world');
    expect(releaseDecision(list, 'my-module.presets', 'shipper')).toMatchObject({
      allowed: true,
      onList: true,
    });
    expect(releaseListCovers(list, 'world.archive', 'other')).toBe(true);
    expect(releaseEntryMatches('my-mod', 'my-module.presets', 'shipper')).toBe(false);
    expect(releaseEntryMatches('world.arch', 'world.archive', 'world')).toBe(false);
    expect(releaseEntryMatches('my-module.presets', 'my-module.presets', null)).toBe(true);
  });

  it('lets no rule match through a list that is damaged or not registered', () => {
    expect(releaseListCovers(interpretReleaseList(undefined), 'world.archive', 'world')).toBe(
      false
    );
    expect(releaseListCovers(interpretReleaseList('[world'), 'world.archive', 'world')).toBe(false);
    expect(releaseListCovers(interpretReleaseList(''), 'world.archive', 'world')).toBe(false);
  });

  it('refuses every compendium while the list is damaged or missing, with the cause', () => {
    const refused = releaseDecision(interpretReleaseList('[oops'), 'world.a', 'world');
    expect(refused).toMatchObject({ allowed: false, onList: false });
    expect(refused.reason).toMatch(/could not be read: the stored text is not a list/);
    expect(releaseDecision(interpretReleaseList(undefined), 'world.a').reason).toMatch(
      /not registered/
    );
  });
});
