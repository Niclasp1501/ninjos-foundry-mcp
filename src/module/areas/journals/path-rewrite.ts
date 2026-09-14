/**
 * The rules of world-rewrite-paths, free of Foundry so they can be tested.
 *
 * A prefix matches only where a path begins and only up to a path boundary:
 * "Bilder/Token" never touches "Bilder/Tokenringe". A path begins at the
 * start of a string, or right after a quote or an opening parenthesis, which
 * is where it stands inside HTML (`<img src="...">`) and CSS (`url(...)`).
 * A single slash in front is allowed and kept.
 *
 * Foundry stores many paths percent-encoded. The prefix is looked for in its
 * plain and in its encoded spelling, and the new prefix is written in the
 * spelling that was found, so no path ends up half plain and half encoded.
 */

export interface PathRule {
  from: string;
  to: string;
  /** Spellings to look for, longest first, each with its replacement. */
  variants: ReadonlyArray<{ find: string; replace: string }>;
}

export class PathRuleError extends Error {}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function safeDecode(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

function lowerHex(value: string): string {
  return value.replace(/%[0-9A-F]{2}/g, hex => hex.toLowerCase());
}

export function makePathRule(fromInput: string, toInput: string): PathRule {
  const from = trimTrailingSlashes(fromInput.trim());
  const to = trimTrailingSlashes(toInput.trim());
  if (from.length < 3)
    throw new PathRuleError(
      `from must have at least 3 characters (without trailing slashes), got "${from}"`
    );
  if (to === '') throw new PathRuleError('to must not be empty');
  if (from === to) throw new PathRuleError(`from and to are the same: "${from}"`);

  const plainFrom = safeDecode(from);
  const plainTo = safeDecode(to);
  if (plainFrom === plainTo)
    throw new PathRuleError(`from and to name the same path: "${plainFrom}"`);

  const variants = new Map<string, string>();
  variants.set(plainFrom, plainTo);
  const encodedFrom = encodeURI(plainFrom);
  const encodedTo = encodeURI(plainTo);
  if (!variants.has(encodedFrom)) variants.set(encodedFrom, encodedTo);
  if (!variants.has(lowerHex(encodedFrom)))
    variants.set(lowerHex(encodedFrom), lowerHex(encodedTo));
  if (!variants.has(from)) variants.set(from, to);

  return {
    from,
    to,
    variants: [...variants.entries()]
      .map(([find, replace]) => ({ find, replace }))
      .sort((a, b) => b.find.length - a.find.length),
  };
}

const OPENERS: Readonly<Record<string, string>> = { '"': '"', "'": "'", '(': ')' };

export interface StringRewrite {
  value: string;
  count: number;
  /** "old -> new" of each replaced path, up to the end of that path. */
  examples: string[];
}

/** Where a path that starts at `index` ends: at its closing character, or at the end of the string. */
function pathEnd(text: string, index: number, closer: string | null): number {
  if (closer === null) return text.length;
  const end = text.indexOf(closer, index);
  return end < 0 ? text.length : end;
}

export function rewriteString(text: string, rule: PathRule): StringRewrite {
  let out = '';
  let copied = 0;
  let count = 0;
  const examples: string[] = [];

  for (let i = 0; i < text.length; i += 1) {
    let anchor: number | null = null;
    let closer: string | null = null;
    const before = i === 0 ? null : (text[i - 1] as string);
    if (i === 0) anchor = 0;
    else if (before !== null && before in OPENERS) {
      anchor = i;
      closer = OPENERS[before] as string;
    }
    if (anchor === null) continue;

    let start = i;
    if (text[start] === '/') start += 1;
    const variant = rule.variants.find(candidate => {
      if (!text.startsWith(candidate.find, start)) return false;
      const next = text[start + candidate.find.length];
      return next === undefined || next === '/' || (closer !== null && next === closer);
    });
    if (!variant) continue;

    const end = pathEnd(text, start, closer);
    const oldPath = text.slice(i, end);
    const newPath =
      text.slice(i, start) + variant.replace + text.slice(start + variant.find.length, end);
    out += text.slice(copied, start) + variant.replace;
    copied = start + variant.find.length;
    count += 1;
    examples.push(`${oldPath} -> ${newPath}`);
    i = copied - 1;
  }

  return count
    ? { value: out + text.slice(copied), count, examples }
    : { value: text, count, examples };
}

export interface DataRewrite {
  /** Changes in Foundry's update form: dotted keys, arrays and objects with dotted keys replaced whole. */
  changes: Record<string, unknown>;
  count: number;
  examples: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Rewrite a value deeply; returns the same value when nothing matched. */
function rewriteDeep(
  value: unknown,
  rule: PathRule,
  tally: { count: number; examples: string[] }
): unknown {
  if (typeof value === 'string') {
    const result = rewriteString(value, rule);
    if (!result.count) return value;
    tally.count += result.count;
    tally.examples.push(...result.examples);
    return result.value;
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map(item => {
      const rewritten = rewriteDeep(item, rule, tally);
      if (rewritten !== item) changed = true;
      return rewritten;
    });
    return changed ? next : value;
  }
  if (isRecord(value)) {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const rewritten = rewriteDeep(item, rule, tally);
      if (rewritten !== item) changed = true;
      next[key] = rewritten;
    }
    return changed ? next : value;
  }
  return value;
}

/**
 * Collect the changes for one document's own data.
 *
 * Strings get a dotted key. A list is replaced as a whole, because Foundry
 * replaces arrays on update anyway. An object whose keys contain a dot cannot
 * be addressed with dotted keys, so it is given whole; Foundry merges it.
 */
export function rewriteData(
  data: Record<string, unknown>,
  rule: PathRule,
  skip: ReadonlySet<string> = new Set()
): DataRewrite {
  const changes: Record<string, unknown> = {};
  const tally = { count: 0, examples: [] as string[] };

  const visit = (value: unknown, path: string) => {
    if (isRecord(value) && Object.keys(value).every(key => !key.includes('.'))) {
      for (const [key, item] of Object.entries(value)) visit(item, path ? `${path}.${key}` : key);
      return;
    }
    const rewritten = rewriteDeep(value, rule, tally);
    if (rewritten !== value) changes[path] = rewritten;
  };

  for (const [key, value] of Object.entries(data)) {
    if (skip.has(key)) continue;
    if (key.includes('.')) {
      const rewritten = rewriteDeep(value, rule, tally);
      if (rewritten !== value) changes[key] = rewritten;
    } else {
      visit(value, key);
    }
  }
  return { changes, count: tally.count, examples: tally.examples };
}
