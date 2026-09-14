/**
 * The status cycle and the dashboard figures, computed from saved status.
 */
import { describe, expect, it } from 'vitest';
import { computeView, nextStatus, readStatus, statusKey, type ViewPartInput } from './model.js';

const PARTS: ViewPartInput[] = [
  { id: 'part-1', label: 'Part 1', subParts: [] },
  {
    id: 'part-2',
    label: 'Part 2',
    subParts: [
      { id: 'part-2-1', label: '2.1' },
      { id: 'part-2-2', label: '2.2' },
    ],
  },
  { id: 'part-3', label: 'Part 3', subParts: [] },
];

const saved = (entries: Record<string, string>) =>
  Object.fromEntries(Object.entries(entries).map(([id, status]) => [statusKey('c', id), status]));

describe('status', () => {
  it('cycles not started, in progress, completed, skipped and round again', () => {
    expect(nextStatus('not_started')).toBe('in_progress');
    expect(nextStatus('in_progress')).toBe('completed');
    expect(nextStatus('completed')).toBe('skipped');
    expect(nextStatus('skipped')).toBe('not_started');
  });

  it('reads unknown or damaged values as not started', () => {
    expect(readStatus(null, 'x')).toBe('not_started');
    expect(readStatus({ x: 'done' }, 'x')).toBe('not_started');
    expect(readStatus({ x: 'completed' }, 'x')).toBe('completed');
  });
});

describe('computeView', () => {
  it('starts ready, with every part after the first locked', () => {
    const view = computeView('c', PARTS, undefined);
    expect(view.current).toEqual({ kind: 'ready', label: null });
    expect(view.parts.map(part => part.locked)).toEqual([false, true, true]);
    expect(view.parts[1]?.requires).toBe('Part 1');
    expect([view.done, view.total, view.percent]).toEqual([0, 4, 0]);
  });

  it('counts sub parts where a part has them and follows the saved status', () => {
    const view = computeView('c', PARTS, saved({ 'part-1': 'completed', 'part-2-1': 'skipped' }));
    expect([view.done, view.total, view.percent]).toEqual([2, 4, 50]);
    expect(view.parts.map(part => part.locked)).toEqual([false, false, true]);
    expect(view.current).toEqual({ kind: 'active', label: 'Part 2, 2.2' });
  });

  it('treats a part whose sub parts are all done as done, and reports a finished campaign', () => {
    const view = computeView(
      'c',
      PARTS,
      saved({
        'part-1': 'skipped',
        'part-2-1': 'completed',
        'part-2-2': 'completed',
        'part-3': 'completed',
      })
    );
    expect(view.parts.every(part => part.done && !part.locked)).toBe(true);
    expect(view.current).toEqual({ kind: 'finished', label: null });
    expect(view.percent).toBe(100);
  });

  it('locks a part again when the one before goes back to not started', () => {
    const view = computeView('c', PARTS, saved({ 'part-2': 'completed' }));
    expect(view.parts[2]?.locked).toBe(false);
    expect(view.parts[1]?.locked).toBe(true);
    expect(view.current).toEqual({ kind: 'active', label: 'Part 1' });
  });
});
