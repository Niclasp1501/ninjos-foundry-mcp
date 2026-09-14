/**
 * Reading journals: the list, one journal, one page, in chunks; and the
 * search, which runs here in the browser instead of fetching every page over
 * the bridge.
 */
import type { QueryHandler } from '../../dispatcher.js';
import { requireWorld } from '../../world-ready.js';
import {
  argsOf,
  folderIdOf,
  getJournal,
  getPage,
  isTextPage,
  optionalBoolean,
  optionalNumber,
  optionalText,
  orderedPages,
  pageHtml,
  requiredText,
} from './common.js';
import { QueryError } from '../../dispatcher.js';

export const DEFAULT_MAX_CHARS = 50_000;
export const MIN_MAX_CHARS = 1_000;
export const MAX_MAX_CHARS = 200_000;
const PREVIEW_CHARS = 150;

interface Chunk {
  content: string;
  contentLength: number;
  offset: number;
  returned: number;
  hasMore: boolean;
  nextOffset?: number;
  note?: string;
}

/** One chunk of a content, with the fields that say how to read on. */
export function chunkOf(content: string, offsetArg?: number, maxCharsArg?: number): Chunk {
  const maxChars = Math.floor(
    Math.min(MAX_MAX_CHARS, Math.max(MIN_MAX_CHARS, maxCharsArg ?? DEFAULT_MAX_CHARS))
  );
  const offset = Math.floor(offsetArg ?? 0);
  if (offset < 0)
    throw new QueryError('INVALID_ARGUMENT', `offset must not be negative, got ${offset}`);
  if (offset > content.length) {
    throw new QueryError(
      'INVALID_ARGUMENT',
      `offset ${offset} is beyond the end of the content, which has ${content.length} characters`
    );
  }
  const end = Math.min(content.length, offset + maxChars);
  const chunk: Chunk = {
    content: content.slice(offset, end),
    contentLength: content.length,
    offset,
    returned: end - offset,
    hasMore: end < content.length,
  };
  if (chunk.hasMore) {
    chunk.nextOffset = end;
    chunk.note = `TRUNCATED: showing characters ${offset}-${end} of ${content.length}. Read the next chunk with offset=${end}.`;
  }
  return chunk;
}

function pageSummary(page: FoundryJournalsPage) {
  return { id: page.id, name: page.name, type: page.type };
}

/** What a page holds: the HTML of a text page, the source address of any other page. */
function contentOf(page: FoundryJournalsPage): string {
  if (isTextPage(page)) return pageHtml(page);
  return typeof page.src === 'string' ? page.src : '';
}

function joinNotes(...notes: Array<string | undefined>): string | undefined {
  const present = notes.filter((note): note is string => !!note);
  return present.length ? present.join(' | ') : undefined;
}

function withNote<T extends { note?: string }>(target: T, note: string | undefined): T {
  if (note) target.note = note;
  else delete target.note;
  return target;
}

/**
 * Every journal with its pages, as a bare list: the form a server of the
 * previous generation reads. Filtering quests is the
 * server's work, as it was. `includeContent` adds `preview`, which an old
 * module does not know; the new server then asks for each journal instead.
 */
export const listJournals: QueryHandler = {
  access: { kind: 'read' },
  run: data => {
    requireWorld();
    const args = argsOf(data);
    const includeContent = optionalBoolean(args, 'includeContent') ?? false;
    return (game.journal.contents as FoundryJournalsEntry[]).map(journal => {
      const pages = orderedPages(journal);
      const folderId = folderIdOf(journal);
      const entry: Record<string, unknown> = {
        id: journal.id,
        name: journal.name,
        type: 'JournalEntry',
        folder: folderId ? (game.folders.get(folderId)?.name ?? folderId) : null,
        pageCount: pages.length,
        pages: pages.map(pageSummary),
      };
      if (includeContent) {
        const first = pages.find(isTextPage);
        entry['preview'] = first ? pageHtml(first).slice(0, PREVIEW_CHARS) : '';
      }
      return entry;
    });
  },
};

function chunkArgs(args: Record<string, unknown>) {
  return { offset: optionalNumber(args, 'offset'), maxChars: optionalNumber(args, 'maxChars') };
}

/**
 * The first text page of a journal, one chunk of it, and all its pages.
 * `currentPage`, `allPages` and `pageCount` are the names an old server takes over.
 */
export const getJournalContent: QueryHandler = {
  access: { kind: 'read' },
  run: data => {
    requireWorld();
    const args = argsOf(data);
    const { offset, maxChars } = chunkArgs(args);
    const journal = getJournal(requiredText(args, 'journalId'));
    const pages = orderedPages(journal);
    const first = pages.find(isTextPage);
    const chunk = chunkOf(first ? pageHtml(first) : '', offset, maxChars);
    const pagesNote =
      pages.length > 1
        ? `This journal has ${pages.length} pages: ${pages
            .map(page => `"${page.name}" (${page.id}, ${page.type})`)
            .join(', ')}. Read any of them with journalId and pageId.`
        : undefined;
    const noTextNote = first ? undefined : 'This journal has no text page, so there is no content.';
    const summaries = pages.map(pageSummary);
    return withNote(
      {
        mode: 'journal',
        journalId: journal.id,
        journalName: journal.name,
        pageId: first?.id ?? null,
        pageName: first?.name ?? null,
        pages: summaries,
        ...chunk,
        currentPage: first ? pageSummary(first) : null,
        allPages: summaries,
        pageCount: pages.length,
      },
      joinNotes(chunk.note, pagesNote, noTextNote)
    );
  },
};

/** One chunk of one page. `id`, `name` and `type` repeat the page for an old server. */
export const getJournalPageContent: QueryHandler = {
  access: { kind: 'read' },
  run: data => {
    requireWorld();
    const args = argsOf(data);
    const { offset, maxChars } = chunkArgs(args);
    const journal = getJournal(requiredText(args, 'journalId'));
    const page = getPage(journal, requiredText(args, 'pageId'));
    return {
      mode: 'page',
      journalId: journal.id,
      journalName: journal.name,
      pageId: page.id,
      pageName: page.name,
      pageType: page.type,
      ...chunkOf(contentOf(page), offset, maxChars),
      id: page.id,
      name: page.name,
      type: page.type,
    };
  },
};

const SNIPPET_BEFORE = 50;
const SNIPPET_AFTER = 200;

export const searchJournals: QueryHandler = {
  access: { kind: 'read' },
  run: data => {
    requireWorld();
    const args = argsOf(data);
    const searchQuery = requiredText(args, 'searchQuery');
    const searchType = optionalText(args, 'searchType') ?? 'both';
    if (!['title', 'content', 'both'].includes(searchType)) {
      throw new QueryError(
        'INVALID_ARGUMENT',
        `searchType must be "title", "content" or "both", got "${searchType}"`
      );
    }
    const needle = searchQuery.toLowerCase();
    const results: Array<Record<string, unknown>> = [];

    for (const journal of game.journal.contents as FoundryJournalsEntry[]) {
      const pages = orderedPages(journal);
      const matchType: string[] = [];
      if (searchType !== 'content' && (journal.name ?? '').toLowerCase().includes(needle)) {
        matchType.push('title');
      }
      const matchingPages: Array<{ id: string; name: string; snippet: string }> = [];
      if (searchType !== 'title') {
        for (const page of pages) {
          if (!isTextPage(page)) continue;
          const html = pageHtml(page);
          const at = html.toLowerCase().indexOf(needle);
          if (at < 0) continue;
          const from = Math.max(0, at - SNIPPET_BEFORE);
          const to = Math.min(html.length, at + needle.length + SNIPPET_AFTER);
          matchingPages.push({
            id: page.id,
            name: page.name,
            snippet: `...${html.slice(from, to)}...`,
          });
        }
        if (matchingPages.length) matchType.push('content');
      }
      if (!matchType.length) continue;
      results.push({
        id: journal.id,
        name: journal.name,
        pageCount: pages.length,
        matchType,
        pages: matchingPages,
      });
    }

    return { searchQuery, searchType, results, totalMatches: results.length };
  },
};
