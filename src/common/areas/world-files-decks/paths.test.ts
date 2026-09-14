import { describe, expect, it } from 'vitest';
import {
  checkFileName,
  extensionProblem,
  normalizePath,
  PathError,
  pathsInText,
  referencedPath,
  stringsOf,
  writeProblem,
} from './paths.js';

describe('normalizePath', () => {
  it('trims slashes, collapses doubles and decodes', () => {
    expect(normalizePath(' /worlds//w/Karten%20Alt/ ', 'path')).toBe('worlds/w/Karten Alt');
    expect(normalizePath('./a/b', 'path')).toBe('a/b');
    expect(normalizePath('', 'path', true)).toBe('');
  });

  it('refuses what could mean another place', () => {
    for (const bad of ['../x', 'a/../b', 'a\\b', 'C:/x', 'https://x/y.png', '//host/x', 'a/./b']) {
      expect(() => normalizePath(bad, 'path')).toThrow(PathError);
    }
    expect(() => normalizePath('', 'path')).toThrow('must not be empty');
    expect(() => normalizePath(5, 'path')).toThrow('must be a text');
  });
});

describe('write rules', () => {
  it('never writes into packages or another world', () => {
    expect(writeProblem('modules/x/a.png', 'w')).toContain('installed packages');
    expect(writeProblem('systems', 'w')).toContain('installed packages');
    expect(writeProblem('worlds/other/a.png', 'w')).toContain('another world');
    expect(writeProblem('worlds', 'w')).toContain('directly into');
    expect(writeProblem('worlds/w/maps', 'w')).toBeNull();
    expect(writeProblem('assets/maps', 'w')).toBeNull();
  });

  it('checks names and extensions', () => {
    expect(checkFileName(' map.webp ', 'name')).toBe('map.webp');
    expect(() => checkFileName('a/b.png', 'name')).toThrow('without folders');
    expect(() => checkFileName('.hidden.png', 'name')).toThrow('dot');
    expect(() => checkFileName('noext', 'name')).toThrow('extension');
    expect(extensionProblem('x.JS', null)).toContain('never written');
    expect(extensionProblem('x.pdf', new Set(['png']))).toContain('does not accept');
    expect(extensionProblem('x.png', new Set(['png']))).toBeNull();
  });
});

describe('references', () => {
  it('reads local file paths only', () => {
    expect(referencedPath('worlds/w/a%20b.png?v=2')).toBe('worlds/w/a b.png');
    expect(referencedPath('/icons/svg/x.svg')).toBe('icons/svg/x.svg');
    for (const not of [
      'https://x/a.png',
      'data:image/png;base64,AA',
      'Just some text.',
      'notes.docx',
      '@UUID[x]',
    ]) {
      expect(referencedPath(not)).toBeNull();
    }
  });

  it('finds paths in markup and in whole strings', () => {
    expect(
      pathsInText(
        '<p><img src="worlds/w/a.png"> <a href=\'docs/b.pdf\'>b</a><div style="background: url(c/d.webp)"></div>'
      )
    ).toEqual(['worlds/w/a.png', 'docs/b.pdf', 'c/d.webp']);
    expect(pathsInText('tokens/goblin.webp')).toEqual(['tokens/goblin.webp']);
    expect(pathsInText('a goblin with tokens/goblin.webp inside')).toEqual([]);
  });

  it('names every string with its field, list entries by id', () => {
    const rows = stringsOf({
      _id: 'x',
      _stats: { a: 'b' },
      img: 'a.png',
      tokens: [{ _id: 't1', texture: { src: 'b.png' } }, 'c.png'],
    });
    expect(rows).toEqual([
      { field: 'img', value: 'a.png' },
      { field: 'tokens[t1].texture.src', value: 'b.png' },
      { field: 'tokens[1]', value: 'c.png' },
    ]);
  });
});
