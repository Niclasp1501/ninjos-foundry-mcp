/**
 * Visible texts of the tokens-dice area, with an English fallback for every key, and
 * the notifications of the roll card.
 *
 * The notifications go through `defineAnnouncements` of the core
 * (src/module/notify.ts): one level per key, text only through language keys,
 * the English text when a translation is missing. Keys, levels and texts are
 * the ones this package always had. A test compares the table with lang.en.json.
 */
import { MODULE_ID } from '../../../common/constants.js';
import { defineAnnouncements, type AnnouncementSpec } from '../../notify.js';

export type RollTextData = Record<string, string | number>;

export const TOKENS_DICE_EN = {
  [MODULE_ID]: {
    'tokens-dice': {
      roll: {
        customLabel: 'Custom roll',
        resultFlavorGm: '{label} (rolled by the Gamemaster)',
        card: {
          title: 'Roll request: {label}',
          target: 'Target: {player}',
          targetWithCharacter: 'Target: {player} ({character})',
          targetGmOnly:
            'Target: {character}. No player owns this character, so a Gamemaster rolls.',
          context: 'Context: {flavor}',
          public: 'Public roll: everyone sees the result.',
          private: 'Private roll: only {player} and the Gamemasters see the result.',
          privateGm: 'Private roll: only the Gamemasters see the result.',
          button: 'Roll: {label}',
          onlyTarget: 'Only {player} or a Gamemaster can roll.',
          onlyGm: 'Only a Gamemaster can roll.',
          rolling: 'Rolling',
          waiting: 'Rolled by {name}. A Gamemaster confirms the roll as soon as one is online.',
          completed: 'Rolled by {name} on {time}.',
          result: 'Result: {total}',
        },
      },
      notify: {
        notAllowed: 'You may not make this roll.',
        rollFailed: 'The roll could not be made: {reason}',
        alreadyRolled: 'This request has already been rolled.',
        noGamemaster:
          'The roll is in the chat. The request is marked as done as soon as a Gamemaster is online.',
        completeFailed: 'The roll request {label} could not be marked as done: {reason}',
        foreignRoll:
          '{name} rolled for the request {label} without being allowed to. The request stays open.',
        formulaMismatch:
          '{name} rolled {used} instead of {expected} for the request {label}. The request stays open.',
        visibilityMismatch:
          'The roll of {name} for the private request {label} was not whispered. The request stays open.',
        duplicateRoll:
          '{name} rolled again for the request {label}, which was already done. The first roll counts.',
      },
    },
  },
} as const;

export const ROLL_NOTIFY_LEVELS = {
  notAllowed: 'warn',
  rollFailed: 'error',
  alreadyRolled: 'warn',
  noGamemaster: 'info',
  completeFailed: 'error',
  foreignRoll: 'warn',
  formulaMismatch: 'warn',
  visibilityMismatch: 'warn',
  duplicateRoll: 'warn',
} as const satisfies Record<
  keyof (typeof TOKENS_DICE_EN)[typeof MODULE_ID]['tokens-dice']['notify'],
  'info' | 'warn' | 'error'
>;

export type RollNotifyKey = keyof typeof ROLL_NOTIFY_LEVELS;

function fallback(key: string): string | undefined {
  let node: unknown = TOKENS_DICE_EN[MODULE_ID]['tokens-dice'];
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/** A text of this package, filled; a missing translation shows the English text, never the key. */
export function rollText(key: string, data: RollTextData = {}): string {
  const full = `${MODULE_ID}.tokens-dice.${key}`;
  let translated: string | undefined;
  try {
    translated = game.i18n?.localize(full);
  } catch {
    translated = undefined;
  }
  const template = translated && translated !== full ? translated : (fallback(key) ?? full);
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(data, name) ? String(data[name]) : match
  );
}

const NOTIFY_EN = TOKENS_DICE_EN[MODULE_ID]['tokens-dice'].notify;

export const rollNotes = defineAnnouncements(
  'tokens-dice',
  Object.fromEntries(
    (Object.keys(ROLL_NOTIFY_LEVELS) as RollNotifyKey[]).map(key => [
      key,
      { level: ROLL_NOTIFY_LEVELS[key], en: NOTIFY_EN[key] },
    ])
  ) as Record<RollNotifyKey, AnnouncementSpec>
);

/** Show a notification of the roll card at the level of its key. Returns the text. */
export function notifyRoll(key: RollNotifyKey, data: RollTextData = {}): string {
  return rollNotes.announce(key, data);
}
