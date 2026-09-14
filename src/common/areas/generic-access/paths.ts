/**
 * Field paths into document data, and what a change to them does.
 *
 * The generic-access area reads and writes any document by path. Everything here works
 * on plain source data (`toObject()`, index rows), so it runs without Foundry
 * and is tested on its own.
 *
 * A path is dotted, with list positions either as a part of their own or in
 * brackets: `system.skills.0.name` and `system.skills[0].name` are the same.
 * `*` stands for every entry of a list or object, and only when reading.
 *
 * Writing follows Foundry's update rules, which the model is told in the tool
 * description: keys of `changes` may be dotted, an object merges into the
 * object that is there, everything else (lists included) replaces. On top of
 * that, and not left to Foundry:
 *
 * - a list position in a key changes that entry; the whole list is sent,
 *   because Foundry cannot address one entry of a list field
 * - `replace` makes an object value replace instead of merge
 * - `remove` deletes a key or a list entry
 *
 * The planned result is computed here first. The update sent to Foundry is
 * derived from the difference between the current data and that result, so
 * what is sent, what is previewed and what is compared after reading back are
 * the same thing.
 */

export type Data = Record<string, unknown>;

export class PathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathError';
  }
}

const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export function isPlainRecord(value: unknown): value is Data {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIndex(segment: string): boolean {
  return /^\d+$/.test(segment);
}

function hasOwn(node: Data, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(node, key);
}

function copy<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The parts of a path. Throws PathError with the path in the text. */
export function parsePath(path: string): string[] {
  if (typeof path !== 'string' || !path.trim())
    throw new PathError('A field path must not be empty');
  const segments: string[] = [];
  for (const piece of path.split('.')) {
    const match = /^([^[\]]*)((?:\[(?:\d+|\*)\])*)$/.exec(piece);
    if (!match) {
      throw new PathError(
        `The field path "${path}" is not valid: brackets may only hold a list position or *`
      );
    }
    const name = match[1] ?? '';
    const brackets = match[2] ?? '';
    if (!name && !brackets) throw new PathError(`The field path "${path}" has an empty part`);
    if (name) segments.push(name);
    for (const position of brackets.matchAll(/\[(\d+|\*)\]/g)) segments.push(position[1] as string);
  }
  const unsafe = segments.find(segment => UNSAFE_KEYS.has(segment));
  if (unsafe) throw new PathError(`The field path "${path}" uses the reserved name "${unsafe}"`);
  return segments;
}

/** The canonical, dotted spelling of a path. */
export function canonicalPath(path: string): string {
  return parsePath(path).join('.');
}

export interface PathValue {
  found: boolean;
  /** With `*` in the path: the list of every value found. */
  value?: unknown;
}

function collect(node: unknown, segments: readonly string[], at: number, hits: unknown[]): void {
  if (at === segments.length) {
    hits.push(node);
    return;
  }
  const segment = segments[at] as string;
  if (segment === '*') {
    const children = Array.isArray(node) ? node : isPlainRecord(node) ? Object.values(node) : [];
    for (const child of children) collect(child, segments, at + 1, hits);
    return;
  }
  if (Array.isArray(node)) {
    if (isIndex(segment) && Number(segment) < node.length)
      collect(node[Number(segment)], segments, at + 1, hits);
    return;
  }
  if (isPlainRecord(node) && hasOwn(node, segment)) collect(node[segment], segments, at + 1, hits);
}

/**
 * The value at a path. A key that holds the whole dotted path is found too,
 * as compendium index rows may store requested fields that way.
 */
export function readPath(source: unknown, path: string): PathValue {
  const segments = parsePath(path);
  if (isPlainRecord(source) && path.includes('.') && hasOwn(source, path))
    return { found: true, value: source[path] };
  const hits: unknown[] = [];
  collect(source, segments, 0, hits);
  if (segments.includes('*')) return { found: hits.length > 0, value: hits };
  return hits.length ? { found: true, value: hits[0] } : { found: false };
}

/** The requested fields by path, and the paths that hold nothing. */
export function selectFields(
  source: unknown,
  paths: readonly string[]
): { fields: Data; missing: string[] } {
  const fields: Data = {};
  const missing: string[] = [];
  for (const path of paths) {
    const hit = readPath(source, path);
    if (hit.found) fields[path] = hit.value;
    else missing.push(path);
  }
  return { fields, missing };
}

/**
 * Foundry's update rules on a copy: dotted keys reach into objects (creating
 * them), an object merges, anything else replaces. A list on the way is
 * refused, because Foundry would turn it into an object. Operator keys never
 * arrive here (`refuseOperators`).
 */
export function mergeChanges(target: Data, changes: Data, where = ''): void {
  for (const [key, value] of Object.entries(changes)) {
    const parts = key.split('.');
    const last = parts.pop() as string;
    let node = target;
    for (const part of parts) {
      if (UNSAFE_KEYS.has(part)) throw new PathError(`"${key}" uses the reserved name "${part}"`);
      if (Array.isArray(node[part])) {
        throw new PathError(
          `"${where}${key}" goes through the list "${where}${part}" inside an object value; put the list position into the key of changes instead`
        );
      }
      if (!isPlainRecord(node[part])) node[part] = {};
      node = node[part] as Data;
    }
    if (UNSAFE_KEYS.has(last)) throw new PathError(`"${key}" uses the reserved name "${last}"`);
    if (isPlainRecord(value)) {
      if (!isPlainRecord(node[last])) node[last] = {};
      mergeChanges(node[last] as Data, value, `${where}${key}.`);
    } else {
      node[last] = copy(value);
    }
  }
}

/** An object value with its dotted keys expanded, without merging into anything. */
function expanded(value: unknown): unknown {
  if (!isPlainRecord(value)) return copy(value);
  const out: Data = {};
  mergeChanges(out, value);
  return out;
}

function setIn(root: Data, path: string, value: unknown, replace: boolean): void {
  const segments = parsePath(path);
  if (segments.includes('*')) throw new PathError(`"${path}": * is only allowed when reading`);
  let node: unknown = root;
  for (const [position, segment] of segments.entries()) {
    const last = position === segments.length - 1;
    const walked = segments.slice(0, position).join('.') || '(the document)';
    if (Array.isArray(node)) {
      if (!isIndex(segment)) {
        throw new PathError(
          `"${path}": "${walked}" is a list, so the next part must be a position, not "${segment}"`
        );
      }
      const index = Number(segment);
      if (index > node.length || (!last && index === node.length)) {
        throw new PathError(
          `"${path}": the list "${walked}" has ${node.length} entries; position ${index} is outside it`
        );
      }
      if (last) {
        const current = node[index];
        if (!replace && isPlainRecord(value) && isPlainRecord(current))
          mergeChanges(current, value);
        else node[index] = expanded(value);
        return;
      }
      if (!isPlainRecord(node[index]) && !Array.isArray(node[index])) node[index] = {};
      node = node[index];
      continue;
    }
    const record = node as Data;
    if (last) {
      const current = record[segment];
      if (!replace && isPlainRecord(value) && isPlainRecord(current)) mergeChanges(current, value);
      else record[segment] = expanded(value);
      return;
    }
    const next = record[segment];
    if (!isPlainRecord(next) && !Array.isArray(next)) record[segment] = {};
    node = record[segment];
  }
}

function removeIn(root: Data, path: string): void {
  const segments = parsePath(path);
  if (segments.includes('*')) throw new PathError(`"${path}": * is only allowed when reading`);
  const parentPath = segments.slice(0, -1);
  const last = segments[segments.length - 1] as string;
  let parent: unknown = root;
  for (const segment of parentPath) {
    if (Array.isArray(parent) && isIndex(segment)) parent = parent[Number(segment)];
    else if (isPlainRecord(parent) && hasOwn(parent, segment)) parent = parent[segment];
    else parent = undefined;
  }
  if (Array.isArray(parent) && isIndex(last) && Number(last) < parent.length) {
    parent.splice(Number(last), 1);
    return;
  }
  if (isPlainRecord(parent) && hasOwn(parent, last)) {
    delete parent[last];
    return;
  }
  throw new PathError(`"${path}" holds nothing that could be removed`);
}

/**
 * The update Foundry needs to turn `before` into `after`: deleted keys as
 * `-=key`, new or different values set at the deepest object path, lists and
 * everything that is not an object as a whole.
 */
export function foundryChanges(before: Data, after: Data): Data {
  const out: Data = {};
  const walk = (from: Data, to: Data, prefix: string) => {
    for (const key of Object.keys(from)) {
      if (!hasOwn(to, key)) out[`${prefix}-=${key}`] = null;
    }
    for (const [key, value] of Object.entries(to)) {
      const path = `${prefix}${key}`;
      if (!hasOwn(from, key)) out[path] = copy(value);
      else if (isPlainRecord(from[key]) && isPlainRecord(value))
        walk(from[key] as Data, value, `${path}.`);
      else if (!sameJson(from[key], value)) out[path] = copy(value);
    }
  };
  walk(before, after, '');
  return out;
}

export interface DiffEntry {
  path: string;
  /** Absent when the path held nothing before. */
  before?: unknown;
  /** Absent when the path holds nothing afterwards. */
  after?: unknown;
}

/** Every leaf that differs. Objects and lists are followed; a new or removed branch is one entry. */
export function diffValues(before: unknown, after: unknown, path = ''): DiffEntry[] {
  const out: DiffEntry[] = [];
  const join = (key: string | number) => (path ? `${path}.${key}` : String(key));
  if (sameJson(before, after)) return out;
  if (isPlainRecord(before) && isPlainRecord(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)]))
      out.push(...diffValues(before[key], after[key], join(key)));
    return out;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    for (let index = 0; index < Math.max(before.length, after.length); index += 1)
      out.push(...diffValues(before[index], after[index], join(index)));
    return out;
  }
  const entry: DiffEntry = { path: path || '(the document)' };
  if (before !== undefined) entry.before = copy(before);
  if (after !== undefined) entry.after = copy(after);
  out.push(entry);
  return out;
}

export interface UpdateInput {
  /** Foundry-style changes; keys may be dotted and hold list positions. */
  changes?: Data;
  /** Keys of `changes` whose object value replaces instead of merging. */
  replace?: readonly string[];
  /** Paths to delete: a key of an object or an entry of a list. */
  remove?: readonly string[];
}

export interface UpdatePlan {
  /** What is sent to Foundry's `update`. */
  changes: Data;
  /** The data as it should read afterwards. */
  expected: Data;
  /** Every leaf that should change. */
  diff: DiffEntry[];
}

function overlaps(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);
}

/** Whether a key is one of Foundry's update operators: "-=key" deletes, "==key" replaces. */
export function isOperatorKey(key: string): boolean {
  return key.startsWith('-=') || key.startsWith('==');
}

/**
 * Refuse Foundry's update operators anywhere in the given changes, keys and
 * nested values alike. They would act inside Foundry while the planned result
 * shows a plain key, so the protected fields could be removed or replaced
 * without the comparison noticing. `remove` and `replace` say the same openly.
 */
export function refuseOperators(value: unknown, where: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => refuseOperators(entry, `${where}.${index}`));
    return;
  }
  if (!isPlainRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    const operator = key.split('.').find(isOperatorKey);
    if (operator) {
      throw new PathError(
        `"${where ? `${where}.` : ''}${key}" uses Foundry's update operator "${operator.slice(0, 2)}"; ` +
          'name the path in remove to delete it, or in replace to replace an object'
      );
    }
    refuseOperators(entry, where ? `${where}.${key}` : key);
  }
}

/** Plan an update. Throws PathError for a path that cannot be applied, before anything is sent. */
export function planUpdate(current: Data, input: UpdateInput): UpdatePlan {
  refuseOperators(input.changes ?? {}, '');
  for (const path of [...(input.replace ?? []), ...(input.remove ?? [])]) {
    const operator = parsePath(path).find(isOperatorKey);
    if (operator)
      throw new PathError(`"${path}" uses Foundry's update operator "${operator.slice(0, 2)}"`);
  }
  const expected = copy(current);
  const sets = Object.entries(input.changes ?? {}).map(([key, value]) => ({
    key,
    path: canonicalPath(key),
    value,
  }));
  const replace = (input.replace ?? []).map(path => ({ given: path, path: canonicalPath(path) }));
  const remove = (input.remove ?? []).map(canonicalPath);

  for (const entry of replace) {
    if (!sets.some(set => set.path === entry.path)) {
      throw new PathError(
        `replace names "${entry.given}", but changes has no key for that path; replace only applies to a value given in changes`
      );
    }
  }
  for (const path of remove) {
    const clash = sets.find(set => overlaps(set.path, path));
    if (clash)
      throw new PathError(`"${path}" is both removed and set (changes key "${clash.key}")`);
  }
  for (const [index, set] of sets.entries()) {
    const other = sets.slice(0, index).find(earlier => overlaps(earlier.path, set.path));
    if (other) {
      throw new PathError(
        `changes sets "${set.key}" and "${other.key}", and one lies inside the other; give each field once`
      );
    }
  }

  for (const set of sets) {
    setIn(
      expected,
      set.path,
      set.value,
      replace.some(entry => entry.path === set.path)
    );
  }
  // Highest positions first, so removing two entries of one list removes the ones that were named.
  const ordered = [...remove].sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
  for (const path of ordered) removeIn(expected, path);

  return {
    changes: foundryChanges(current, expected),
    expected,
    diff: diffValues(current, expected),
  };
}

export type WhereOperator =
  'eq' | 'ne' | 'in' | 'contains' | 'exists' | 'gt' | 'gte' | 'lt' | 'lte';

export const WHERE_OPERATORS: readonly WhereOperator[] = [
  'eq',
  'ne',
  'in',
  'contains',
  'exists',
  'gt',
  'gte',
  'lt',
  'lte',
];

export interface WhereCondition {
  path: string;
  op: WhereOperator;
  value?: unknown;
}

function ordered(a: unknown, b: unknown): number | null {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);
  return null;
}

/**
 * Whether data passes one condition. With `*` in the path it passes when any
 * value found passes (`ne` and `exists: false`: when none does).
 */
export function matchesCondition(data: unknown, condition: WhereCondition): boolean {
  const hit = readPath(data, condition.path);
  const values = condition.path.includes('*')
    ? (hit.value as unknown[])
    : hit.found
      ? [hit.value]
      : [];
  const wanted = condition.value;
  const equal = (value: unknown) => sameJson(value, wanted);
  switch (condition.op) {
    case 'exists':
      return wanted === false ? values.length === 0 : values.length > 0;
    case 'eq':
      return values.some(equal);
    case 'ne':
      return !values.some(equal);
    case 'in':
      return Array.isArray(wanted) && values.some(value => wanted.some(o => sameJson(value, o)));
    case 'contains':
      return values.some(value =>
        typeof value === 'string'
          ? typeof wanted === 'string' && value.toLowerCase().includes(wanted.toLowerCase())
          : Array.isArray(value) && value.some(equal)
      );
    default: {
      return values.some(value => {
        const order = ordered(value, wanted);
        if (order === null) return false;
        if (condition.op === 'gt') return order > 0;
        if (condition.op === 'gte') return order >= 0;
        if (condition.op === 'lt') return order < 0;
        return order <= 0;
      });
    }
  }
}

/** Sort order of two values found at a sort path; nothing sorts last. */
export function compareFound(a: PathValue, b: PathValue): number {
  if (!a.found || a.value === undefined || a.value === null)
    return !b.found || b.value === undefined || b.value === null ? 0 : 1;
  if (!b.found || b.value === undefined || b.value === null) return -1;
  return (
    ordered(a.value, b.value) ?? JSON.stringify(a.value).localeCompare(JSON.stringify(b.value))
  );
}

/** A short, stable mark of a text, to notice that a document changed between two parts. */
export function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16).padStart(8, '0')}${text.length.toString(36)}`;
}

/** A value for a report: as it is, or cut to a preview when its JSON is longer than `maxChars`. */
export function reportValue(value: unknown, maxChars: number): unknown {
  if (value === undefined) return undefined;
  const json = JSON.stringify(value) ?? String(value);
  return json.length <= maxChars
    ? value
    : { shortened: true, chars: json.length, preview: json.slice(0, maxChars) };
}

/** At most `max` diff entries, each value shortened for a report. */
export function reportDiff(
  entries: readonly DiffEntry[],
  max = 100,
  valueChars = 400
): { entries: DiffEntry[]; omitted: number } {
  return {
    entries: entries.slice(0, max).map(entry => {
      const out: DiffEntry = { path: entry.path };
      if (entry.before !== undefined) out.before = reportValue(entry.before, valueChars);
      if (entry.after !== undefined) out.after = reportValue(entry.after, valueChars);
      return out;
    }),
    omitted: Math.max(0, entries.length - max),
  };
}
