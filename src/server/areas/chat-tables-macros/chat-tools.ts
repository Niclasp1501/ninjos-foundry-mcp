/**
 * list-chat-messages, send-chat-message, update-chat-message, delete-chat-message.
 */
import { readOnlyTool, writingTool, type ToolDefinition } from '../../tools/types.js';
import {
  ask,
  isRecord,
  listOf,
  param,
  pick,
  schema,
  SPEAKER_PARAMETERS,
  str,
  unknownShape,
  warningLines,
} from './shared.js';

function messageLines(message: Record<string, unknown>): string[] {
  const author = isRecord(message['author']) ? str(message['author']['name']) : '';
  const speaker = isRecord(message['speaker']) ? str(message['speaker']['label']) : '';
  const whisper = listOf(message['whisperTo'])
    .filter(isRecord)
    .map(user => str(user['name']))
    .join(', ');
  const notes = [
    listOf(message['types']).map(String).join(', '),
    whisper ? `whisper to ${whisper}` : 'everyone',
    ...(message['blind'] === true ? ['blind'] : []),
    ...(message['own'] === true ? ['own'] : []),
  ];
  const lines = [
    `[${str(message['id'])}] ${str(message['timestamp'])} ${speaker || author}` +
      `${author && author !== speaker ? ` (by ${author})` : ''} (${notes.join('; ')}):`,
  ];
  const content = str(message['content']);
  if (content) {
    lines.push(
      `  ${content.replace(/\n/g, '\n  ')}${message['contentTruncated'] === true ? ' [shortened]' : ''}`
    );
  }
  if (typeof message['hiddenContentFor'] === 'string')
    lines.push(
      `  (${message['hiddenContentFor']} sees this message, but not its content: a blind roll)`
    );
  const flavor = str(message['flavor']);
  if (flavor) lines.push(`  flavor: ${flavor}`);
  const rolls = listOf(message['rolls'])
    .filter(isRecord)
    .map(
      roll => `${str(roll['formula'])} = ${typeof roll['total'] === 'number' ? roll['total'] : '?'}`
    );
  if (rolls.length) lines.push(`  rolls: ${rolls.join(', ')}`);
  return lines;
}

export function formatChatMessages(answer: unknown): string {
  if (!isRecord(answer) || !Array.isArray(answer['messages'])) return unknownShape(answer);
  const messages = answer['messages'].filter(isRecord);
  const total = typeof answer['total'] === 'number' ? answer['total'] : '?';
  const viewer = isRecord(answer['viewer']) ? ` that ${str(answer['viewer']['name'])} can see` : '';
  if (!messages.length) return `No chat messages${viewer} match. The chat holds ${total} messages.`;
  const next = str(answer['nextBeforeId']);
  return [
    `${messages.length} chat messages${viewer}, newest first (the chat holds ${total}):`,
    ...messages.flatMap(messageLines),
    next ? `More match: call again with beforeId "${next}".` : 'No older messages match.',
  ].join('\n');
}

export function formatSentMessage(answer: unknown): string {
  if (!isRecord(answer) || typeof answer['id'] !== 'string') return unknownShape(answer);
  const whisper = listOf(answer['whisperTo'])
    .filter(isRecord)
    .map(user => str(user['name']));
  return [
    `Chat message sent (id ${answer['id']}) as ${str(answer['speaker'])}, style ${str(answer['style'])}, ` +
      `${whisper.length ? `whispered to ${whisper.join(', ')} only` : 'visible to everyone'}.`,
    ...warningLines(answer),
  ].join('\n');
}

export const listChatMessagesTool: ToolDefinition = {
  name: 'list-chat-messages',
  title: 'List chat messages',
  group: 'chat',
  description:
    'Read the chat log as the Gamemaster sees it, newest first, whispers included, each with who it is whispered ' +
    'to. Filter by speaker, author, type, time or what one user can see, and page back with beforeId. Content is ' +
    'shown as plain text.',
  inputSchema: schema({
    speaker: param(
      'string',
      'Only messages spoken as this alias, actor id or name, or token id (whole name, any case)'
    ),
    author: param('string', 'Only messages written by this user: id or exact name'),
    type: param('string', 'Only messages of this type', {
      enum: ['roll', 'whisper', 'public', 'ic', 'ooc', 'emote', 'other'],
    }),
    since: param('string', 'Only messages from this time on, e.g. "2026-09-14T18:00:00Z"'),
    visibleTo: param('string', 'Only messages this user can see: id or exact name'),
    limit: param('integer', 'How many messages, 1 to 100; default 20'),
    beforeId: param(
      'string',
      'Continue after this message id, from nextBeforeId of the previous page'
    ),
    contentChars: param(
      'integer',
      'Shorten each content to this many characters; 0 for all; default 500'
    ),
  }),
  annotations: readOnlyTool('List chat messages'),
  handler: async (args, context) =>
    formatChatMessages(
      await ask(
        context,
        'listChatMessages',
        pick(args, [
          'speaker',
          'author',
          'type',
          'since',
          'visibleTo',
          'limit',
          'beforeId',
          'contentChars',
        ]),
        'list chat messages'
      )
    ),
};

export const sendChatMessageTool: ToolDefinition = {
  name: 'send-chat-message',
  title: 'Send a chat message',
  group: 'chat',
  description:
    'Post a message to the Foundry chat as the Gamemaster, or as an actor or token. Without whisperTo and ' +
    'whisperToGamemasters everyone sees it. Recipients are user ids or exact names; an unknown or ambiguous name ' +
    'sends nothing. Content is HTML.',
  inputSchema: schema(
    {
      content: param('string', 'The message, HTML allowed'),
      flavor: param('string', 'Optional small text above the message'),
      style: param(
        'string',
        'In character, out of character, emote or other; default ic with a speaker, else ooc',
        {
          enum: ['ic', 'ooc', 'emote', 'other'],
        }
      ),
      ...SPEAKER_PARAMETERS,
      whisperTo: param('array', 'Only these users see it: ids or exact names', {
        items: { type: 'string' },
      }),
      whisperToGamemasters: param(
        'boolean',
        'Every Gamemaster sees it too; alone, only Gamemasters see it'
      ),
    },
    ['content']
  ),
  annotations: writingTool('Send a chat message', { destructive: false, idempotent: false }),
  handler: async (args, context) =>
    formatSentMessage(
      await ask(
        context,
        'sendChatMessage',
        pick(args, [
          'content',
          'flavor',
          'style',
          'speakerActor',
          'speakerToken',
          'sceneId',
          'alias',
          'whisperTo',
          'whisperToGamemasters',
        ]),
        'send chat message'
      )
    ),
};

export const updateChatMessageTool: ToolDefinition = {
  name: 'update-chat-message',
  title: 'Change a chat message',
  group: 'chat',
  description:
    'Change the content or flavor of a chat message written by the Gamemaster the bridge runs as. Who sees the ' +
    'message does not change; send a new message for other recipients.',
  inputSchema: schema(
    {
      messageId: param('string', 'Id of the message'),
      content: param('string', 'New content, HTML allowed'),
      flavor: param('string', 'New flavor; an empty text removes it'),
    },
    ['messageId']
  ),
  annotations: writingTool('Change a chat message', { destructive: true, idempotent: true }),
  handler: async (args, context) => {
    const answer = await ask(
      context,
      'updateChatMessage',
      pick(args, ['messageId', 'content', 'flavor']),
      'change chat message'
    );
    if (!isRecord(answer) || typeof answer['id'] !== 'string') return unknownShape(answer);
    return [
      `Chat message ${answer['id']} changed: ${listOf(answer['changed']).map(String).join(', ')}.`,
      ...warningLines(answer),
    ].join('\n');
  },
};

export const deleteChatMessageTool: ToolDefinition = {
  name: 'delete-chat-message',
  title: 'Delete a chat message',
  group: 'chat',
  description:
    'Delete a chat message written by the Gamemaster the bridge runs as, by id. Refused until the permission ' +
    'settings have a level for chat messages that allows deleting.',
  inputSchema: schema({ messageId: param('string', 'Id of the message') }, ['messageId']),
  annotations: writingTool('Delete a chat message', { destructive: true, idempotent: true }),
  handler: async (args, context) => {
    const answer = await ask(
      context,
      'deleteChatMessage',
      pick(args, ['messageId']),
      'delete chat message'
    );
    return isRecord(answer) && answer['deleted'] === true
      ? `Chat message ${str(answer['id'])} deleted.`
      : unknownShape(answer);
  },
};
