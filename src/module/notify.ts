/**
 * Messages to the person at the table: one place, always with a fallback.
 *
 * On 07.09.2026 this module had 72 notifications, all in English and several
 * with emoji, while its settings were fully translated. Every visible text now
 * goes through a language key. `game.i18n.localize` hands a missing key back
 * unchanged, which would put a raw dotted key on screen, so each call carries
 * the English text to show instead. Placeholders in braces are filled in both.
 *
 * Grown from meldungen.ts of the production module, which was written in house.
 */
import { MODULE_ID } from '../common/constants.js';

type Data = Record<string, string | number>;

function fill(template: string, data?: Data): string {
  if (!data) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(data, name) ? String(data[name]) : match
  );
}

/** Translate `<module>.<key>`, or use the fallback. */
export function localize(key: string, fallback: string, data?: Data): string {
  const full = `${MODULE_ID}.${key}`;
  let translated: string | undefined;
  try {
    translated = game.i18n?.localize(full);
  } catch {
    translated = undefined;
  }
  return fill(!translated || translated === full ? fallback : translated, data);
}

export type NotificationLevel = 'info' | 'warn' | 'error';
export type NotificationData = Data;

export interface AnnouncementSpec {
  level: NotificationLevel;
  /** The English text, shown when the language file has none. Placeholders in braces. */
  en: string;
}

export interface Announcements<K extends string> {
  readonly area: string;
  readonly keys: readonly K[];
  /** `ninjos-foundry-mcp.<area>.<group>.<key>`, the key in the language files. */
  languageKey(key: K): string;
  level(key: K): NotificationLevel;
  /** The text, translated and filled, without showing it. */
  text(key: K, data?: Data): string;
  /** Show the notification at the level of its key. Returns the text shown. */
  announce(key: K, data?: Data): string;
}

const LEVELS: ReadonlySet<string> = new Set(['info', 'warn', 'error']);

/**
 * Notifications of any area, with its own language keys.
 *
 * The level belongs to the key, as in the interface area, so one message never shows
 * once as a hint and once as an error. Texts live in the area's language
 * fragments under `ninjos-foundry-mcp.<area>.notify.<key>` (another group
 * with `group`); a missing translation shows the English text, never the key.
 * A table with an unknown level or an empty English text throws at once.
 *
 * ```ts
 * const rollNotes = defineAnnouncements('tokens-dice', {
 *   notAllowed: { level: 'warn', en: 'You may not make this roll.' },
 * });
 * rollNotes.announce('notAllowed');
 * ```
 */
export function defineAnnouncements<K extends string>(
  area: string,
  messages: Readonly<Record<K, AnnouncementSpec>>,
  options: { group?: string } = {}
): Announcements<K> {
  const group = options.group ?? 'notify';
  if (!/^[a-z0-9-]+$/.test(area))
    throw new Error(`Announcements need an area id such as "tokens-dice", not "${area}"`);
  if (!/^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/.test(group))
    throw new Error(`The announcement group "${group}" of area "${area}" is not a key path`);
  const keys = Object.keys(messages) as K[];
  for (const key of keys) {
    const spec = messages[key];
    if (!spec || !LEVELS.has(spec.level) || typeof spec.en !== 'string' || !spec.en.trim()) {
      throw new Error(
        `The announcement "${key}" of area "${area}" needs a level (info, warn, error) and an English text`
      );
    }
  }
  const languageKey = (key: K) => `${MODULE_ID}.${area}.${group}.${key}`;
  const text = (key: K, data?: Data): string => {
    const spec = messages[key];
    const full = languageKey(key);
    let translated: string | undefined;
    try {
      translated = typeof game === 'undefined' ? undefined : game.i18n?.localize(full);
    } catch {
      translated = undefined;
    }
    return fill(!translated || translated === full ? spec.en : translated, data);
  };
  return {
    area,
    keys,
    languageKey,
    level: key => messages[key].level,
    text,
    announce: (key, data) => {
      const shown = text(key, data);
      const notifications = typeof ui === 'undefined' ? undefined : ui.notifications;
      notifications?.[messages[key].level](shown);
      return shown;
    },
  };
}

export const notify = {
  info(key: string, fallback: string, data?: Data): void {
    ui.notifications?.info(localize(`notify.${key}`, fallback, data));
  },
  warn(key: string, fallback: string, data?: Data): void {
    ui.notifications?.warn(localize(`notify.${key}`, fallback, data));
  },
  error(key: string, fallback: string, data?: Data): void {
    ui.notifications?.error(localize(`notify.${key}`, fallback, data));
  },
};
