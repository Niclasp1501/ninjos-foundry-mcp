import { afterEach, describe, expect, it } from 'vitest';
import { MODULE_ID } from '../../../common/constants.js';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { FakeFoundry, type FakeFoundryOptions } from '../../../testing/fake-foundry.js';

let harness: AreaHarness | null = null;
afterEach(() => {
  harness?.close();
  harness = null;
});

const open = (options: FakeFoundryOptions = {}) =>
  (harness = createAreaHarness({ foundry: new FakeFoundry(options) }));

const six = ['a', 'b', 'c', 'd', 'e', 'f'].map(text => ({ text }));

describe('listRollTables', () => {
  it('lists id, name, formula, folder and number of results', async () => {
    const h = open();
    h.foundry.seed('Folder', { _id: 'f1', name: 'Travel', type: 'RollTable' });
    h.foundry.seed('RollTable', {
      _id: 't1',
      name: 'Weather',
      formula: '1d4',
      folder: 'f1',
      results: [{ range: [1, 2] }, { range: [3, 4] }],
    });
    await expect(h.query('listRollTables')).resolves.toEqual({
      tables: [{ id: 't1', name: 'Weather', formula: '1d4', folder: 'Travel', resultCount: 2 }],
    });
  });
});

describe('createRollTable', () => {
  it('creates a 1d6 table from six entries, reads it back and logs it', async () => {
    const h = open();
    const answer = (await h.query('createRollTable', { name: 'Loot', results: six })) as Record<
      string,
      unknown
    >;
    expect(answer).toMatchObject({
      name: 'Loot',
      formula: '1d6',
      formulaDerived: true,
      entries: 6,
      folderId: null,
      warnings: [],
    });
    const table = h.foundry.collection('RollTable').get(String(answer['id']));
    expect(table).toMatchObject({ replacement: true, displayRoll: true, formula: '1d6' });
    const results = table?.getEmbeddedCollection('TableResult').contents ?? [];
    expect(results.map(r => [r['description'], r['range'], r['weight'], r['type']])).toEqual([
      ['a', [1, 1], 1, 'text'],
      ['b', [2, 2], 1, 'text'],
      ['c', [3, 3], 1, 'text'],
      ['d', [4, 4], 1, 'text'],
      ['e', [5, 5], 1, 'text'],
      ['f', [6, 6], 1, 'text'],
    ]);
    expect(h.changeLog.list()[0]).toMatchObject({ document: 'RollTables', action: 'create' });
  });

  it('creates missing folders level by level and reuses existing ones', async () => {
    const h = open();
    h.foundry.seed('Folder', { _id: 'top', name: 'Tables', type: 'RollTable', folder: null });
    h.foundry.seed('Folder', { _id: 'other', name: 'Travel', type: 'Scene', folder: null });
    const answer = (await h.query('createRollTable', {
      name: 'Weather',
      folderPath: 'Tables/Travel',
      results: six,
    })) as Record<string, unknown>;
    expect(answer['foldersCreated']).toEqual(['Tables/Travel']);
    const created = h.foundry.collection('Folder').get(String(answer['folderId']));
    expect(created).toMatchObject({
      name: 'Travel',
      type: 'RollTable',
      folder: 'top',
      flags: { [MODULE_ID]: { createdByMcp: true, mcpGenerated: true } },
    });
    expect(
      Date.parse(
        String(
          (created?.['flags'] as Record<string, Record<string, unknown>>)[MODULE_ID]?.['createdAt']
        )
      )
    ).not.toBeNaN();
    expect(h.changeLog.list().map(e => e.document)).toEqual(['RollTables', 'Folders']);
  });

  it('needs the folder level to create a folder, and writes nothing without it', async () => {
    const h = open({ settings: { [`${MODULE_ID}.permFolders`]: 'read' } });
    await expect(
      h.query('createRollTable', { name: 'Weather', folderPath: 'New', results: six })
    ).rejects.toThrow(/folder "New".*would have to be created.*Creating folders is not permitted/);
    expect(h.foundry.operations).toEqual([]);
  });

  it('refuses two folders of the same name on one level', async () => {
    const h = open();
    h.foundry.seed('Folder', { _id: 'x1', name: 'Tables', type: 'RollTable', folder: null });
    h.foundry.seed('Folder', { _id: 'x2', name: 'Tables', type: 'RollTable', folder: null });
    await expect(
      h.query('createRollTable', { name: 'Weather', folderPath: 'Tables', results: six })
    ).rejects.toMatchObject({ moduleCode: 'AMBIGUOUS' });
  });

  it('refuses overlapping ranges before anything is written', async () => {
    const h = open();
    await expect(
      h.query('createRollTable', {
        name: 'Broken',
        folderPath: 'New',
        results: [
          { text: 'a', range: [1, 3] },
          { text: 'b', range: [3, 4] },
        ],
      })
    ).rejects.toMatchObject({ moduleCode: 'INVALID_ARGUMENTS' });
    expect(h.foundry.operations).toEqual([]);
  });

  it('creates a table with a gap and reports it', async () => {
    const h = open();
    const answer = (await h.query('createRollTable', {
      name: 'Gappy',
      formula: '1d8',
      results: [
        { text: 'a', range: [1, 4] },
        { text: 'b', range: [7, 8] },
      ],
    })) as { warnings: string[] };
    expect(answer.warnings).toEqual(['No entry covers 5-6; a roll there draws nothing.']);
  });

  it('is held by the switch and the roll table level', async () => {
    const off = open({ settings: { [`${MODULE_ID}.allowWriteOperations`]: false } });
    await expect(off.query('createRollTable', { name: 'x', results: six })).rejects.toMatchObject({
      moduleCode: 'WRITE_DISABLED',
    });
    off.close();
    const read = open({ settings: { [`${MODULE_ID}.permRollTables`]: 'read' } });
    await expect(read.query('createRollTable', { name: 'x', results: six })).rejects.toMatchObject({
      moduleCode: 'PERMISSION_DENIED',
    });
  });

  it('fails honestly when Foundry creates fewer entries than asked', async () => {
    const h = open();
    // Foundry dropping entries is imitated by a create that loses them on the way.
    const RollTable = (globalThis as Record<string, unknown>)['RollTable'] as {
      create(data: Record<string, unknown>): Promise<unknown>;
    };
    const original = RollTable.create;
    RollTable.create = data => original({ ...data, results: [] });
    try {
      await expect(h.query('createRollTable', { name: 'Short', results: six })).rejects.toThrow(
        /created with 0 of 6 entries/
      );
    } finally {
      RollTable.create = original;
    }
  });
});

describe('deleteRollTable', () => {
  it('deletes by id with the full level and refuses a name', async () => {
    const h = open({ settings: { [`${MODULE_ID}.permRollTables`]: 'full' } });
    h.foundry.seed('RollTable', { _id: 't1', name: 'Weather', results: [] });
    await expect(h.query('deleteRollTable', { tableId: 'Weather' })).rejects.toThrow(
      /Roll table "Weather" not found\. Deleting works by id only.*id t1/
    );
    await expect(h.query('deleteRollTable', { tableId: 't1' })).resolves.toEqual({
      id: 't1',
      name: 'Weather',
      deleted: true,
    });
    expect(h.foundry.collection('RollTable').size).toBe(0);
    expect(h.changeLog.list()[0]).toMatchObject({ action: 'delete', undoable: true });
  });

  it('is off by default', async () => {
    const h = open();
    h.foundry.seed('RollTable', { _id: 't1', name: 'Weather', results: [] });
    await expect(h.query('deleteRollTable', { tableId: 't1' })).rejects.toMatchObject({
      moduleCode: 'PERMISSION_DENIED',
    });
  });
});
