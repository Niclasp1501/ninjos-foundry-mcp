/**
 * Plain actor, item and compendium data made fit for an answer to the model.
 *
 * The actors area reads `toObject()` data, which is already free of Foundry
 * objects. What remains to do:
 *
 * - Credentials never leave the browser. A key is dropped when its name,
 *   without case, underscores and hyphens, ends in one of the words below and
 *   its value is a text or a number. Objects are walked instead, so a field
 *   named `save`, `key` or `token` with game data stays (the
 *   previous cleanup lost the save data of dnd5e activities).
 * - Keys starting with an underscore are internal bookkeeping of Foundry
 *   (`_stats`) and dropped, except `_id`.
 * - Functions are dropped, a date becomes its ISO text, other class instances
 *   become a short marker, so the result is always valid JSON.
 * - A real cycle becomes CIRCULAR, anything deeper than MAX_DEPTH TOO_DEEP.
 *   The same object reached twice without a cycle is copied twice.
 *
 * No field of any game system is named here; the core stays neutral.
 */

export const CIRCULAR = '[Circular Reference]';
export const TOO_DEEP = '[Max depth reached]';
export const MAX_DEPTH = 50;

const CREDENTIAL_ENDINGS = [
  'password',
  'passwd',
  'passphrase',
  'secret',
  'credential',
  'credentials',
  'cookie',
  'sessionid',
  'apikey',
  'privatekey',
  'accesstoken',
  'refreshtoken',
  'authtoken',
  'bearertoken',
  'authorization',
];

/** Whether a key with a scalar value looks like a credential. */
export function isCredentialKey(key: string): boolean {
  const flat = key.toLowerCase().replace(/[_\-\s]/g, '');
  return CREDENTIAL_ENDINGS.some(ending => flat.endsWith(ending));
}

function isPlain(value: object): boolean {
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function walk(value: unknown, ancestors: object[]): unknown {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'function' || typeof value === 'symbol') return undefined;
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'number' && !Number.isFinite(value)) return null;
    return value;
  }
  if (ancestors.includes(value)) return CIRCULAR;
  if (ancestors.length >= MAX_DEPTH) return TOO_DEEP;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();

  const below = [...ancestors, value];
  if (Array.isArray(value)) {
    return value.map(entry => {
      const clean = walk(entry, below);
      return clean === undefined ? null : clean;
    });
  }
  if (value instanceof Set) return [...value].map(entry => walk(entry, below) ?? null);
  if (value instanceof Map) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of value) out[String(key)] = walk(entry, below);
    return out;
  }
  if (!isPlain(value)) {
    const name = (value as { constructor?: { name?: unknown } }).constructor?.name;
    return `[${typeof name === 'string' && name ? name : 'Object'}]`;
  }

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key.startsWith('_') && key !== '_id') continue;
    if ((typeof entry === 'string' || typeof entry === 'number') && isCredentialKey(key)) continue;
    const clean = walk(entry, below);
    if (clean !== undefined) out[key] = clean;
  }
  return out;
}

/** A copy that is safe to send: see the rules at the top of this file. */
export function sanitize(value: unknown): unknown {
  return walk(value, []) ?? null;
}

/** Text without markup, whitespace collapsed, cut to `max` characters with an ellipsis mark. */
export function plainText(html: string, max = 300): string {
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}
