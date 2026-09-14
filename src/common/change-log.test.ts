import { describe, expect, it } from 'vitest';
import { ChangeLog } from './change-log.js';

const fixedNow = () => new Date('2026-09-13T12:00:00Z');

describe('ChangeLog', () => {
  it('keeps entries newest first and bounded', () => {
    const log = new ChangeLog({ capacity: 2, now: fixedNow });
    for (const name of ['a', 'b', 'c']) {
      log.record({
        query: 'q',
        document: 'Scenes',
        action: 'create',
        targets: [{ id: name }],
        summary: name,
      });
    }
    expect(log.list().map(e => e.summary)).toEqual(['c', 'b']);
    expect(log.size).toBe(2);
  });

  it('says honestly whether an entry can be undone', () => {
    const log = new ChangeLog({ now: fixedNow });
    const created = log.record({
      query: 'q',
      document: 'Scenes',
      action: 'create',
      targets: [{ id: 's1' }],
      summary: '',
    });
    const blindUpdate = log.record({
      query: 'q',
      document: 'Scenes',
      action: 'update',
      targets: [{ id: 's1' }],
      summary: '',
    });
    const update = log.record({
      query: 'q',
      document: 'Scenes',
      action: 'update',
      targets: [{ id: 's1' }],
      summary: '',
      before: { name: 'old' },
    });
    expect(created.undoable).toBe(true);
    expect(blindUpdate.undoable).toBe(false);
    expect(update.undoable).toBe(true);
  });

  it('marks an entry undone only once', () => {
    const log = new ChangeLog({ now: fixedNow });
    const entry = log.record({
      query: 'q',
      document: 'Journals',
      action: 'delete',
      targets: [{ id: 'j' }],
      summary: '',
      before: {},
    });
    expect(log.markUndone(entry.id)).toBe(true);
    expect(log.markUndone(entry.id)).toBe(false);
    expect(log.get(entry.id)?.undoneAt).toBe('2026-09-13T12:00:00.000Z');
  });

  it('records one change across several collections and finds it under each kind', () => {
    const log = new ChangeLog({ now: fixedNow });
    log.record({
      query: 'rewriteWorldPaths',
      document: 'Multiple',
      documents: ['Scenes', 'Items'],
      action: 'update',
      targets: [
        { id: 's1', documentName: 'Scene' },
        { id: 'i1', documentName: 'Item' },
      ],
      summary: 'paths',
    });
    expect(log.list({ document: 'Items' }).map(e => e.summary)).toEqual(['paths']);
    expect(log.list({ document: 'Journals' })).toEqual([]);
    expect(() =>
      log.record({ query: 'q', document: 'Multiple', action: 'update', targets: [], summary: '' })
    ).toThrow(/without naming the kinds/);
  });

  it('filters by document kind and informs listeners, even past a broken one', () => {
    const log = new ChangeLog({ now: fixedNow });
    const seen: string[] = [];
    log.subscribe(() => {
      throw new Error('broken listener');
    });
    log.subscribe(entry => seen.push(entry.summary));
    log.record({ query: 'q', document: 'Scenes', action: 'create', targets: [], summary: 'scene' });
    log.record({
      query: 'q',
      document: 'Journals',
      action: 'create',
      targets: [],
      summary: 'journal',
    });
    expect(log.list({ document: 'Journals' }).map(e => e.summary)).toEqual(['journal']);
    expect(seen).toEqual(['scene', 'journal']);
  });
});
