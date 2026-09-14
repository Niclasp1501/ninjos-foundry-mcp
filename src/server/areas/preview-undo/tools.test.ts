/**
 * list-changes and undo-change from the tool registry to the module and back.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { MODULE_AREAS } from '../../../module/areas/index.js';
import { undoTestArea } from '../../../module/areas/preview-undo/testing.js';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { previewUndoArea } from './index.js';
import { formatHistory, formatUndo } from './tools.js';

let harness: AreaHarness | null = null;
afterEach(() => {
  harness?.close();
  harness = null;
});

const open = () => (harness = createAreaHarness({ moduleAreas: [...MODULE_AREAS, undoTestArea] }));
const text = (result: { content: Array<{ text?: string }> }) => result.content[0]?.text ?? '';

describe('the tools of the preview-undo area', () => {
  it('are listed in the group history with honest annotations', async () => {
    const listed = await open().tools.list();
    const byName = new Map(listed.map(tool => [tool.name, tool.annotations]));
    expect(byName.get('list-changes')).toMatchObject({ readOnlyHint: true });
    expect(byName.get('undo-change')).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    const own = previewUndoArea.tools ?? [];
    expect(own.map(tool => tool.group)).toEqual(['history', 'history']);
    for (const tool of own) expect(tool.description).not.toMatch(/[–—]/);
  });

  it('lists a change with its call and undoes it by the model', async () => {
    const h = open();
    const { id } = (await h.query('testCreate', { name: 'Cellar' })) as { id: string };
    const listing = text(await h.call('list-changes', { limit: 3 }));
    expect(listing).toContain('1 of 1 matching changes, newest first:');
    expect(listing).toContain('by Gamemaster, call call-');
    expect(listing).toContain('test-create: create Journals; "Cellar" (JournalEntry.');
    expect(listing).toContain('reversible');

    const preview = text(await h.call('undo-change', { dryRun: true }));
    expect(preview).toContain('Dry run: the undo would run. Nothing was changed.');
    expect(preview).toContain('remove "Cellar"');

    const done = await h.call('undo-change', {});
    expect(done.isError).toBeUndefined();
    expect(text(done)).toContain('Undid 1 change(s), newest first, each read back:');
    expect(text(done)).toContain('undo that entry to redo');
    expect((h.foundry.game['journal'] as Map<string, unknown>).has(id)).toBe(false);
  });

  it('passes the refusal of the module on as a tool error with its cause', async () => {
    const h = open();
    await h.query('testChat', {});
    const result = await h.call('undo-change', {});
    expect(result.isError).toBe(true);
    expect(text(result)).toContain(
      'Failed to undo the changes: Undo refused, nothing was changed.'
    );
  });
});

describe('formatting', () => {
  it('says so when nothing matches, and shows unknown shapes', () => {
    expect(formatHistory({ total: 0, entries: [], note: 'Log note.' })).toBe(
      'No change matches. Log note.'
    );
    expect(formatUndo('x')).toContain('unknown shape');
  });
});
