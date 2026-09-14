import { describe, expect, it } from 'vitest';
import {
  compareTurnOrder,
  isNonPlayerCharacter,
  recipientsFor,
  sameRecipients,
  selectForInitiative,
  summarizeRoll,
} from './rules.js';

describe('roll modes', () => {
  it('whispers gmroll to every Gamemaster and the roller, blindroll hidden, selfroll to the roller', () => {
    expect(recipientsFor('publicroll', 'u', ['gm1', 'gm2'])).toEqual({ whisper: [], blind: false });
    expect(recipientsFor('gmroll', 'gm1', ['gm1', 'gm2'])).toEqual({
      whisper: ['gm1', 'gm2'],
      blind: false,
    });
    expect(recipientsFor('blindroll', 'gm1', ['gm1'])).toEqual({ whisper: ['gm1'], blind: true });
    expect(recipientsFor('selfroll', 'gm1', ['gm1', 'gm2'])).toEqual({
      whisper: ['gm1'],
      blind: false,
    });
  });

  it('compares recipients as sets, blind included', () => {
    expect(
      sameRecipients({ whisper: ['a', 'b'], blind: false }, { whisper: ['b', 'a'], blind: false })
    ).toBe(true);
    expect(sameRecipients({ whisper: ['a'], blind: false }, { whisper: [], blind: false })).toBe(
      false
    );
    expect(sameRecipients({ whisper: ['a'], blind: true }, { whisper: ['a'], blind: false })).toBe(
      false
    );
  });
});

describe('turn order and NPCs', () => {
  it('sorts by initiative, missing last, then name and id', () => {
    const entries = [
      { id: 'c', name: 'Cara', initiative: null },
      { id: 'b', name: 'Bo', initiative: 12 },
      { id: 'a2', name: 'Al', initiative: 12 },
      { id: 'a1', name: 'Al', initiative: 12 },
      { id: 'd', name: 'Dan', initiative: 20 },
    ];
    expect([...entries].sort(compareTurnOrder).map(e => e.id)).toEqual(['d', 'a1', 'a2', 'b', 'c']);
  });

  it('counts an actor as NPC unless a player owns it explicitly or by default', () => {
    const users = [
      { id: 'gm', isGM: true },
      { id: 'p1', isGM: false },
    ];
    expect(isNonPlayerCharacter({ gm: 3 }, users)).toBe(true);
    expect(isNonPlayerCharacter({ p1: 3 }, users)).toBe(false);
    expect(isNonPlayerCharacter({ default: 3 }, users)).toBe(false);
    expect(isNonPlayerCharacter({ p1: 2 }, users)).toBe(true);
    expect(isNonPlayerCharacter(null, users)).toBe(true);
  });
});

describe('initiative selection', () => {
  const candidates = [
    { id: 'h', name: 'Hero', initiative: null, isNPC: false },
    { id: 'g', name: 'Goblin', initiative: null, isNPC: true },
    { id: 'w', name: 'Wolf', initiative: 7, isNPC: true },
  ];

  it('names every combatant it leaves out', () => {
    expect(selectForInitiative(candidates, { scope: 'npcs', onlyMissing: true })).toEqual({
      selected: [candidates[1]],
      skipped: [
        { id: 'h', name: 'Hero', reason: 'player character' },
        { id: 'w', name: 'Wolf', reason: 'has initiative 7' },
      ],
    });
    expect(
      selectForInitiative(candidates, { scope: 'all', onlyMissing: false }).selected
    ).toHaveLength(3);
  });

  it('takes exactly the named ones, and stops on an unknown or doubled id', () => {
    expect(
      selectForInitiative(candidates, { ids: ['w'], scope: 'all', onlyMissing: true }).selected
    ).toEqual([candidates[2]]);
    expect(() =>
      selectForInitiative(candidates, { ids: ['w', 'x'], scope: 'all', onlyMissing: true })
    ).toThrow(/Not in this encounter: "x"\. Nothing was rolled/);
    expect(() =>
      selectForInitiative(candidates, { ids: ['w', 'w'], scope: 'all', onlyMissing: true })
    ).toThrow(/listed twice/);
  });
});

describe('roll summary', () => {
  it('reads formula, total and single dice, discarded ones as inactive', () => {
    const summary = summarizeRoll({
      formula: '2d20kh + 3',
      total: 18,
      result: '15 + 3',
      dice: [
        {
          expression: '2d20kh',
          faces: 20,
          number: 2,
          total: 15,
          results: [
            { result: 15, active: true },
            { result: 4, active: false, discarded: true },
          ],
        },
      ],
    });
    expect(summary).toEqual({
      formula: '2d20kh + 3',
      total: 18,
      result: '15 + 3',
      dice: [
        {
          expression: '2d20kh',
          faces: 20,
          number: 2,
          total: 15,
          results: [
            { result: 15, active: true },
            { result: 4, active: false },
          ],
        },
      ],
    });
    expect(summarizeRoll(null)).toEqual({ formula: '', total: null, result: null, dice: [] });
  });
});
