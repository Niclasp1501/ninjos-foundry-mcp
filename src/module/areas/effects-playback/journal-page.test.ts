import { afterEach, describe, expect, it } from 'vitest';
import { MODULE_ID } from '../../../common/constants.js';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { FakeFoundry, type FakeFoundryOptions } from '../../../testing/fake-foundry.js';

let harness: AreaHarness | null = null;
afterEach(() => {
  harness?.close();
  harness = null;
});

function world(options: FakeFoundryOptions = {}) {
  const h = (harness = createAreaHarness({ foundry: new FakeFoundry(options) }));
  const journal = h.foundry.seed('JournalEntry', {
    _id: 'lore',
    name: 'Lore',
    pages: [
      { _id: 'intro', name: 'Intro', type: 'text', text: { content: '<p>old</p>', format: 1 } },
      { _id: 'map', name: 'Map', type: 'image', src: 'maps/a.webp' },
    ],
  });
  const page = (journal as unknown as { pages: Map<string, Record<string, any>> }).pages.get(
    'intro'
  )!;
  return { h, page };
}

const replace = (h: AreaHarness, data: Record<string, unknown>) =>
  h.query('replaceJournalPage', data) as Promise<Record<string, any>>;

describe('replaceJournalPage', () => {
  it('writes paragraphs and the new name in one update and reads both back', async () => {
    const { h, page } = world();
    const answer = await replace(h, {
      journalId: 'lore',
      pageId: 'intro',
      newContent: 'Line one\nline two\n\nSecond',
      newPageName: 'Introduction',
    });
    expect(answer).toEqual({
      success: true,
      message: 'Page content replaced successfully',
      journalId: 'lore',
      pageId: 'intro',
      pageName: 'Introduction',
      previousName: 'Intro',
      length: 40,
      format: 'text',
      verified: true,
      details: 'Page content replaced and read back identical. New content length: 40 characters.',
    });
    expect(page['text'].content).toBe('<p>Line one<br>line two</p><p>Second</p>');
    expect(h.foundry.operations).toHaveLength(1);
    expect(h.changeLog.list()[0]).toMatchObject({
      tool: 'replace-journal-page',
      before: { name: 'Intro', 'text.content': '<p>old</p>' },
    });
  });

  it('keeps HTML as sent, asterisks and all, and does not send the content back', async () => {
    const { h, page } = world();
    const html = '<p>**not bold**</p>\n- <em>kept</em>';
    const answer = await replace(h, { journalId: 'lore', pageId: 'intro', newContent: html });
    expect(page['text'].content).toBe(html);
    expect(answer).toMatchObject({ format: 'html', pageName: 'Intro' });
    expect(JSON.stringify(answer)).not.toContain('not bold');
  });

  it('refuses image pages and blank content without writing', async () => {
    const { h } = world();
    await expect(replace(h, { journalId: 'lore', pageId: 'map', newContent: 'x' })).rejects.toThrow(
      /page "Map" \(map\) is a image page; only text pages have HTML content/
    );
    await expect(
      replace(h, { journalId: 'lore', pageId: 'intro', newContent: '  \n' })
    ).rejects.toThrow(/newContent is empty or only white space; nothing was changed/);
    expect(h.foundry.operations).toEqual([]);
  });

  it('fails when Foundry stores something else', async () => {
    const { h, page } = world();
    page['update'] = async () => {
      page['text'].content = '<p>cleaned</p>';
      return page;
    };
    await expect(
      replace(h, { journalId: 'lore', pageId: 'intro', newContent: '<p>x</p><script>1</script>' })
    ).rejects.toMatchObject({ moduleCode: 'VERIFY_FAILED' });
  });

  it('is held by the switch and names an unknown page', async () => {
    const off = world({ settings: { [`${MODULE_ID}.allowWriteOperations`]: false } });
    await expect(
      replace(off.h, { journalId: 'lore', pageId: 'intro', newContent: 'x' })
    ).rejects.toMatchObject({
      moduleCode: 'WRITE_DISABLED',
    });
    off.h.close();
    const { h } = world();
    await expect(
      replace(h, { journalId: 'lore', pageId: 'nope', newContent: 'x' })
    ).rejects.toThrow('Page not found: nope (journal "Lore", lore)');
  });
});
