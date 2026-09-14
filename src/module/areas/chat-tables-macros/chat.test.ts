import { afterEach, describe, expect, it } from 'vitest';
import { ChangeLog } from '../../../common/change-log.js';
import { MODULE_ID } from '../../../common/constants.js';
import type { FakeFoundry } from '../../../testing/fake-foundry.js';
import type { HandlerContext } from '../../dispatcher.js';
import { deleteChatMessage } from './chat.js';
import { openChatTables, type ChatTablesSetup } from './testing.js';

let setup: ChatTablesSetup | null = null;
afterEach(() => {
  setup?.harness.close();
  setup = null;
});

const USERS = [
  { id: 'gm', name: 'Gamemaster', isGM: true },
  { id: 'alice', name: 'Alice' },
  { id: 'alina', name: 'Alina' },
  { id: 'bob1', name: 'Bob' },
  { id: 'bob2', name: 'Bob' },
  { id: 'gm2', name: 'Co GM', isGM: true },
];

const open = (settings: Record<string, unknown> = {}) =>
  (setup = openChatTables({ users: USERS, settings }));

const SWITCH_OFF = { [`${MODULE_ID}.allowWriteOperations`]: false };

function seedMessages(foundry: FakeFoundry): void {
  foundry.seed('Actor', { _id: 'hero', name: 'Hero' });
  foundry.seed('ChatMessage', {
    _id: 'm1',
    author: 'alice',
    timestamp: 1000,
    style: 1,
    content: '<p>Hello &amp; welcome</p>',
    whisper: [],
  });
  foundry.seed('ChatMessage', {
    _id: 'm2',
    author: 'gm',
    timestamp: 2000,
    style: 2,
    speaker: { actor: 'hero', alias: 'Hero' },
    content: 'I attack',
    rolls: [JSON.stringify({ formula: '1d20', total: 17 })],
    whisper: [],
  });
  foundry.seed('ChatMessage', {
    _id: 'm3',
    author: 'gm',
    timestamp: 3000,
    style: 1,
    content: 'Secret for Alice',
    whisper: ['alice'],
  });
  foundry.seed('ChatMessage', {
    _id: 'm4',
    author: 'bob1',
    timestamp: 4000,
    style: 1,
    content: 'Bob to the GM',
    whisper: ['gm'],
  });
}

type Answer = Record<string, unknown> & { messages: Array<Record<string, unknown>> };
const ids = (answer: unknown) => (answer as Answer).messages.map(message => message['id']);

describe('listChatMessages', () => {
  it('lists newest first, as plain text, with recipients and rolls', async () => {
    const { harness, foundry } = open();
    seedMessages(foundry);
    const answer = (await harness.query('listChatMessages')) as Answer;
    expect(ids(answer)).toEqual(['m4', 'm3', 'm2', 'm1']);
    const [m4, m3, m2, m1] = answer.messages;
    expect(m1).toMatchObject({ content: 'Hello & welcome', audience: 'everyone', style: 'ooc' });
    expect(m3).toMatchObject({
      audience: 'whisper',
      whisperTo: [{ id: 'alice', name: 'Alice' }],
      own: true,
    });
    expect(m2).toMatchObject({
      rolls: [{ formula: '1d20', total: 17 }],
      speaker: { actorName: 'Hero', label: 'Hero' },
      types: ['ic', 'roll', 'public'],
    });
    expect(m4).toMatchObject({ author: { id: 'bob1', name: 'Bob' }, own: false });
  });

  it('pages back with beforeId', async () => {
    const { harness, foundry } = open();
    seedMessages(foundry);
    const first = (await harness.query('listChatMessages', { limit: 2 })) as Answer;
    expect(ids(first)).toEqual(['m4', 'm3']);
    expect(first['nextBeforeId']).toBe('m3');
    const second = (await harness.query('listChatMessages', {
      limit: 2,
      beforeId: 'm3',
    })) as Answer;
    expect(ids(second)).toEqual(['m2', 'm1']);
    expect(second['nextBeforeId']).toBeNull();
    await expect(harness.query('listChatMessages', { beforeId: 'gone' })).rejects.toMatchObject({
      moduleCode: 'NOT_FOUND',
    });
  });

  it('filters by type, speaker, author and time', async () => {
    const { harness, foundry } = open();
    seedMessages(foundry);
    expect(ids(await harness.query('listChatMessages', { type: 'whisper' }))).toEqual(['m4', 'm3']);
    expect(ids(await harness.query('listChatMessages', { type: 'roll' }))).toEqual(['m2']);
    expect(ids(await harness.query('listChatMessages', { speaker: 'hero' }))).toEqual(['m2']);
    expect(ids(await harness.query('listChatMessages', { author: 'Alice' }))).toEqual(['m1']);
    expect(ids(await harness.query('listChatMessages', { since: 2500 }))).toEqual(['m4', 'm3']);
    expect(
      ids(await harness.query('listChatMessages', { since: new Date(2500).toISOString() }))
    ).toEqual(['m4', 'm3']);
    await expect(harness.query('listChatMessages', { since: 'yesterday' })).rejects.toMatchObject({
      moduleCode: 'INVALID_ARGUMENT',
    });
  });

  it('shows only what one user sees, and never finds a user by part of a name', async () => {
    const { harness, foundry } = open();
    seedMessages(foundry);
    expect(ids(await harness.query('listChatMessages', { visibleTo: 'Alice' }))).toEqual([
      'm3',
      'm2',
      'm1',
    ]);
    await expect(harness.query('listChatMessages', { visibleTo: 'Ali' })).rejects.toMatchObject({
      moduleCode: 'NOT_FOUND',
    });
  });
});

describe('sendChatMessage', () => {
  it('sends a public message as the Gamemaster, reads it back and logs it', async () => {
    const { harness, foundry } = open();
    const answer = (await harness.query('sendChatMessage', { content: 'Welcome back' })) as Record<
      string,
      unknown
    >;
    expect(answer).toMatchObject({
      audience: 'everyone',
      whisperTo: [],
      speaker: 'Gamemaster',
      style: 'ooc',
    });
    const stored = foundry.collection('ChatMessage').get(String(answer['id']));
    expect(stored).toMatchObject({
      content: 'Welcome back',
      author: 'gm',
      style: 1,
      whisper: [],
      flags: { [MODULE_ID]: { createdByMcp: true } },
    });
    expect(harness.changeLog.list()[0]).toMatchObject({
      document: 'ChatMessages',
      action: 'create',
    });
  });

  it('speaks as an actor by exact name, in character', async () => {
    const { harness, foundry } = open();
    foundry.seed('Actor', { _id: 'hero', name: 'Hero' });
    const answer = (await harness.query('sendChatMessage', {
      content: 'For the realm!',
      speakerActor: 'Hero',
    })) as Record<string, unknown>;
    expect(foundry.collection('ChatMessage').get(String(answer['id']))).toMatchObject({
      style: 2,
      speaker: { actor: 'hero', token: null, alias: 'Hero' },
    });
  });

  it('speaks as a token by uuid or id', async () => {
    const { harness, foundry } = open();
    foundry.seed('Actor', { _id: 'hero', name: 'Hero' });
    foundry.seed('Scene', {
      _id: 's1',
      name: 'Cave',
      tokens: [{ _id: 'tok', name: 'Goblin', actorId: 'hero' }],
    });
    const byUuid = (await harness.query('sendChatMessage', {
      content: 'Grr',
      speakerToken: 'Scene.s1.Token.tok',
    })) as Record<string, unknown>;
    expect(foundry.collection('ChatMessage').get(String(byUuid['id']))).toMatchObject({
      speaker: { scene: 's1', actor: 'hero', token: 'tok', alias: 'Goblin' },
    });
    const byId = (await harness.query('sendChatMessage', {
      content: 'Grr',
      speakerToken: 'tok',
    })) as Record<string, unknown>;
    expect(byId['speaker']).toBe('Goblin');
    await expect(
      harness.query('sendChatMessage', { content: 'Grr', speakerToken: 'Goblin' })
    ).rejects.toMatchObject({ moduleCode: 'NOT_FOUND' });
  });

  it('whispers to exact names and to every Gamemaster', async () => {
    const { harness, foundry } = open();
    const answer = (await harness.query('sendChatMessage', {
      content: 'Psst',
      whisperTo: ['Alice'],
      whisperToGamemasters: true,
    })) as Record<string, unknown>;
    expect(answer['audience']).toBe('whisper');
    const stored = foundry.collection('ChatMessage').get(String(answer['id']));
    expect([...(stored?.['whisper'] as string[])].sort()).toEqual(['alice', 'gm', 'gm2']);
  });

  it('sends nothing for an unknown, partial, ambiguous or empty recipient list', async () => {
    const { harness, foundry } = open();
    await expect(
      harness.query('sendChatMessage', { content: 'x', whisperTo: ['Ali'] })
    ).rejects.toMatchObject({
      moduleCode: 'NOT_FOUND',
      message: expect.stringContaining('never in part'),
    });
    await expect(
      harness.query('sendChatMessage', { content: 'x', whisperTo: ['Bob'] })
    ).rejects.toMatchObject({
      moduleCode: 'AMBIGUOUS',
      message: expect.stringContaining('bob1, bob2'),
    });
    await expect(
      harness.query('sendChatMessage', { content: 'x', whisperTo: [] })
    ).rejects.toMatchObject({ moduleCode: 'INVALID_ARGUMENT' });
    expect(foundry.operations).toEqual([]);
  });

  it('sends nothing with the switch off', async () => {
    const { harness, foundry } = open(SWITCH_OFF);
    await expect(harness.query('sendChatMessage', { content: 'x' })).rejects.toMatchObject({
      moduleCode: 'WRITE_DISABLED',
    });
    expect(foundry.operations).toEqual([]);
  });

  it('fails when the stored recipients differ from the request', async () => {
    const { harness, foundry } = open();
    foundry.hooks.on('createChatMessage', (message: unknown) => {
      (message as Record<string, unknown>)['whisper'] = [];
    });
    await expect(
      harness.query('sendChatMessage', { content: 'Secret', whisperTo: ['alice'] })
    ).rejects.toMatchObject({
      moduleCode: 'WHISPER_MISMATCH',
      message: expect.stringContaining('asked for whisper to Alice, stored everyone'),
    });
  });
});

describe('updateChatMessage', () => {
  it('changes an own message and reads it back', async () => {
    const { harness, foundry } = open();
    seedMessages(foundry);
    const answer = await harness.query('updateChatMessage', {
      messageId: 'm3',
      content: 'Changed',
    });
    expect(answer).toMatchObject({ id: 'm3', changed: ['content'], warnings: [] });
    expect(foundry.collection('ChatMessage').get('m3')?.['content']).toBe('Changed');
    expect(harness.changeLog.list()[0]).toMatchObject({ action: 'update', undoable: true });
  });

  it('refuses messages of other users, unknown ids and empty changes', async () => {
    const { harness, foundry } = open();
    seedMessages(foundry);
    await expect(
      harness.query('updateChatMessage', { messageId: 'm1', content: 'x' })
    ).rejects.toMatchObject({ moduleCode: 'NOT_OWN', message: expect.stringContaining('"Alice"') });
    await expect(
      harness.query('updateChatMessage', { messageId: 'nope', content: 'x' })
    ).rejects.toMatchObject({ moduleCode: 'NOT_FOUND' });
    await expect(harness.query('updateChatMessage', { messageId: 'm3' })).rejects.toMatchObject({
      moduleCode: 'INVALID_ARGUMENT',
    });
    expect(foundry.operations).toEqual([]);
  });
});

describe('deleteChatMessage', () => {
  it('is refused by the core rule for kinds without a level', async () => {
    const { harness, foundry } = open();
    seedMessages(foundry);
    await expect(harness.query('deleteChatMessage', { messageId: 'm3' })).rejects.toMatchObject({
      moduleCode: 'PERMISSION_DENIED',
      message: expect.stringContaining('Chat messages have no level of their own'),
    });
    expect(foundry.collection('ChatMessage').get('m3')).toBeDefined();
  });

  it('names the switch first when it is off', async () => {
    const { harness, foundry } = open(SWITCH_OFF);
    seedMessages(foundry);
    await expect(harness.query('deleteChatMessage', { messageId: 'm3' })).rejects.toMatchObject({
      moduleCode: 'WRITE_DISABLED',
    });
  });

  it('deletes an own message and reads it back once permitted', async () => {
    const { foundry } = open();
    seedMessages(foundry);
    const log = new ChangeLog();
    const context: HandlerContext = {
      progress: () => undefined,
      recordChange: change => log.record(change),
      requireAccess: () => undefined,
      accessProblem: () => null,
    };
    await expect(deleteChatMessage.run({ messageId: 'm3' }, context)).resolves.toEqual({
      id: 'm3',
      deleted: true,
    });
    expect(foundry.collection('ChatMessage').get('m3')).toBeUndefined();
    expect(log.list()[0]).toMatchObject({ action: 'delete', undoable: true });
    await expect(deleteChatMessage.run({ messageId: 'm4' }, context)).rejects.toMatchObject({
      code: 'NOT_OWN',
    });
  });
});
