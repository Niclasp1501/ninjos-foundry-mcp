import { afterEach, describe, expect, it } from 'vitest';
import { MODULE_ID } from '../../../common/constants.js';
import type { FakeDocument, FakeFoundry } from '../../../testing/fake-foundry.js';
import { DRAW_LIMITS } from './tables.js';
import { openChatTables, type ChatTablesSetup } from './testing.js';

let setup: ChatTablesSetup | null = null;
afterEach(() => {
  setup?.harness.close();
  setup = null;
});

const open = (settings: Record<string, unknown> = {}, totals: number[] = []) =>
  (setup = openChatTables({ settings }, totals));

const SWITCH_OFF = { [`${MODULE_ID}.allowWriteOperations`]: false };

function seedTable(foundry: FakeFoundry, replacement = true, drawn: string[] = []): FakeDocument {
  const entry = (id: string, text: string, range: [number, number], weight = 1, sort = 100) => ({
    _id: id,
    type: 'text',
    description: text,
    range,
    weight,
    drawn: drawn.includes(id),
    sort,
  });
  return foundry.seed('RollTable', {
    _id: 'loot',
    name: 'Loot',
    formula: '1d4',
    replacement,
    displayRoll: true,
    results: [
      entry('r1', 'Gold', [1, 1]),
      entry('r2', 'Sword', [2, 2], 1, 200),
      entry('r3', 'Rope', [3, 4], 2, 300),
    ],
  });
}

const result = (foundry: FakeFoundry, id: string) =>
  foundry.collection('RollTable').get('loot')?.getEmbeddedCollection('TableResult').get(id);

describe('getRollTable', () => {
  it('reads settings and entries by exact name', async () => {
    const { harness, foundry } = open();
    seedTable(foundry, true, ['r2']);
    const answer = (await harness.query('getRollTable', { tableId: 'Loot' })) as Record<
      string,
      unknown
    >;
    expect(answer).toMatchObject({
      id: 'loot',
      formula: '1d4',
      replacement: true,
      entries: 3,
      available: 2,
    });
    expect((answer['results'] as unknown[])[1]).toMatchObject({
      id: 'r2',
      text: 'Sword',
      range: [2, 2],
      drawn: true,
    });
    await expect(harness.query('getRollTable', { tableId: 'Lo' })).rejects.toMatchObject({
      moduleCode: 'NOT_FOUND',
    });
  });
});

describe('drawRollTable', () => {
  it('draws from a table with replacement as a read, even with the switch off', async () => {
    const { harness, foundry } = open(SWITCH_OFF, [2]);
    seedTable(foundry);
    const answer = (await harness.query('drawRollTable', { tableId: 'loot' })) as Record<
      string,
      unknown
    >;
    expect(answer).toMatchObject({ drawnMarked: false, available: 3, messages: [], warnings: [] });
    expect(answer['draws']).toMatchObject([{ total: 2, results: [{ id: 'r2', text: 'Sword' }] }]);
    expect(foundry.operations).toEqual([]);
  });

  it('marks drawn entries of a table without replacement and logs it', async () => {
    const { harness, foundry } = open({}, [1, 3]);
    seedTable(foundry, false);
    const answer = (await harness.query('drawRollTable', { tableId: 'loot', count: 2 })) as Record<
      string,
      unknown
    >;
    expect(answer).toMatchObject({ drawnMarked: true, available: 1 });
    expect(result(foundry, 'r1')?.['drawn']).toBe(true);
    expect(result(foundry, 'r3')?.['drawn']).toBe(true);
    expect(harness.changeLog.list()[0]).toMatchObject({
      document: 'RollTables',
      action: 'update',
      undoable: true,
    });
  });

  it('refuses more draws than entries are left, before rolling', async () => {
    const { harness, foundry, fake } = open({}, [1, 2, 3, 4]);
    seedTable(foundry, false);
    await expect(
      harness.query('drawRollTable', { tableId: 'loot', count: 4 })
    ).rejects.toMatchObject({
      moduleCode: 'NO_RESULTS_LEFT',
      message: expect.stringContaining('3 of 3 entries left'),
    });
    expect(foundry.operations).toEqual([]);
    expect(fake.totals).toHaveLength(4);
  });

  it('refuses a table whose entries are all drawn', async () => {
    const { harness, foundry } = open({}, [1]);
    seedTable(foundry, false, ['r1', 'r2', 'r3']);
    await expect(harness.query('drawRollTable', { tableId: 'loot' })).rejects.toMatchObject({
      moduleCode: 'NO_RESULTS_LEFT',
      message: expect.stringContaining('reset-roll-table'),
    });
  });

  it('draws without RollTable#roll and #draw, which hang with Dice So Nice and no canvas', async () => {
    const { harness, foundry, fake } = open({}, [2, 3]);
    fake.hang.roll = true;
    fake.hang.draw = true;
    seedTable(foundry, false);
    const answer = (await harness.query('drawRollTable', { tableId: 'loot', count: 2 })) as Record<
      string,
      unknown
    >;
    expect(answer['draws']).toMatchObject([
      { total: 2, formula: '1d4', results: [{ id: 'r2', text: 'Sword' }] },
      { total: 3, formula: '1d4', results: [{ id: 'r3', text: 'Rope' }] },
    ]);
    expect(answer).toMatchObject({ drawnMarked: true, available: 1, messages: [] });
    expect(result(foundry, 'r2')?.['drawn']).toBe(true);
    expect(result(foundry, 'r3')?.['drawn']).toBe(true);
    expect(fake.evaluations).toEqual([{ allowInteractive: false }, { allowInteractive: false }]);
  });

  it('rolls again when a table without replacement lands on a drawn entry, as Foundry does', async () => {
    const { harness, foundry } = open({}, [1, 3]);
    seedTable(foundry, false, ['r1']);
    const answer = (await harness.query('drawRollTable', { tableId: 'loot' })) as Record<
      string,
      unknown
    >;
    expect(answer['draws']).toMatchObject([{ total: 3, results: [{ id: 'r3' }] }]);
  });

  it('stops with a clear cause when a roll never finishes, before the bridge gives up', async () => {
    const { harness, foundry, fake } = open({}, [2]);
    fake.hang.evaluate = true;
    seedTable(foundry, false);
    const saved = DRAW_LIMITS.totalMs;
    DRAW_LIMITS.totalMs = 50;
    try {
      await expect(harness.query('drawRollTable', { tableId: 'loot' })).rejects.toMatchObject({
        moduleCode: 'TIMEOUT',
        message: expect.stringMatching(
          /did not finish.*within 0\.05 seconds.*Dice So Nice.*Nothing was marked/s
        ),
      });
    } finally {
      DRAW_LIMITS.totalMs = saved;
    }
    expect(foundry.operations).toEqual([]);
  });

  it('names the results already drawn when posting to the chat never finishes', async () => {
    const { harness, foundry, fake } = open({}, [2]);
    fake.hang.toMessage = true;
    seedTable(foundry);
    const saved = DRAW_LIMITS.totalMs;
    DRAW_LIMITS.totalMs = 50;
    try {
      await expect(
        harness.query('drawRollTable', { tableId: 'loot', chat: 'gm' })
      ).rejects.toMatchObject({
        moduleCode: 'TIMEOUT',
        message: expect.stringContaining('Sword'),
      });
    } finally {
      DRAW_LIMITS.totalMs = saved;
    }
  });

  it('needs the switch when the draw marks entries', async () => {
    const { harness, foundry } = open(SWITCH_OFF, [1]);
    seedTable(foundry, false);
    await expect(harness.query('drawRollTable', { tableId: 'loot' })).rejects.toMatchObject({
      moduleCode: 'WRITE_DISABLED',
    });
  });

  it('rolls without marking in mode roll', async () => {
    const { harness, foundry } = open({}, [1]);
    seedTable(foundry, false);
    const answer = (await harness.query('drawRollTable', {
      tableId: 'loot',
      mode: 'roll',
    })) as Record<string, unknown>;
    expect(answer).toMatchObject({ drawnMarked: false, available: 3 });
    expect(result(foundry, 'r1')?.['drawn']).toBe(false);
    expect(foundry.operations).toEqual([]);
  });

  it('posts to the Gamemasters only when asked, and needs the switch for it', async () => {
    const { harness, foundry } = open({}, [1, 2]);
    seedTable(foundry);
    const answer = (await harness.query('drawRollTable', {
      tableId: 'loot',
      chat: 'gm',
    })) as Record<string, unknown>;
    const [id] = answer['messages'] as string[];
    expect(foundry.collection('ChatMessage').get(String(id))?.['whisper']).toEqual(['gm']);
    expect(harness.changeLog.list()[0]).toMatchObject({
      document: 'ChatMessages',
      action: 'create',
    });

    const rolled = (await harness.query('drawRollTable', {
      tableId: 'loot',
      mode: 'roll',
      chat: 'public',
    })) as Record<string, unknown>;
    expect(rolled['messages']).toHaveLength(1);
  });

  it('refuses posting with the switch off', async () => {
    const { harness, foundry } = open(SWITCH_OFF, [1]);
    seedTable(foundry);
    await expect(
      harness.query('drawRollTable', { tableId: 'loot', chat: 'gm' })
    ).rejects.toMatchObject({
      moduleCode: 'WRITE_DISABLED',
    });
    expect(foundry.operations).toEqual([]);
  });

  it('fails when a message is visible to more users than asked for', async () => {
    const { harness, foundry } = open({}, [1]);
    seedTable(foundry);
    foundry.hooks.on('createChatMessage', (message: unknown) => {
      (message as Record<string, unknown>)['whisper'] = [];
    });
    await expect(
      harness.query('drawRollTable', { tableId: 'loot', chat: 'gm' })
    ).rejects.toMatchObject({
      moduleCode: 'VISIBILITY_MISMATCH',
      message: expect.stringContaining('Gold'),
    });
  });
});

describe('resetRollTable', () => {
  it('returns drawn entries and does nothing when none are drawn', async () => {
    const { harness, foundry } = open();
    seedTable(foundry, false, ['r1', 'r3']);
    await expect(harness.query('resetRollTable', { tableId: 'loot' })).resolves.toMatchObject({
      returned: 2,
      changed: true,
    });
    expect(result(foundry, 'r1')?.['drawn']).toBe(false);
    const writes = foundry.operations.length;
    await expect(harness.query('resetRollTable', { tableId: 'loot' })).resolves.toMatchObject({
      returned: 0,
      changed: false,
    });
    expect(foundry.operations).toHaveLength(writes);
  });
});

describe('updateRollTable', () => {
  it('changes the settings and reads them back', async () => {
    const { harness, foundry } = open();
    seedTable(foundry);
    const answer = (await harness.query('updateRollTable', {
      tableId: 'loot',
      name: 'Treasure',
      formula: '1d6',
      replacement: false,
    })) as Record<string, unknown>;
    expect(answer).toMatchObject({
      name: 'Treasure',
      changedSettings: ['name', 'formula', 'replacement'],
      replacement: false,
      formula: '1d6',
    });
    expect(answer['warnings']).toEqual(['The formula 1d6 can roll 5-6, where no entry is.']);
    expect(foundry.collection('RollTable').get('loot')).toMatchObject({
      name: 'Treasure',
      replacement: false,
    });
    expect(harness.changeLog.list()[0]).toMatchObject({
      document: 'RollTables',
      action: 'update',
      undoable: true,
    });
  });

  it('changes an entry and adds one after the highest range', async () => {
    const { harness, foundry } = open();
    seedTable(foundry);
    const answer = (await harness.query('updateRollTable', {
      tableId: 'loot',
      results: [{ id: 'r1', text: 'Much gold' }],
      addResults: [{ text: 'Map' }],
    })) as Record<string, unknown>;
    expect(answer['changedEntries']).toEqual(['r1']);
    const [added] = answer['addedEntries'] as string[];
    expect(result(foundry, 'r1')?.['description']).toBe('Much gold');
    expect(result(foundry, String(added))).toMatchObject({
      description: 'Map',
      range: [5, 5],
      weight: 1,
    });
    expect(String((answer['warnings'] as string[])[0])).toContain('can never roll');
  });

  it('refuses overlapping ranges and unknown entries before writing', async () => {
    const { harness, foundry } = open();
    seedTable(foundry);
    await expect(
      harness.query('updateRollTable', { tableId: 'loot', results: [{ id: 'r2', range: [1, 2] }] })
    ).rejects.toMatchObject({
      moduleCode: 'INVALID_ARGUMENT',
      message: expect.stringContaining('overlap'),
    });
    await expect(
      harness.query('updateRollTable', { tableId: 'loot', results: [{ id: 'r9', text: 'x' }] })
    ).rejects.toMatchObject({ moduleCode: 'NOT_FOUND' });
    await expect(harness.query('updateRollTable', { tableId: 'loot' })).rejects.toMatchObject({
      moduleCode: 'INVALID_ARGUMENT',
    });
    expect(foundry.operations).toEqual([]);
  });

  it('needs the full level to remove entries', async () => {
    const refused = open();
    seedTable(refused.foundry);
    await expect(
      refused.harness.query('updateRollTable', { tableId: 'loot', removeResults: ['r3'] })
    ).rejects.toMatchObject({ moduleCode: 'PERMISSION_DENIED' });
    refused.harness.close();

    const { harness, foundry } = open({ [`${MODULE_ID}.permRollTables`]: 'full' });
    seedTable(foundry);
    await expect(
      harness.query('updateRollTable', { tableId: 'loot', removeResults: ['r3'] })
    ).resolves.toMatchObject({ removedEntries: ['r3'], entries: 2 });
    expect(result(foundry, 'r3')).toBeUndefined();
  });
});
