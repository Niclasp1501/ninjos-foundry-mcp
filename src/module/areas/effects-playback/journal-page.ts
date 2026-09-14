/**
 * replace-journal-page: the whole content of one text page, and optionally
 * its name, in one write.
 *
 * The same write as journal-set-page (the journals area): text pages only, read
 * back and compared with what was sent. Added here: plain text becomes
 * paragraphs (src/common/areas/effects-playback/content.ts), and the name
 * goes into the same update instead of a second write of the same content.
 * The page content is not sent back, only its length.
 */
import { isBlank, prepareContent } from '../../../common/areas/effects-playback/content.js';
import type { QueryHandler } from '../../dispatcher.js';
import { requireWorld } from '../../world-ready.js';
import { getJournal, getPage, pageHtml, requireTextPage, smallEnough } from '../journals/common.js';
import { checkStored } from '../journals/write.js';
import { argsOf, invalid, notApplied, refuseUnknown, requiredText } from './lookup.js';

export const replaceJournalPage: QueryHandler = {
  access: { kind: 'write', document: 'Journals', action: 'update' },
  run: async (data, context) => {
    requireWorld();
    const args = argsOf(data);
    const problems = refuseUnknown(args, ['journalId', 'pageId', 'newContent', 'newPageName']);
    if (problems.length) invalid(`Invalid arguments: ${problems.join('; ')}`);

    const content = args['newContent'];
    if (typeof content !== 'string') invalid('newContent is required and must be a string');
    if (isBlank(content)) {
      invalid(
        'newContent is empty or only white space; nothing was changed. To empty a page, use journal-set-page with html ""'
      );
    }
    const rawName = args['newPageName'];
    if (rawName !== undefined && (typeof rawName !== 'string' || rawName.trim() === '')) {
      invalid('newPageName must be a non-empty string; leave it out to keep the name');
    }
    const newName = typeof rawName === 'string' ? rawName.trim() : null;

    const journal = getJournal(requiredText(args, 'journalId').trim());
    const page = getPage(journal, requiredText(args, 'pageId').trim());
    requireTextPage(page, 'replace-journal-page');

    const prepared = prepareContent(content);
    const before = { name: page.name, 'text.content': pageHtml(page) };
    await page.update({ 'text.content': prepared.html, ...(newName ? { name: newName } : {}) });

    const stored = getPage(getJournal(journal.id), page.id);
    checkStored(`Page "${stored.name}"`, prepared.html, pageHtml(stored));
    if (newName && stored.name !== newName) {
      notApplied(
        `Page ${page.id} reads back with the name "${stored.name}" instead of "${newName}"; its content was replaced`
      );
    }

    const renamed = newName !== null && before.name !== newName;
    context.recordChange({
      query: 'replaceJournalPage',
      tool: 'replace-journal-page',
      document: 'Journals',
      action: 'update',
      targets: [{ id: page.id, uuid: page.uuid, name: stored.name }],
      summary:
        `Replaced the content of page "${stored.name}" in "${journal.name}"` +
        (renamed ? `, renamed from "${before.name}"` : '') +
        '.',
      before: smallEnough(before),
    });
    return {
      success: true,
      message: 'Page content replaced successfully',
      journalId: journal.id,
      pageId: page.id,
      pageName: stored.name,
      ...(renamed ? { previousName: before.name } : {}),
      length: prepared.html.length,
      format: prepared.format,
      verified: true,
      details: `Page content replaced and read back identical. New content length: ${prepared.html.length} characters.`,
      ...(prepared.note ? { note: prepared.note } : {}),
    };
  },
};
