/**
 * Small readers the three adapters of the wfrp4e-cosmere-traveller area share. They take plain
 * data (`toObject()`, compendium index rows), never Foundry documents, so the
 * adapters run in the module, on the server and in tests without Foundry.
 */
import type { AdapterDocument } from '../../game-systems.js';

export type Data = Record<string, unknown>;

export function isRecord(value: unknown): value is Data {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A value at a dotted path of nested objects. */
export function at(value: unknown, path: string): unknown {
  let node = value;
  for (const part of path.split('.')) {
    if (!isRecord(node)) return undefined;
    node = node[part];
  }
  return node;
}

/**
 * A value of an index row or of full data: index rows of some Foundry
 * versions keep requested fields under a dotted key ("system.tier"), others
 * nest them. Both are read; the nested form wins.
 */
export function read(entry: unknown, path: string): unknown {
  const nested = at(entry, path);
  if (nested !== undefined) return nested;
  return isRecord(entry) ? entry[path] : undefined;
}

/** A finite number, also from a text such as "12"; otherwise null. */
export function num(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** A text field stored either as text or as `{ value }`, as WFRP4e and Traveller keep many. */
export function textValue(value: unknown): string {
  if (typeof value === 'string') return value;
  return isRecord(value) ? text(value['value']) : '';
}

/** A number field stored either as number or as `{ value }`. */
export function numberValue(value: unknown): number | null {
  const direct = num(value);
  if (direct !== null) return direct;
  return isRecord(value) ? num(value['value']) : null;
}

export function systemOf(document: AdapterDocument | Data): Data {
  const system = document['system'];
  return isRecord(system) ? system : {};
}

export function itemsOf(document: AdapterDocument | Data): Data[] {
  const items = document['items'];
  return Array.isArray(items) ? items.filter(isRecord) : [];
}

export function idOf(document: Data): string {
  return text(document['_id']) || text(document['id']);
}

/** Two names are the same when they match trimmed and ignoring case. */
export function sameName(a: unknown, b: unknown): boolean {
  return (
    typeof a === 'string' &&
    typeof b === 'string' &&
    a.trim().toLowerCase() === b.trim().toLowerCase()
  );
}

/** "+2", "0", "-1": a modifier as it is written on a sheet. */
export function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

/**
 * A numeric roll modifier such as "+20", "-10" or "5". Null for empty.
 * Anything else throws with the cause.
 */
export function numericModifier(raw: string | undefined, what: string): number | null {
  const given = (raw ?? '').trim();
  if (!given) return null;
  const value = Number(given.replace(/\s+/g, ''));
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(
      `rollModifier "${given}" is not a whole number; ${what}. Pass e.g. "+20" or "-10".`
    );
  }
  return value;
}

/** A formula with a numeric bonus and an optional free modifier appended. */
export function formulaWith(base: string, bonus: number, modifier?: string): string {
  let formula = bonus ? `${base}${bonus > 0 ? '+' : ''}${bonus}` : base;
  const extra = (modifier ?? '').trim();
  if (extra) formula += /^[+-]/.test(extra) ? extra : `+${extra}`;
  return formula;
}

/**
 * Lists of choices from a system's CONFIG block, without guessing field paths
 * of item data: every map of labels or list of texts up to two levels deep,
 * named by its path under the block.
 */
export function choiceLists(block: unknown, prefix: string): Record<string, readonly string[]> {
  const out: Record<string, readonly string[]> = {};
  const labelMap = (value: Data) =>
    Object.values(value).every(
      entry => typeof entry === 'string' || (isRecord(entry) && typeof entry['label'] === 'string')
    );
  const walk = (node: unknown, path: string, depth: number) => {
    if (Array.isArray(node)) {
      if (node.length && node.every(entry => typeof entry === 'string')) out[path] = node;
      return;
    }
    if (!isRecord(node)) return;
    const keys = Object.keys(node);
    if (path && keys.length && labelMap(node)) {
      out[path] = keys;
      return;
    }
    if (depth >= 2) return;
    for (const key of keys) walk(node[key], path ? `${path}.${key}` : key, depth + 1);
  };
  walk(block, '', 0);
  return Object.fromEntries(Object.entries(out).map(([key, value]) => [`${prefix}.${key}`, value]));
}

/** Whether a line contains a dash used as a sentence dash; used by tests of the texts. */
export const SENTENCE_DASH = /[–—]/;
