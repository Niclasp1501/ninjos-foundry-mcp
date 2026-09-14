/**
 * What the window "Release compendiums" shows and what it stores.
 *
 * Pure functions, so the rules that once went wrong can be tested without
 * Foundry: a stored selection must come back ticked, and a selection must
 * never turn into "everything allowed" on the way. That happened once
 * because compendium ids contain a dot and the form data arrived nested.
 * The window here reads its checkboxes one by one, by value, and never
 * expands field names.
 */

export interface PackInfo {
  /** Full id, e.g. "world.archive" or "my-module.presets". */
  id: string;
  label: string;
  /** Document type, e.g. "JournalEntry". */
  type: string;
  count: number;
  locked: boolean;
  /** "world", "module" or "system"; anything else is shown with the modules. */
  packageType: string;
  packageName: string;
}

export interface ReleaseRow extends PackInfo {
  checked: boolean;
}

export interface ReleaseGroup {
  kind: 'world' | 'module' | 'system';
  /** Package name, for modules and the system; "world" for the world. */
  name: string;
  packs: ReleaseRow[];
}

export interface ReleaseView {
  /** The box "allow every compendium that is not locked": set while the list is empty. */
  allowAll: boolean;
  /** World first, then one group per package sorted by title, then the system. */
  groups: ReleaseGroup[];
  /** Entries of the stored list that match no compendium present. */
  unmatched: string[];
}

/** Title of a package for sorting and headings. */
export type TitleOf = (kind: ReleaseGroup['kind'], name: string) => string;

const byText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

function normalise(entries: readonly string[]): string[] {
  return [...new Set(entries.map(entry => entry.trim()).filter(Boolean))];
}

/** An entry matches a pack by its full id or by its package name. */
export function matchesPack(entry: string, pack: PackInfo): boolean {
  return entry === pack.id || entry === pack.packageName;
}

export function buildReleaseView(
  packs: readonly PackInfo[],
  storedEntries: readonly string[],
  titleOf: TitleOf
): ReleaseView {
  const entries = normalise(storedEntries);
  const groups = new Map<string, ReleaseGroup>();

  for (const pack of packs) {
    const kind: ReleaseGroup['kind'] =
      pack.packageType === 'world' ? 'world' : pack.packageType === 'system' ? 'system' : 'module';
    const name = kind === 'world' ? 'world' : pack.packageName;
    const key = `${kind}:${name}`;
    let group = groups.get(key);
    if (!group) {
      group = { kind, name, packs: [] };
      groups.set(key, group);
    }
    group.packs.push({ ...pack, checked: entries.some(entry => matchesPack(entry, pack)) });
  }

  const rank = { world: 0, module: 1, system: 2 } as const;
  const sorted = [...groups.values()].sort(
    (a, b) =>
      rank[a.kind] - rank[b.kind] || byText(titleOf(a.kind, a.name), titleOf(b.kind, b.name))
  );
  for (const group of sorted) group.packs.sort((a, b) => byText(a.label, b.label));

  return {
    allowAll: entries.length === 0,
    groups: sorted,
    unmatched: entries.filter(entry => !packs.some(pack => matchesPack(entry, pack))),
  };
}

/**
 * The entries to store for what is ticked.
 *
 * - Nothing ticked below: an empty list, which means every compendium that is
 *   not locked. The box at the top does not change that; it only shows it.
 * - Something ticked: exactly that selection, whatever the box at the top says.
 * - A package name that was on the list stays a package name while every
 *   compendium of that package is still ticked, so a compendium the package
 *   adds later is released as before.
 * - Entries that match no compendium present (a deactivated module) stay on
 *   the list; the window names them.
 */
export function releaseListFrom(
  packs: readonly PackInfo[],
  storedEntries: readonly string[],
  checkedIds: readonly string[]
): string[] {
  const checked = new Set(checkedIds.filter(id => packs.some(pack => pack.id === id)));
  if (checked.size === 0) return [];

  const previous = normalise(storedEntries);
  const result = new Set<string>();
  const covered = new Set<string>();

  for (const entry of previous) {
    const members = packs.filter(pack => pack.packageName === entry && pack.id !== entry);
    if (members.length > 0 && members.every(pack => checked.has(pack.id))) {
      result.add(entry);
      for (const pack of members) covered.add(pack.id);
    }
  }
  for (const id of checked) if (!covered.has(id)) result.add(id);
  for (const entry of previous) {
    if (!packs.some(pack => matchesPack(entry, pack))) result.add(entry);
  }
  return [...result].sort(byText);
}

/** Two lists hold the same entries, in any order. */
export function sameEntries(a: readonly string[], b: readonly string[]): boolean {
  const left = normalise(a).sort();
  const right = normalise(b).sort();
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

/** The compendiums of the loaded world, read from game.packs. */
export function readPacks(): PackInfo[] {
  const packs = (game as unknown as { packs?: Iterable<FoundryInterfacePack> }).packs;
  if (!packs) return [];
  const out: PackInfo[] = [];
  for (const pack of packs) {
    const metadata = pack.metadata ?? {};
    out.push({
      id: pack.collection,
      label: metadata.label ?? pack.title ?? pack.collection,
      type: pack.documentName ?? metadata.type ?? '',
      count: pack.index?.size ?? 0,
      locked: pack.locked === true,
      packageType: metadata.packageType ?? 'module',
      packageName: metadata.packageName ?? pack.collection.split('.')[0] ?? '',
    });
  }
  return out;
}

/** Title of a module or the system, falling back to its id. */
export function packageTitle(kind: ReleaseGroup['kind'], name: string): string {
  if (kind === 'world') return name;
  if (kind === 'system') {
    const system = game.system as { id: string; title?: string } | undefined;
    return system?.id === name && system.title ? system.title : name;
  }
  const module = game.modules.get(name) as { title?: string } | undefined;
  return module?.title || name;
}
