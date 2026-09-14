/**
 * Which settings the AI may read and write, free of Foundry.
 *
 * Reading covers registered settings of the scopes "world" and "client". Two
 * things are never shown: the settings of Ninjo's Foundry MCP itself (they hold
 * the write switch and the permission matrix; get-permissions shows them) and
 * values whose key looks like a secret. Writing is limited to world settings on
 * an explicit list. The list is empty until Ninjo decides which settings belong
 * on it.
 */
import { MODULE_ID } from '../../constants.js';

/**
 * World settings the AI may change, as "namespace.key". Deliberately empty:
 * every entry is a decision of Ninjo, not of a session.
 */
export const WRITABLE_WORLD_SETTINGS: readonly string[] = [];

/** A key that looks like it holds a secret. Its value is never read out. */
const SECRET_KEY =
  /(pass(word|wd)?|secret|token|api[-_]?key|credential|private[-_]?key|auth|licen[cs]e|webhook)/i;

export function isSecretKey(key: string): boolean {
  return SECRET_KEY.test(key);
}

export function isOwnNamespace(namespace: string): boolean {
  return namespace === MODULE_ID;
}

export const READABLE_SCOPES: ReadonlySet<string> = new Set(['world', 'client']);

/** The largest value, as JSON characters, a listing shows in full. */
export const SETTING_VALUE_MAX_CHARS = 4000;

/** A setting value for a listing: as it is, or shortened JSON with a note. */
export function settingValueForListing(value: unknown): {
  value: unknown;
  truncated?: true;
} {
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    return { value: String(value) };
  }
  if (json === undefined) return { value: null };
  if (json.length <= SETTING_VALUE_MAX_CHARS) return { value };
  return { value: json.slice(0, SETTING_VALUE_MAX_CHARS), truncated: true };
}

export type SettingWriteRefusal =
  | { code: 'OWN_SETTING'; reason: string }
  | { code: 'SECRET'; reason: string }
  | { code: 'NOT_WORLD'; reason: string }
  | { code: 'NOT_ALLOWED'; reason: string };

/**
 * Why a setting may not be written, or null. Checked in this order, so the
 * reason names the rule that matters most: own settings, secrets, scope, list.
 */
export function settingWriteRefusal(
  id: string,
  scope: string,
  allowlist: readonly string[]
): SettingWriteRefusal | null {
  const namespace = id.slice(0, id.indexOf('.'));
  const key = id.slice(id.indexOf('.') + 1);
  if (isOwnNamespace(namespace)) {
    return {
      code: 'OWN_SETTING',
      reason:
        "The settings of Ninjo's Foundry MCP hold the write switch and the permission matrix; the AI never changes " +
        'them. A Gamemaster changes them in the module settings.',
    };
  }
  if (isSecretKey(key)) {
    return {
      code: 'SECRET',
      reason: `"${id}" looks like it holds a secret, so it is neither shown nor written.`,
    };
  }
  if (scope !== 'world') {
    return {
      code: 'NOT_WORLD',
      reason: `"${id}" is a ${scope} setting. Only world settings can be written; a ${scope} setting belongs to one browser or user.`,
    };
  }
  if (!allowlist.includes(id)) {
    return {
      code: 'NOT_ALLOWED',
      reason: allowlist.length
        ? `"${id}" is not on the list of world settings the AI may change. The list: ${allowlist.join(', ')}.`
        : `"${id}" is not on the list of world settings the AI may change, and that list is empty: which ` +
          'settings belong on it is not decided yet. Change the setting in Foundry.',
    };
  }
  return null;
}

/** Why a value does not fit a setting of this type, or null. Only text, number and true/false settings are written. */
export function settingValueProblem(
  value: unknown,
  config: {
    type?: unknown;
    choices?: unknown;
    range?: unknown;
  }
): string | null {
  const type = config.type;
  const typeName = typeof type === 'function' ? (type as { name?: string }).name : undefined;
  if (typeName !== 'String' && typeName !== 'Number' && typeName !== 'Boolean') {
    return `Only settings of type text, number or true/false are written; this one is ${typeName ?? 'of an unknown type'}.`;
  }
  if (typeName === 'Boolean' && typeof value !== 'boolean')
    return 'The value must be true or false.';
  if (typeName === 'String' && typeof value !== 'string') return 'The value must be a text.';
  if (typeName === 'Number' && (typeof value !== 'number' || !Number.isFinite(value)))
    return 'The value must be a number.';
  const choices = config.choices;
  if (choices && typeof choices === 'object') {
    const keys = Object.keys(choices);
    if (keys.length && !keys.includes(String(value)))
      return `The value must be one of ${keys.map(key => `"${key}"`).join(', ')}.`;
  }
  const range = config.range as { min?: unknown; max?: unknown } | undefined;
  if (typeName === 'Number' && range && typeof value === 'number') {
    if (typeof range.min === 'number' && value < range.min)
      return `The value must be at least ${range.min}.`;
    if (typeof range.max === 'number' && value > range.max)
      return `The value must be at most ${range.max}.`;
  }
  return null;
}
