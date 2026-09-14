/**
 * The compendium release list, read and interpreted in one place.
 *
 * Stored in the world setting `writableCompendiums` as text. Empty means every
 * unlocked compendium, whoever ships it. Filled means only what is listed; an
 * entry matches a compendium when it is its full id (`world.archive`), its
 * package name (`my-module`), or the start of its id followed by a dot
 * (`my-module` for `my-module.spells`, whatever the package is called). These
 * are the three rules of the previous generation, so one stored list releases
 * the same compendiums in both.
 *
 * Both the permission overview (the world area) and the compendium checks
 * (the compendiums area) read it through these functions, so what the overview shows is
 * what the check enforces.
 *
 * A value that cannot be read never releases more than intended: it counts as
 * a filled list that covers nothing, and the reason is reported. Once before, a
 * saved selection arrived nested and was stored as empty, and an empty list
 * means "everything allowed". A setting that is
 * not registered at all is treated the same way.
 *
 * Read are text separated by commas, semicolons or line breaks (what the
 * previous generation reads), a JSON list of texts inside the text, and a list
 * of texts. No generation writes the JSON forms; reading them releases what
 * they name, which is on the safe side. Written is text separated by a comma
 * and a space, as the release window of the previous generation stored it.
 */

export const RELEASE_LIST_SETTING = 'writableCompendiums';

/**
 * - `all-unlocked`: empty, every compendium that is not locked may be written
 * - `listed`: only the entries
 * - `damaged`: a stored value that cannot be read; releases nothing
 * - `unregistered`: the setting does not exist in this module; releases nothing
 */
export type ReleaseListMode = 'all-unlocked' | 'listed' | 'damaged' | 'unregistered';

export interface ReleaseList {
  setting: string;
  mode: ReleaseListMode;
  entries: string[];
  /** Why the list could not be read, for `damaged` and `unregistered`; otherwise null. */
  problem: string | null;
}

export interface ReleaseDecision {
  /** Whether the release list lets this compendium be written. The lock is a separate question. */
  allowed: boolean;
  /** Named by a filled list. A compendium on the list may be written while locked. */
  onList: boolean;
  /** Why it is refused, or null. */
  reason: string | null;
}

function clean(values: readonly string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(value => value !== ''))];
}

function fromEntries(entries: string[]): ReleaseList {
  return {
    setting: RELEASE_LIST_SETTING,
    mode: entries.length ? 'listed' : 'all-unlocked',
    entries,
    problem: null,
  };
}

function broken(mode: 'damaged' | 'unregistered', problem: string): ReleaseList {
  return { setting: RELEASE_LIST_SETTING, mode, entries: [], problem };
}

/** Interpret a stored value. `undefined` is what reading an unregistered setting gives. */
export function interpretReleaseList(raw: unknown): ReleaseList {
  if (raw === undefined) {
    return broken(
      'unregistered',
      `the setting "${RELEASE_LIST_SETTING}" is not registered in this version of the module`
    );
  }
  if (raw === null) return fromEntries([]);
  if (Array.isArray(raw)) {
    return raw.every(value => typeof value === 'string')
      ? fromEntries(clean(raw))
      : broken('damaged', 'the stored list contains values that are not text');
  }
  if (typeof raw !== 'string')
    return broken('damaged', `the stored value is ${typeof raw}, not text`);

  const text = raw.trim();
  if (text === '') return fromEntries([]);
  if (text.startsWith('[')) {
    try {
      const list: unknown = JSON.parse(text);
      if (Array.isArray(list) && list.every(value => typeof value === 'string'))
        return fromEntries(clean(list));
    } catch {
      // Reported below with the stored text.
    }
    return broken('damaged', `the stored text is not a list of texts: ${text.slice(0, 80)}`);
  }
  return fromEntries(clean(text.split(/[,;\n]/)));
}

/** What is written back: entries separated by a comma and a space. Neither ids nor package names contain a comma. */
export function serializeReleaseList(entries: readonly string[]): string {
  return clean(entries).join(', ');
}

/** Whether one entry names this compendium: its id, its package name, or the start of its id and a dot. */
export function releaseEntryMatches(
  entry: string,
  packId: string,
  packageName?: string | null
): boolean {
  return (
    entry === packId || (!!packageName && entry === packageName) || packId.startsWith(`${entry}.`)
  );
}

/** Whether a filled, readable list names this compendium. A damaged or unregistered list names nothing. */
export function releaseListCovers(
  list: ReleaseList,
  packId: string,
  packageName?: string | null
): boolean {
  return (
    list.mode === 'listed' &&
    list.entries.some(entry => releaseEntryMatches(entry, packId, packageName))
  );
}

/** The release list's answer for one compendium. */
export function releaseDecision(
  list: ReleaseList,
  packId: string,
  packageName?: string | null
): ReleaseDecision {
  if (list.mode === 'all-unlocked') return { allowed: true, onList: false, reason: null };
  if (list.mode === 'listed') {
    if (releaseListCovers(list, packId, packageName))
      return { allowed: true, onList: true, reason: null };
    return {
      allowed: false,
      onList: false,
      reason:
        `"${packId}" is not on the release list (setting "${RELEASE_LIST_SETTING}"). A Gamemaster can add it` +
        (packageName ? `, or its package "${packageName}",` : '') +
        ' in the module settings, or clear the list to allow every unlocked compendium.',
    };
  }
  return {
    allowed: false,
    onList: false,
    reason:
      `The release list (setting "${RELEASE_LIST_SETTING}") could not be read: ${list.problem}. ` +
      `Until it is saved again, no compendium counts as released, so "${packId}" is refused.`,
  };
}
