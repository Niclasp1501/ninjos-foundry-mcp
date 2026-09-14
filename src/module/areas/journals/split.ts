/**
 * journal-split-page: cut one text page into one page per section, in the
 * browser, so the content never crosses the bridge.
 */
import type { QueryHandler } from '../../dispatcher.js';
import { QueryError } from '../../dispatcher.js';
import { requireWorld } from '../../world-ready.js';
import {
  argsOf,
  getJournal,
  getPage,
  HTML_FORMAT,
  localize,
  optionalBoolean,
  optionalNumber,
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
import { splitAtHeadings } from './html.js';
import { checkStored } from './write.js';

const NAME_LIMIT = 120;

export function sectionPageName(prefix: string | undefined, title: string): string {
  const cleanPrefix = prefix?.trim() ?? '';
  const name = cleanPrefix ? `${cleanPrefix} ${title}` : title;
  return name.length > NAME_LIMIT ? name.slice(0, NAME_LIMIT).trimEnd() : name;
}

export const splitJournalPage: QueryHandler = {
  access: { kind: 'write', document: 'Journals', action: 'create' },
  run: async (data, context) => {
    requireWorld();
    const args = argsOf(data);
    const journal = getJournal(requiredText(args, 'journalId'));
    const page = getPage(journal, requiredText(args, 'pageId'));
    requireTextPage(page, 'journal-split-page');
    const level = optionalNumber(args, 'level') ?? 1;
    if (!Number.isInteger(level) || level < 1 || level > 6) {
      throw new QueryError(
        'INVALID_ARGUMENT',
        `level must be a whole number from 1 to 6, got ${level}`
      );
    }
    const deleteOriginal = optionalBoolean(args, 'deleteOriginal') ?? false;
    const namePrefix = optionalText(args, 'namePrefix');
    if (deleteOriginal) requireAccess('Journals', 'delete');

    const source = pageHtml(page);
    const split = splitAtHeadings(source, level);
    if (split.sections.length < 2) {
      const deeper = level < 6 ? ` Try a deeper level, for example level=${level + 1}.` : '';
      throw new QueryError(
        'NOTHING_TO_SPLIT',
        `Page "${page.name}" has ${split.sections.length} section(s) at headings h1 to h${level}, so splitting would change nothing.${deeper}`
      );
    }

    const pieces: Array<{ name: string; html: string }> = [];
    if (split.intro !== null) {
      pieces.push({ name: sectionPageName(namePrefix, localize('introName')), html: split.intro });
    }
    split.sections.forEach((section, index) => {
      const title = section.title || localize('sectionName', { n: String(index + 1) });
      pieces.push({ name: sectionPageName(namePrefix, title), html: section.html });
    });

    // The new pages go right behind the source page. Make room when the gap to the next page is too small.
    const ordered = orderedPages(journal);
    const position = ordered.findIndex(entry => entry.id === page.id);
    const following = ordered.slice(position + 1);
    const base = page.sort ?? 0;
    let nextSort = following[0] ? (following[0].sort ?? 0) : null;
    if (nextSort !== null && nextSort - base <= pieces.length) {
      const shift = (pieces.length + 1) * SORT_STEP;
      await journal.updateEmbeddedDocuments(
        'JournalEntryPage',
        following.map(entry => ({ _id: entry.id, sort: (entry.sort ?? 0) + shift }))
      );
      nextSort += shift;
    }
    const step =
      nextSort === null ? SORT_STEP : Math.floor((nextSort - base) / (pieces.length + 1));
    context.progress({ progress: 0, total: pieces.length, message: 'creating pages' });

    const created = await journal.createEmbeddedDocuments(
      'JournalEntryPage',
      pieces.map((piece, index) => ({
        name: piece.name,
        type: 'text',
        text: { content: piece.html, format: HTML_FORMAT },
        sort: base + (index + 1) * step,
      }))
    );
    if (created.length !== pieces.length) {
      verifyFailed(`Foundry created ${created.length} pages instead of ${pieces.length}`);
    }
    const fresh = getJournal(journal.id);
    const pages = pieces.map((piece, index) => {
      const id = (created[index] as FoundryDocument).id;
      const stored = fresh.pages.get(id);
      if (!stored) return verifyFailed(`The new page "${piece.name}" (${id}) does not read back`);
      checkStored(`Page "${piece.name}"`, piece.html, pageHtml(stored));
      return { id, name: stored.name, length: piece.html.length };
    });
    context.progress({ progress: pieces.length, total: pieces.length, message: 'pages created' });

    context.recordChange({
      query: 'splitJournalPage',
      tool: 'journal-split-page',
      document: 'Journals',
      action: 'create',
      targets: pages.map(entry => ({ id: entry.id, name: entry.name })),
      summary: `Split page "${page.name}" of "${journal.name}" into ${pages.length} pages.`,
    });

    let originalDeleted = false;
    if (deleteOriginal) {
      const before = page.toObject();
      await journal.deleteEmbeddedDocuments('JournalEntryPage', [page.id]);
      if (getJournal(journal.id).pages.get(page.id)) {
        verifyFailed(
          `The pages were created, but the source page ${page.id} still exists after deleting it`
        );
      }
      originalDeleted = true;
      context.recordChange({
        query: 'splitJournalPage',
        tool: 'journal-split-page',
        document: 'Journals',
        action: 'delete',
        targets: [{ id: page.id, uuid: page.uuid, name: page.name }],
        summary: `Deleted the source page "${page.name}" after splitting it.`,
        before: smallEnough(before),
      });
    }

    return {
      success: true,
      journalId: journal.id,
      sourcePageId: page.id,
      sourceLength: source.length,
      level,
      introPage: split.intro !== null,
      pages,
      originalDeleted,
      // The names of the previous generation, which an old server passes on.
      created: pages,
      originalLength: source.length,
      deletedOriginal: originalDeleted,
    };
  },
};
