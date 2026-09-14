/**
 * What in the change log can be undone, and how, without Foundry.
 *
 * The packages record their states in the forms that suit them: a whole
 * document (`toObject()`), a list with one document per target, or only the
 * fields they touched (`{ "text.content": ... }`). These rules read all three
 * the same way: a state is a set of dotted paths with values.
 */
import type { ChangeEntry, ChangeTarget } from '../../change-log.js';
import {
  PERMISSION_SETTINGS,
  UNLEVELED_KINDS,
  WRITE_SWITCH_ONLY,
  type Access,
  type DocumentKind,
  type WriteAction,
} from '../../permissions.js';

export type Data = Record<string, unknown>;

export function isData(value: unknown): value is Data {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Labels the packages log without a document behind them, and why an entry
 * with one of them stays as it is. A chat message counts here too: once
 * players have read it, removing it does not take it back.
 */
export const NOT_REVERSIBLE_KINDS: Readonly<Record<string, string>> = {
  ChatMessages: 'a chat message has been seen at the table; removing it does not take it back',
  Notifications: 'a notification has been shown already',
  WorldTime: 'world time moved on for every client, and modules may have reacted to it',
  Pause: 'pausing or resuming reached every client at once',
  Files: 'files are not documents, and Foundry cannot delete files',
  Settings: 'settings are changed through their own allow list, not through undo',
  Extension: 'the tool of another module did not describe its change',
};

/** Where a world document of a kind lives in `game`. */
export const WORLD_COLLECTION_OF: Readonly<
  Record<string, { collection: string; documentName: string }>
> = {
  Scenes: { collection: 'scenes', documentName: 'Scene' },
  Playlists: { collection: 'playlists', documentName: 'Playlist' },
  Journals: { collection: 'journal', documentName: 'JournalEntry' },
  RollTables: { collection: 'tables', documentName: 'RollTable' },
  Actors: { collection: 'actors', documentName: 'Actor' },
  Folders: { collection: 'folders', documentName: 'Folder' },
  Items: { collection: 'items', documentName: 'Item' },
  Macros: { collection: 'macros', documentName: 'Macro' },
  Cards: { collection: 'cards', documentName: 'Cards' },
  Combats: { collection: 'combats', documentName: 'Combat' },
};

export function kindsOf(entry: Pick<ChangeEntry, 'document' | 'documents'>): string[] {
  return entry.document === 'Multiple' ? [...(entry.documents ?? [])] : [entry.document];
}

/** The action whose level every undo in a chain is checked against. */
export function rightsAction(
  entry: Pick<ChangeEntry, 'action' | 'restores'>
): WriteAction | 'other' {
  return entry.restores?.action ?? entry.action;
}

/**
 * The states of `value` per target, in the order of `targets`, or null when
 * they cannot be told apart. A list is matched by `_id` when its entries
 * carry the target ids, else by position; a single object belongs to a single
 * target.
 */
export function statesPerTarget(value: unknown, targets: readonly ChangeTarget[]): Data[] | null {
  if (value === undefined) return null;
  if (Array.isArray(value)) {
    if (value.length !== targets.length || !value.every(isData)) return null;
    const byId = new Map(
      value
        .filter(item => typeof item['_id'] === 'string')
        .map(item => [item['_id'] as string, item])
    );
    if (byId.size === value.length && targets.every(t => t.id && byId.has(t.id)))
      return targets.map(t => byId.get(t.id as string) as Data);
    return value;
  }
  return isData(value) && targets.length === 1 ? [value] : null;
}

export interface Reversibility {
  reversible: boolean;
  reason?: string;
}

/** Whether an entry can be undone at all, before looking at the world. */
export function reversibility(entry: ChangeEntry): Reversibility {
  const no = (reason: string): Reversibility => ({ reversible: false, reason });
  if (entry.undoneAt) return no(`it was undone already at ${entry.undoneAt}`);
  for (const kind of kindsOf(entry)) {
    const why = NOT_REVERSIBLE_KINDS[kind];
    if (why) return no(`it changed ${kind}: ${why}`);
  }
  if (entry.action === 'other') return no('it is no create, update or delete of documents');
  if (entry.targets.length === 0) return no('the entry names no document');
  if (entry.action === 'create') {
    if (!entry.targets.every(t => t.uuid || t.id))
      return no('the entry does not name the id of every created document');
    return { reversible: true };
  }
  if (entry.before === undefined)
    return no(
      'the state before the change was not recorded (too large, or the tool does not record it)'
    );
  if (!statesPerTarget(entry.before, entry.targets))
    return no('the recorded state before the change cannot be matched to its documents');
  if (entry.action === 'delete') {
    const states = statesPerTarget(entry.before, entry.targets) ?? [];
    if (entry.targets.some(t => t.uuid?.startsWith('Compendium.')))
      return no('undo does not restore documents in compendiums');
    if (states.some(state => Object.keys(state).some(key => key.includes('.'))))
      return no('only some fields of the deleted document were recorded, not the document');
  }
  return { reversible: true };
}

/**
 * The accesses an undo needs: the same kind and action as the first write of
 * the chain. A kind the permission settings do not know is treated like a
 * kind without a level: the switch, and no delete.
 */
export function undoAccesses(entry: ChangeEntry): { accesses: Access[]; refusal?: string } {
  const action = rightsAction(entry);
  if (action === 'other') return { accesses: [WRITE_SWITCH_ONLY] };
  const accesses: Access[] = [];
  for (const kind of kindsOf(entry)) {
    if (kind in PERMISSION_SETTINGS || kind in UNLEVELED_KINDS) {
      accesses.push({ kind: 'write', document: kind as DocumentKind, action });
    } else if (action === 'delete') {
      return {
        accesses,
        refusal:
          `Undoing a deletion of ${kind} needs the level "create, change and delete", and ${kind} have no level ` +
          'in the permission settings, so it stays off.',
      };
    } else {
      accesses.push(WRITE_SWITCH_ONLY);
    }
  }
  return { accesses: accesses.length ? accesses : [WRITE_SWITCH_ONLY] };
}

const IGNORED_ROOTS = new Set(['_id', '_stats']);

/** A list of embedded documents, which an update cannot restore field by field. */
export function isEmbeddedList(value: unknown): boolean {
  return (
    Array.isArray(value) && value.length > 0 && value.every(item => isData(item) && '_id' in item)
  );
}

/**
 * Leaves of a state as dotted paths. Keys that already contain dots stay one
 * path. Arrays are leaves. `_id` and `_stats` are left out, because Foundry
 * keeps them itself.
 */
export function flatten(state: Data, prefix = ''): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [key, value] of Object.entries(state)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!prefix && IGNORED_ROOTS.has(key)) continue;
    if (isData(value) && Object.keys(value).length > 0) {
      for (const [inner, leaf] of flatten(value, path)) out.set(inner, leaf);
    } else {
      out.set(path, value);
    }
  }
  return out;
}

/** The value at a dotted path, or undefined. */
export function readPath(data: unknown, path: string): unknown {
  let current: unknown = data;
  for (const part of path.split('.')) {
    if (!isData(current) || !(part in current)) return undefined;
    current = current[part];
  }
  return current;
}

export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const empty = (v: unknown) => v === undefined || (isData(v) && Object.keys(v).length === 0);
  if (empty(a) && empty(b)) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export interface FieldDifference {
  path: string;
  expected: unknown;
  actual: unknown;
}

/** Every path of `expected` whose value in `actual` is different. */
export function differences(expected: Data, actual: Data): FieldDifference[] {
  const found: FieldDifference[] = [];
  for (const [path, value] of flatten(expected)) {
    const now = readPath(actual, path);
    if (!sameValue(value, now)) found.push({ path, expected: value, actual: now });
  }
  return found;
}

export interface RestorePlan {
  /** The update that puts the fields back, with `-=` for keys the change added. */
  update: Data;
  /** Paths the update touches, for the answer and the check afterwards. */
  paths: string[];
  /** Why the plan cannot restore everything; a plan with problems is not run. */
  problems: string[];
}

/**
 * The update that brings `current` back to `before`. Keys that exist only
 * after the change are removed when the state after is known.
 */
export function restorePlan(before: Data, current: Data, after?: Data): RestorePlan {
  const update: Data = {};
  const paths: string[] = [];
  const problems: string[] = [];
  const old = flatten(before);
  for (const [path, value] of old) {
    const now = readPath(current, path);
    if (sameValue(value, now)) continue;
    if (isEmbeddedList(value) || isEmbeddedList(now)) {
      problems.push(
        `${path} holds embedded documents that changed; undo cannot restore them field by field`
      );
      continue;
    }
    update[path] = value;
    paths.push(path);
  }
  if (after) {
    for (const path of flatten(after).keys()) {
      if (old.has(path) || [...old.keys()].some(known => path.startsWith(`${known}.`))) continue;
      if (readPath(current, path) === undefined) continue;
      const cut = path.lastIndexOf('.');
      const key = cut < 0 ? `-=${path}` : `${path.slice(0, cut)}.-=${path.slice(cut + 1)}`;
      update[key] = null;
      paths.push(path);
    }
  }
  return { update, paths, problems };
}

/** Whether two targets name the same document. */
export function sameTarget(a: ChangeTarget, b: ChangeTarget): boolean {
  if (a.uuid && b.uuid) return a.uuid === b.uuid;
  return Boolean(a.id && a.id === b.id && (a.documentName ?? '') === (b.documentName ?? ''));
}

/** `Scene.abc.Wall.def` gives `{ parent: "Scene.abc", documentName: "Wall", id: "def" }`. */
export function splitUuid(
  uuid: string
): { parent: string | null; documentName: string; id: string } | null {
  const parts = uuid.split('.');
  if (parts.length < 2 || parts.length % 2 !== 0) return null;
  return {
    parent: parts.length > 2 ? parts.slice(0, -2).join('.') : null,
    documentName: parts[parts.length - 2] as string,
    id: parts[parts.length - 1] as string,
  };
}
