/**
 * The rules of the window "Release compendiums", without Foundry: grouping,
 * what comes back ticked, and what is stored. The regression of the
 * previous generation is covered first: compendium ids contain dots, and a stored
 * selection must never turn into "everything allowed".
 */
import { afterEach, describe, expect, it } from 'vitest';
import { FakeFoundry } from '../../../testing/fake-foundry.js';
import {
  buildReleaseView,
  packageTitle,
  readPacks,
  releaseListFrom,
  sameEntries,
  type PackInfo,
} from './release-model.js';

const pack = (id: string, packageType: string, extra: Partial<PackInfo> = {}): PackInfo => ({
  id,
  label: id.split('.').slice(1).join('.'),
  type: 'JournalEntry',
  count: 3,
  locked: false,
  packageType,
  packageName: id.split('.')[0] ?? '',
  ...extra,
});

const PACKS: PackInfo[] = [
  pack('dnd5e.monsters', 'system', { label: 'Monsters', type: 'Actor' }),
  pack('world.archive', 'world', { label: 'Archive' }),
  pack('zeta-mod.presets', 'module', { label: 'Presets' }),
  pack('alpha-mod.maps.v2', 'module', { label: 'Maps' }),
  pack('alpha-mod.handouts', 'module', { label: 'Handouts', locked: true }),
  pack('world.backup', 'world', { label: 'Backup' }),
];

const titles: Record<string, string> = { 'alpha-mod': 'Zebra Tools', 'zeta-mod': 'Alpha Presets' };
const titleOf = (_kind: string, name: string) => titles[name] ?? name;

let foundry: FakeFoundry | null = null;
afterEach(() => {
  foundry?.uninstall();
  foundry = null;
});

describe('a stored selection', () => {
  it('comes back ticked, ids with dots included, and is stored again unchanged', () => {
    const stored = ['alpha-mod.maps.v2', 'world.archive'];
    const view = buildReleaseView(PACKS, stored, titleOf);
    const ticked = view.groups.flatMap(group => group.packs.filter(p => p.checked).map(p => p.id));
    expect(ticked.sort()).toEqual(stored);
    expect(view.allowAll).toBe(false);
    expect(releaseListFrom(PACKS, stored, ticked)).toEqual(stored);
  });

  it('never becomes an empty list while something is ticked', () => {
    expect(releaseListFrom(PACKS, [], ['alpha-mod.maps.v2'])).toEqual(['alpha-mod.maps.v2']);
  });
});

describe('buildReleaseView', () => {
  it('puts the world first, then one group per module sorted by title, then the system', () => {
    const view = buildReleaseView(PACKS, [], titleOf);
    expect(view.groups.map(group => `${group.kind}:${group.name}`)).toEqual([
      'world:world',
      'module:zeta-mod',
      'module:alpha-mod',
      'system:dnd5e',
    ]);
    expect(view.groups[0]?.packs.map(p => p.label)).toEqual(['Archive', 'Backup']);
    expect(view.groups[2]?.packs.map(p => p.label)).toEqual(['Handouts', 'Maps']);
  });

  it('ticks by full id or by package name, and sets "allow all" only for an empty list', () => {
    const view = buildReleaseView(PACKS, [' alpha-mod ', ''], titleOf);
    const alpha = view.groups.find(group => group.name === 'alpha-mod');
    expect(alpha?.packs.every(p => p.checked)).toBe(true);
    expect(view.allowAll).toBe(false);
    expect(buildReleaseView(PACKS, [], titleOf).allowAll).toBe(true);
  });

  it('names entries that match no compendium present', () => {
    expect(buildReleaseView(PACKS, ['gone-mod', 'world.archive'], titleOf).unmatched).toEqual([
      'gone-mod',
    ]);
  });
});

describe('releaseListFrom', () => {
  it('stores an empty list when nothing is ticked, which means every unlocked compendium', () => {
    expect(releaseListFrom(PACKS, ['world.archive'], [])).toEqual([]);
  });

  it('ignores ticked ids of compendiums that are not there', () => {
    expect(releaseListFrom(PACKS, [], ['nowhere.pack'])).toEqual([]);
  });

  it('keeps a package name while every compendium of that package stays ticked', () => {
    expect(
      releaseListFrom(PACKS, ['alpha-mod'], ['alpha-mod.maps.v2', 'alpha-mod.handouts'])
    ).toEqual(['alpha-mod']);
  });

  it('turns a package name into single ids when one of its compendiums is unticked', () => {
    expect(releaseListFrom(PACKS, ['alpha-mod'], ['alpha-mod.maps.v2'])).toEqual([
      'alpha-mod.maps.v2',
    ]);
  });

  it('keeps entries of compendiums that are not present while a selection is stored', () => {
    expect(releaseListFrom(PACKS, ['gone-mod'], ['world.backup'])).toEqual([
      'gone-mod',
      'world.backup',
    ]);
  });

  it('compares lists regardless of order and blanks', () => {
    expect(sameEntries(['b', 'a'], ['a', ' b'])).toBe(true);
    expect(sameEntries(['a'], [])).toBe(false);
  });
});

describe('reading from Foundry', () => {
  it('reads id, label, type, count, lock and package of every compendium', () => {
    foundry = new FakeFoundry().install();
    foundry.game['packs'] = [
      {
        collection: 'my-mod.npc.pack',
        documentName: 'Actor',
        locked: true,
        metadata: { label: 'NPCs', packageType: 'module', packageName: 'my-mod' },
        index: { size: 42 },
      },
      { collection: 'world.bare', metadata: {} },
    ];
    expect(readPacks()).toEqual([
      {
        id: 'my-mod.npc.pack',
        label: 'NPCs',
        type: 'Actor',
        count: 42,
        locked: true,
        packageType: 'module',
        packageName: 'my-mod',
      },
      {
        id: 'world.bare',
        label: 'world.bare',
        type: '',
        count: 0,
        locked: false,
        packageType: 'module',
        packageName: 'world',
      },
    ]);
    expect(packageTitle('module', 'unknown-mod')).toBe('unknown-mod');
    expect(packageTitle('world', 'world')).toBe('world');
  });

  it('reads nothing when there are no compendiums', () => {
    foundry = new FakeFoundry().install();
    expect(readPacks()).toEqual([]);
  });
});
