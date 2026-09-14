import { describe, expect, it } from 'vitest';
import { parseHtml, splitAtHeadings, textOf } from './html.js';

describe('parseHtml', () => {
  it('keeps offsets into the original markup', () => {
    const html = '<p>a<img src="x>y.png">b</p><!-- c --><div><br/>d</div>';
    const nodes = parseHtml(html);
    expect(nodes.map(node => html.slice(node.start, node.end))).toEqual([
      '<p>a<img src="x>y.png">b</p>',
      '<!-- c -->',
      '<div><br/>d</div>',
    ]);
  });

  it('closes an open paragraph at a block element and ignores stray closing tags', () => {
    const html = '<p>one<h2>Two</h2></span>';
    const nodes = parseHtml(html);
    expect(nodes.map(node => (node.kind === 'element' ? node.tag : node.kind))).toEqual([
      'p',
      'h2',
      'other',
    ]);
  });

  it('does not look for tags inside scripts', () => {
    const html = '<script>if (a < b) "<h1>";</script><h1>Real</h1>';
    expect(parseHtml(html).map(node => (node.kind === 'element' ? node.tag : node.kind))).toEqual([
      'script',
      'h1',
    ]);
  });
});

describe('textOf', () => {
  it('removes tags and decodes entities', () => {
    expect(textOf('<em>Kap.</em>&nbsp;2 &amp; &#228;&#x00FC;')).toBe('Kap. 2 & äü');
  });
});

describe('splitAtHeadings', () => {
  it('cuts at headings up to the level and keeps the markup as it was', () => {
    const html = '<h1>One</h1><p class="x">a</p><h2>Sub</h2><h1>Two &amp; more</h1><p>b</p>';
    expect(splitAtHeadings(html, 1)).toEqual({
      intro: null,
      sections: [
        { title: 'One', html: '<h1>One</h1><p class="x">a</p><h2>Sub</h2>' },
        { title: 'Two & more', html: '<h1>Two &amp; more</h1><p>b</p>' },
      ],
    });
    expect(splitAtHeadings(html, 2).sections.map(section => section.title)).toEqual([
      'One',
      'Sub',
      'Two & more',
    ]);
  });

  it('keeps what stands before the first heading as intro', () => {
    const result = splitAtHeadings('<p>Lead</p>\n<h1>A</h1><h1>B</h1>', 1);
    expect(result.intro).toBe('<p>Lead</p>\n');
  });

  it('treats only white space and comments before the first heading as no intro', () => {
    expect(splitAtHeadings(' <!-- x -->\n<h1>A</h1><h1>B</h1>', 1).intro).toBeNull();
  });

  it('goes into a single wrapper and keeps what stood around it', () => {
    const html =
      '<p>Before</p><div class="chapter"><p>Inner lead</p><h2>A</h2><p>a</p><section><h2>B</h2></section></div><p>After</p>';
    const result = splitAtHeadings(html, 2);
    expect(result.intro).toBe('<p>Before</p><p>Inner lead</p>');
    expect(result.sections).toEqual([
      { title: 'A', html: '<h2>A</h2><p>a</p>' },
      { title: 'B', html: '<section><h2>B</h2></section><p>After</p>' },
    ]);
  });

  it('finds fewer than two sections when there is nothing to split', () => {
    expect(splitAtHeadings('<p>no headings</p>', 1).sections).toEqual([]);
    expect(splitAtHeadings('<h2>A</h2><h2>B</h2>', 1).sections).toEqual([]);
  });

  it('names a heading without text with an empty title', () => {
    expect(splitAtHeadings('<h1><img src="a.png"></h1><h1>B</h1>', 1).sections[0]?.title).toBe('');
  });
});
