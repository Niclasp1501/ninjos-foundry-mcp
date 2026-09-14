/**
 * Notifications of the module, one table for all of them.
 *
 * One call per message: `announce('sceneCreated', { name })`. The level
 * belongs to the key, so a package cannot show the same message once as a
 * hint and once as an error. Texts live under
 * `ninjos-foundry-mcp.interface.notify.<key>` in German and English, with the
 * English text as fallback (texts.ts). No emoji, no dashes.
 *
 * Not in here: the three connection messages (`connected`, `disconnected`,
 * `lostConnection`). The bridge in main.ts shows them and gates them on
 * "Connection messages"; every message here appears always.
 *
 * Rule 5 of the interface principles: where players are involved, the result
 * belongs into the window, not into a toast. The windows of this package show
 * their result in the window as well; the toast is for the Gamemaster at the
 * desk.
 */
import { defineAnnouncements, type AnnouncementSpec } from '../../notify.js';
import { fallbackFor, t, type TextData } from './texts.js';

export type MessageLevel = 'info' | 'warn' | 'error';

export const MESSAGE_LEVELS = {
  indexBuilding: 'info',
  indexRebuilding: 'info',
  indexRebuilt: 'info',
  indexRebuildFailed: 'error',
  indexSkipped: 'warn',
  indexNotStored: 'warn',
  indexSettingsSaved: 'info',
  releaseSaved: 'info',
  releaseAllowAll: 'info',
  releaseFailed: 'error',
  comfyAlreadyRunning: 'info',
  comfyStarting: 'info',
  comfyStarted: 'info',
  comfyStartFailed: 'error',
  comfyStopped: 'info',
  comfyStopFailed: 'error',
  backendMissing: 'warn',
  mapgenSaved: 'info',
  mapJobFailed: 'error',
  sceneCreated: 'info',
  sceneSwitched: 'info',
  wallsCreated: 'info',
  noWalls: 'warn',
  gmOnlyProgress: 'warn',
  progressSaveFailed: 'error',
  progressUpdateFailed: 'error',
} as const satisfies Record<string, MessageLevel>;

export type MessageKey = keyof typeof MESSAGE_LEVELS;

/** The text of a message, filled, without showing it. */
export function messageText(key: MessageKey, data?: TextData): string {
  return t(`notify.${key}`, data);
}

/**
 * The table on the notifications of the core (src/module/notify.ts),
 * with the same keys, levels and English fallbacks.
 */
const notes = defineAnnouncements(
  'interface',
  Object.fromEntries(
    (Object.keys(MESSAGE_LEVELS) as MessageKey[]).map(key => [
      key,
      {
        level: MESSAGE_LEVELS[key],
        en: fallbackFor(`ninjos-foundry-mcp.interface.notify.${key}`) ?? key,
      },
    ])
  ) as Record<MessageKey, AnnouncementSpec>
);

/** Show a message at the level of its key. Returns the text shown. */
export function announce(key: MessageKey, data?: TextData): string {
  return notes.announce(key, data);
}

/** The cause of a failure as a short text, for {reason}. */
export function reasonOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  const text = String(error ?? '');
  return text || 'unknown cause';
}
