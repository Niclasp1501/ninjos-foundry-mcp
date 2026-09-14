/**
 * The tools of the chat-tables-macros area from the registry to the module handlers and back.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { MODULE_ID } from '../../../common/constants.js';
import { MODULE_AREAS } from '../../../module/areas/index.js';
import {
  openChatTables,
  type ChatTablesSetup,
} from '../../../module/areas/chat-tables-macros/testing.js';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { chatTablesMacrosArea } from './index.js';

let setup: ChatTablesSetup | null = null;
let plain: AreaHarness | null = null;
afterEach(() => {
  setup?.harness.close();
  plain?.close();
  setup = null;
  plain = null;
});

const text = (result: { content: Array<{ type: string; text?: string }> }) =>
  result.content[0]?.text ?? '';

describe('registration', () => {
  it('offers eleven tools with groups and annotations', async () => {
    setup = openChatTables();
    const own = new Set((chatTablesMacrosArea.tools ?? []).map(tool => tool.name));
    expect(own.size).toBe(11);
    const listed = (await setup.harness.tools.list()).filter(tool => own.has(tool.name));
    expect(listed).toHaveLength(11);
    const byName = new Map(listed.map(tool => [tool.name, tool.annotations]));
    expect(byName.get('list-chat-messages')).toMatchObject({ readOnlyHint: true });
    expect(byName.get('get-roll-table')).toMatchObject({ readOnlyHint: true });
    expect(byName.get('delete-chat-message')).toMatchObject({
      destructiveHint: true,
      idempotentHint: true,
    });
    expect(byName.get('execute-macro')).toMatchObject({
      destructiveHint: true,
      openWorldHint: true,
    });
    const groups = new Map((chatTablesMacrosArea.tools ?? []).map(tool => [tool.name, tool.group]));
    expect(groups.get('send-chat-message')).toBe('chat');
    expect(groups.get('draw-roll-table')).toBe('rolltables');
    expect(groups.get('create-macro')).toBe('macros');
  });
});

describe('tool texts', () => {
  it('sends and lists chat messages', async () => {
    setup = openChatTables({
      users: [
        { id: 'gm', name: 'Gamemaster', isGM: true },
        { id: 'alice', name: 'Alice' },
      ],
    });
    expect(
      text(await setup.harness.call('send-chat-message', { content: 'Hi', whisperTo: ['Alice'] }))
    ).toMatch(/^Chat message sent \(id \w+\) as Gamemaster, style ooc, whispered to Alice only\.$/);
    const listed = text(await setup.harness.call('list-chat-messages', {}));
    expect(listed).toContain('1 chat messages, newest first (the chat holds 1):');
    expect(listed).toContain(
      'Gamemaster (ooc, public; whisper to Alice; own):'.replace('public', 'whisper')
    );
    expect(listed).toContain('No older messages match.');
  });

  it('draws and reports where the result went', async () => {
    setup = openChatTables({}, [2]);
    setup.foundry.seed('RollTable', {
      _id: 't',
      name: 'Weather',
      formula: '1d2',
      replacement: true,
      results: [
        { _id: 'a', description: 'Sun', range: [1, 1] },
        { _id: 'b', description: 'Rain', range: [2, 2] },
      ],
    });
    expect(text(await setup.harness.call('draw-roll-table', { tableId: 'Weather' }))).toBe(
      [
        'Roll table "Weather" (id t), 1 time(s), drawn with replacement:',
        '1. 1d2 = 2: Rain [b]',
        'Entries left: 2 of 2.',
        'Not posted to the chat.',
      ].join('\n')
    );
    const invalid = await setup.harness.call('draw-roll-table', {
      tableId: 'Weather',
      chat: 'loud',
    });
    expect(text(invalid)).toContain('Invalid arguments for draw-roll-table');
  });

  it('names the refusal of running a macro', async () => {
    setup = openChatTables();
    setup.foundry.seed('Macro', { _id: 'm', name: 'M', type: 'chat', command: 'hi' });
    const result = await setup.harness.call('execute-macro', { macroId: 'M' });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(
      /^(Error: )?Failed to run macro: Running macros is not permitted\./
    );
  });

  it('runs a script macro and shows what it returned', async () => {
    setup = openChatTables({ settings: { [`${MODULE_ID}.macroExecution`]: 'all' } });
    setup.foundry.seed('Macro', {
      _id: 'm',
      name: 'Count',
      type: 'script',
      command: 'return [1, 2];',
    });
    expect(text(await setup.harness.call('execute-macro', { macroId: 'Count' }))).toBe(
      [
        'Macro "Count" (id m, script) ran.',
        'It returned (array): [\n  1,\n  2\n]',
        'It posted no chat message.',
      ].join('\n')
    );
  });

  it('says the module is too old when it lacks the query', async () => {
    plain = createAreaHarness({
      moduleAreas: MODULE_AREAS.filter(area => area.id !== 'chat-tables-macros'),
    });
    const result = await plain.call('list-macros', {});
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('does not know the query "listMacros"');
    expect(text(result)).toContain('Nothing was changed in the world.');
  });
});
