/**
 * Reading, writing and deleting journals, through the dispatcher with its
 * permission gate, on a fake world.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { FakeFoundry, type FakeFoundryOptions } from '../../../testing/fake-foundry.js';
import { withDataFiles } from './testing.js';

let harness: AreaHarness | null = null;
afterEach(() => {
  harness?.close();
  harness = null;
});

const open = (options: FakeFoundryOptions = {}) => {
  harness = createAreaHarness({ foundry: new FakeFoundry(options) });
  const f = harness.foundry;
  const lore = f.seed('JournalEntry', {
    _id: 'lore',
    name: 'Lore of the Coast',
    pages: [
      {
        _id: 'p1',
        name: 'Intro',
        type: 'text',
        text: { content: '<p>Hello world</p>' },
        sort: 100,
      },
      { _id: 'p2', name: 'Map', type: 'image', src: 'maps/coast.webp', sort: 200 },
      {
        _id: 'p3',
        name: 'Secrets',
        type: 'text',
        text: { content: '<p>The dragon sleeps</p>' },
        sort: 300,
      },
    ],
  });
  f.seed('JournalEntry', { _id: 'quest', name: 'Main Quest', pages: [] });
  return { h: harness, f, lore };
};

describe('listJournals, getJournalContent, getJournalPageContent', () => {
  it('lists every journal with its pages as a bare list, with a preview only when asked', async () => {
    const { h } = open();
    const all = (await h.query('listJournals', { includeContent: true })) as Array<
      Record<string, any>
    >;
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({
      id: 'lore',
      pageCount: 3,
      preview: '<p>Hello world</p>',
      pages: [{ id: 'p1', name: 'Intro', type: 'text' }, { id: 'p2' }, { id: 'p3' }],
    });
    expect(all[1]?.['preview']).toBe('');
    const plain = (await h.query('listJournals', {})) as Array<Record<string, any>>;
    expect(plain[0]).not.toHaveProperty('preview');
  });

  it('reads the first text page of a journal and names all pages', async () => {
    const { h } = open();
    const answer = (await h.query('getJournalContent', { journalId: 'lore' })) as Record<
      string,
      any
    >;
    expect(answer).toMatchObject({
      mode: 'journal',
      pageId: 'p1',
      content: '<p>Hello world</p>',
      hasMore: false,
    });
    expect(answer['note']).toContain('3 pages');
    expect(answer['note']).toContain('"Secrets" (p3, text)');
  });

  it('reads a page in chunks and says how to go on', async () => {
    const { h, lore } = open();
    await lore.updateEmbeddedDocuments('JournalEntryPage', [
      { _id: 'p3', 'text.content': 'x'.repeat(2500) },
    ]);
    const first = (await h.query('getJournalPageContent', {
      journalId: 'lore',
      pageId: 'p3',
      maxChars: 10,
    })) as Record<string, any>;
    expect(first).toMatchObject({
      mode: 'page',
      returned: 1000,
      hasMore: true,
      nextOffset: 1000,
      contentLength: 2500,
    });
    expect(first['note']).toBe(
      'TRUNCATED: showing characters 0-1000 of 2500. Read the next chunk with offset=1000.'
    );
    const last = (await h.query('getJournalPageContent', {
      journalId: 'lore',
      pageId: 'p3',
      offset: 2000,
      maxChars: 1000,
    })) as Record<string, any>;
    expect(last).toMatchObject({ returned: 500, hasMore: false });
    expect(last['nextOffset']).toBeUndefined();
    await expect(
      h.query('getJournalPageContent', { journalId: 'lore', pageId: 'p3', offset: 3000 })
    ).rejects.toThrow(/beyond the end/);
  });

  it('gives the source address as content of an image page, and names what is missing', async () => {
    const { h } = open();
    await expect(
      h.query('getJournalPageContent', { journalId: 'lore', pageId: 'p2' })
    ).resolves.toMatchObject({
      content: 'maps/coast.webp',
    });
    await expect(h.query('getJournalContent', { journalId: 'nope' })).rejects.toThrow(
      'Journal not found: nope'
    );
    await expect(
      h.query('getJournalPageContent', { journalId: 'lore', pageId: 'zz' })
    ).rejects.toThrow(/Page not found: zz/);
    await expect(h.query('getJournalContent', { journalId: 'quest' })).resolves.toMatchObject({
      content: '',
      pageId: null,
    });
  });
});

describe('searchJournals', () => {
  it('searches names and text pages in one request, ignoring case', async () => {
    const { h } = open();
    const answer = (await h.query('searchJournals', { searchQuery: 'DRAGON' })) as Record<
      string,
      any
    >;
    expect(answer).toMatchObject({ searchType: 'both', totalMatches: 1 });
    expect(answer['results'][0]).toMatchObject({
      id: 'lore',
      matchType: ['content'],
      pages: [{ id: 'p3', snippet: '...<p>The dragon sleeps</p>...' }],
    });
    const titles = (await h.query('searchJournals', {
      searchQuery: 'coast',
      searchType: 'title',
    })) as Record<string, any>;
    expect(titles['results']).toMatchObject([{ id: 'lore', matchType: ['title'], pages: [] }]);
    await expect(h.query('searchJournals', { searchQuery: ' ' })).rejects.toThrow(
      /must not be empty/
    );
  });
});

describe('createCleanJournal', () => {
  it('creates exactly the given pages outside any folder, visible only to Gamemasters', async () => {
    const { h, f } = open();
    const answer = (await h.query('createCleanJournal', {
      name: 'Chapter 1',
      pages: [
        { name: 'A', html: '<h2>A</h2>@UUID[Actor.x]' },
        { name: 'B', html: '' },
      ],
    })) as Record<string, any>;
    expect(answer).toMatchObject({ name: 'Chapter 1', pageCount: 2, folder: null });
    const created = f.collection('JournalEntry').get(answer['id'])!;
    expect(created['folder']).toBeUndefined();
    expect(created['ownership']).toEqual({ default: 0 });
    expect(created.toObject()['pages']).toMatchObject([
      { name: 'A', type: 'text', text: { content: '<h2>A</h2>@UUID[Actor.x]' } },
      { name: 'B', text: { content: '' } },
    ]);
    expect(h.changeLog.list()[0]).toMatchObject({ action: 'create', tool: 'journal-create' });
    expect(f.collection('Folder').size).toBe(0);
  });

  it('uses an existing journal folder, creates a missing one, and checks the folder level for that', async () => {
    const { h, f } = open();
    f.seed('Folder', { _id: 'fa', name: 'Actors', type: 'Actor' });
    f.seed('Folder', { _id: 'fj', name: 'Lore', type: 'JournalEntry' });
    await expect(
      h.query('createCleanJournal', {
        name: 'X',
        folderName: 'Lore',
        pages: [{ name: 'p', html: '' }],
      })
    ).resolves.toMatchObject({
      folder: { id: 'fj', created: false },
    });
    const made = (await h.query('createCleanJournal', {
      name: 'Y',
      folderName: 'Actors',
      pages: [{ name: 'p', html: '' }],
    })) as Record<string, any>;
    expect(made['folder']).toMatchObject({ name: 'Actors', created: true });
    expect(f.collection('Folder').get(made['folder'].id)?.['type']).toBe('JournalEntry');
    harness?.close();

    const denied = open({ settings: { 'ninjos-foundry-mcp.permFolders': 'read' } });
    await expect(
      denied.h.query('createCleanJournal', {
        name: 'Z',
        folderName: 'New',
        pages: [{ name: 'p', html: '' }],
      })
    ).rejects.toMatchObject({ moduleCode: 'PERMISSION_DENIED' });
    expect(denied.f.operations).toEqual([]);
  });

  it('refuses an empty page list and a page without a name', async () => {
    const { h } = open();
    await expect(h.query('createCleanJournal', { name: 'X', pages: [] })).rejects.toThrow(
      /at least one page/
    );
    await expect(
      h.query('createCleanJournal', { name: 'X', pages: [{ html: '' }] })
    ).rejects.toThrow('pages[0]: name is required');
  });

  it('does nothing with the write switch off or the journal level on read', async () => {
    const off = open({ settings: { 'ninjos-foundry-mcp.allowWriteOperations': false } });
    await expect(
      off.h.query('createCleanJournal', { name: 'X', pages: [{ name: 'a', html: '' }] })
    ).rejects.toMatchObject({
      moduleCode: 'WRITE_DISABLED',
    });
    harness?.close();
    const read = open({ settings: { 'ninjos-foundry-mcp.permJournals': 'read' } });
    await expect(
      read.h.query('setJournalPage', { journalId: 'lore', pageId: 'p1', html: 'x' })
    ).rejects.toMatchObject({
      moduleCode: 'PERMISSION_DENIED',
    });
    expect(read.f.operations).toEqual([]);
  });

  it('reports a write that does not read back as it was sent', async () => {
    const { h, f } = open();
    // Foundry cleaning the stored markup, as it may do with scripts.
    const page = f
      .collection('JournalEntry')
      .get('lore')!
      .getEmbeddedCollection('JournalEntryPage')
      .get('p1')!;
    const original = page.update.bind(page);
    page.update = async changes => original({ ...changes, 'text.content': '<p>cleaned</p>' });
    await expect(
      h.query('setJournalPage', {
        journalId: 'lore',
        pageId: 'p1',
        html: '<p>x</p><script>1</script>',
      })
    ).rejects.toMatchObject({
      moduleCode: 'VERIFY_FAILED',
    });
  });
});

describe('page writes', () => {
  it('replaces a text page and refuses other page types', async () => {
    const { h, f } = open();
    await expect(
      h.query('setJournalPage', { journalId: 'lore', pageId: 'p1', html: '<p>new</p>' })
    ).resolves.toMatchObject({
      pageId: 'p1',
      name: 'Intro',
    });
    expect(f.fromUuid('JournalEntry.lore.JournalEntryPage.p1')?.['text']).toEqual({
      content: '<p>new</p>',
    });
    expect(h.changeLog.list()[0]).toMatchObject({
      undoable: true,
      before: { 'text.content': '<p>Hello world</p>' },
    });
    await expect(
      h.query('setJournalPage', { journalId: 'lore', pageId: 'p2', html: 'x' })
    ).rejects.toThrow(/image page/);
  });

  it('adds a page at the end and appends to a text page', async () => {
    const { h, f } = open();
    const added = (await h.query('addJournalPage', {
      journalId: 'lore',
      name: 'More',
      html: '<p>1</p>',
    })) as Record<string, any>;
    const page = f.fromUuid(`JournalEntry.lore.JournalEntryPage.${added['pageId']}`)!;
    expect(page['sort']).toBe(300 + 100_000);
    await expect(
      h.query('appendJournalPageContent', {
        journalId: 'lore',
        pageId: added['pageId'],
        html: '<p>2</p>',
      })
    ).resolves.toMatchObject({
      length: 16,
    });
    expect(page['text']).toMatchObject({ content: '<p>1</p><p>2</p>' });
    await expect(
      h.query('appendJournalPageContent', { journalId: 'lore', pageId: 'p2', html: 'x' })
    ).rejects.toThrow(/Only text pages can be appended to/);
  });

  it('fills a page from a file in the data directory', async () => {
    const { h, f } = open();
    const requests: string[] = [];
    withDataFiles(
      f,
      { 'Bilder/Kap 2.html': '<h1>Two</h1>', 'leer.html': '  \n', 'kaputt.html': 500 },
      requests
    );

    await expect(
      h.query('setJournalPageFromFile', {
        journalId: 'lore',
        path: '/Bilder/Kap 2.html',
        pageId: 'p1',
      })
    ).resolves.toMatchObject({
      pageId: 'p1',
      created: false,
      length: 12,
    });
    expect(requests).toEqual(['/Bilder/Kap%202.html']);
    const created = (await h.query('setJournalPageFromFile', {
      journalId: 'lore',
      path: 'Bilder/Kap 2.html',
    })) as Record<string, any>;
    expect(created).toMatchObject({ created: true, pageName: 'Kap 2.html' });

    await expect(
      h.query('setJournalPageFromFile', { journalId: 'lore', path: 'x.html', pageId: 'gone' })
    ).rejects.toThrow(/Page not found: gone/);
    expect(requests).toHaveLength(2);
    await expect(
      h.query('setJournalPageFromFile', { journalId: 'lore', path: 'missing.html' })
    ).rejects.toThrow(
      'Could not read missing.html from the Foundry data directory: HTTP 404 Not Found'
    );
    await expect(
      h.query('setJournalPageFromFile', { journalId: 'lore', path: 'kaputt.html' })
    ).rejects.toThrow(/HTTP 500/);
    await expect(
      h.query('setJournalPageFromFile', { journalId: 'lore', path: 'leer.html' })
    ).rejects.toThrow('File leer.html is empty');
    await expect(
      h.query('setJournalPageFromFile', { journalId: 'lore', path: '../secret.html' })
    ).rejects.toThrow(/inside the Foundry data directory/);
  });

  it('renames a journal', async () => {
    const { h, f } = open();
    await expect(
      h.query('renameJournal', { journalId: 'lore', newName: ' Coast ' })
    ).resolves.toEqual({
      success: true,
      id: 'lore',
      journalId: 'lore',
      oldName: 'Lore of the Coast',
      name: 'Coast',
    });
    expect(f.collection('JournalEntry').get('lore')?.['name']).toBe('Coast');
  });
});

describe('deleting', () => {
  it('is refused at the default level, and names the setting', async () => {
    const { h, f } = open();
    await expect(h.query('deleteJournalPage', { journalId: 'lore', pageId: 'p1' })).rejects.toThrow(
      /permJournals/
    );
    await expect(h.query('deleteJournalEntry', { journalId: 'lore' })).rejects.toMatchObject({
      moduleCode: 'PERMISSION_DENIED',
    });
    expect(f.operations).toEqual([]);
  });

  it('deletes a page and a journal at the full level, with the state before', async () => {
    const { h, f } = open({ settings: { 'ninjos-foundry-mcp.permJournals': 'full' } });
    await expect(
      h.query('deleteJournalPage', { journalId: 'lore', pageId: 'p1' })
    ).resolves.toEqual({
      success: true,
      journalId: 'lore',
      pageId: 'p1',
      name: 'Intro',
      deletedPageId: 'p1',
    });
    await expect(h.query('deleteJournalEntry', { journalId: 'lore' })).resolves.toMatchObject({
      name: 'Lore of the Coast',
      deletedPages: 2,
    });
    expect(f.collection('JournalEntry').has('lore')).toBe(false);
    expect(h.changeLog.list()[0]).toMatchObject({ action: 'delete', undoable: true });
  });
});
