/**
 * Undo from the query to the fake world and back into the log, through the
 * dispatcher with its permission gate.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { FakeFoundry } from '../../../testing/fake-foundry.js';
import { MODULE_AREAS } from '../index.js';
import { undoTestArea } from './testing.js';

let harness: AreaHarness | null = null;
afterEach(() => {
  harness?.close();
  harness = null;
});

function open(settings: Record<string, unknown> = {}) {
  harness = createAreaHarness({
    foundry: new FakeFoundry({ settings }),
    moduleAreas: [...MODULE_AREAS, undoTestArea],
  });
  return harness;
}

const FULL = { 'ninjos-foundry-mcp.permJournals': 'full' };

async function refusal(promise: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await promise;
  } catch (error) {
    return {
      code: String((error as { moduleCode?: unknown }).moduleCode),
      message: (error as Error).message,
    };
  }
  throw new Error('expected a refusal');
}

const journal = (h: AreaHarness) => h.foundry.game['journal'] as Map<string, { name: string }>;

const setSetting = (h: AreaHarness, key: string, value: unknown) =>
  (h.foundry.game['settings'] as { set(n: string, k: string, v: unknown): Promise<unknown> }).set(
    'ninjos-foundry-mcp',
    key,
    value
  );

describe('the change log of the dispatcher', () => {
  it('stamps every change of one call with the same call id and the user', async () => {
    const h = open();
    await h.query('testCreateAndRename', { name: 'Tavern' });
    const [renamed, created] = h.changeLog.list();
    expect(renamed?.callId).toBeDefined();
    expect(renamed?.callId).toBe(created?.callId);
    expect(renamed?.user).toEqual({ id: 'gm', name: 'Gamemaster' });
  });
});

describe('undoChanges', () => {
  it('restores the fields of an update, logs the undo, and undoing that entry redoes', async () => {
    const h = open();
    const { id } = (await h.query('testCreate', { name: 'Old' })) as { id: string };
    await h.query('testRename', { id, name: 'New' });
    const renameId = h.changeLog.list()[0]?.id as string;

    const undone = (await h.query('undoChanges', { changeId: renameId })) as {
      undone: Array<{ restoredBy: string }>;
    };
    expect(journal(h).get(id)?.name).toBe('Old');
    const restoration = h.changeLog.get(undone.undone[0]?.restoredBy as string);
    expect(restoration).toMatchObject({
      tool: 'undo-change',
      action: 'update',
      restores: { changeId: renameId, action: 'update' },
      before: { name: 'New' },
      after: { name: 'Old' },
    });
    expect(h.changeLog.get(renameId)?.undoneAt).toBeDefined();

    await h.query('undoChanges', { changeId: restoration?.id });
    expect(journal(h).get(id)?.name).toBe('New');
    expect(h.changeLog.get(renameId)?.undoneAt).toBeUndefined();
  });

  it('removes a created document with the create level only, since removing it restores the world', async () => {
    const h = open();
    const { id } = (await h.query('testCreate', { name: 'Draft' })) as { id: string };
    await h.query('undoChanges', {});
    expect(journal(h).has(id)).toBe(false);
    expect(h.changeLog.list()[0]).toMatchObject({
      action: 'delete',
      restores: { action: 'create' },
    });
  });

  it('refuses to remove a created document that changed since, and shows the difference', async () => {
    const h = open();
    const { id } = (await h.query('testCreate', { name: 'Draft' })) as { id: string };
    const createId = h.changeLog.list()[0]?.id as string;
    await (h.foundry.game['journal'] as Map<string, { update(c: object): Promise<unknown> }>)
      .get(id)
      ?.update({ name: 'Edited by hand' });
    const failed = await refusal(h.query('undoChanges', { changeId: createId, force: true }));
    expect(failed.code).toBe('CONFLICT');
    expect(failed.message).toContain('nothing was changed');
    expect(failed.message).toContain('name was "Draft" after the change, now "Edited by hand"');
    expect(journal(h).has(id)).toBe(true);

    await h.query('testRename', { id, name: 'Later' });
    const later = await refusal(h.query('undoChanges', { changeId: createId }));
    expect(later.message).toContain('(test-rename) touched');
  });

  it('reads a removal back when Foundry throws after deleting', async () => {
    const h = open();
    const { id } = (await h.query('testCreate', { name: 'Draft' })) as { id: string };
    h.foundry.hooks.on('deleteJournalEntry', () => {
      throw new TypeError("Cannot read properties of null (reading 'clipboard')");
    });
    const answer = (await h.query('undoChanges', {})) as {
      undone: Array<{ targets: Array<Record<string, unknown>> }>;
    };
    expect(journal(h).has(id)).toBe(false);
    expect(answer.undone[0]?.targets[0]).toMatchObject({ operation: 'remove' });
    expect(answer.undone[0]?.targets[0]?.['note']).toContain("reading 'clipboard'");
    expect(h.changeLog.list()[0]).toMatchObject({
      action: 'delete',
      restores: { action: 'create' },
    });
  });

  it('undoes a whole tool call newest first', async () => {
    const h = open();
    const { id } = (await h.query('testCreateAndRename', { name: 'Inn' })) as { id: string };
    const callId = h.changeLog.list()[0]?.callId;
    const answer = (await h.query('undoChanges', { callId })) as { undone: unknown[] };
    expect(answer.undone).toHaveLength(2);
    expect(journal(h).has(id)).toBe(false);
  });

  it('recreates a deleted document with its id and pages, only with the full level', async () => {
    const h = open();
    const { id } = (await h.query('testCreate', { name: 'Lore' })) as { id: string };
    await setSetting(h, 'permJournals', 'full');
    await h.query('testDelete', { id });
    const deleteId = h.changeLog.list()[0]?.id as string;

    await setSetting(h, 'permJournals', 'write');
    const denied = await refusal(h.query('undoChanges', { changeId: deleteId }));
    expect(denied.code).toBe('PERMISSION_DENIED');
    expect(journal(h).has(id)).toBe(false);

    await setSetting(h, 'permJournals', 'full');
    await h.query('undoChanges', { changeId: deleteId });
    const back = (
      h.foundry.game['journal'] as Map<string, { name: string; pages: Map<string, unknown> }>
    ).get(id);
    expect(back?.name).toBe('Lore');
    expect(back?.pages.size).toBe(1);
  });

  it('refuses entries whose effect cannot be taken back', async () => {
    const h = open();
    await h.query('testChat', {});
    const failed = await refusal(h.query('undoChanges', {}));
    expect(failed.code).toBe('NOT_REVERSIBLE');
    expect(failed.message).toContain('seen at the table');
  });

  it('restores changed fields only with force, and a dry run writes nothing', async () => {
    const h = open();
    const { id } = (await h.query('testCreate', { name: 'A' })) as { id: string };
    await h.query('testRename', { id, name: 'B' });
    const renameId = h.changeLog.list()[0]?.id as string;
    await (h.foundry.game['journal'] as Map<string, { update(c: object): Promise<unknown> }>)
      .get(id)
      ?.update({ name: 'C' });

    const writes = h.foundry.operations.length;
    const preview = (await h.query('undoChanges', { changeId: renameId, dryRun: true })) as {
      wouldUndo: boolean;
      refusals: string[];
    };
    expect(preview.wouldUndo).toBe(false);
    expect(preview.refusals[0]).toContain('now "C"');
    expect(h.foundry.operations.length).toBe(writes);

    expect((await refusal(h.query('undoChanges', { changeId: renameId }))).message).toContain(
      'force: true restores'
    );
    await h.query('undoChanges', { changeId: renameId, force: true });
    expect(journal(h).get(id)?.name).toBe('A');
  });

  it('asks the write switch before anything else is written', async () => {
    const h = open();
    const { id } = (await h.query('testCreate', { name: 'A' })) as { id: string };
    await setSetting(h, 'allowWriteOperations', false);
    expect((await refusal(h.query('undoChanges', {}))).code).toBe('WRITE_DISABLED');
    expect(journal(h).has(id)).toBe(true);
  });

  it('names a missing change and a call with nothing left', async () => {
    const h = open(FULL);
    expect((await refusal(h.query('undoChanges', { changeId: 'nope' }))).code).toBe('NOT_FOUND');
    expect((await refusal(h.query('undoChanges', {}))).code).toBe('NOTHING_TO_UNDO');
  });
});

describe('listChangeHistory and getConfirmationMode', () => {
  it('lists who, when, tool, documents and whether undo works', async () => {
    const h = open();
    await h.query('testCreate', { name: 'A' });
    await h.query('testChat', {});
    const answer = (await h.query('listChangeHistory', { limit: 5 })) as {
      total: number;
      entries: Array<Record<string, unknown>>;
    };
    expect(answer.total).toBe(2);
    expect(answer.entries[0]).toMatchObject({ reversible: false, kinds: ['ChatMessages'] });
    expect(answer.entries[1]).toMatchObject({
      tool: 'test-create',
      reversible: true,
      user: { name: 'Gamemaster' },
    });
    expect(
      ((await h.query('listChangeHistory', { tool: 'test-create' })) as { total: number }).total
    ).toBe(1);
  });

  it('reports the preview mode, off by default', async () => {
    expect(await open().query('getConfirmationMode', {})).toEqual({
      enabled: false,
      userId: 'gm',
      userName: 'Gamemaster',
    });
  });
});
