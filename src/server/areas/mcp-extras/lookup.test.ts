/**
 * Completion of ids: reading the list answers of other packages in either
 * shape, ranking, and the page completer that depends on the journal.
 */
import { describe, expect, it } from 'vitest';
import type { CompletionContext } from '../../tools/resources.js';
import {
  candidatesIn,
  completeFrom,
  completePageId,
  completeSceneId,
  rankCandidates,
} from './lookup.js';

function contextWith(
  answers: Record<string, unknown>,
  given: Record<string, string> = {}
): CompletionContext {
  return {
    arguments: given,
    query: async (name: string) => {
      if (!(name in answers)) throw new Error(`unexpected query ${name}`);
      return answers[name];
    },
  };
}

describe('candidatesIn', () => {
  it('reads a bare list and a list under a key, with every known id and name field', () => {
    expect(candidatesIn([{ id: 'a', name: 'Alpha' }, { name: 'no id' }, 'text'], [])).toEqual([
      { id: 'a', name: 'Alpha' },
    ]);
    expect(
      candidatesIn(
        {
          compendiums: [
            { collection: 'world.npcs', label: 'NPCs' },
            { _id: 'x', title: 'X' },
          ],
        },
        ['packs', 'compendiums']
      )
    ).toEqual([
      { id: 'world.npcs', name: 'NPCs' },
      { id: 'x', name: 'X' },
    ]);
    expect(candidatesIn({ other: [] }, ['scenes'])).toEqual([]);
  });
});

describe('rankCandidates', () => {
  const list = [
    { id: 'zz1', name: 'Tower of Dawn' },
    { id: 'to2', name: 'Cave' },
    { id: 'c3', name: 'Old Tower' },
    { id: 'q4', name: 'Swamp' },
  ];

  it('puts an id prefix before a name prefix before a name part, and drops the rest', () => {
    expect(rankCandidates(list, 'to')).toEqual(['to2', 'zz1', 'c3']);
  });

  it('lists everything by name when nothing is typed', () => {
    expect(rankCandidates(list, '  ')).toEqual(['to2', 'c3', 'q4', 'zz1']);
  });
});

describe('completers', () => {
  it('completes scene ids from list-scenes', async () => {
    const context = contextWith({
      'list-scenes': [
        { id: 's1', name: 'Cave' },
        { id: 's2', name: 'Tower' },
      ],
    });
    expect(await completeSceneId('tow', context)).toEqual(['s2']);
  });

  it('turns a failure returned as a value into an error', async () => {
    const context = contextWith({ 'list-scenes': { success: false, error: 'Access denied' } });
    await expect(completeSceneId('', context)).rejects.toThrow('list-scenes failed: Access denied');
  });

  it('completes page ids only inside the journal already given', async () => {
    const journals = [
      {
        id: 'j1',
        name: 'Chapter',
        pages: [
          { id: 'p1', name: 'Intro' },
          { id: 'p2', name: 'End' },
        ],
      },
      { id: 'j2', name: 'Other', pages: [{ id: 'p3', name: 'Intro' }] },
    ];
    expect(await completePageId('in', contextWith({ listJournals: journals }))).toEqual([]);
    expect(
      await completePageId('in', contextWith({ listJournals: journals }, { journalId: 'j1' }))
    ).toEqual(['p1']);
    expect(
      await completePageId('', contextWith({ listJournals: journals }, { journalId: 'nope' }))
    ).toEqual([]);
  });

  it('filters a fixed list by prefix', async () => {
    expect(await completeFrom(['easy', 'medium', 'hard'])('HA', contextWith({}))).toEqual(['hard']);
  });
});
