/**
 * Chat: read messages as the Gamemaster sees them, send, change and delete
 * own messages.
 *
 * Decisions:
 * - Reading shows every message, whispers included, because the bridge runs
 *   as a Gamemaster, who sees them in Foundry too. Each message says who it
 *   is whispered to, and `visibleTo` narrows the list to what one user sees.
 * - Recipients are resolved by id or exact name before anything is sent. An
 *   unknown or ambiguous name, or an empty list, is an error: a whisper that
 *   falls back to a public message is the worst failure this tool could have.
 * - After sending, the stored recipients are compared with the requested ones.
 * - Only messages written by the user the bridge runs as can be changed or
 *   deleted. Deleting follows the core rule for kinds without a level.
 */
import { smallEnough } from '../../../common/change-log.js';
import { MODULE_ID } from '../../../common/constants.js';
import { QueryError, type QueryHandler } from '../../dispatcher.js';
import { requireWorld } from '../../world-ready.js';
import { CHAT_LOG_KIND, chatAccess } from './access.js';
import {
  documentClass,
  idOf,
  inputOf,
  isRecord,
  messageOf,
  optionalBoolean,
  optionalChoice,
  optionalInteger,
  optionalText,
  plainText,
  requiredText,
  resolveUsers,
  userLabel,
} from './lookup.js';
import { resolveSpeaker } from './speaker.js';

/** Foundry's CHAT_MESSAGE_STYLES in order: OTHER 0, OOC 1, IC 2, EMOTE 3. */
export const STYLE_NAMES = ['other', 'ooc', 'ic', 'emote'] as const;
export type StyleName = (typeof STYLE_NAMES)[number];

export const MESSAGE_TYPES = ['roll', 'whisper', 'public', 'ic', 'ooc', 'emote', 'other'] as const;

export const messages = () => game.messages as FoundryCollection<FoundryChatTablesMessage>;

export function authorIdOf(message: FoundryChatTablesMessage): string | null {
  return idOf(message.author) ?? idOf(message.user);
}

export function whisperIdsOf(message: FoundryChatTablesMessage): string[] {
  if (!Array.isArray(message.whisper)) return [];
  return message.whisper.map(entry => idOf(entry)).filter((id): id is string => id !== null);
}

function styleOf(message: FoundryChatTablesMessage): StyleName {
  const index = typeof message.style === 'number' ? message.style : 0;
  return STYLE_NAMES[index] ?? 'other';
}

export function rollsOf(
  message: FoundryChatTablesMessage
): Array<{ formula: string; total: number | null }> {
  if (!Array.isArray(message.rolls)) return [];
  return message.rolls.flatMap(entry => {
    let data: unknown = entry;
    if (typeof entry === 'string') {
      try {
        data = JSON.parse(entry);
      } catch {
        return [{ formula: entry, total: null }];
      }
    }
    if (!isRecord(data)) return [];
    return [
      {
        formula: typeof data['formula'] === 'string' ? data['formula'] : '',
        total: typeof data['total'] === 'number' ? data['total'] : null,
      },
    ];
  });
}

/** Whisper recipients as text: "everyone" or "whisper to A, B". */
export function audienceText(message: FoundryChatTablesMessage): string {
  const whisper = whisperIdsOf(message);
  return whisper.length ? `whisper to ${whisper.map(userLabel).join(', ')}` : 'everyone';
}

/**
 * What one user sees of a message. A Gamemaster sees everything. Anyone else
 * sees a public message, a message they wrote, and a whisper to them. The
 * content of a blind roll stays hidden from them.
 * OPEN: checked against the description of `visible` and `isContentVisible`,
 * not in a browser.
 */
export function visibilityFor(
  message: FoundryChatTablesMessage,
  user: FoundryUser
): { visible: boolean; contentVisible: boolean } {
  if (user.isGM) return { visible: true, contentVisible: true };
  const whisper = whisperIdsOf(message);
  const visible = !whisper.length || authorIdOf(message) === user.id || whisper.includes(user.id);
  const blindRoll = message.blind === true && rollsOf(message).length > 0;
  return { visible, contentVisible: visible && !blindRoll };
}

function timestampOf(message: FoundryChatTablesMessage): number {
  return typeof message.timestamp === 'number' ? message.timestamp : 0;
}

function speakerOf(message: FoundryChatTablesMessage) {
  const speaker = isRecord(message.speaker) ? message.speaker : {};
  const actorId = idOf(speaker['actor']);
  const alias = typeof speaker['alias'] === 'string' && speaker['alias'] ? speaker['alias'] : null;
  return {
    alias,
    actorId,
    actorName: actorId ? (game.actors.get(actorId)?.name ?? null) : null,
    tokenId: idOf(speaker['token']),
    sceneId: idOf(speaker['scene']),
  };
}

function ownFlags(message: FoundryChatTablesMessage): Record<string, unknown> {
  const flags = message.flags;
  if (!isRecord(flags)) return {};
  const own = flags[MODULE_ID];
  return isRecord(own) ? own : {};
}

export function summarizeMessage(message: FoundryChatTablesMessage, contentChars: number) {
  const authorId = authorIdOf(message);
  const authorName = authorId ? userLabel(authorId) : 'unknown';
  const speaker = speakerOf(message);
  const whisper = whisperIdsOf(message);
  const content = plainText(message.content);
  const shortened = contentChars > 0 && content.length > contentChars;
  const rolls = rollsOf(message);
  const types: string[] = [styleOf(message)];
  if (rolls.length) types.push('roll');
  types.push(whisper.length ? 'whisper' : 'public');
  return {
    id: message.id,
    timestamp: new Date(timestampOf(message)).toISOString(),
    author: { id: authorId, name: authorName },
    speaker: { ...speaker, label: speaker.alias ?? speaker.actorName ?? authorName },
    style: styleOf(message),
    types,
    audience: whisper.length ? 'whisper' : 'everyone',
    whisperTo: whisper.map(id => ({ id, name: userLabel(id) })),
    blind: message.blind === true,
    content: shortened ? content.slice(0, contentChars) : content,
    contentTruncated: shortened,
    flavor: plainText(message.flavor) || null,
    rolls,
    own: authorId !== null && authorId === game.user?.id,
    createdByMcp: ownFlags(message)['createdByMcp'] === true,
  };
}

function sinceOf(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) return parsed;
  }
  throw new QueryError(
    'INVALID_ARGUMENT',
    `since must be a date such as "2026-09-14T18:00:00Z" or milliseconds since 1970, got ${JSON.stringify(raw)}`
  );
}

export const listChatMessages: QueryHandler = {
  access: { kind: 'read' },
  run: data => {
    requireWorld();
    const input = inputOf(data);
    const limit = optionalInteger(input, 'limit', 1, 100) ?? 20;
    const contentChars = optionalInteger(input, 'contentChars', 0, 20000) ?? 500;
    const type = optionalChoice(input, 'type', MESSAGE_TYPES);
    const since = sinceOf(input['since']);
    const speaker = optionalText(input, 'speaker')?.trim().toLowerCase() || null;
    const authorRef = optionalText(input, 'author')?.trim();
    const author = authorRef ? resolveUsers([authorRef], 'author')[0] : undefined;
    const viewerRef = optionalText(input, 'visibleTo')?.trim();
    const viewer = viewerRef ? resolveUsers([viewerRef], 'visibleTo')[0] : undefined;
    const beforeId = optionalText(input, 'beforeId')?.trim();

    const all = messages()
      .contents.map((message, index) => ({ message, index }))
      .sort((a, b) => timestampOf(b.message) - timestampOf(a.message) || b.index - a.index)
      .map(entry => entry.message);

    let start = 0;
    if (beforeId) {
      const at = all.findIndex(message => message.id === beforeId);
      if (at < 0) {
        throw new QueryError(
          'NOT_FOUND',
          `beforeId "${beforeId}" is not a chat message in this world (any more). Start again without beforeId.`
        );
      }
      start = at + 1;
    }

    const matches = (message: FoundryChatTablesMessage): boolean => {
      if (since !== null && timestampOf(message) < since) return false;
      if (author && authorIdOf(message) !== author.id) return false;
      if (viewer && !visibilityFor(message, viewer).visible) return false;
      if (type) {
        const whisper = whisperIdsOf(message).length > 0;
        if (type === 'roll' && !rollsOf(message).length) return false;
        if (type === 'whisper' && !whisper) return false;
        if (type === 'public' && whisper) return false;
        if (['ic', 'ooc', 'emote', 'other'].includes(type) && styleOf(message) !== type)
          return false;
      }
      if (speaker) {
        const s = speakerOf(message);
        const candidates = [s.alias, s.actorId, s.actorName, s.tokenId].filter(
          (value): value is string => typeof value === 'string'
        );
        if (!candidates.some(value => value.toLowerCase() === speaker)) return false;
      }
      return true;
    };

    const page: FoundryChatTablesMessage[] = [];
    let more = false;
    for (let index = start; index < all.length; index += 1) {
      const message = all[index];
      if (!message || !matches(message)) continue;
      if (page.length === limit) {
        more = true;
        break;
      }
      page.push(message);
    }

    return {
      total: all.length,
      viewer: viewer ? { id: viewer.id, name: viewer.name } : null,
      messages: page.map(message => {
        const summary = summarizeMessage(message, contentChars);
        return viewer && !visibilityFor(message, viewer).contentVisible
          ? { ...summary, hiddenContentFor: viewer.name }
          : summary;
      }),
      nextBeforeId: more ? (page.at(-1)?.id ?? null) : null,
    };
  },
};

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return [...a].sort().join('\n') === [...b].sort().join('\n');
}

function recipientsText(ids: readonly string[]): string {
  return ids.length ? `whisper to ${ids.map(userLabel).join(', ')}` : 'everyone';
}

export const sendChatMessage: QueryHandler = {
  access: () => chatAccess('create'),
  run: async (data, context) => {
    requireWorld();
    const input = inputOf(data);
    const content = requiredText(input, 'content');
    const flavor = optionalText(input, 'flavor');
    const resolved = resolveSpeaker(input);
    const speaksAsCharacter = Boolean(resolved?.speaker.actor || resolved?.speaker.token);
    const style = optionalChoice(input, 'style', STYLE_NAMES) ?? (speaksAsCharacter ? 'ic' : 'ooc');

    // Every recipient is known before anything is written.
    const rawWhisper = input['whisperTo'];
    let named: FoundryUser[] = [];
    if (rawWhisper !== undefined && rawWhisper !== null) {
      if (
        !Array.isArray(rawWhisper) ||
        !rawWhisper.every(entry => typeof entry === 'string' && entry.trim())
      ) {
        throw new QueryError(
          'INVALID_ARGUMENT',
          'whisperTo must be a list of user ids or exact user names'
        );
      }
      if (!rawWhisper.length) {
        throw new QueryError(
          'INVALID_ARGUMENT',
          'whisperTo is empty. Leave it out for a message everyone sees, or name at least one user.'
        );
      }
      named = resolveUsers(rawWhisper as string[], 'whisperTo');
    }
    const toGamemasters = optionalBoolean(input, 'whisperToGamemasters') === true;
    const gamemasters = (game.users?.contents ?? []).filter(user => user.isGM);
    const recipients = [
      ...new Set([...named, ...(toGamemasters ? gamemasters : [])].map(user => user.id)),
    ];
    const user = game.user as FoundryUser;

    const source: Record<string, unknown> = {
      content,
      style: STYLE_NAMES.indexOf(style),
      speaker: resolved?.speaker ?? { scene: null, actor: null, token: null },
      author: user.id,
      whisper: recipients,
      flags: { [MODULE_ID]: { createdByMcp: true } },
    };
    if (flavor) source['flavor'] = flavor;

    let made: unknown;
    try {
      made = await documentClass('ChatMessage').create(source);
    } catch (error) {
      throw new QueryError(
        'CREATE_FAILED',
        `Foundry refused the chat message: ${messageOf(error)}. Nothing was sent.`
      );
    }
    const id = idOf(made);
    const stored = id ? messages().get(id) : undefined;
    if (!stored) {
      throw new QueryError(
        'NOT_APPLIED',
        'Foundry did not report a new chat message, and none is in the chat when read back. ' +
          'Another module may have stopped it before it was created.'
      );
    }

    const actual = whisperIdsOf(stored);
    if (!sameIds(actual, recipients)) {
      throw new QueryError(
        'WHISPER_MISMATCH',
        `Chat message ${stored.id} was created, but its recipients differ from the request: asked for ` +
          `${recipientsText(recipients)}, stored ${recipientsText(actual)}. Another module may have changed it. ` +
          'The message was not deleted; check it in the chat.'
      );
    }

    const warnings: string[] = [];
    const storedSpeaker = speakerOf(stored);
    if (
      resolved &&
      (storedSpeaker.actorId !== resolved.speaker.actor ||
        storedSpeaker.tokenId !== resolved.speaker.token)
    ) {
      warnings.push(
        `Foundry stored a different speaker: actor ${storedSpeaker.actorId ?? 'none'}, token ${storedSpeaker.tokenId ?? 'none'}.`
      );
    }
    if (stored.content !== content) {
      warnings.push(
        `Foundry stored the content changed, for example with cleaned HTML: ${JSON.stringify(stored.content)}.`
      );
    }

    const label = resolved?.label ?? user.name;
    context.recordChange({
      query: 'sendChatMessage',
      tool: 'send-chat-message',
      document: CHAT_LOG_KIND,
      action: 'create',
      targets: [{ id: stored.id, uuid: stored.uuid, name: label }],
      summary: `Sent a chat message as ${label} to ${recipientsText(actual)}.`,
      after: smallEnough(stored.toObject()),
    });

    return {
      id: stored.id,
      audience: actual.length ? 'whisper' : 'everyone',
      whisperTo: actual.map(userId => ({ id: userId, name: userLabel(userId) })),
      speaker: label,
      style,
      warnings,
    };
  },
};

/** A message by id that the bridge user wrote; anything else is an error with the cause. */
function ownMessage(input: Record<string, unknown>, verb: string): FoundryChatTablesMessage {
  const id = requiredText(input, 'messageId');
  const message = messages().get(id);
  if (!message) {
    throw new QueryError(
      'NOT_FOUND',
      `Chat message "${id}" not found. Chat messages are found by id only; list-chat-messages shows the ids.`
    );
  }
  const authorId = authorIdOf(message);
  const user = game.user as FoundryUser;
  if (authorId !== user.id) {
    throw new QueryError(
      'NOT_OWN',
      `Chat message ${id} was written by ${authorId ? `"${userLabel(authorId)}"` : 'an unknown author'}, not by ` +
        `"${user.name}", the Gamemaster this bridge runs as. Only own messages can be ${verb}.`
    );
  }
  return message;
}

export const updateChatMessage: QueryHandler = {
  access: () => chatAccess('update'),
  run: async (data, context) => {
    requireWorld();
    const input = inputOf(data);
    const message = ownMessage(input, 'changed');
    const changes: Record<string, unknown> = {};
    const content = optionalText(input, 'content');
    if (content !== undefined) {
      if (!content.trim())
        throw new QueryError(
          'INVALID_ARGUMENT',
          'content must not be empty; delete the message instead'
        );
      changes['content'] = content;
    }
    const flavor = optionalText(input, 'flavor');
    if (flavor !== undefined) changes['flavor'] = flavor;
    if (!Object.keys(changes).length)
      throw new QueryError('INVALID_ARGUMENT', 'Nothing to change: pass content, flavor or both');

    const before = smallEnough(message.toObject());
    try {
      await message.update(changes);
    } catch (error) {
      throw new QueryError(
        'UPDATE_FAILED',
        `Foundry refused the change to chat message ${message.id}: ${messageOf(error)}. Nothing was changed.`
      );
    }
    const stored = messages().get(message.id);
    if (!stored) {
      throw new QueryError('NOT_APPLIED', `Chat message ${message.id} is gone when read back.`);
    }
    const warnings: string[] = [];
    const unchanged: string[] = [];
    for (const [key, value] of Object.entries(changes)) {
      const now = (stored as unknown as Record<string, unknown>)[key];
      if (now === value) continue;
      const was = isRecord(before) ? before[key] : undefined;
      if (now === was) unchanged.push(key);
      else
        warnings.push(
          `Foundry stored ${key} changed, for example with cleaned HTML: ${JSON.stringify(now)}.`
        );
    }
    if (unchanged.length) {
      throw new QueryError(
        'NOT_APPLIED',
        `Chat message ${message.id} was updated, but ${unchanged.join(' and ')} still hold the old text when read back.`
      );
    }

    context.recordChange({
      query: 'updateChatMessage',
      tool: 'update-chat-message',
      document: CHAT_LOG_KIND,
      action: 'update',
      targets: [{ id: stored.id, uuid: stored.uuid }],
      summary: `Changed ${Object.keys(changes).join(' and ')} of chat message ${stored.id}.`,
      before,
      after: smallEnough(stored.toObject()),
    });
    return { id: stored.id, changed: Object.keys(changes), warnings };
  },
};

export const deleteChatMessage: QueryHandler = {
  access: () => chatAccess('delete'),
  run: async (data, context) => {
    requireWorld();
    const message = ownMessage(inputOf(data), 'deleted');
    const before = smallEnough(message.toObject());
    const audience = audienceText(message);
    try {
      await message.delete();
    } catch (error) {
      throw new QueryError(
        'DELETE_FAILED',
        `Foundry refused to delete chat message ${message.id}: ${messageOf(error)}.`
      );
    }
    if (messages().get(message.id)) {
      throw new QueryError(
        'NOT_APPLIED',
        `Chat message ${message.id} was deleted, but it is still in the chat when read back.`
      );
    }
    context.recordChange({
      query: 'deleteChatMessage',
      tool: 'delete-chat-message',
      document: CHAT_LOG_KIND,
      action: 'delete',
      targets: [{ id: message.id, uuid: message.uuid }],
      summary: `Deleted own chat message ${message.id} (${audience}).`,
      before,
    });
    return { id: message.id, deleted: true };
  },
};
