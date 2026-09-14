import { describe, expect, it } from 'vitest';
import { ChangeLog, type ChangeInput } from '../../change-log.js';
import {
  differences,
  flatten,
  restorePlan,
  reversibility,
  splitUuid,
  statesPerTarget,
  undoAccesses,
} from './rules.js';

const now = () => new Date('2026-09-14T10:00:00Z');

function entry(input: Partial<ChangeInput>) {
  return new ChangeLog({ now }).record({
    query: 'q',
    document: 'Journals',
    action: 'update',
    targets: [{ id: 'j1' }],
    summary: '',
    ...input,
  });
}

describe('statesPerTarget', () => {
  it('matches a list by _id, else by position, and a single object to a single target', () => {
    const targets = [{ id: 'b' }, { id: 'a' }];
    expect(
      statesPerTarget(
        [
          { _id: 'a', x: 1 },
          { _id: 'b', x: 2 },
        ],
        targets
      )
    ).toEqual([
      { _id: 'b', x: 2 },
      { _id: 'a', x: 1 },
    ]);
    expect(statesPerTarget([{ x: 1 }, { x: 2 }], targets)).toEqual([{ x: 1 }, { x: 2 }]);
    expect(statesPerTarget({ name: 'old' }, [{ id: 'j' }])).toEqual([{ name: 'old' }]);
    expect(statesPerTarget({ name: 'old' }, targets)).toBeNull();
    expect(statesPerTarget([{ x: 1 }], targets)).toBeNull();
  });
});

describe('reversibility', () => {
  it('refuses kinds whose effect cannot be taken back, with the reason', () => {
    expect(reversibility(entry({ document: 'ChatMessages', action: 'create' }))).toMatchObject({
      reversible: false,
      reason: expect.stringContaining('seen at the table'),
    });
    const time = entry({ document: 'WorldTime' as never, action: 'other' });
    expect(reversibility(time).reason).toContain('world time');
    expect(
      reversibility(
        entry({
          document: 'Multiple',
          documents: ['Journals', 'ChatMessages'],
          action: 'update',
          before: {},
        })
      ).reversible
    ).toBe(false);
  });

  it('needs ids for creates and the state before for updates and deletes', () => {
    expect(reversibility(entry({ action: 'create' })).reversible).toBe(true);
    expect(reversibility(entry({ action: 'create', targets: [{ name: 'x' }] })).reversible).toBe(
      false
    );
    expect(reversibility(entry({ action: 'update' })).reason).toContain('not recorded');
    expect(
      reversibility(entry({ action: 'delete', before: { 'text.content': 'x' } })).reason
    ).toContain('only some fields');
    expect(
      reversibility(
        entry({ action: 'delete', targets: [{ uuid: 'Compendium.a.b.Actor.c' }], before: {} })
      ).reason
    ).toContain('compendiums');
  });
});

describe('undoAccesses', () => {
  it('asks the kind and the first action of the chain', () => {
    expect(undoAccesses(entry({ action: 'delete', before: {} })).accesses).toEqual([
      { kind: 'write', document: 'Journals', action: 'delete' },
    ]);
    expect(
      undoAccesses(
        entry({ action: 'delete', before: {}, restores: { changeId: 'c', action: 'create' } })
      ).accesses
    ).toEqual([{ kind: 'write', document: 'Journals', action: 'create' }]);
  });

  it('treats a kind without settings like a kind without a level', () => {
    expect(undoAccesses(entry({ document: 'Tokens' as never, action: 'update' })).accesses).toEqual(
      [{ kind: 'switch' }]
    );
    expect(
      undoAccesses(entry({ document: 'Tokens' as never, action: 'delete' })).refusal
    ).toContain('Tokens have no level');
  });

  it('asks the core kind of combat encounters', () => {
    expect(undoAccesses(entry({ document: 'Combats', action: 'delete', before: {} }))).toEqual({
      accesses: [{ kind: 'write', document: 'Combats', action: 'delete' }],
    });
  });
});

describe('restorePlan and differences', () => {
  it('writes back changed leaves, removes keys the change added, and leaves _stats alone', () => {
    const before = { name: 'Old', flags: { a: { x: 1 } }, _stats: { modifiedTime: 1 } };
    const after = { name: 'New', flags: { a: { x: 1, y: 2 } } };
    const current = { name: 'New', flags: { a: { x: 1, y: 2 } }, _stats: { modifiedTime: 9 } };
    expect(restorePlan(before, current, after)).toEqual({
      update: { name: 'Old', 'flags.a.-=y': null },
      paths: ['name', 'flags.a.y'],
      problems: [],
    });
  });

  it('reads dotted keys of partial states as paths', () => {
    expect([...flatten({ 'text.content': '<p>a</p>' }).keys()]).toEqual(['text.content']);
    expect(differences({ 'text.content': 'a' }, { text: { content: 'b' } })).toEqual([
      { path: 'text.content', expected: 'a', actual: 'b' },
    ]);
  });

  it('does not restore changed embedded documents through an update', () => {
    const plan = restorePlan({ pages: [{ _id: 'p', name: 'A' }] }, { pages: [] });
    expect(plan.problems[0]).toContain('embedded documents');
  });
});

describe('splitUuid', () => {
  it('splits parent, type and id', () => {
    expect(splitUuid('Scene.s.Wall.w')).toEqual({
      parent: 'Scene.s',
      documentName: 'Wall',
      id: 'w',
    });
    expect(splitUuid('JournalEntry.j')).toEqual({
      parent: null,
      documentName: 'JournalEntry',
      id: 'j',
    });
    expect(splitUuid('odd')).toBeNull();
  });
});

describe('ChangeLog origin', () => {
  it('keeps call id and user, and can take an undo back', () => {
    const log = new ChangeLog({ now });
    const recorded = log.record(
      {
        query: 'q',
        document: 'Scenes',
        action: 'update',
        targets: [{ id: 's' }],
        summary: '',
        before: {},
      },
      { callId: 'call-1', user: { id: 'gm', name: 'GM' } }
    );
    expect(recorded).toMatchObject({ callId: 'call-1', user: { id: 'gm', name: 'GM' } });
    expect(log.clearUndone(recorded.id)).toBe(false);
    log.markUndone(recorded.id);
    expect(log.clearUndone(recorded.id)).toBe(true);
    expect(log.get(recorded.id)?.undoneAt).toBeUndefined();
  });
});
