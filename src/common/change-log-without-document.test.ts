import { describe, expect, it } from 'vitest';
import { ChangeLog, CHANGES_WITHOUT_DOCUMENT, type ChangeWithoutDocument } from './change-log.js';

describe('changes without a document type', () => {
  it('lists the five labels of the world-files-decks area', () => {
    expect([...CHANGES_WITHOUT_DOCUMENT]).toEqual([
      'WorldTime',
      'Pause',
      'Notifications',
      'Files',
      'Settings',
    ]);
  });

  it('records each label without a cast, keeps it undoable only as the rules say, and finds it', () => {
    const log = new ChangeLog();
    for (const label of CHANGES_WITHOUT_DOCUMENT) {
      const entry = log.record({
        query: 'q',
        document: label satisfies ChangeWithoutDocument,
        action: 'other',
        targets: [],
        summary: `${label} changed.`,
      });
      expect(entry.document).toBe(label);
      expect(entry.undoable).toBe(false);
    }
    expect(log.list({ document: 'Pause' }).map(entry => entry.summary)).toEqual(['Pause changed.']);
  });

  it('does not find a label among the kinds of a change across collections', () => {
    const log = new ChangeLog();
    log.record({
      query: 'q',
      document: 'Multiple',
      documents: ['Journals', 'Items'],
      action: 'update',
      targets: [{ id: 'a' }],
      summary: '',
    });
    expect(log.list({ document: 'Files' })).toEqual([]);
    expect(log.list({ document: 'Items' })).toHaveLength(1);
  });
});
