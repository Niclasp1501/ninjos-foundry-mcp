/**
 * Creating, writing, renaming and deleting journals and their pages.
 * Every handler reads its effect back before it reports success.
 *
 * Answers carry the field names a server of the previous generation reads or
 * passes on next to the names of this version, and
 * `success: true`. The new server keeps the new names only.
 */
import { MODULE_ID } from '../../../common/constants.js';
import type { HandlerContext, QueryHandler } from '../../dispatcher.js';
import { QueryError } from '../../dispatcher.js';
import { requireWorld } from '../../world-ready.js';
import {
  argsOf,
  documentClass,
  findByIdOrName,
  getJournal,
  getPage,
  HTML_FORMAT,
  isRecord,
  isTextPage,
  optionalText,
  orderedPages,
  pageHtml,
  requireAccess,
  requiredText,
  requireTextPage,
  smallEnough,
  SORT_STEP,
  verifyFailed,
} from './common.js';

/** CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE: only Gamemasters see the journal. */
const OWNERSHIP_NONE = 0;

/** Compare what Foundry stored with what was sent, and say where it differs. */
export function checkStored(what: string, expected: string, actual: string): void {
  if (expected === actual) return;
  let at = 0;
  while (at < expected.length && expected[at] === actual[at]) at += 1;
  verifyFailed(
    `${what} reads back with ${actual.length} characters instead of ${expected.length}, first difference at ` +
      `character ${at}. Foundry may have removed markup it does not allow, such as scripts`
  );
}

function textPageData(name: string, html: string, sort: number): Record<string, unknown> {
  return { name, type: 'text', text: { content: html, format: HTML_FORMAT }, sort };
}

function nextSort(journal: FoundryJournalsEntry): number {
  const pages = orderedPages(journal);
  const last = pages.at(-1);
  return (last?.sort ?? 0) + SORT_STEP;
}

function createdId(created: unknown, what: string): string {
  const document = Array.isArray(created) ? created[0] : created;
  if (isRecord(document) || (typeof document === 'object' && document !== null)) {
    const id = (document as { id?: unknown }).id;
    if (typeof id === 'string' && id) return id;
  }
  return verifyFailed(`Foundry did not return the created ${what}`);
}

/**
 * The marker on folders this module creates: `createdByMcp` as the core writes
 * it, and `mcpGenerated` with `createdAt` as the previous module wrote it, so a
 * later cleanup finds the folders of both generations.
 */
export function createdFolderFlags(): Record<string, unknown> {
  return {
    [MODULE_ID]: { createdByMcp: true, mcpGenerated: true, createdAt: new Date().toISOString() },
  };
}

/** The journal folder by id or exact name; created when missing. */
async function journalFolder(
  folderName: string
): Promise<{ id: string; name: string; created: boolean }> {
  const folders = game.folders.contents.filter(
    folder => (folder as FoundryJournalsFolder).type === 'JournalEntry'
  ) as FoundryJournalsFolder[];
  const byId = folders.find(folder => folder.id === folderName);
  const named = folders.filter(folder => folder.name === folderName);
  if (byId || named.length) {
    const folder = findByIdOrName(folders, folderName, 'Folder', f => `"${f.name}" (${f.id})`);
    return { id: folder.id, name: folder.name, created: false };
  }
  requireAccess('Folders', 'create');
  const created = await documentClass('Folder').create({
    name: folderName,
    type: 'JournalEntry',
    flags: createdFolderFlags(),
  });
  const id = createdId(created, 'folder');
  const folder = game.folders.get(id) as FoundryJournalsFolder | undefined;
  if (!folder || folder.name !== folderName)
    verifyFailed(`The folder "${folderName}" does not read back`);
  return { id, name: folder.name, created: true };
}

/**
 * The HTML of one page of `createCleanJournal`. This version sends `html`, the
 * previous server renamed it to `content`; either is taken, both must agree.
 */
function pageHtmlArg(page: Record<string, unknown>): string {
  const html = page['html'];
  const content = page['content'];
  if (html === undefined && typeof content === 'string') return content;
  const value = requiredText(page, 'html', { allowEmpty: true });
  if (typeof content === 'string' && content !== value)
    throw new Error('html and content differ; send only one of them');
  return value;
}

export const createCleanJournal: QueryHandler = {
  access: { kind: 'write', document: 'Journals', action: 'create' },
  run: async (data, context) => {
    requireWorld();
    const args = argsOf(data);
    const name = requiredText(args, 'name').trim();
    const folderName = optionalText(args, 'folderName');
    const rawPages = args['pages'];
    if (!Array.isArray(rawPages) || rawPages.length === 0) {
      throw new QueryError('INVALID_ARGUMENT', 'pages must be a list with at least one page');
    }
    const pages = rawPages.map((page, index) => {
      if (!isRecord(page)) {
        throw new QueryError(
          'INVALID_ARGUMENT',
          `pages[${index}] must be an object with name and html`
        );
      }
      try {
        return { name: requiredText(page, 'name').trim(), html: pageHtmlArg(page) };
      } catch (error) {
        throw new QueryError('INVALID_ARGUMENT', `pages[${index}]: ${(error as Error).message}`);
      }
    });

    const folder =
      folderName !== undefined && folderName.trim() !== ''
        ? await journalFolder(folderName.trim())
        : null;

    const created = await documentClass('JournalEntry').create({
      name,
      ownership: { default: OWNERSHIP_NONE },
      ...(folder ? { folder: folder.id } : {}),
      pages: pages.map((page, index) =>
        textPageData(page.name, page.html, (index + 1) * SORT_STEP)
      ),
    });
    const id = createdId(created, 'journal');
    const journal = getJournal(id);
    const stored = orderedPages(journal);
    if (journal.name !== name)
      verifyFailed(`The journal ${id} reads back with the name "${journal.name}"`);
    if (stored.length !== pages.length) {
      verifyFailed(
        `The journal ${id} reads back with ${stored.length} pages instead of ${pages.length}`
      );
    }
    pages.forEach((page, index) => {
      const actual = stored[index] as FoundryJournalsPage;
      if (actual.name !== page.name) {
        verifyFailed(
          `Page ${index + 1} of journal ${id} reads back with the name "${actual.name}"`
        );
      }
      checkStored(`Page "${page.name}" of journal ${id}`, page.html, pageHtml(actual));
    });

    context.recordChange({
      query: 'createCleanJournal',
      tool: 'journal-create',
      document: 'Journals',
      action: 'create',
      targets: [{ id, uuid: journal.uuid, name }],
      summary: `Created the journal "${name}" with ${pages.length} pages${folder ? ` in the folder "${folder.name}"` : ''}.`,
    });
    return {
      success: true,
      id,
      name,
      pageCount: stored.length,
      folder: folder ? { id: folder.id, name: folder.name, created: folder.created } : null,
    };
  },
};

interface PageWrite {
  query: string;
  tool: string;
}

/** Replace the HTML of a text page, read it back, record it. */
async function replacePage(
  journal: FoundryJournalsEntry,
  page: FoundryJournalsPage,
  html: string,
  context: HandlerContext,
  write: PageWrite
): Promise<void> {
  requireTextPage(page, write.tool);
  const before = pageHtml(page);
  await page.update({ 'text.content': html });
  checkStored(`Page "${page.name}"`, html, pageHtml(getPage(getJournal(journal.id), page.id)));
  context.recordChange({
    query: write.query,
    tool: write.tool,
    document: 'Journals',
    action: 'update',
    targets: [{ id: page.id, uuid: page.uuid, name: page.name }],
    summary: `Replaced the content of page "${page.name}" in "${journal.name}".`,
    before: smallEnough({ 'text.content': before }),
  });
}

/** Add a text page at the end, read it back, record it. */
async function addPage(
  journal: FoundryJournalsEntry,
  name: string,
  html: string,
  context: HandlerContext,
  write: PageWrite
): Promise<FoundryJournalsPage> {
  const created = await journal.createEmbeddedDocuments('JournalEntryPage', [
    textPageData(name, html, nextSort(journal)),
  ]);
  const pageId = createdId(created, 'page');
  const page = getPage(getJournal(journal.id), pageId);
  checkStored(`Page "${name}"`, html, pageHtml(page));
  context.recordChange({
    query: write.query,
    tool: write.tool,
    document: 'Journals',
    action: 'create',
    targets: [{ id: pageId, uuid: page.uuid, name }],
    summary: `Added the page "${name}" to "${journal.name}".`,
  });
  return page;
}

export const setJournalPage: QueryHandler = {
  access: { kind: 'write', document: 'Journals', action: 'update' },
  run: async (data, context) => {
    requireWorld();
    const args = argsOf(data);
    const journal = getJournal(requiredText(args, 'journalId'));
    const page = getPage(journal, requiredText(args, 'pageId'));
    const html = requiredText(args, 'html', { allowEmpty: true });
    await replacePage(journal, page, html, context, {
      query: 'setJournalPage',
      tool: 'journal-set-page',
    });
    return { journalId: journal.id, pageId: page.id, name: page.name, length: html.length };
  },
};

export const addJournalPage: QueryHandler = {
  access: { kind: 'write', document: 'Journals', action: 'create' },
  run: async (data, context) => {
    requireWorld();
    const args = argsOf(data);
    const journal = getJournal(requiredText(args, 'journalId'));
    const name = requiredText(args, 'name').trim();
    const html = requiredText(args, 'html', { allowEmpty: true });
    const page = await addPage(journal, name, html, context, {
      query: 'addJournalPage',
      tool: 'journal-add-page',
    });
    return { journalId: journal.id, pageId: page.id, name: page.name, length: html.length };
  },
};

/**
 * The page write of the previous generation, in its three forms:
 * with `pageId` it replaces that page, with
 * `newPageName` it adds a page, and with neither it replaces the first text
 * page. The new server never sends the third form; an old server does, for its
 * quest tools, and also for journal-add-page without a name. The module keeps
 * the form for one version, but says in the answer which page it overwrote and
 * records the state before, so it can be restored.
 */
export const updateJournalContent: QueryHandler = {
  access: data =>
    isRecord(data) && data['newPageName'] !== undefined && data['newPageName'] !== null
      ? { kind: 'write', document: 'Journals', action: 'create' }
      : { kind: 'write', document: 'Journals', action: 'update' },
  run: async (data, context) => {
    requireWorld();
    const args = argsOf(data);
    const journal = getJournal(requiredText(args, 'journalId'));
    const html = requiredText(args, 'content');
    const pageId = optionalText(args, 'pageId');
    const newPageName = optionalText(args, 'newPageName');
    const write = { query: 'updateJournalContent', tool: 'journal-set-page' };
    if (pageId !== undefined && newPageName !== undefined) {
      throw new QueryError(
        'INVALID_ARGUMENT',
        'Send either pageId (replace that page) or newPageName (add a page), not both'
      );
    }

    if (newPageName !== undefined) {
      const name = newPageName.trim();
      if (!name) throw new QueryError('INVALID_ARGUMENT', 'newPageName must not be empty');
      const page = await addPage(journal, name, html, context, {
        ...write,
        tool: 'journal-add-page',
      });
      return {
        success: true,
        journalId: journal.id,
        pageId: page.id,
        pageName: page.name,
        length: html.length,
        created: true,
      };
    }

    let page: FoundryJournalsPage;
    let note: string | undefined;
    if (pageId !== undefined) {
      page = getPage(journal, pageId);
    } else {
      const first = orderedPages(journal).find(isTextPage);
      if (!first) {
        throw new QueryError(
          'NOT_FOUND',
          `Journal "${journal.name}" (${journal.id}) has no text page to write; pass newPageName to add one`
        );
      }
      page = first;
      note =
        `No pageId and no newPageName: the first text page "${page.name}" (${page.id}) was overwritten. ` +
        'Its previous content is kept in the change log.';
    }
    await replacePage(journal, page, html, context, write);
    return {
      success: true,
      journalId: journal.id,
      pageId: page.id,
      pageName: page.name,
      length: html.length,
      created: false,
      ...(note ? { replacedFirstTextPage: true, note } : {}),
    };
  },
};

export const appendJournalPageContent: QueryHandler = {
  access: { kind: 'write', document: 'Journals', action: 'update' },
  run: async (data, context) => {
    requireWorld();
    const args = argsOf(data);
    const journal = getJournal(requiredText(args, 'journalId'));
    const page = getPage(journal, requiredText(args, 'pageId'));
    const html = requiredText(args, 'html');
    if (page.type !== 'text') {
      throw new QueryError(
        'INVALID_ARGUMENT',
        `Only text pages can be appended to; page "${page.name}" (${page.id}) is a ${page.type} page`
      );
    }
    const before = pageHtml(page);
    const expected = before + html;

    await page.update({ 'text.content': expected });
    checkStored(
      `Page "${page.name}"`,
      expected,
      pageHtml(getPage(getJournal(journal.id), page.id))
    );

    context.recordChange({
      query: 'appendJournalPageContent',
      tool: 'journal-append-page',
      document: 'Journals',
      action: 'update',
      targets: [{ id: page.id, uuid: page.uuid, name: page.name }],
      summary: `Appended ${html.length} characters to page "${page.name}" in "${journal.name}".`,
      before: smallEnough({ 'text.content': before }),
    });
    return {
      success: true,
      journalId: journal.id,
      pageId: page.id,
      name: page.name,
      length: expected.length,
      newLength: expected.length,
    };
  },
};

/** Where the browser fetches a file of the Foundry data directory. */
export function dataUrl(path: string): string {
  const encoded = path
    .split('/')
    .map(segment => (/%[0-9A-Fa-f]{2}/.test(segment) ? segment : encodeURIComponent(segment)))
    .join('/');
  const utils = (globalThis as { foundry?: { utils?: { getRoute?: (path: string) => string } } })
    .foundry?.utils;
  return typeof utils?.getRoute === 'function' ? utils.getRoute(encoded) : `/${encoded}`;
}

export function normaliseDataPath(input: string): string {
  const path = input.trim().replace(/^\/+/, '');
  if (!path)
    throw new QueryError('INVALID_ARGUMENT', 'path must name a file in the Foundry data directory');
  if (path.split('/').some(segment => segment === '..')) {
    throw new QueryError(
      'INVALID_ARGUMENT',
      `path must stay inside the Foundry data directory: ${input}`
    );
  }
  return path;
}

export const setJournalPageFromFile: QueryHandler = {
  access: { kind: 'write', document: 'Journals', action: 'update' },
  run: async (data, context) => {
    requireWorld();
    const args = argsOf(data);
    const journal = getJournal(requiredText(args, 'journalId'));
    const path = normaliseDataPath(requiredText(args, 'path'));
    const pageId = optionalText(args, 'pageId');
    const pageName = optionalText(args, 'pageName');

    // An unknown page is an error before anything is fetched, never a silent new page.
    const existing = pageId !== undefined ? getPage(journal, pageId) : null;
    if (existing) requireTextPage(existing, 'journal-page-from-file');
    else requireAccess('Journals', 'create');

    let html: string;
    try {
      const response = await globalThis.fetch(dataUrl(path), { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
      html = await response.text();
    } catch (error) {
      throw new QueryError(
        'READ_FAILED',
        `Could not read ${path} from the Foundry data directory: ${(error as Error).message}`
      );
    }
    if (html.trim() === '') throw new QueryError('READ_FAILED', `File ${path} is empty`);

    if (existing) {
      const before = pageHtml(existing);
      await existing.update({ 'text.content': html });
      checkStored(
        `Page "${existing.name}"`,
        html,
        pageHtml(getPage(getJournal(journal.id), existing.id))
      );
      context.recordChange({
        query: 'setJournalPageFromFile',
        tool: 'journal-page-from-file',
        document: 'Journals',
        action: 'update',
        targets: [{ id: existing.id, uuid: existing.uuid, name: existing.name }],
        summary: `Filled page "${existing.name}" in "${journal.name}" from ${path}.`,
        before: smallEnough({ 'text.content': before }),
      });
      return {
        success: true,
        journalId: journal.id,
        pageId: existing.id,
        pageName: existing.name,
        length: html.length,
        created: false,
      };
    }

    const fileName = decodeURIComponent(path.split('/').at(-1) ?? path);
    const name = pageName?.trim() || fileName;
    const created = await journal.createEmbeddedDocuments('JournalEntryPage', [
      textPageData(name, html, nextSort(journal)),
    ]);
    const newId = createdId(created, 'page');
    const page = getPage(getJournal(journal.id), newId);
    checkStored(`Page "${name}"`, html, pageHtml(page));
    context.recordChange({
      query: 'setJournalPageFromFile',
      tool: 'journal-page-from-file',
      document: 'Journals',
      action: 'create',
      targets: [{ id: newId, uuid: page.uuid, name }],
      summary: `Added the page "${name}" to "${journal.name}" from ${path}.`,
    });
    return {
      success: true,
      journalId: journal.id,
      pageId: newId,
      pageName: page.name,
      length: html.length,
      created: true,
    };
  },
};

export const renameJournal: QueryHandler = {
  access: { kind: 'write', document: 'Journals', action: 'update' },
  run: async (data, context) => {
    requireWorld();
    const args = argsOf(data);
    const journal = getJournal(requiredText(args, 'journalId'));
    const newName = requiredText(args, 'newName').trim();
    const oldName = journal.name;

    await journal.update({ name: newName });
    const stored = getJournal(journal.id).name;
    if (stored !== newName)
      verifyFailed(`The journal ${journal.id} reads back with the name "${stored}"`);

    context.recordChange({
      query: 'renameJournal',
      tool: 'journal-rename',
      document: 'Journals',
      action: 'update',
      targets: [{ id: journal.id, uuid: journal.uuid, name: newName }],
      summary: `Renamed the journal "${oldName}" to "${newName}".`,
      before: { name: oldName },
    });
    return { success: true, id: journal.id, journalId: journal.id, oldName, name: newName };
  },
};

export const deleteJournalPage: QueryHandler = {
  access: { kind: 'write', document: 'Journals', action: 'delete' },
  run: async (data, context) => {
    requireWorld();
    const args = argsOf(data);
    const journal = getJournal(requiredText(args, 'journalId'));
    const page = getPage(journal, requiredText(args, 'pageId'));
    const before = page.toObject();

    await journal.deleteEmbeddedDocuments('JournalEntryPage', [page.id]);
    if (getJournal(journal.id).pages.get(page.id)) {
      verifyFailed(`The page ${page.id} still exists in journal ${journal.id} after deleting it`);
    }

    context.recordChange({
      query: 'deleteJournalPage',
      tool: 'journal-delete-page',
      document: 'Journals',
      action: 'delete',
      targets: [{ id: page.id, uuid: page.uuid, name: page.name }],
      summary: `Deleted the page "${page.name}" from "${journal.name}".`,
      before: smallEnough(before),
    });
    return {
      success: true,
      journalId: journal.id,
      pageId: page.id,
      name: page.name,
      deletedPageId: page.id,
    };
  },
};

export const deleteJournalEntry: QueryHandler = {
  access: { kind: 'write', document: 'Journals', action: 'delete' },
  run: async (data, context) => {
    requireWorld();
    const args = argsOf(data);
    const journal = getJournal(requiredText(args, 'journalId'));
    const before = journal.toObject();
    const pageCount = journal.pages.size;

    await journal.delete();
    if (game.journal.get(journal.id))
      verifyFailed(`The journal ${journal.id} still exists after deleting it`);

    context.recordChange({
      query: 'deleteJournalEntry',
      tool: 'journal-delete',
      document: 'Journals',
      action: 'delete',
      targets: [{ id: journal.id, uuid: journal.uuid, name: journal.name }],
      summary: `Deleted the journal "${journal.name}" with ${pageCount} pages.`,
      before: smallEnough(before),
    });
    return {
      success: true,
      journalId: journal.id,
      name: journal.name,
      deletedPages: pageCount,
      deletedJournalId: journal.id,
    };
  },
};
