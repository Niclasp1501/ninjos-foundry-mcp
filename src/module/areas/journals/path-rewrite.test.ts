import { describe, expect, it } from 'vitest';
import { makePathRule, rewriteData, rewriteString } from './path-rewrite.js';

const rule = makePathRule('Bilder/Token/', 'Bilder/Figuren');

describe('makePathRule', () => {
  it('refuses a short, an empty or an unchanged prefix', () => {
    expect(() => makePathRule('ab', 'x')).toThrow(/at least 3 characters/);
    expect(() => makePathRule('abc', '  ')).toThrow(/to must not be empty/);
    expect(() => makePathRule('abc/', 'abc')).toThrow(/the same/);
    expect(() => makePathRule('K%C3%BCstenweg', 'Küstenweg')).toThrow(/same path/);
  });
});

describe('rewriteString', () => {
  it('matches only at the start and only up to a path boundary', () => {
    expect(rewriteString('Bilder/Token/a.png', rule).value).toBe('Bilder/Figuren/a.png');
    expect(rewriteString('Bilder/Token', rule).value).toBe('Bilder/Figuren');
    expect(rewriteString('Bilder/Tokenringe/a.png', rule).count).toBe(0);
    expect(rewriteString('Alt/Bilder/Token/a.png', rule).count).toBe(0);
  });

  it('keeps a leading slash', () => {
    expect(rewriteString('/Bilder/Token/a.png', rule).value).toBe('/Bilder/Figuren/a.png');
  });

  it('finds paths inside HTML attributes and CSS', () => {
    const html =
      '<p>Bilder/Token/x</p><img src="Bilder/Token/a.png"><div style="background:url(Bilder/Token/b.png)">';
    const result = rewriteString(html, rule);
    expect(result.count).toBe(2);
    expect(result.value).toBe(
      '<p>Bilder/Token/x</p><img src="Bilder/Figuren/a.png"><div style="background:url(Bilder/Figuren/b.png)">'
    );
    expect(result.examples[0]).toBe('Bilder/Token/a.png -> Bilder/Figuren/a.png');
  });

  it('matches the encoded spelling and writes the target in the spelling found', () => {
    const encoded = makePathRule('Karten/Küstenweg', 'Karten/Nordküste');
    expect(rewriteString('Karten/K%C3%BCstenweg/Hafen%20Ost.webp', encoded).value).toBe(
      'Karten/Nordk%C3%BCste/Hafen%20Ost.webp'
    );
    expect(rewriteString('Karten/Küstenweg/Hafen Ost.webp', encoded).value).toBe(
      'Karten/Nordküste/Hafen Ost.webp'
    );
  });

  it('does not treat a space as a boundary in a plain path', () => {
    expect(rewriteString('Bilder/Token Alt/a.png', rule).count).toBe(0);
  });
});

describe('rewriteData', () => {
  it('builds dotted changes, replaces lists whole and leaves skipped fields alone', () => {
    const data = {
      _id: 'x',
      img: 'Bilder/Token/a.png',
      texture: { src: 'Bilder/Token/b.png', tint: '#fff' },
      tags: ['keep', 'Bilder/Token/c.png'],
      flags: { 'my.module': { art: 'Bilder/Token/d.png' } },
      folder: 'Bilder/Token',
    };
    const result = rewriteData(data, rule, new Set(['_id', 'folder']));
    expect(result.count).toBe(4);
    expect(result.changes).toEqual({
      img: 'Bilder/Figuren/a.png',
      'texture.src': 'Bilder/Figuren/b.png',
      tags: ['keep', 'Bilder/Figuren/c.png'],
      flags: { 'my.module': { art: 'Bilder/Figuren/d.png' } },
    });
  });
});
