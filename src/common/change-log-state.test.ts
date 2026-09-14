import { describe, expect, it } from 'vitest';
import { CHANGE_STATE_MAX_CHARS, ChangeLog, smallEnough } from './change-log.js';

describe('smallEnough', () => {
  it('keeps a state up to the limit and returns the same value', () => {
    const state = { name: 'Lore', text: { content: '<p>a</p>' } };
    expect(smallEnough(state)).toBe(state);
    expect(smallEnough(null)).toBeNull();
    expect(smallEnough('x'.repeat(CHANGE_STATE_MAX_CHARS - 2))).toHaveLength(
      CHANGE_STATE_MAX_CHARS - 2
    );
  });

  it('drops a state that is too large, or cannot be written as JSON', () => {
    expect(smallEnough('x'.repeat(CHANGE_STATE_MAX_CHARS - 1))).toBeUndefined();
    expect(smallEnough({ a: 'abcdef' }, 10)).toBeUndefined();
    const cycle: Record<string, unknown> = {};
    cycle['self'] = cycle;
    expect(smallEnough(cycle)).toBeUndefined();
    expect(smallEnough({ big: 1n })).toBeUndefined();
    expect(smallEnough(() => 1)).toBeUndefined();
    expect(smallEnough(undefined)).toBeUndefined();
  });

  it('makes an update without its state count as not undoable', () => {
    const log = new ChangeLog();
    const entry = log.record({
      query: 'updateJournalContent',
      document: 'Journals',
      action: 'update',
      targets: [{ id: 'j1' }],
      summary: 'Replaced a large page.',
      before: smallEnough('x'.repeat(CHANGE_STATE_MAX_CHARS)),
    });
    expect(entry.undoable).toBe(false);
  });
});
