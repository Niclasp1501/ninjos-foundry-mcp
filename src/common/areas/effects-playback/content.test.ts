import { describe, expect, it } from 'vitest';
import { isBlank, prepareContent } from './content.js';

describe('prepareContent', () => {
  it('keeps content with markup byte for byte, Markdown characters included', () => {
    const html = '<h2>**Loot**</h2>\n- <em>not a list</em> # nor a heading';
    expect(prepareContent(html)).toEqual({ html, format: 'html', note: null });
  });

  it('turns plain text into paragraphs and single breaks into <br>', () => {
    expect(prepareContent('  First line\r\nsecond line\n\n\nNext paragraph  ')).toEqual({
      html: '<p>First line<br>second line</p><p>Next paragraph</p>',
      format: 'text',
      note: null,
    });
  });

  it('escapes angle brackets and a bare ampersand, but keeps entities', () => {
    expect(prepareContent('a < b & c &amp; d &#169;').html).toBe(
      '<p>a &lt; b &amp; c &amp; d &#169;</p>'
    );
  });

  it('removes nothing from text that looks like Markdown, and says so', () => {
    const prepared = prepareContent('## Loot\n- **gold**');
    expect(prepared.html).toBe('<p>## Loot<br>- **gold**</p>');
    expect(prepared.note).toMatch(/looks like Markdown/);
  });

  it('knows blank content', () => {
    expect(isBlank(' \n\t')).toBe(true);
    expect(isBlank('x')).toBe(false);
  });
});
