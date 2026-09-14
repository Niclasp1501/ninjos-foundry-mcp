/**
 * A record of every change the AI made to the world.
 *
 * This is the groundwork for three things that come later and need the same
 * data: a log the GM can read, a preview before destructive work, and undo.
 * Undo needs the state before the change, so an entry carries it whenever the
 * writing handler can provide it, and says honestly whether it can be undone.
 *
 * Kept in memory for now, bounded, newest first. Where it is persisted is an
 * open decision.
 */
import type { DocumentKind, WriteAction } from './permissions.js';

export interface ChangeTarget {
  id?: string;
  uuid?: string;
  name?: string;
  /** Foundry document name of this target, e.g. "Item", when the change spans several kinds. */
  documentName?: string;
}

/**
 * Changes with no document type behind them: world
 * time, pausing, notifications, files and settings. They are logged under one
 * of these labels instead of a document kind. None of them has a level in the
 * permission settings; the handler declares the switch alone.
 */
export type ChangeWithoutDocument = 'WorldTime' | 'Pause' | 'Notifications' | 'Files' | 'Settings';

export const CHANGES_WITHOUT_DOCUMENT: readonly ChangeWithoutDocument[] = [
  'WorldTime',
  'Pause',
  'Notifications',
  'Files',
  'Settings',
];

export interface ChangeInput {
  /** The query that made the change, short name. */
  query: string;
  /** The MCP tool behind it, when known. */
  tool?: string;
  /**
   * The kind that changed. `Multiple` for one change across several
   * collections (world-rewrite-paths); `documents` then lists them. A change
   * without a document type names its label (`ChangeWithoutDocument`).
   */
  document: DocumentKind | ChangeWithoutDocument | 'Extension' | 'Multiple';
  /** Every kind the change touched. Required with `Multiple`, optional otherwise. */
  documents?: DocumentKind[];
  action: WriteAction | 'other';
  targets: ChangeTarget[];
  /** One English sentence for the log view. */
  summary: string;
  /** Source data of the documents before the change; required for undoing update and delete. */
  before?: unknown;
  /** Source data after the change, for comparison and redo. */
  after?: unknown;
  /**
   * This change undid the entry `changeId`. `action` is the
   * action whose permission level the whole chain is checked against, so a
   * redo needs the same level as the first write.
   */
  restores?: { changeId: string; action: WriteAction | 'other' };
}

/** Who and which call made a change; set by the dispatcher. */
export interface ChangeOrigin {
  /** Every change of one query shares this id. */
  callId?: string;
  user?: { id: string; name: string };
}

export interface ChangeEntry extends ChangeInput, ChangeOrigin {
  id: string;
  at: string;
  undoable: boolean;
  undoneAt?: string;
}

export interface ChangeLogOptions {
  capacity?: number;
  now?: () => Date;
}

export type ChangeListener = (entry: ChangeEntry) => void;

/**
 * The largest state, as JSON characters, an entry keeps in `before` or `after`.
 * The log holds up to 200 entries in the browser of the Gamemaster; 200 pages
 * of 2 MB each would weigh on it.
 */
export const CHANGE_STATE_MAX_CHARS = 200_000;

/**
 * A state for `before` or `after`, or `undefined` when it is too large or
 * cannot be written as JSON (a cycle, a BigInt). Leaving it out is honest:
 * an update or delete without `before` counts as not undoable.
 */
export function smallEnough(value: unknown, maxChars: number = CHANGE_STATE_MAX_CHARS): unknown {
  if (value === undefined) return undefined;
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    return undefined;
  }
  return json !== undefined && json.length <= maxChars ? value : undefined;
}

function canUndo(input: ChangeInput): boolean {
  if (input.action === 'create') return input.targets.some(t => t.id || t.uuid);
  if (input.action === 'update' || input.action === 'delete') return input.before !== undefined;
  return false;
}

export class ChangeLog {
  private readonly entries: ChangeEntry[] = [];
  private readonly listeners = new Set<ChangeListener>();
  private counter = 0;
  private readonly capacity: number;
  private readonly now: () => Date;

  constructor(options: ChangeLogOptions = {}) {
    this.capacity = Math.max(1, options.capacity ?? 200);
    this.now = options.now ?? (() => new Date());
  }

  record(input: ChangeInput, origin: ChangeOrigin = {}): ChangeEntry {
    if (input.document === 'Multiple' && !input.documents?.length) {
      throw new Error(
        `The change of ${input.query} is recorded as "Multiple" without naming the kinds in documents`
      );
    }
    this.counter += 1;
    const at = this.now();
    const entry: ChangeEntry = {
      ...input,
      ...(origin.callId ? { callId: origin.callId } : {}),
      ...(origin.user ? { user: { ...origin.user } } : {}),
      ...(input.documents ? { documents: [...input.documents] } : {}),
      targets: input.targets.map(t => ({ ...t })),
      id: `change-${at.getTime().toString(36)}-${this.counter}`,
      at: at.toISOString(),
      undoable: canUndo(input),
    };
    this.entries.unshift(entry);
    if (this.entries.length > this.capacity) this.entries.length = this.capacity;
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch {
        // A broken listener must never undo the fact that the change happened.
      }
    }
    return entry;
  }

  /** Newest first. A kind also finds the changes that touched it among others. */
  list(filter: { limit?: number; document?: ChangeEntry['document'] } = {}): ChangeEntry[] {
    const wanted = filter.document;
    const matching = wanted
      ? this.entries.filter(
          e =>
            e.document === wanted ||
            (wanted !== 'Multiple' &&
              wanted !== 'Extension' &&
              ((e.documents ?? []) as readonly string[]).includes(wanted))
        )
      : this.entries;
    return matching.slice(0, filter.limit ?? matching.length);
  }

  get(id: string): ChangeEntry | undefined {
    return this.entries.find(e => e.id === id);
  }

  /** Mark an entry as undone. Returns false when it does not exist, cannot be undone or already was. */
  markUndone(id: string): boolean {
    const entry = this.get(id);
    if (!entry || !entry.undoable || entry.undoneAt) return false;
    entry.undoneAt = this.now().toISOString();
    return true;
  }

  /** The undo of this entry was itself undone, so its effect is back. */
  clearUndone(id: string): boolean {
    const entry = this.get(id);
    if (!entry?.undoneAt) return false;
    delete entry.undoneAt;
    return true;
  }

  subscribe(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get size(): number {
    return this.entries.length;
  }
}
