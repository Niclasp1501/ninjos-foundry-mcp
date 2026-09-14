/**
 * A notification to everyone or to chosen users.
 *
 * - Recipients are resolved exactly (id or exact name, the rule of the chat-tables-macros area), so a
 *   message never reaches someone the model did not mean.
 * - The Gamemaster's own browser shows it directly. Other browsers get it over
 *   the module socket `module.ninjos-foundry-mcp`, which Foundry only relays
 *   when the manifest declares `"socket": true`. Without it the tool says so
 *   and sends nothing, instead of reporting a delivery that cannot happen.
 * - Delivery to another browser cannot be read back. The answer names who was
 *   logged in (and so could receive it) and who was not.
 * - A receiving browser shows only messages from a user who is a Gamemaster,
 *   and only when it is among the recipients.
 * - The text is plain: markup is refused, at most 500 characters, and the
 *   visible line names the sender through a language key.
 */
import { MODULE_ID } from '../../../common/constants.js';
import { WRITE_SWITCH_ONLY } from '../../../common/permissions.js';
import { QueryError, type QueryHandler } from '../../dispatcher.js';
import { defineAnnouncements } from '../../notify.js';
import { requireWorld } from '../../world-ready.js';
import {
  inputOf,
  invalid,
  isRecord,
  listOfTexts,
  optionalChoice,
  recordWorldChange,
  resolveUsers,
  textOf,
  worldGame,
} from './common.js';

export const SOCKET_EVENT = `module.${MODULE_ID}`;
export const NOTIFICATION_MAX_CHARS = 500;
export const NOTIFICATION_LEVELS = ['info', 'warn', 'error'] as const;
type Level = (typeof NOTIFICATION_LEVELS)[number];

export const worldNotes = defineAnnouncements('world-files-decks', {
  messageInfo: { level: 'info', en: 'Message from {sender}: {message}' },
  messageWarn: { level: 'warn', en: 'Message from {sender}: {message}' },
  messageError: { level: 'error', en: 'Message from {sender}: {message}' },
});

const KEY_OF: Record<Level, 'messageInfo' | 'messageWarn' | 'messageError'> = {
  info: 'messageInfo',
  warn: 'messageWarn',
  error: 'messageError',
};

export interface NotificationPayload {
  type: 'world-files-decks.notify';
  level: Level;
  message: string;
  sender: string;
  recipients: string[];
}

export function socketDeclared(): boolean {
  return worldGame().modules.get(MODULE_ID)?.socket === true;
}

export const sendNotification: QueryHandler = {
  access: WRITE_SWITCH_ONLY,
  run: (data, context) => {
    requireWorld();
    const input = inputOf(data);
    const message = textOf(input['message']);
    if (!message) throw invalid('message is required and must not be empty');
    if (message.length > NOTIFICATION_MAX_CHARS)
      throw invalid(
        `message has ${message.length} characters; at most ${NOTIFICATION_MAX_CHARS} fit a notification`
      );
    if (/[<>]/.test(message))
      throw invalid('message must be plain text without "<" or ">"; markup is not shown');
    const level = optionalChoice(input, 'level', NOTIFICATION_LEVELS) ?? 'info';
    const named = listOfTexts(input, 'users');
    if (named && !named.length) throw invalid('users must name at least one user, or be left out');
    const all = game.users?.contents ?? [];
    const recipients = named ? resolveUsers(named, 'users') : all;
    const self = game.user as FoundryUser;
    const others = recipients.filter(user => user.id !== self.id);

    if (others.length && !socketDeclared()) {
      throw new QueryError(
        'NOT_AVAILABLE',
        'Nothing was sent: Foundry only relays messages between browsers for a module whose manifest declares ' +
          '"socket": true, and the installed manifest of Ninjo\'s Foundry MCP does not declare it (Foundry reads ' +
          'the manifest when the world starts). Only a notification to the Gamemaster in this browser is possible now.'
      );
    }

    const payload: NotificationPayload = {
      type: 'world-files-decks.notify',
      level,
      message,
      sender: self.id,
      recipients: recipients.map(user => user.id),
    };
    if (others.length) {
      const socket = worldGame().socket;
      if (!socket || typeof socket.emit !== 'function')
        throw new QueryError(
          'NOT_AVAILABLE',
          "Nothing was sent: Foundry's game.socket is not available"
        );
      socket.emit(SOCKET_EVENT, payload);
    }
    const shownHere = recipients.some(user => user.id === self.id);
    if (shownHere) worldNotes.announce(KEY_OF[level], { sender: self.name, message });

    const online = others.filter(user => user.active);
    const offline = others.filter(user => !user.active);
    recordWorldChange(context, 'Notifications', {
      query: 'sendNotification',
      tool: 'send-notification',
      action: 'other',
      targets: recipients.map(user => ({ id: user.id, name: user.name, documentName: 'User' })),
      summary: `Sent a ${level} notification to ${recipients.map(user => user.name).join(', ')}.`,
    });
    return {
      level,
      shownHere,
      sentTo: online.map(user => ({ id: user.id, name: user.name })),
      notLoggedIn: offline.map(user => ({ id: user.id, name: user.name })),
      note:
        others.length > 0
          ? 'Sent to the other browsers over the module socket; whether they showed it cannot be read back.'
          : null,
    };
  },
};

/**
 * Show a notification that arrived over the socket. `senderId` is the id of
 * the sending user as Foundry's server adds it to a relayed module message.
 * The payload's own `sender` is written by the sending browser and proves
 * nothing, so without an id from Foundry, or with one that differs from the
 * payload, nothing is shown: a player cannot show a message in the name of a
 * Gamemaster. Returns whether it was shown.
 */
export function receiveNotification(raw: unknown, senderId?: unknown): boolean {
  if (!isRecord(raw) || raw['type'] !== 'world-files-decks.notify') return false;
  const me = game.user;
  if (!me) return false;
  const recipients = Array.isArray(raw['recipients']) ? raw['recipients'] : [];
  if (!recipients.includes(me.id)) return false;
  if (typeof senderId !== 'string' || !senderId || raw['sender'] !== senderId) return false;
  const sender = game.users?.get(raw['sender']);
  if (!sender?.isGM || sender.id === me.id) return false;
  const level = NOTIFICATION_LEVELS.find(entry => entry === raw['level']);
  const message = typeof raw['message'] === 'string' ? raw['message'].trim() : '';
  if (!level || !message || message.length > NOTIFICATION_MAX_CHARS || /[<>]/.test(message))
    return false;
  worldNotes.announce(KEY_OF[level], { sender: sender.name, message });
  return true;
}

let listening = false;

/** Listen for notifications once per browser, for players and Gamemasters alike. */
export function listenForNotifications(): void {
  const socket = worldGame().socket;
  if (listening || !socket || typeof socket.on !== 'function') return;
  socket.on(SOCKET_EVENT, (payload, ...rest) => {
    // Foundry appends the sender's id after everything the sender passed, so only the
    // last argument can be trusted; a forged id in front of it changes nothing.
    receiveNotification(payload, rest.length ? rest[rest.length - 1] : undefined);
  });
  listening = true;
}

/** For tests. */
export function resetNotificationListener(): void {
  listening = false;
}
