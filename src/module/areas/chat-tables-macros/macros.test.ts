import { afterEach, describe, expect, it } from 'vitest';
import { MODULE_ID } from '../../../common/constants.js';
import type { FakeFoundry } from '../../../testing/fake-foundry.js';
import { openChatTables, type ChatTablesSetup } from './testing.js';

let setup: ChatTablesSetup | null = null;
afterEach(() => {
  setup?.harness.close();
  setup = null;
});

const LEVEL = `${MODULE_ID}.macroExecution`;
const open = (settings: Record<string, unknown> = {}) => (setup = openChatTables({ settings }));

function seedMacros(foundry: FakeFoundry, script = 'return a + b;'): void {
  foundry.seed('Actor', { _id: 'hero', name: 'Hero' });
  foundry.seed('Macro', {
    _id: 'hello',
    name: 'Hello',
    type: 'chat',
    command: '/roll 1d20',
    author: 'gm',
  });
  foundry.seed('Macro', { _id: 'sum', name: 'Sum', type: 'script', command: script, author: 'gm' });
}

describe('listMacros', () => {
  it('lists with type, author, command and whether they can run', async () => {
    const { harness, foundry } = open({ [LEVEL]: 'chat' });
    seedMacros(foundry);
    const answer = (await harness.query('listMacros', { includeCommand: true })) as Record<
      string,
      unknown
    >;
    expect(answer['executionSetting']).toBe('chat');
    expect(answer['macros']).toEqual([
      expect.objectContaining({
        id: 'hello',
        type: 'chat',
        author: 'Gamemaster',
        runnable: true,
        command: '/roll 1d20',
      }),
      expect.objectContaining({ id: 'sum', type: 'script', runnable: false }),
    ]);
    const scripts = (await harness.query('listMacros', { type: 'script' })) as Record<
      string,
      unknown
    >;
    expect(scripts['macros']).toEqual([
      expect.not.objectContaining({ command: expect.anything() }),
    ]);
    const named = (await harness.query('listMacros', { nameContains: 'ELL' })) as {
      macros: unknown[];
    };
    expect(named.macros).toHaveLength(1);
  });
});

describe('createMacro', () => {
  it('creates a chat macro in a new folder and reads it back', async () => {
    const { harness, foundry } = open();
    const answer = (await harness.query('createMacro', {
      name: 'Greet',
      type: 'chat',
      command: 'Hello table',
      folderPath: 'Tools/Chat',
    })) as Record<string, unknown>;
    expect(answer).toMatchObject({
      name: 'Greet',
      type: 'chat',
      folderPath: 'Tools/Chat',
      warnings: [],
    });
    expect(foundry.collection('Macro').get(String(answer['id']))).toMatchObject({
      type: 'chat',
      command: 'Hello table',
      scope: 'global',
      folder: answer['folderId'],
    });
    expect(
      harness.changeLog
        .list()
        .some(entry => entry.document === 'Macros' && entry.action === 'create')
    ).toBe(true);
  });

  it('marks a script macro as able to do anything', async () => {
    const { harness } = open();
    const answer = (await harness.query('createMacro', {
      name: 'X',
      type: 'script',
      command: 'return 1;',
    })) as Record<string, unknown>;
    expect(answer['runnable']).toBe(false);
    expect(String((answer['warnings'] as string[])[0])).toContain('anything a Gamemaster can');
  });

  it('refuses a missing type or command', async () => {
    const { harness, foundry } = open();
    await expect(harness.query('createMacro', { name: 'X', command: 'y' })).rejects.toMatchObject({
      moduleCode: 'INVALID_ARGUMENT',
    });
    await expect(
      harness.query('createMacro', { name: 'X', type: 'chat', command: ' ' })
    ).rejects.toMatchObject({
      moduleCode: 'INVALID_ARGUMENT',
    });
    expect(foundry.operations).toEqual([]);
  });
});

describe('executeMacro', () => {
  it('is off by default', async () => {
    const { harness, foundry, fake } = open();
    seedMacros(foundry);
    await expect(harness.query('executeMacro', { macroId: 'Hello' })).rejects.toMatchObject({
      moduleCode: 'PERMISSION_DENIED',
      message: expect.stringContaining('"macroExecution"'),
    });
    expect(fake.processed).toEqual([]);
  });

  it('counts a damaged setting as off', async () => {
    const { harness, foundry } = open({ [LEVEL]: 'yes' });
    seedMacros(foundry);
    await expect(harness.query('executeMacro', { macroId: 'hello' })).rejects.toMatchObject({
      moduleCode: 'PERMISSION_DENIED',
    });
  });

  it('runs a chat macro at "chat", reads back its message and tells the Gamemaster', async () => {
    const { harness, foundry, fake } = open({ [LEVEL]: 'chat' });
    seedMacros(foundry);
    const answer = (await harness.query('executeMacro', {
      macroId: 'Hello',
      speakerActor: 'Hero',
    })) as Record<string, unknown>;
    expect(fake.processed).toEqual([
      {
        command: '/roll 1d20',
        options: { speaker: { scene: null, actor: 'hero', token: null, alias: 'Hero' } },
      },
    ]);
    expect(answer['messages']).toHaveLength(1);
    expect(foundry.notifications).toContainEqual({
      level: 'info',
      message: `${MODULE_ID}.chat-tables-macros.notify.chatMacroRun`,
    });
    expect(harness.changeLog.list()[0]).toMatchObject({
      document: 'Macros',
      action: 'other',
      undoable: false,
    });
  });

  it('refuses a script macro at "chat"', async () => {
    const { harness, foundry } = open({ [LEVEL]: 'chat' });
    seedMacros(foundry);
    await expect(harness.query('executeMacro', { macroId: 'Sum' })).rejects.toMatchObject({
      moduleCode: 'PERMISSION_DENIED',
      message: expect.stringContaining('is a script macro'),
    });
  });

  it('runs a script macro at "all" with args and speaker and returns its value', async () => {
    const { harness, foundry } = open({ [LEVEL]: 'all' });
    seedMacros(
      foundry,
      'return { sum: a + b, actor: actor?.name ?? null, speaker: speaker.alias };'
    );
    const answer = (await harness.query('executeMacro', {
      macroId: 'sum',
      speakerActor: 'hero',
      args: { a: 2, b: 3 },
    })) as Record<string, unknown>;
    expect(answer).toMatchObject({
      type: 'script',
      returnedType: 'object',
      returned: { sum: 5, actor: 'Hero', speaker: 'Hero' },
      messages: [],
    });
  });

  it('lists the chat messages a script posted', async () => {
    const { harness, foundry } = open({ [LEVEL]: 'all' });
    seedMacros(
      foundry,
      "await ChatMessage.create({ content: 'from script', author: game.user.id, whisper: ['gm'] });"
    );
    const answer = (await harness.query('executeMacro', { macroId: 'Sum' })) as Record<
      string,
      unknown
    >;
    expect(answer).toMatchObject({
      returnedType: 'undefined',
      messages: [{ whisperTo: ['Gamemaster'] }],
    });
  });

  it('reports the cause when a script fails or cannot be read', async () => {
    const failing = open({ [LEVEL]: 'all' });
    seedMacros(failing.foundry, "throw new Error('boom');");
    await expect(failing.harness.query('executeMacro', { macroId: 'Sum' })).rejects.toMatchObject({
      moduleCode: 'MACRO_FAILED',
      message: expect.stringContaining('boom'),
    });
    failing.harness.close();

    const broken = open({ [LEVEL]: 'all' });
    seedMacros(broken.foundry, 'return {');
    await expect(broken.harness.query('executeMacro', { macroId: 'Sum' })).rejects.toMatchObject({
      moduleCode: 'MACRO_FAILED',
      message: expect.stringContaining('could not be read'),
    });
  });

  it('names the switch first, and an unknown macro', async () => {
    const off = open({ [LEVEL]: 'all', [`${MODULE_ID}.allowWriteOperations`]: false });
    seedMacros(off.foundry);
    await expect(off.harness.query('executeMacro', { macroId: 'Sum' })).rejects.toMatchObject({
      moduleCode: 'WRITE_DISABLED',
    });
    off.harness.close();

    const { harness, foundry } = open({ [LEVEL]: 'all' });
    seedMacros(foundry);
    await expect(harness.query('executeMacro', { macroId: 'Su' })).rejects.toMatchObject({
      moduleCode: 'NOT_FOUND',
    });
  });
});
