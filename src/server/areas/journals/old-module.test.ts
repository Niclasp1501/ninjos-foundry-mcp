/**
 * The journal tools of the new server against a module of the previous
 * generation, built from the answer shapes of that module: bare
 * lists, chunked reading, the old page write, failures as normal values, and
 * no handler for the queries this version added.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ModuleArea } from '../../../module/areas.js';
import type { QueryHandler } from '../../../module/dispatcher.js';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';

type Rec = Record<string, any>;

let harness: AreaHarness | null = null;
afterEach(() => {
  harness?.close();
  harness = null;
});

interface OldPage {
  id: string;
  name: string;
  type: string;
  content: string;
}

/** A world as the old module sees it, and what it received. */
function oldModule(chunk = 50_000) {
  const journals = [
    {
      id: 'j1',
      name: 'Main Quest',
      pages: [
        { id: 'p1', name: 'Intro', type: 'text', content: 'Hello' },
        {
          id: 'p2',
          name: 'Long',
          type: 'text',
          content: `${'a'.repeat(120)}needle${'b'.repeat(40)}`,
        },
        { id: 'p3', name: 'Map', type: 'image', content: '' },
      ] as OldPage[],
    },
    {
      id: 'j2',
      name: 'Lore',
      pages: [{ id: 'l1', name: 'Broken', type: 'text', content: 'needle' }] as OldPage[],
    },
  ];
  const received: Array<{ query: string; data: Rec }> = [];
  const read = (run: (data: Rec) => unknown): QueryHandler => ({
    access: { kind: 'read' },
    run: data => {
      return run((data ?? {}) as Rec);
    },
  });
  const journal = (id: unknown) => journals.find(entry => entry.id === id);
  const sliceOf = (content: string, data: Rec) => {
    const offset = typeof data['offset'] === 'number' ? data['offset'] : 0;
    const max = Math.min(chunk, typeof data['maxChars'] === 'number' ? data['maxChars'] : chunk);
    const end = Math.min(content.length, offset + max);
    return {
      content: content.slice(offset, end),
      contentLength: content.length,
      offset,
      returned: end - offset,
      hasMore: end < content.length,
      ...(end < content.length ? { nextOffset: end } : {}),
    };
  };
  const log = (query: string, run: (data: Rec) => unknown) =>
    read(data => {
      received.push({ query, data });
      return run(data);
    });

  const area: ModuleArea = {
    id: 'old-module',
    queries: [
      {
        names: 'listJournals',
        handler: log('listJournals', () =>
          journals.map(entry => ({
            id: entry.id,
            name: entry.name,
            pageCount: entry.pages.length,
            pages: entry.pages.map(({ id, name, type }) => ({ id, name, type })),
          }))
        ),
      },
      {
        names: 'getJournalContent',
        handler: log('getJournalContent', data => {
          const entry = journal(data['journalId']);
          if (!entry) return null;
          const first = entry.pages.find(page => page.type === 'text');
          return {
            ...sliceOf(first?.content ?? '', data),
            currentPage: first ? { id: first.id, name: first.name } : null,
            allPages: entry.pages.map(({ id, name, type }) => ({ id, name, type })),
            pageCount: entry.pages.length,
          };
        }),
      },
      {
        names: 'getJournalPageContent',
        handler: log('getJournalPageContent', data => {
          const page = journal(data['journalId'])?.pages.find(entry => entry.id === data['pageId']);
          if (!page) return { error: `Page not found: ${String(data['pageId'])}` };
          if (page.id === 'l1') throw new Error('Failed to get page content: broken page');
          return { id: page.id, name: page.name, type: page.type, ...sliceOf(page.content, data) };
        }),
      },
      {
        names: 'updateJournalContent',
        handler: log('updateJournalContent', data => {
          const entry = journal(data['journalId']);
          if (!entry) return { error: 'Journal not found', success: false };
          if (typeof data['content'] !== 'string' || !data['content'])
            return { error: 'content is required', success: false };
          // The old rule: a name adds a page, a page id replaces it, neither overwrites the first text page.
          if (data['newPageName']) {
            const page = {
              id: `n${entry.pages.length}`,
              name: data['newPageName'] as string,
              type: 'text',
              content: data['content'] as string,
            };
            entry.pages.push(page);
            return { success: true, pageId: page.id, pageName: page.name };
          }
          const page =
            entry.pages.find(candidate => candidate.id === data['pageId']) ??
            entry.pages.find(candidate => candidate.type === 'text')!;
          page.content = data['content'] as string;
          return { success: true, pageId: page.id, pageName: page.name };
        }),
      },
      {
        names: 'createCleanJournal',
        handler: log('createCleanJournal', data => ({
          id: 'new1',
          name: data['name'],
          pageCount: (data['pages'] as unknown[]).length,
        })),
      },
      {
        names: 'renameJournal',
        handler: log('renameJournal', data => ({
          success: true,
          journalId: data['journalId'],
          name: data['newName'],
        })),
      },
      {
        names: 'rewriteWorldPaths',
        handler: log('rewriteWorldPaths', data => ({
          success: true,
          world: 'w',
          from: data['from'],
          to: data['to'],
          totalChanges: 3,
          documentsTouched: 2,
          byCollection: { scenes: 3 },
          samples: ['a -> b'],
          dryRun: true,
        })),
      },
      {
        names: 'deleteJournalEntry',
        handler: log('deleteJournalEntry', () => ({ error: 'Access denied', success: false })),
      },
    ],
    settings: [],
  };
  return { area, journals, received };
}

const textOf = (result: { content: Array<{ text?: string }> }) => result.content[0]?.text ?? '';
const json = (result: { content: Array<{ text?: string }> }) => JSON.parse(textOf(result)) as Rec;

describe('list-journals with an old module', () => {
  it('builds the list result from the bare list, filters quests on the server, and reads missing previews', async () => {
    const old = oldModule();
    harness = createAreaHarness({ moduleAreas: [old.area] });

    const all = json(await harness.call('list-journals', {}));
    expect(all).toMatchObject({ mode: 'list', total: 2, filtered: 2 });
    expect(all['journals'][0]).toMatchObject({ id: 'j1', pageCount: 3 });

    const quests = json(
      await harness.call('list-journals', { filterQuests: true, includeContent: true })
    );
    expect(quests).toMatchObject({
      total: 2,
      filtered: 1,
      journals: [{ id: 'j1', preview: 'Hello' }],
    });
    expect(old.received.filter(entry => entry.query === 'getJournalContent')).toEqual([
      { query: 'getJournalContent', data: { journalId: 'j1', maxChars: 1000 } },
    ]);
  });

  it('reads a journal and a page in the documented result, from the old field names', async () => {
    const old = oldModule();
    harness = createAreaHarness({ moduleAreas: [old.area] });
    expect(json(await harness.call('list-journals', { journalId: 'j1' }))).toMatchObject({
      mode: 'journal',
      journalId: 'j1',
      pageId: 'p1',
      pageName: 'Intro',
      pageCount: 3,
      content: 'Hello',
      hasMore: false,
    });
    expect(
      json(await harness.call('list-journals', { journalId: 'j1', pageId: 'p2', maxChars: 1000 }))
    ).toMatchObject({
      mode: 'page',
      pageId: 'p2',
      pageName: 'Long',
      pageType: 'text',
      contentLength: 166,
    });
    await expect(
      harness.call('list-journals', { journalId: 'j1', pageId: 'zz' })
    ).resolves.toMatchObject({
      isError: true,
      content: [{ text: 'Error: Page not found: zz' }],
    });
    await expect(harness.call('list-journals', { journalId: 'nope' })).resolves.toMatchObject({
      isError: true,
      content: [{ text: 'Error: Journal not found: nope' }],
    });
  });
});

describe('search-journals with an old module', () => {
  it('falls back to the list and reads every chunk of every text page, naming a page it could not read', async () => {
    const old = oldModule(100);
    harness = createAreaHarness({ moduleAreas: [old.area] });
    const result = json(await harness.call('search-journals', { searchQuery: 'NEEDLE' }));
    expect(result).toMatchObject({ searchQuery: 'NEEDLE', searchType: 'both', totalMatches: 1 });
    expect(result['results'][0]).toMatchObject({
      id: 'j1',
      matchType: ['content'],
      pages: [{ id: 'p2', name: 'Long' }],
    });
    // The match lies behind the first chunk of 100 characters.
    expect(
      old.received.filter(
        entry => entry.query === 'getJournalPageContent' && entry.data['pageId'] === 'p2'
      )
    ).toHaveLength(2);
    expect(result['unreadPages']).toEqual([
      {
        journalId: 'j2',
        pageId: 'l1',
        name: 'Broken',
        reason: expect.stringContaining('broken page'),
      },
    ]);
    expect(result['note']).toMatch(/1 text page/);
  });
});

describe('page writes with an old module', () => {
  it('replaces a page through updateJournalContent with pageId and checks the stored length', async () => {
    const old = oldModule();
    harness = createAreaHarness({ moduleAreas: [old.area] });
    const result = await harness.call('journal-set-page', {
      journalId: 'j1',
      pageId: 'p1',
      html: '<p>new</p>',
    });
    expect(json(result)).toEqual({ journalId: 'j1', pageId: 'p1', name: 'Intro', length: 10 });
    expect(old.received.find(entry => entry.query === 'updateJournalContent')?.data).toEqual({
      journalId: 'j1',
      pageId: 'p1',
      content: '<p>new</p>',
    });
  });

  it('adds a page through updateJournalContent with newPageName', async () => {
    const old = oldModule();
    harness = createAreaHarness({ moduleAreas: [old.area] });
    const result = json(
      await harness.call('journal-add-page', {
        journalId: 'j1',
        name: 'Epilogue',
        html: '<p>end</p>',
      })
    );
    expect(result).toEqual({ journalId: 'j1', pageId: 'n3', name: 'Epilogue', length: 10 });
    expect(old.journals[0]?.pages[0]?.content).toBe('Hello');
  });

  it('never lets an empty name reach the module, which would overwrite the first text page', async () => {
    const old = oldModule();
    harness = createAreaHarness({ moduleAreas: [old.area] });
    await expect(
      harness.call('journal-add-page', { journalId: 'j1', name: '  ', html: '<p>x</p>' })
    ).resolves.toMatchObject({
      isError: true,
      content: [{ text: 'Error: name must not be empty' }],
    });
    expect(old.received).toEqual([]);
    expect(old.journals[0]?.pages[0]?.content).toBe('Hello');
  });

  it('reports an answer naming another page as a possible overwrite', async () => {
    const old = oldModule();
    const update = old.area.queries?.find(query => query.names === 'updateJournalContent');
    const original = update!.handler.run;
    // A module that ignores newPageName, as the old one does when it arrives empty.
    update!.handler.run = (data, context) =>
      original({ ...(data as Rec), newPageName: undefined }, context);
    harness = createAreaHarness({ moduleAreas: [old.area] });
    const result = await harness.call('journal-add-page', {
      journalId: 'j1',
      name: 'Epilogue',
      html: 'x',
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(
      /did not add a page named "Epilogue".*page "Intro" \(p1\).*overwritten/
    );
  });
});

describe('other journal tools with an old module', () => {
  it('sends the page HTML under content as well, and keeps the result', async () => {
    const old = oldModule();
    harness = createAreaHarness({ moduleAreas: [old.area] });
    expect(
      json(
        await harness.call('journal-create', {
          name: 'C',
          pages: [{ name: 'A', html: '<p>a</p>' }],
        })
      )
    ).toEqual({ id: 'new1', name: 'C', pageCount: 1 });
    expect(old.received[0]?.data['pages']).toEqual([
      { name: 'A', html: '<p>a</p>', content: '<p>a</p>' },
    ]);
  });

  it('turns the old answer names into the names of this version', async () => {
    const old = oldModule();
    harness = createAreaHarness({ moduleAreas: [old.area] });
    expect(json(await harness.call('journal-rename', { journalId: 'j1', newName: 'N' }))).toEqual({
      id: 'j1',
      name: 'N',
    });
    expect(
      json(
        await harness.call('world-rewrite-paths', {
          from: 'Bilder/A',
          to: 'Bilder/B',
          dryRun: true,
        })
      )
    ).toEqual({
      worldId: 'w',
      from: 'Bilder/A',
      to: 'Bilder/B',
      changes: 3,
      documents: 2,
      byCollection: { scenes: 3 },
      examples: ['a -> b'],
      dryRun: true,
    });
  });

  it('turns a refusal sent as a normal value into a tool error with its cause', async () => {
    const old = oldModule();
    harness = createAreaHarness({ moduleAreas: [old.area] });
    await expect(harness.call('journal-delete', { journalId: 'j1' })).resolves.toMatchObject({
      isError: true,
      content: [{ text: 'Error: Access denied' }],
    });
  });
});

describe('journal tools with the new module', () => {
  it('filters quests on the server and shows no answer name of the previous generation', async () => {
    harness = createAreaHarness();
    harness.foundry.seed('JournalEntry', { _id: 'q', name: 'Side quest', pages: [] });
    harness.foundry.seed('JournalEntry', { _id: 'l', name: 'Lore', pages: [] });
    expect(json(await harness.call('list-journals', { filterQuests: true }))).toMatchObject({
      mode: 'list',
      total: 2,
      filtered: 1,
      journals: [{ id: 'q' }],
    });
    const renamed = json(
      await harness.call('journal-rename', { journalId: 'l', newName: 'World' })
    );
    expect(renamed).toEqual({ id: 'l', oldName: 'Lore', name: 'World' });
    const page = json(await harness.call('list-journals', { journalId: 'l' }));
    expect(page).not.toHaveProperty('allPages');
    expect(page).not.toHaveProperty('currentPage');
  });
});
