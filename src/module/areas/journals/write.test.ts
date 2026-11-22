/**
 * The read-back check of journal pages: what the sanitizer only spells
 * differently is the same page, what it removed is not.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkStored } from './write.js';

/** A browser stand-in whose serializer writes `&#39;` as the apostrophe, as Chromium does. */
function fakeBrowser(): void {
  vi.stubGlobal('document', {
    createElement: () => {
      let html = '';
      return {
        set innerHTML(value: string) {
          html = value.replace(/&#39;/g, "'");
        },
        get innerHTML() {
          return html;
        },
      };
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('checkStored', () => {
  it('accepts a page whose apostrophes the sanitizer wrote back as characters', () => {
    fakeBrowser();
    expect(() =>
      checkStored('Page', '<p>The King&#39;s Road</p>', "<p>The King's Road</p>")
    ).not.toThrow();
  });

  it('still reports markup the sanitizer removed', () => {
    fakeBrowser();
    expect(() => checkStored('Page', '<p>Hi</p><script>alert(1)</script>', '<p>Hi</p>')).toThrow(
      /reads back with 9 characters instead of 34, first difference at character 9/
    );
  });

  it('compares exactly where there is no browser', () => {
    expect(() =>
      checkStored('Page', '<p>The King&#39;s Road</p>', "<p>The King's Road</p>")
    ).toThrow(/first difference at character 11/);
  });
});
