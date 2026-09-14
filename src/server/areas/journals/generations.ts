/**
 * The journal tools against a module of either generation.
 *
 * A module of the previous generation answers some failures as a normal
 * value, lists journals as a bare list, reads content in chunks under
 * getJournalContent and getJournalPageContent, and does not know the queries
 * this version added (searchJournals, setJournalPage, addJournalPage). What
 * follows from that for the server lives here; the data contracts are those of
 * the previous generation.
 */
import { BridgeError } from '../../bridge/foundry-bridge.js';
import { legacyFailure, messageOf } from '../../tools/results.js';
import type { ToolContext } from '../../tools/types.js';

export type Rec = Record<string, unknown>;

export function isRecord(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Whether the module does not know the query, as a module of the previous generation. */
export function unknownQuery(error: unknown): boolean {
  if (!(error instanceof BridgeError)) return false;
  return error.moduleCode === 'UNKNOWN_QUERY' || /no handler found/i.test(error.message);
}

/**
 * Ask the module. A failure sent as a normal value, `{ success: false, error }`
 * or an object with only `error`, is thrown with its cause.
 */
export async function ask(context: ToolContext, query: string, data: Rec): Promise<unknown> {
  const answer = await context.query(query, data);
  const failure = legacyFailure(answer);
  if (failure !== null) throw new Error(failure);
  if (isRecord(answer) && answer['success'] !== true && text(answer['error'])) {
    throw new Error(text(answer['error']));
  }
  return answer;
}

/**
 * The answer with the field names of this version only. The new module sends
 * the old names beside the new ones for an old server, an old module sends
 * only the old ones; either way the model reads one set.
 */
export function modernNames(answer: Rec, aliases: Readonly<Record<string, string>>): Rec {
  const result: Rec = { ...answer };
  delete result['success'];
  for (const [old, modern] of Object.entries(aliases)) {
    if (!(old in result)) continue;
    if (result[modern] === undefined) result[modern] = result[old];
    delete result[old];
  }
  return result;
}

function defined(record: Rec): Rec {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

const QUEST_WORDS = ['quest', 'mission', 'task', 'adventure', 'job', 'contract'];
const PREVIEW_CHARS = 150;
const SNIPPET_BEFORE = 50;
const SNIPPET_AFTER = 200;
/** The largest chunk a module of either generation hands out. */
const LARGEST_CHUNK = 200_000;
/** The smallest chunk a module accepts; enough to learn the length of a page. */
const SMALLEST_CHUNK = 1_000;

const CHUNK_FIELDS = [
  'content',
  'contentLength',
  'offset',
  'returned',
  'hasMore',
  'nextOffset',
  'note',
];

function chunkFields(answer: Rec): Rec {
  return Object.fromEntries(CHUNK_FIELDS.map(key => [key, answer[key]]));
}

function chunkArgs(args: Rec): Rec {
  return defined({ offset: args['offset'], maxChars: args['maxChars'] });
}

async function readPage(args: Rec, context: ToolContext): Promise<Rec> {
  const journalId = text(args['journalId']);
  const pageId = text(args['pageId']);
  const answer = await ask(context, 'getJournalPageContent', {
    journalId,
    pageId,
    ...chunkArgs(args),
  });
  if (!isRecord(answer)) throw new Error(`Page not found: ${pageId} (journal ${journalId})`);
  return defined({
    mode: 'page',
    journalId: text(answer['journalId']) || journalId,
    journalName: answer['journalName'],
    pageId: answer['pageId'] ?? answer['id'] ?? pageId,
    pageName: answer['pageName'] ?? answer['name'],
    pageType: answer['pageType'] ?? answer['type'],
    ...chunkFields(answer),
  });
}

async function readJournal(args: Rec, context: ToolContext): Promise<Rec> {
  const journalId = text(args['journalId']);
  const answer = await ask(context, 'getJournalContent', { journalId, ...chunkArgs(args) });
  if (!isRecord(answer)) throw new Error(`Journal not found: ${journalId}`);
  const current = isRecord(answer['currentPage']) ? answer['currentPage'] : {};
  const pages = answer['pages'] ?? answer['allPages'];
  return defined({
    mode: 'journal',
    journalId: text(answer['journalId']) || journalId,
    journalName: answer['journalName'],
    pageId: answer['pageId'] ?? current['id'] ?? null,
    pageName: answer['pageName'] ?? current['name'] ?? null,
    pages,
    pageCount: answer['pageCount'] ?? (Array.isArray(pages) ? pages.length : undefined),
    ...chunkFields(answer),
  });
}

function journalsIn(answer: unknown): unknown[] {
  if (Array.isArray(answer)) return answer;
  if (isRecord(answer) && Array.isArray(answer['journals'])) return answer['journals'];
  throw new Error(
    `listJournals answered in a form this server does not know: ${JSON.stringify(answer)?.slice(0, 500)}`
  );
}

/**
 * list-journals in its three modes. Reading uses the queries both generations
 * answer alike; the list is a bare list from both, and filtering quests is the
 * server's work. A preview the module did not add (an old module) is read per
 * journal, and a journal whose preview could not be read says so.
 */
export async function listJournals(args: Rec, context: ToolContext): Promise<Rec> {
  if (args['pageId'] !== undefined && args['journalId'] === undefined) {
    throw new Error('pageId needs journalId as well');
  }
  if (args['journalId'] !== undefined && args['pageId'] !== undefined)
    return readPage(args, context);
  if (args['journalId'] !== undefined) return readJournal(args, context);

  const includeContent = args['includeContent'] === true;
  const all = journalsIn(
    await ask(context, 'listJournals', includeContent ? { includeContent } : {})
  ).filter(isRecord);
  const selected =
    args['filterQuests'] === true
      ? all.filter(journal =>
          QUEST_WORDS.some(word => text(journal['name']).toLowerCase().includes(word))
        )
      : all;

  const journals: Rec[] = [];
  for (const [index, journal] of selected.entries()) {
    const entry: Rec = { ...journal };
    if (!includeContent) delete entry['preview'];
    else if (typeof entry['preview'] !== 'string') {
      if (index % 10 === 0)
        context.progress({ progress: index, total: selected.length, message: 'reading previews' });
      try {
        const first = await ask(context, 'getJournalContent', {
          journalId: text(journal['id']),
          maxChars: SMALLEST_CHUNK,
        });
        entry['preview'] = isRecord(first) ? text(first['content']).slice(0, PREVIEW_CHARS) : '';
      } catch (error) {
        entry['preview'] = '';
        entry['previewError'] = messageOf(error);
      }
    }
    journals.push(entry);
  }
  return { mode: 'list', total: all.length, filtered: journals.length, journals };
}

/** Every chunk of a page, joined, as an old module hands it out. */
async function wholePage(context: ToolContext, journalId: string, pageId: string): Promise<string> {
  let offset = 0;
  let content = '';
  for (;;) {
    const answer = await ask(context, 'getJournalPageContent', {
      journalId,
      pageId,
      offset,
      maxChars: LARGEST_CHUNK,
    });
    if (!isRecord(answer)) throw new Error(`Page not found: ${pageId}`);
    content += text(answer['content']);
    if (answer['hasMore'] !== true) return content;
    const next = answer['nextOffset'];
    if (typeof next !== 'number' || next <= offset)
      throw new Error(`the module did not move on from offset ${offset}`);
    offset = next;
  }
}

/**
 * search-journals against a module without searchJournals: the list, then
 * every text page read to its end, not only its first chunk as the previous
 * server did. A page that cannot be read is named in the result instead of
 * being passed over.
 */
export async function searchWithoutModuleSearch(args: Rec, context: ToolContext): Promise<Rec> {
  const searchQuery = text(args['searchQuery']);
  if (!searchQuery.trim()) throw new Error('searchQuery must not be empty');
  const searchType = text(args['searchType']) || 'both';
  const needle = searchQuery.toLowerCase();
  const journals = journalsIn(await ask(context, 'listJournals', {})).filter(isRecord);
  const results: Rec[] = [];
  const unreadPages: Rec[] = [];

  for (const [index, journal] of journals.entries()) {
    if (index % 10 === 0)
      context.progress({ progress: index, total: journals.length, message: 'searching journals' });
    const journalId = text(journal['id']);
    const pages = Array.isArray(journal['pages']) ? journal['pages'].filter(isRecord) : [];
    const matchType: string[] = [];
    if (searchType !== 'content' && text(journal['name']).toLowerCase().includes(needle))
      matchType.push('title');
    const matchingPages: Rec[] = [];
    if (searchType !== 'title') {
      for (const page of pages) {
        if (page['type'] !== 'text') continue;
        const pageId = text(page['id']);
        let html: string;
        try {
          html = await wholePage(context, journalId, pageId);
        } catch (error) {
          unreadPages.push({ journalId, pageId, name: page['name'], reason: messageOf(error) });
          continue;
        }
        const at = html.toLowerCase().indexOf(needle);
        if (at < 0) continue;
        const from = Math.max(0, at - SNIPPET_BEFORE);
        const to = Math.min(html.length, at + needle.length + SNIPPET_AFTER);
        matchingPages.push({
          id: pageId,
          name: page['name'],
          snippet: `...${html.slice(from, to)}...`,
        });
      }
      if (matchingPages.length) matchType.push('content');
    }
    if (!matchType.length) continue;
    results.push({
      id: journalId,
      name: journal['name'],
      pageCount: journal['pageCount'] ?? pages.length,
      matchType,
      pages: matchingPages,
    });
  }

  const result: Rec = { searchQuery, searchType, results, totalMatches: results.length };
  if (unreadPages.length) {
    result['unreadPages'] = unreadPages;
    result['note'] = `${unreadPages.length} text page(s) could not be read and were not searched.`;
  }
  return result;
}

/** After a write through an old module, which does not read back: compare the stored length. */
async function checkLength(
  context: ToolContext,
  journalId: string,
  pageId: string,
  expected: number
): Promise<void> {
  let stored: unknown;
  try {
    const answer = await ask(context, 'getJournalPageContent', {
      journalId,
      pageId,
      maxChars: SMALLEST_CHUNK,
    });
    stored = isRecord(answer) ? answer['contentLength'] : undefined;
  } catch (error) {
    throw new Error(
      `The page ${pageId} was written, but could not be read back: ${messageOf(error)}. Check it before retrying.`
    );
  }
  if (typeof stored === 'number' && stored !== expected) {
    throw new Error(
      `The page ${pageId} was written, but reads back with ${stored} characters instead of ${expected}. ` +
        'Foundry may have removed markup it does not allow; check the page before retrying.'
    );
  }
}

function confirmed(answer: unknown, query: string): Rec {
  if (!isRecord(answer) || answer['success'] !== true) {
    throw new Error(`${query} did not confirm the write: ${JSON.stringify(answer)?.slice(0, 500)}`);
  }
  return answer;
}

/** journal-set-page against a module without setJournalPage: the old page write with pageId. */
export async function setPageWithoutModuleQuery(args: Rec, context: ToolContext): Promise<Rec> {
  const journalId = text(args['journalId']);
  const pageId = text(args['pageId']);
  const html = text(args['html']);
  const answer = confirmed(
    await ask(context, 'updateJournalContent', { journalId, pageId, content: html }),
    'updateJournalContent'
  );
  if (answer['pageId'] !== undefined && answer['pageId'] !== pageId) {
    throw new Error(
      `The module wrote the page ${text(answer['pageId'])} instead of ${pageId}. Check both pages before retrying.`
    );
  }
  await checkLength(context, journalId, pageId, html.length);
  return { journalId, pageId, name: answer['pageName'] ?? answer['name'], length: html.length };
}

/**
 * journal-add-page against a module without addJournalPage: the old page write
 * with newPageName. That module overwrites the first text page when the name
 * is missing or empty, so the name is checked first, and an answer naming
 * another page is reported as the overwrite it would be.
 */
export async function addPageWithoutModuleQuery(args: Rec, context: ToolContext): Promise<Rec> {
  const journalId = text(args['journalId']);
  const name = text(args['name']).trim();
  const html = text(args['html']);
  const answer = confirmed(
    await ask(context, 'updateJournalContent', { journalId, newPageName: name, content: html }),
    'updateJournalContent'
  );
  const pageId = text(answer['pageId']);
  if (!pageId || answer['pageName'] !== name) {
    throw new Error(
      `The module did not add a page named "${name}": it answered with page "${text(answer['pageName'])}" ` +
        `(${pageId || 'no id'}). That page may have been overwritten; check it before retrying.`
    );
  }
  await checkLength(context, journalId, pageId, html.length);
  return { journalId, pageId, name, length: html.length };
}

/** An empty page name is refused here: the previous module would overwrite the first text page. */
export function requirePageName(args: Rec): void {
  if (!text(args['name']).trim()) throw new Error('name must not be empty');
}
