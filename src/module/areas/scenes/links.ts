/**
 * Linking a journal, and optionally one of its pages, to a scene.
 *
 * Linking writes, so there is no substring match for the page: the previous
 * generation fell back to the first page whose name contained the text and
 * could link the wrong page without a word. A page that is not found is an
 * error listing every page.
 */
import { fail, findJournal, findPage } from './support.js';

export interface JournalLink {
  journal: string | null;
  journalEntryPage: string | null;
  report: { id: string; name: string; pageId?: string; pageName?: string } | null;
}

/**
 * `identifier` undefined: no change asked for. Empty string: remove the link.
 * `page` alone targets a page of `currentJournal`.
 */
export function journalLink(
  identifier: string | undefined,
  page: string | undefined,
  currentJournal: string | null = null
): JournalLink | undefined {
  if (identifier === undefined && page === undefined) return undefined;
  if (identifier !== undefined && identifier.trim() === '') {
    if (page)
      fail('INVALID_ARGUMENT', 'journalPageName needs a journal; journalIdentifier is empty');
    return { journal: null, journalEntryPage: null, report: null };
  }

  let journal: FoundryScenesJournal;
  if (identifier !== undefined) {
    journal = findJournal(identifier);
  } else {
    const linked = currentJournal
      ? (game.journal.get(currentJournal) as FoundryScenesJournal | undefined)
      : undefined;
    if (!linked)
      fail(
        'INVALID_ARGUMENT',
        'journalPageName was given without journalIdentifier, and the scene has no linked journal'
      );
    journal = linked;
  }

  if (!page)
    return {
      journal: journal.id,
      journalEntryPage: null,
      report: { id: journal.id, name: journal.name },
    };
  const target = findPage(journal, page);
  return {
    journal: journal.id,
    journalEntryPage: target.id,
    report: { id: journal.id, name: journal.name, pageId: target.id, pageName: target.name },
  };
}
