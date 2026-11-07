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

describe('deleteMacro', () => {
  const PERM = `${MODULE_ID}.permMacros`;
  const players = [
    { id: 'gm', name: 'Gamemaster', isGM: true },
    { id: 'alice', name: 'Alice', hotbar: { '3': 'hello', '12': 'hello' } },
  ];

  it('is off by default and deletes nothing', async () => {
    const { harness, foundry } = open();
    seedMacros(foundry);
    await expect(harness.query('deleteMacro', { macroId: 'Sum' })).rejects.toMatchObject({
      moduleCode: 'PERMISSION_DENIED',
      message: expect.stringContaining('permMacros'),
    });
    expect(foundry.collection('Macro').get('sum')).toBeDefined();
  });

  it('is held by the write switch even with the level on', async () => {
    const { harness, foundry } = open({
      [PERM]: 'full',
      [`${MODULE_ID}.allowWriteOperations`]: false,
    });
    seedMacros(foundry);
    await expect(harness.query('deleteMacro', { macroId: 'Sum' })).rejects.toMatchObject({
      moduleCode: 'WRITE_DISABLED',
    });
    expect(foundry.collection('Macro').get('sum')).toBeDefined();
  });

  it('deletes with the level on, logs it, and undo recreates it with its id', async () => {
    const { harness, foundry } = open({ [PERM]: 'full' });
    seedMacros(foundry);
    const answer = (await harness.query('deleteMacro', { macroId: 'Sum' })) as Record<
      string,
      unknown
    >;
    expect(answer).toMatchObject({ id: 'sum', deleted: true, hotbars: [], warnings: [] });
    expect(foundry.collection('Macro').get('sum')).toBeUndefined();
    const entry = harness.changeLog.list().find(change => change.tool === 'delete-macro');
    expect(entry).toMatchObject({ document: 'Macros', action: 'delete' });

    await harness.query('undoChanges', { changeId: entry?.id });
    expect(foundry.collection('Macro').get('sum')).toMatchObject({
      name: 'Sum',
      type: 'script',
      command: 'return a + b;',
    });
  });

  it('asks before deleting a macro on a hotbar and deletes only with confirmHotbar', async () => {
    const { harness, foundry } = (setup = openChatTables({
      users: players,
      settings: { [PERM]: 'full' },
    }));
    seedMacros(foundry);
    const asked = (await harness.query('deleteMacro', { macroId: 'Hello' })) as Record<
      string,
      unknown
    >;
    expect(asked).toMatchObject({
      deleted: false,
      needsConfirmation: true,
      hotbars: [{ userId: 'alice', user: 'Alice', gamemaster: false, slots: [3, 12] }],
    });
    expect(String(asked['question'])).toContain('Alice (player) in slot 3, 12');
    expect(foundry.collection('Macro').get('hello')).toBeDefined();
    expect(harness.changeLog.list().some(change => change.tool === 'delete-macro')).toBe(false);

    const done = (await harness.query('deleteMacro', {
      macroId: 'Hello',
      confirmHotbar: true,
    })) as Record<string, unknown>;
    expect(done).toMatchObject({ deleted: true });
    expect(String((done['warnings'] as string[])[0])).toContain('now show empty');
    expect(foundry.collection('Macro').get('hello')).toBeUndefined();
  });

  it('reports a dry run without the level and deletes nothing', async () => {
    const { harness, foundry } = (setup = openChatTables({ users: players }));
    seedMacros(foundry);
    const answer = (await harness.query('deleteMacro', {
      macroId: 'hello',
      dryRun: true,
    })) as Record<string, unknown>;
    expect(answer).toMatchObject({ dryRun: true, allowed: false, needsConfirmation: true });
    expect(String((answer['refused'] as string[])[0])).toContain('permMacros');
    expect(foundry.collection('Macro').get('hello')).toBeDefined();
  });

  it('leaves macros in compendiums to delete-compendium-entries', async () => {
    const { harness } = (setup = openChatTables({
      settings: { [PERM]: 'full' },
      packs: [
        {
          id: 'world.tricks',
          documentName: 'Macro',
          label: 'Tricks',
          documents: [{ _id: 'pm', name: 'Packed', type: 'chat', command: 'hi' }],
        },
      ],
    }));
    await expect(harness.query('deleteMacro', { macroId: 'Packed' })).rejects.toMatchObject({
      moduleCode: 'IN_COMPENDIUM',
      message: expect.stringContaining('world.tricks'),
    });
    await expect(
      harness.query('deleteMacro', { macroId: 'Compendium.world.tricks.Macro.pm' })
    ).rejects.toMatchObject({ moduleCode: 'IN_COMPENDIUM' });
    await expect(harness.query('deleteMacro', { macroId: 'Nothing' })).rejects.toMatchObject({
      moduleCode: 'NOT_FOUND',
    });
  });
});
