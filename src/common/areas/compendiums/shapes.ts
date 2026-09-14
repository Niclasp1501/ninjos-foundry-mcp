/**
 * Limits and answer shapes both sides of the compendiums area agree on.
 *
 * The module answers in these shapes; the server turns them into text. The
 * server still reads every field defensively, because a module of the
 * previous generation may answer differently.
 */

/** Document types a compendium can hold, as create-compendium offers them. */
export const COMPENDIUM_TYPES = [
  'Actor',
  'Item',
  'Scene',
  'JournalEntry',
  'RollTable',
  'Playlist',
  'Macro',
  'Cards',
  'Adventure',
] as const;

/** Document types export-to-compendium saves from the world. */
export const EXPORT_TYPES = [
  'JournalEntry',
  'Scene',
  'Actor',
  'RollTable',
  'Playlist',
  'Item',
  'Macro',
] as const;

export const ENTRY_LIMIT = { fallback: 200, max: 1000 } as const;
export const SEARCH_LIMIT = { fallback: 50, max: 50 } as const;
export const CREATURE_LIMIT = { fallback: 100, max: 1000 } as const;
/** Entries removed per call to Foundry, so no single answer grows too large. */
export const DELETE_BATCH = 200;
/** Entries written out in a text before "... and n more". */
export const LISTED_IN_TEXT = 25;
/** Names of a compendium shown when an entry was not found. */
export const NAMES_IN_ERROR = 15;

/**
 * The data field a server of this generation adds to searchCompendium to get
 * the detailed answer. Without it the module answers with the bare list a
 * server of the previous generation reads, which has no room for ignored
 * filters or the true count. A module of the previous generation ignores it.
 */
export const DETAILED_ANSWER = { field: 'answerShape', value: 'report' } as const;

export interface PackRef {
  id: string;
  label: string;
}

export interface EntryRef {
  id: string;
  name: string;
}

export interface AmbiguousName {
  name: string;
  ids: string[];
}

/** What happened to the lock of a compendium during one operation. */
export interface LockReport {
  wasLocked: boolean;
  /** The lock was lifted for the operation. */
  lifted: boolean;
  /** Whether it was set again; null when it was not lifted. */
  restored: boolean | null;
  /** Why restoring failed, or null. */
  problem: string | null;
}

export interface PackSummary {
  id: string;
  label: string;
  type: string;
  locked: boolean;
  packageType: string;
  packageName: string;
  system: string | null;
  count: number;
  /** Every layer lets the AI write here: switch, level, release list, lock. */
  writable: boolean;
  /** The first layer that holds it back, or null. */
  notWritableReason: string | null;
  onReleaseList: boolean;
}

export interface WriteAccessSummary {
  writeOperationsEnabled: boolean;
  level: string;
  releaseList: string[];
  releaseListProblem: string | null;
}
