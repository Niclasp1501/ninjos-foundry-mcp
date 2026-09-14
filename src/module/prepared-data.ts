/**
 * Plain data for the game system adapters, with the values Foundry prepared.
 *
 * `toObject()` gives the source data as it is saved. Everything a system
 * derives in `prepareData` (armor class, maximum hit points, modifiers, skill
 * totals, levels) lives only on the live `document.system`. A first test
 * against a real world showed dnd5e
 * reporting armor class and maximum hit points as null for that reason.
 *
 * Adapters read plain data on both sides of the bridge, so the prepared system
 * is copied over the stored one here: a prepared value wins, a stored value
 * fills in what the prepared data leaves out. Embedded items get the same.
 * The copy is JSON safe; documents, functions and cycles inside are left out.
 */

import { PREPARED_DATA_KEY } from '../common/game-systems.js';

type Data = Record<string, unknown>;

const MAX_DEPTH = 14;
const MAX_NODES = 50_000;
/** Back references a data model keeps next to its values. */
const SKIPPED_KEYS = new Set(['parent', '_source']);

function isRecord(value: unknown): value is Data {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDocument(value: object): boolean {
  return (
    'documentName' in value && typeof (value as { toObject?: unknown }).toObject === 'function'
  );
}

/** A JSON safe copy of prepared data, or undefined when there is nothing to copy. */
export function preparedSnapshot(value: unknown): unknown {
  const open = new WeakSet<object>();
  let nodes = 0;
  const copy = (node: unknown, depth: number): unknown => {
    if (node === null || typeof node === 'string' || typeof node === 'boolean') return node;
    if (typeof node === 'number') return Number.isFinite(node) ? node : null;
    if (typeof node !== 'object') return undefined;
    if (depth > MAX_DEPTH || open.has(node) || isDocument(node) || node instanceof Map)
      return undefined;
    nodes += 1;
    if (nodes > MAX_NODES) return undefined;
    open.add(node);
    try {
      if (node instanceof Set || Array.isArray(node)) {
        return [...node].map(entry => copy(entry, depth + 1)).filter(entry => entry !== undefined);
      }
      const out: Data = {};
      for (const key of Object.keys(node)) {
        if (SKIPPED_KEYS.has(key)) continue;
        let entry: unknown;
        try {
          entry = (node as Data)[key];
        } catch {
          continue;
        }
        const copied = copy(entry, depth + 1);
        if (copied !== undefined) out[key] = copied;
      }
      return out;
    } finally {
      open.delete(node);
    }
  };
  return copy(value, 0);
}

/** Prepared values over stored ones; objects are merged key by key. */
export function overlayPrepared(stored: unknown, prepared: unknown): unknown {
  if (prepared === undefined) return stored;
  if (prepared === null) return stored ?? null;
  if (isRecord(prepared) && isRecord(stored)) {
    const out: Data = { ...stored };
    for (const [key, value] of Object.entries(prepared))
      out[key] = overlayPrepared(stored[key], value);
    return out;
  }
  return prepared;
}

function liveSystem(document: unknown): unknown {
  try {
    return isRecord(document) || typeof document === 'object'
      ? preparedSnapshot((document as { system?: unknown } | null)?.system)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Deep equality of plain data, ignoring the order of object keys. */
function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((entry, index) => sameData(entry, b[index]))
    );
  }
  if (!isRecord(a) || !isRecord(b)) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every(key => sameData(a[key], b[key]));
}

/**
 * Marked as prepared only when the prepared system adds or changes something.
 * A system that derives nothing for a document, or a stand-in whose `system`
 * is the stored data itself, would otherwise pass stored placeholders (a
 * DSA5 maximum of 0) off as values the system computed.
 */
function withPrepared(data: Data, document: unknown): Data {
  const prepared = liveSystem(document);
  if (!isRecord(prepared)) return data;
  const merged = overlayPrepared(data['system'], prepared);
  if (sameData(merged, data['system'])) return data;
  return { ...data, system: merged, [PREPARED_DATA_KEY]: true };
}

interface LiveDocument {
  toObject(): Data;
  /** The prepared data of the live document. */
  system?: unknown;
  /** Embedded items, looked up by id for their own prepared data. */
  items?: unknown;
}

/**
 * The document for an adapter question: stored data with the prepared system,
 * and each embedded item with its own prepared system.
 */
export function adapterData(document: LiveDocument): Data {
  const plain = withPrepared(document.toObject(), document);
  const items = plain['items'];
  const live = (document as { items?: { get?(id: string): unknown } }).items;
  if (Array.isArray(items) && typeof live?.get === 'function') {
    plain['items'] = items.map(item => {
      if (!isRecord(item) || typeof item['_id'] !== 'string') return item;
      const found = live.get?.(item['_id']);
      return found ? withPrepared(item, found) : item;
    });
  }
  return plain;
}
