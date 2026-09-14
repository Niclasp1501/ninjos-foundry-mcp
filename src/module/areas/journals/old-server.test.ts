/**
 * The new module as a server of the previous generation uses it: the query
 * names and data fields that server sends, and the answer fields it reads.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { FakeFoundry, type FakeFoundryOptions } from '../../../testing/fake-foundry.js';

let harness: AreaHarness | null = null;
afterEach(() => {
  harness?.close();
  harness = null;
});

const open = (options: FakeFoundryOptions = {}) => {
  harness = createAreaHarness({ foundry: new FakeFoundry(options) });
  const f = harness.foundry;
  f.seed('JournalEntry', {
    _id: 'quest',
    name: 'Main Quest',
    pages: [
      { _id: 'img', name: 'Map', type: 'image', src: 'maps/a.webp', sort: 100 },
      { _id: 'q1', name: 'Quest', type: 'text', text: { content: 'x'.repeat(2500) }, sort: 200 },
      { _id: 'q2', name: 'Notes', type: 'text', text: { content: '<p>n</p>' }, sort: 300 },
    ],
  });
  return { h: harness, f };
};

type Answer = Record<string, any>;

describe('reading, as an old server asks', () => {
  it('lists journals as a bare list with the page types the old search reads', async () => {
    const { h } = open();
    const list = (await h.query('listJournals', {})) as Answer[];
    expect(Array.isArray(list)).toBe(true);
    expect(list[0]).toMatchObject({
      id: 'quest',
      name: 'Main Quest',
      pageCount: 3,
      pages: [
        { id: 'img', type: 'image' },
        { id: 'q1', name: 'Quest', type: 'text' },
        { id: 'q2', type: 'text' },
      ],
    });
  });

  it('answers getJournalContent with the ten fields the old list-journals takes over', async () => {
    const { h } = open();
    const first = (await h.query('getJournalContent', {
      journalId: 'quest',
      offset: 0,
      maxChars: 1000,
    })) as Answer;
    expect(first).toMatchObject({
      content: 'x'.repeat(1000),
      contentLength: 2500,
      offset: 0,
      returned: 1000,
      hasMore: true,
      nextOffset: 1000,
      currentPage: { id: 'q1', name: 'Quest', type: 'text' },
      pageCount: 3,
    });
    expect(first['allPages']).toHaveLength(3);
    expect(first['note']).toMatch(/^TRUNCATED/);
    // The production quest tools read on until nextOffset stops.
    const next = (await h.query('getJournalContent', {
      journalId: 'quest',
      offset: first['nextOffset'],
      maxChars: 200_000,
    })) as Answer;
    expect(next).toMatchObject({ offset: 1000, returned: 1500, hasMore: false });
    expect(first['content'].length + next['content'].length).toBe(first['contentLength']);
  });

  it('answers getJournalPageContent without offset with the first chunk, and with name and contentLength', async () => {
    const { h } = open();
    await expect(
      h.query('getJournalPageContent', { journalId: 'quest', pageId: 'q2' })
    ).resolves.toMatchObject({ content: '<p>n</p>', contentLength: 8, name: 'Notes' });
    await expect(
      h.query('getJournalPageContent', { journalId: 'quest', pageId: 'q2', maxChars: 1000 })
    ).resolves.toMatchObject({ contentLength: 8, name: 'Notes' });
  });
});

describe('updateJournalContent, the old page write', () => {
  it('replaces the page named by pageId and answers success, pageId, pageName', async () => {
    const { h, f } = open();
    await expect(
      h.query('updateJournalContent', { journalId: 'quest', pageId: 'q2', content: '<p>new</p>' })
    ).resolves.toMatchObject({ success: true, pageId: 'q2', pageName: 'Notes' });
    expect(f.fromUuid('JournalEntry.quest.JournalEntryPage.q2')?.['text']).toMatchObject({
      content: '<p>new</p>',
    });
  });

  it('adds a page with newPageName, as the old journal-add-page sends it', async () => {
    const { h, f } = open();
    const answer = (await h.query('updateJournalContent', {
      journalId: 'quest',
      newPageName: 'Epilogue',
      content: '<p>end</p>',
    })) as Answer;
    expect(answer).toMatchObject({ success: true, pageName: 'Epilogue', created: true });
    expect(
      f.fromUuid(`JournalEntry.quest.JournalEntryPage.${answer['pageId']}`)?.['text']
    ).toMatchObject({ content: '<p>end</p>' });
    expect(h.changeLog.list()[0]).toMatchObject({ action: 'create', tool: 'journal-add-page' });
  });

  it('overwrites the first text page without pageId and newPageName, and says so with the state before', async () => {
    const { h, f } = open();
    const answer = (await h.query('updateJournalContent', {
      journalId: 'quest',
      content: '<p>quest v2</p>',
    })) as Answer;
    expect(answer).toMatchObject({
      success: true,
      pageId: 'q1',
      pageName: 'Quest',
      replacedFirstTextPage: true,
    });
    expect(answer['note']).toMatch(/first text page "Quest" \(q1\) was overwritten/);
    expect(f.fromUuid('JournalEntry.quest.JournalEntryPage.q1')?.['text']).toMatchObject({
      content: '<p>quest v2</p>',
    });
    expect(h.changeLog.list()[0]).toMatchObject({
      undoable: true,
      before: { 'text.content': 'x'.repeat(2500) },
    });
  });

  it('refuses empty content, an empty newPageName, and both pageId and newPageName, before writing', async () => {
    const { h, f } = open();
    await expect(
      h.query('updateJournalContent', { journalId: 'quest', pageId: 'q2', content: '' })
    ).rejects.toThrow(/content must not be empty/);
    await expect(
      h.query('updateJournalContent', { journalId: 'quest', newPageName: ' ', content: 'x' })
    ).rejects.toThrow(/newPageName must not be empty/);
    await expect(
      h.query('updateJournalContent', {
        journalId: 'quest',
        pageId: 'q2',
        newPageName: 'X',
        content: 'x',
      })
    ).rejects.toThrow(/not both/);
    expect(f.operations).toEqual([]);
  });

  it('needs the create level for newPageName and the update level otherwise', async () => {
    const { h, f } = open({ settings: { 'ninjos-foundry-mcp.allowWriteOperations': false } });
    await expect(
      h.query('updateJournalContent', { journalId: 'quest', newPageName: 'X', content: 'x' })
    ).rejects.toMatchObject({ moduleCode: 'WRITE_DISABLED' });
    expect(f.operations).toEqual([]);
  });
});

describe('the other journal queries, with the answer names of the previous generation', () => {
  it('creates a journal from pages with content instead of html', async () => {
    const { h, f } = open();
    const answer = (await h.query('createCleanJournal', {
      name: 'Chapter',
      pages: [{ name: 'A', content: '<p>a</p>' }],
    })) as Answer;
    expect(answer).toMatchObject({ success: true, name: 'Chapter', pageCount: 1 });
    expect(f.collection('JournalEntry').get(answer['id'])?.toObject()['pages']).toMatchObject([
      { name: 'A', text: { content: '<p>a</p>' } },
    ]);
    await expect(
      h.query('createCleanJournal', {
        name: 'Y',
        pages: [{ name: 'A', html: '<p>a</p>', content: '<p>b</p>' }],
      })
    ).rejects.toThrow(/html and content differ/);
  });

  it('marks a folder it creates the way both generations do', async () => {
    const { h, f } = open();
    const answer = (await h.query('createCleanJournal', {
      name: 'Chapter',
      folderName: 'Campaign',
      pages: [{ name: 'A', content: 'a' }],
    })) as Answer;
    const flags = f.collection('Folder').get(answer['folder'].id)?.['flags'] as Answer;
    expect(flags['ninjos-foundry-mcp']).toMatchObject({ createdByMcp: true, mcpGenerated: true });
    expect(new Date(flags['ninjos-foundry-mcp'].createdAt).toISOString()).toBe(
      flags['ninjos-foundry-mcp'].createdAt
    );
  });

  it('answers append, rename and the deletes with the fields the old server passes on', async () => {
    const { h } = open({ settings: { 'ninjos-foundry-mcp.permJournals': 'full' } });
    await expect(
      h.query('appendJournalPageContent', { journalId: 'quest', pageId: 'q2', html: '<p>+</p>' })
    ).resolves.toMatchObject({ success: true, pageId: 'q2', newLength: 16 });
    await expect(
      h.query('renameJournal', { journalId: 'quest', newName: 'Quest Log' })
    ).resolves.toMatchObject({ success: true, journalId: 'quest', name: 'Quest Log' });
    await expect(
      h.query('deleteJournalPage', { journalId: 'quest', pageId: 'img' })
    ).resolves.toMatchObject({ success: true, deletedPageId: 'img' });
    await expect(h.query('deleteJournalEntry', { journalId: 'quest' })).resolves.toMatchObject({
      success: true,
      deletedJournalId: 'quest',
    });
  });

  it('answers the path rewrite with the report names of the previous generation', async () => {
    const { h, f } = open();
    f.seed('Actor', { _id: 'a1', name: 'Bandit', img: 'Bilder/Token/bandit.png' });
    await expect(
      h.query('rewriteWorldPaths', { from: 'Bilder/Token', to: 'Bilder/Figuren', dryRun: true })
    ).resolves.toMatchObject({
      success: true,
      totalChanges: 1,
      documentsTouched: 1,
      byCollection: { actors: 1 },
      samples: [expect.stringContaining('Bilder/Figuren')],
      dryRun: true,
    });
  });
});
