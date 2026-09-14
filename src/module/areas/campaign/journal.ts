/**
 * Creating a journal with its pages and writing one page, both read back
 * before anything is reported. Built on the helpers of the journals area.
 */
import { MODULE_ID } from '../../../common/constants.js';
import type { HandlerContext } from '../../dispatcher.js';
import { QueryError } from '../../dispatcher.js';
import { ensureFolderPath } from '../../folders.js';
import {
  documentClass,
  getJournal,
  getPage,
  HTML_FORMAT,
  notFound,
  orderedPages,
  pageHtml,
  smallEnough,
  SORT_STEP,
  verifyFailed,
} from '../journals/common.js';
import { checkStored } from '../journals/write.js';

/** CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE: only Gamemasters see a new journal. */
const OWNERSHIP_NONE = 0;

export interface NewPage {
  name: string;
  html: string;
}

export interface CreatedJournal {
  journal: FoundryCampaignJournal;
  pages: Array<{ id: string; name: string; length: number }>;
  folder: { id: string; path: string; created: boolean } | null;
  /** Sentences about what worked only in part, for the answer. */
  warnings: string[];
}

/**
 * The core helper marks a created folder with `createdByMcp`. The previous
 * module marked journal folders with `mcpGenerated`, `createdAt` and
 * `questContext`, so every
 * folder created here gets those too and is read back. A folder that keeps
 * only the new marker is reported, not a reason to fail: journal and folder
 * are fine without it.
 */
async function markOldGeneration(
  folderId: string,
  path: string,
  context: string
): Promise<string[]> {
  const folder = game.folders.get(folderId);
  const createdAt = new Date().toISOString();
  try {
    await folder?.update({
      flags: { [MODULE_ID]: { mcpGenerated: true, createdAt, questContext: context } },
    });
  } catch {
    // Checked below by reading back.
  }
  const flags = (
    game.folders.get(folderId) as { flags?: Record<string, Record<string, unknown>> } | undefined
  )?.flags?.[MODULE_ID];
  if (flags?.['mcpGenerated'] === true && flags['questContext'] === context) return [];
  return [
    `Folder "${path}" (id ${folderId}) was created, but the markers of the previous generation ` +
      '("mcpGenerated", "createdAt", "questContext") could not be added; it only carries "createdByMcp".',
  ];
}

function idOf(created: unknown, what: string): string {
  const document = Array.isArray(created) ? created[0] : created;
  const id = (document as { id?: unknown } | null | undefined)?.id;
  if (typeof id === 'string' && id) return id;
  return verifyFailed(`Foundry did not return the created ${what}`);
}

function textPage(name: string, html: string, sort: number): Record<string, unknown> {
  return { name, type: 'text', text: { content: html, format: HTML_FORMAT }, sort };
}

/**
 * Create a journal only Gamemasters see, with exactly these pages, optionally
 * in a journal folder at the top level (created when missing). The folder name
 * is one level: a slash in it is part of the name.
 */
export async function createJournal(options: {
  name: string;
  pages: readonly NewPage[];
  folderName?: string | undefined;
  flags?: Record<string, unknown>;
  /** `questContext` of a created folder: the quest or campaign title. Default: the journal name. */
  folderContext?: string;
  context: HandlerContext;
  query: string;
  tool?: string;
}): Promise<CreatedJournal> {
  const { name, pages, context } = options;
  const folderName = options.folderName?.trim();
  const warnings: string[] = [];
  let folder: CreatedJournal['folder'] = null;
  if (folderName) {
    const ensured = await ensureFolderPath([folderName], {
      type: 'JournalEntry',
      context,
      query: options.query,
      ...(options.tool ? { tool: options.tool } : {}),
    });
    if (!ensured.id) throw new QueryError('INVALID_ARGUMENT', 'folderName must not be empty');
    folder = { id: ensured.id, path: ensured.path, created: ensured.created.length > 0 };
    if (folder.created)
      warnings.push(
        ...(await markOldGeneration(folder.id, folder.path, options.folderContext ?? name))
      );
  }

  const created = await documentClass('JournalEntry').create({
    name,
    ownership: { default: OWNERSHIP_NONE },
    ...(folder ? { folder: folder.id } : {}),
    ...(options.flags ? { flags: options.flags } : {}),
    pages: pages.map((page, index) => textPage(page.name, page.html, (index + 1) * SORT_STEP)),
  });
  const id = idOf(created, 'journal');
  const journal = getJournal(id) as FoundryCampaignJournal;
  if (journal.name !== name)
    verifyFailed(`The journal ${id} reads back with the name "${journal.name}"`);
  const stored = orderedPages(journal);
  if (stored.length !== pages.length)
    verifyFailed(
      `The journal ${id} reads back with ${stored.length} pages instead of ${pages.length}`
    );
  pages.forEach((page, index) => {
    const actual = stored[index] as FoundryJournalsPage;
    if (actual.name !== page.name)
      verifyFailed(`Page ${index + 1} of journal ${id} reads back with the name "${actual.name}"`);
    checkStored(`Page "${page.name}" of journal ${id}`, page.html, pageHtml(actual));
  });

  context.recordChange({
    query: options.query,
    ...(options.tool ? { tool: options.tool } : {}),
    document: 'Journals',
    action: 'create',
    targets: [{ id, uuid: journal.uuid, name }],
    summary: `Created the journal "${name}" with ${pages.length} page${pages.length === 1 ? '' : 's'}${folder ? ` in the folder "${folder.path}"` : ''}.`,
  });
  return {
    journal,
    pages: stored.map(page => ({ id: page.id, name: page.name, length: pageHtml(page).length })),
    folder,
    warnings,
  };
}

/** The first text page in the order Foundry shows them. */
export function firstTextPage(journal: FoundryJournalsEntry, tool: string): FoundryJournalsPage {
  const page = orderedPages(journal).find(entry => entry.type === 'text');
  if (!page)
    notFound(`${tool}: journal "${journal.name}" (${journal.id}) has no text page to write into`);
  return page;
}

/** Replace the whole content of a text page and read it back. Returns the length before and after. */
export async function writePage(options: {
  journal: FoundryJournalsEntry;
  page: FoundryJournalsPage;
  html: string;
  context: HandlerContext;
  query: string;
  tool: string;
  summary: string;
}): Promise<{ lengthBefore: number; lengthAfter: number }> {
  const { journal, page, html } = options;
  const before = pageHtml(page);
  await page.update({ 'text.content': html });
  const stored = pageHtml(getPage(getJournal(journal.id), page.id));
  checkStored(`Page "${page.name}" of journal ${journal.id}`, html, stored);
  options.context.recordChange({
    query: options.query,
    tool: options.tool,
    document: 'Journals',
    action: 'update',
    targets: [{ id: page.id, uuid: page.uuid, name: page.name }],
    summary: options.summary,
    before: smallEnough({ 'text.content': before }),
  });
  return { lengthBefore: before.length, lengthAfter: stored.length };
}

/** Add a text page at the end of a journal and read it back. */
export async function addPage(options: {
  journal: FoundryJournalsEntry;
  name: string;
  html: string;
  context: HandlerContext;
  query: string;
  tool: string;
}): Promise<FoundryJournalsPage> {
  const { journal, name, html } = options;
  const last = orderedPages(journal).at(-1);
  const created = await journal.createEmbeddedDocuments('JournalEntryPage', [
    textPage(name, html, (last?.sort ?? 0) + SORT_STEP),
  ]);
  const pageId = idOf(created, 'page');
  const page = getPage(getJournal(journal.id), pageId);
  if (page.name !== name)
    verifyFailed(`The new page ${pageId} reads back with the name "${page.name}"`);
  checkStored(`Page "${name}" of journal ${journal.id}`, html, pageHtml(page));
  options.context.recordChange({
    query: options.query,
    tool: options.tool,
    document: 'Journals',
    action: 'create',
    targets: [{ id: pageId, uuid: page.uuid, name }],
    summary: `Added the page "${name}" to "${journal.name}".`,
  });
  return page;
}
