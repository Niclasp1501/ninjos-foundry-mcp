import { afterEach, describe, expect, it } from 'vitest';
import { ChangeLog } from '../common/change-log.js';
import { MODULE_ID } from '../common/constants.js';
import { FakeFoundry } from '../testing/fake-foundry.js';
import { QueryDispatcher } from './dispatcher.js';
import {
  ensureFolderPath,
  folderCreationAccess,
  folderPathOf,
  planFolderPath,
  splitFolderPath,
  type FolderPathOptions,
} from './folders.js';

let foundry: FakeFoundry | null = null;
afterEach(() => {
  foundry?.uninstall();
  foundry = null;
});

/** Run the helper inside a real dispatcher, so the late permission check is the real one. */
async function ensure(
  path: string | string[],
  options: FolderPathOptions & { flags?: Record<string, unknown> },
  settings: Record<string, unknown> = {}
) {
  const changeLog = new ChangeLog();
  const dispatcher = new QueryDispatcher({
    isGM: () => true,
    readSetting: key => settings[key],
    changeLog,
  });
  dispatcher.register('make', {
    access: { kind: 'write', document: 'RollTables', action: 'create' },
    run: (_data, context) => ensureFolderPath(path, { ...options, context, query: 'make' }),
  });
  const result = (await dispatcher.dispatch('make', {})) as Awaited<
    ReturnType<typeof ensureFolderPath>
  >;
  return { result, changeLog };
}

describe('splitFolderPath', () => {
  it('splits text at slashes, keeps a list as it is, and refuses an empty level', () => {
    expect(splitFolderPath(' Locations / Harbour ')).toEqual(['Locations', 'Harbour']);
    expect(splitFolderPath('')).toEqual([]);
    expect(splitFolderPath(['AC/DC', 'Songs'])).toEqual(['AC/DC', 'Songs']);
    expect(() => splitFolderPath('a//b')).toThrow(/empty level/);
  });
});

describe('ensureFolderPath', () => {
  it('finds the existing part, creates the rest with the flag, and logs each folder', async () => {
    foundry = new FakeFoundry().install();
    const places = foundry.seed('Folder', { name: 'Places', type: 'RollTable', folder: null });
    const { result, changeLog } = await ensure('Places/Travel/Roads', { type: 'RollTable' });

    expect(result.created.map(entry => entry.path)).toEqual([
      'Places/Travel',
      'Places/Travel/Roads',
    ]);
    const roads = foundry.collection('Folder').get(result.id as string);
    expect(roads?.['flags']).toEqual({
      [MODULE_ID]: {
        createdByMcp: true,
        mcpGenerated: true,
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      },
    });
    // One create per folder, no second write for the markers of the previous generation.
    expect(foundry.operations.map(o => `${o.action} ${o.documentName}`)).toEqual([
      'create Folder',
      'create Folder',
    ]);
    expect(folderPathOf(result.id as string)).toMatchObject({
      path: 'Places/Travel/Roads',
      complete: true,
    });
    expect(foundry.collection('Folder').get(result.created[0]!.id)?.['folder']).toBe(places.id);
    expect(changeLog.list({ document: 'Folders' })).toHaveLength(2);
  });

  it('adds the markers of a package, but never lets them replace the fixed ones', async () => {
    foundry = new FakeFoundry().install();
    const { result } = await ensure('Quests', {
      type: 'JournalEntry',
      flags: { questContext: 'The Lost Mine', createdByMcp: false, createdAt: 'yesterday' },
    });
    const flags = (
      foundry.collection('Folder').get(result.id as string)?.['flags'] as Record<
        string,
        Record<string, unknown>
      >
    )[MODULE_ID];
    expect(flags).toMatchObject({
      questContext: 'The Lost Mine',
      createdByMcp: true,
      mcpGenerated: true,
    });
    expect(Number.isNaN(Date.parse(String(flags?.['createdAt'])))).toBe(false);
  });

  it('creates nothing and asks for nothing when the whole path exists', async () => {
    foundry = new FakeFoundry().install();
    const top = foundry.seed('Folder', { name: 'Places', type: 'Scene', folder: null });
    const { result } = await ensure('Places', { type: 'Scene' }, { permFolders: 'read' });
    expect(result).toEqual({ id: top.id, path: 'Places', created: [] });
    expect(foundry.operations).toEqual([]);
  });

  it('refuses before the first write when folders may not be created', async () => {
    foundry = new FakeFoundry().install();
    await expect(ensure('New/Deeper', { type: 'Scene' }, { permFolders: 'read' })).rejects.toThrow(
      /^The folder "New" of "New\/Deeper" does not exist and would have to be created\. Creating folders/
    );
    expect(foundry.operations).toEqual([]);
  });

  it('names both folders when a level is ambiguous, and never picks one', async () => {
    foundry = new FakeFoundry().install();
    foundry.seed('Folder', { _id: 'f1', name: 'Places', type: 'Scene', folder: null });
    foundry.seed('Folder', { _id: 'f2', name: 'Places', type: 'Scene', folder: null });
    await expect(ensure('Places/Inn', { type: 'Scene' })).rejects.toMatchObject({
      code: 'AMBIGUOUS',
    });
    await expect(ensure('Places/Inn', { type: 'Scene' })).rejects.toThrow(/f1.*f2/);
    expect(foundry.operations).toEqual([]);
  });

  it('matches another case only when asked to and only when unique', async () => {
    foundry = new FakeFoundry().install();
    const top = foundry.seed('Folder', { name: 'Places', type: 'Scene', folder: null });
    expect(planFolderPath('places', { type: 'Scene' }).missing).toEqual(['places']);
    const plan = planFolderPath('places', { type: 'Scene', nameMatch: 'ignoreCaseWhenUnique' });
    expect(plan).toMatchObject({ existingId: top.id, missing: [] });
    expect(folderCreationAccess(plan)).toEqual([]);
    expect(folderCreationAccess(planFolderPath('Other', { type: 'Scene' }))).toEqual([
      { kind: 'write', document: 'Folders', action: 'create' },
    ]);
  });

  it('keeps folders of another type apart', async () => {
    foundry = new FakeFoundry().install();
    foundry.seed('Folder', { name: 'Places', type: 'JournalEntry', folder: null });
    const { result } = await ensure('Places', { type: 'Scene' });
    expect(result.created).toHaveLength(1);
  });

  it('says what was created before a folder that failed', async () => {
    foundry = new FakeFoundry().install();
    let count = 0;
    foundry.onWrite(operation => {
      if (operation.documentName === 'Folder' && ++count === 2) throw new Error('disk full');
    });
    await expect(ensure('A/B', { type: 'Scene' })).rejects.toThrow(
      /"A\/B" could not be created: disk full\. Created before it: "A"/
    );
  });
});
