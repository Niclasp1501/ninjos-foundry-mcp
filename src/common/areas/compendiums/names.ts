/**
 * One rule for finding entries by name, for every compendium tool.
 *
 * The previous generation had three: exact for deleting, ignoring case for
 * saving, and "first entry that contains the text" for importing and
 * sorting. The last one moved entries into the wrong folder without anyone
 * noticing. Here a name is always matched as a whole, never as a part:
 *
 * 1. the exact spelling, if exactly that exists
 * 2. otherwise the same name ignoring case and surrounding spaces, unless the
 *    caller asks for the exact spelling only (deleting does)
 *
 * More than one match is ambiguous and reported with every id. Nothing is
 * guessed. Substring matches only ever appear as suggestions in an error.
 */

export interface Named {
  id: string;
  name: string;
}

export interface AmbiguousMatch<T extends Named> {
  requested: string;
  matches: T[];
}

export interface Selection<T extends Named> {
  /** Every entry selected exactly once, in the order of the request. */
  found: T[];
  notFound: string[];
  ambiguous: AmbiguousMatch<T>[];
}

export interface MatchOptions {
  /** Only the exact spelling counts. */
  caseSensitive?: boolean;
}

export function foldName(name: string): string {
  return name.normalize('NFC').trim().toLowerCase();
}

/** Every entry carrying this name, by the rule above. */
export function entriesNamed<T extends Named>(
  entries: readonly T[],
  wanted: string,
  options: MatchOptions = {}
): T[] {
  const exact = entries.filter(entry => entry.name === wanted);
  if (exact.length > 0 || options.caseSensitive) return exact;
  const folded = foldName(wanted);
  if (folded === '') return [];
  return entries.filter(entry => foldName(entry.name) === folded);
}

/**
 * Resolve a list of requested ids and names.
 *
 * With `acceptIds`, a request equal to an id selects that entry. A request
 * that is an id of one entry and the name of another is ambiguous.
 */
export function selectEntries<T extends Named>(
  entries: readonly T[],
  requested: readonly string[],
  options: MatchOptions & { acceptIds?: boolean } = {}
): Selection<T> {
  const selection: Selection<T> = { found: [], notFound: [], ambiguous: [] };
  const taken = new Set<string>();
  const seen = new Set<string>();

  for (const request of requested) {
    if (seen.has(request)) continue;
    seen.add(request);

    const byName = entriesNamed(entries, request, options);
    const byId = options.acceptIds ? entries.filter(entry => entry.id === request) : [];
    const matches = [...byId, ...byName.filter(entry => !byId.includes(entry))];

    if (matches.length === 0) {
      selection.notFound.push(request);
    } else if (matches.length > 1) {
      selection.ambiguous.push({ requested: request, matches });
    } else {
      const entry = matches[0] as T;
      if (!taken.has(entry.id)) {
        taken.add(entry.id);
        selection.found.push(entry);
      }
    }
  }
  return selection;
}

/** Names that contain the text, for the hint in an error. Never used to select. */
export function similarNames(entries: readonly Named[], wanted: string, max = 10): string[] {
  const folded = foldName(wanted);
  if (folded.length < 2) return [];
  const names = entries.map(entry => entry.name).filter(name => foldName(name).includes(folded));
  return [...new Set(names)].slice(0, max);
}

/** Sort by name the way a person reads a list. */
export function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
}
