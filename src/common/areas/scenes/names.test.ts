import { describe, expect, it } from 'vitest';
import { lookup, lookupFailure } from './lookup.js';
import {
  derivedNavName,
  encodeMediaPath,
  isVideoPath,
  readableName,
  splitFolderPath,
} from './names.js';

describe('scene names', () => {
  it('turns underscores into spaces and drops the SC_ or BM_ prefix for the navigation', () => {
    expect(readableName('SC_Hafen_Nacht')).toBe('SC Hafen Nacht');
    expect(derivedNavName('SC_Hafen_Nacht')).toBe('Hafen Nacht');
    expect(derivedNavName('BM_Kerker')).toBe('Kerker');
    expect(derivedNavName('Taverne')).toBe('Taverne');
  });

  it('encodes a media path once and never twice', () => {
    const raw = 'Maps/Küstenweg/Hafen Nacht.webp';
    const once = encodeMediaPath(raw);
    expect(once).toBe('Maps/K%C3%BCstenweg/Hafen%20Nacht.webp');
    expect(encodeMediaPath(once)).toBe(once);
    expect(encodeMediaPath('Maps/100%.png')).toBe('Maps/100%25.png');
    expect(encodeMediaPath('Maps/a#b.png')).toBe('Maps/a%23b.png');
  });

  it('splits folder paths and recognises videos', () => {
    expect(splitFolderPath(' Locations / Harbour/ ')).toEqual(['Locations', 'Harbour']);
    expect(splitFolderPath('')).toEqual([]);
    expect(isVideoPath('Maps/Fluss.webm')).toBe(true);
    expect(isVideoPath('Maps/Fluss.webp')).toBe(false);
  });
});

describe('the one lookup rule', () => {
  const entries = [
    { id: 'a1', name: 'Hafen' },
    { id: 'a2', name: 'Hafen Nacht' },
    { id: 'a3', name: 'Kerker' },
    { id: 'a4', name: 'kerker' },
    { id: 'a5', name: 'Taverne' },
  ];

  it('takes the id first, then the exact name, then the name in any case', () => {
    expect(lookup(entries, 'a3')).toMatchObject({ found: true, by: 'id' });
    expect(lookup(entries, 'Hafen')).toMatchObject({
      found: true,
      entry: { id: 'a1' },
      by: 'name',
    });
    expect(lookup(entries, 'taverne')).toMatchObject({
      found: true,
      entry: { id: 'a5' },
      by: 'name-any-case',
    });
    expect(lookup(entries, 'Kerker')).toMatchObject({ found: true, entry: { id: 'a3' } });
  });

  it('reports several names in any case as ambiguous, with every id', () => {
    const result = lookup(entries, 'KERKER');
    expect(result).toMatchObject({ found: false, reason: 'ambiguous' });
    if (result.found) return;
    expect(lookupFailure('scene', 'KERKER', result)).toBe(
      'The scene identifier "KERKER" is ambiguous: it matches 2 scenes ("Kerker" [a3], "kerker" [a4]). Pass the id instead.'
    );
  });

  it('never matches a part of a name, and offers such names as a hint only', () => {
    const result = lookup(entries, 'Nacht');
    expect(result).toMatchObject({ found: false, reason: 'missing' });
    if (result.found) return;
    expect(lookupFailure('scene', 'Nacht', result)).toBe(
      'Scene not found: "Nacht". Names containing it: "Hafen Nacht" [a2].'
    );
  });

  it('can leave out the id for folder names', () => {
    expect(lookup(entries, 'a1', { byId: false })).toMatchObject({ found: false });
  });
});
