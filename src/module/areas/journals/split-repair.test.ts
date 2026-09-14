/**
 * Splitting pages and repairing imported content, on a fake world.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { FakeFoundry, type FakeFoundryOptions } from '../../../testing/fake-foundry.js';
import { officialCreatureId, rewriteImages } from './repair.js';
import { withPacks } from './testing.js';

let harness: AreaHarness | null = null;
afterEach(() => {
  harness?.close();
  harness = null;
});

const CHAPTER =
  '<p>Read this first.</p><div class="chapter"><h2>Harbour</h2><p>Ships</p><h2></h2><p>Nameless</p><h2>Tower</h2><p>Top</p></div>';

const open = (options: FakeFoundryOptions = {}) => {
  harness = createAreaHarness({
    foundry: new FakeFoundry({
      translations: {
        'ninjos-foundry-mcp.journals.introName': 'Introduction',
        'ninjos-foundry-mcp.journals.sectionName': 'Section {n}',
      },
      ...options,
    }),
  });
  const f = harness.foundry;
  const journal = f.seed('JournalEntry', {
    _id: 'adv',
    name: 'Adventure',
    pages: [
      { _id: 'before', name: 'Cover', type: 'text', text: { content: '' }, sort: 100 },
      { _id: 'big', name: 'Chapter 2', type: 'text', text: { content: CHAPTER }, sort: 200 },
      { _id: 'after', name: 'Appendix', type: 'text', text: { content: '' }, sort: 202 },
      { _id: 'pic', name: 'Picture', type: 'image', src: 'x.png', sort: 300 },
    ],
  });
  return { h: harness, f, journal };
};

const order = (journal: { toObject(): Record<string, unknown> }) =>
  (journal.toObject()['pages'] as Array<{ name: string; sort: number }>)
    .sort((a, b) => a.sort - b.sort)
    .map(page => page.name);

describe('splitJournalPage', () => {
  it('puts the intro and one page per section right behind the source page', async () => {
    const { h, journal } = open();
    const answer = (await h.query('splitJournalPage', {
      journalId: 'adv',
      pageId: 'big',
      level: 2,
      namePrefix: 'Ch. 2:',
    })) as Record<string, any>;
    expect(answer).toMatchObject({
      introPage: true,
      originalDeleted: false,
      sourceLength: CHAPTER.length,
    });
    expect(answer['pages'].map((page: { name: string }) => page.name)).toEqual([
      'Ch. 2: Introduction',
      'Ch. 2: Harbour',
      'Ch. 2: Section 2',
      'Ch. 2: Tower',
    ]);
    expect(order(journal)).toEqual([
      'Cover',
      'Chapter 2',
      'Ch. 2: Introduction',
      'Ch. 2: Harbour',
      'Ch. 2: Section 2',
      'Ch. 2: Tower',
      'Appendix',
      'Picture',
    ]);
    const pages = journal.toObject()['pages'] as Array<{
      name: string;
      text?: { content: string };
    }>;
    expect(pages.find(page => page.name === 'Ch. 2: Introduction')?.text?.content).toBe(
      '<p>Read this first.</p>'
    );
    expect(pages.find(page => page.name === 'Ch. 2: Tower')?.text?.content).toBe(
      '<h2>Tower</h2><p>Top</p>'
    );
  });

  it('refuses when there is nothing to split and suggests a deeper level', async () => {
    const { h, f } = open();
    await expect(h.query('splitJournalPage', { journalId: 'adv', pageId: 'big' })).rejects.toThrow(
      /level=2/
    );
    await expect(h.query('splitJournalPage', { journalId: 'adv', pageId: 'pic' })).rejects.toThrow(
      /image page/
    );
    await expect(
      h.query('splitJournalPage', { journalId: 'adv', pageId: 'big', level: 7 })
    ).rejects.toThrow(/1 to 6/);
    expect(f.operations).toEqual([]);
  });

  it('deletes the source page only at the full level, checked before anything is created', async () => {
    const denied = open();
    await expect(
      denied.h.query('splitJournalPage', {
        journalId: 'adv',
        pageId: 'big',
        level: 2,
        deleteOriginal: true,
      })
    ).rejects.toMatchObject({ moduleCode: 'PERMISSION_DENIED' });
    expect(denied.f.operations).toEqual([]);
    harness?.close();

    const full = open({ settings: { 'ninjos-foundry-mcp.permJournals': 'full' } });
    await expect(
      full.h.query('splitJournalPage', {
        journalId: 'adv',
        pageId: 'big',
        level: 2,
        deleteOriginal: true,
      })
    ).resolves.toMatchObject({ originalDeleted: true });
    expect(order(full.journal)).not.toContain('Chapter 2');
  });
});

describe('rewriteImages', () => {
  it('replaces only matching img addresses, keeps the quoting, and reports addresses without a file name', () => {
    const html =
      '<img class="a" src="HTTPS://cdn.test/img/a.webp?v=2"><img src=\'https://cdn.test/img/b.png\'><img src="https://other/c.png"><img src="https://cdn.test/img/">';
    expect(rewriteImages(html, 'https://cdn.test/', 'Bilder/Abenteuer/')).toEqual({
      html: '<img class="a" src="Bilder/Abenteuer/a.webp"><img src=\'Bilder/Abenteuer/b.png\'><img src="https://other/c.png"><img src="https://cdn.test/img/">',
      count: 2,
      examples: [
        'HTTPS://cdn.test/img/a.webp?v=2 -> Bilder/Abenteuer/a.webp',
        'https://cdn.test/img/b.png -> Bilder/Abenteuer/b.png',
      ],
      skipped: ['https://cdn.test/img/'],
    });
  });
});

describe('rewriteJournalImages', () => {
  it('writes nothing in a dry run and the same report either way', async () => {
    const { h, f, journal } = open();
    await journal.updateEmbeddedDocuments('JournalEntryPage', [
      { _id: 'before', 'text.content': '<img src="https://cdn.test/a.png">' },
    ]);
    const writes = f.operations.length;
    const args = { journalId: 'adv', urlPattern: 'https://cdn.test/', localPrefix: 'Bilder' };
    const dry = (await h.query('rewriteJournalImages', { ...args, dryRun: true })) as Record<
      string,
      unknown
    >;
    expect(f.operations.length).toBe(writes);
    const real = (await h.query('rewriteJournalImages', args)) as Record<string, unknown>;
    expect({ ...dry, dryRun: false }).toEqual(real);
    expect(real).toMatchObject({
      replacements: 1,
      pagesChecked: 3,
      pagesChanged: [{ id: 'before', replacements: 1 }],
    });
    await expect(h.query('rewriteJournalImages', { ...args, pageId: 'pic' })).rejects.toThrow(
      /image page/
    );
  });
});

describe('linkJournalTags', () => {
  const packs = (f: FakeFoundry) =>
    withPacks(f, [
      {
        id: 'de.monsters',
        documentName: 'Actor',
        entries: [
          { _id: 'mmAdultRedDragon', name: 'Ausgewachsener roter Drache' },
          { _id: 'gob', name: 'Goblin' },
        ],
      },
      { id: 'dnd5e.monsters', documentName: 'Actor', entries: [{ _id: 'gob2', name: 'goblin' }] },
      { id: 'dnd5e.items', documentName: 'Item', entries: [{ _id: 'rope', name: 'Rope' }] },
    ]);

  it('links by name in pack order, by the official id, and lists what stayed unresolved', async () => {
    const { h, f, journal } = open();
    packs(f);
    await journal.updateEmbeddedDocuments('JournalEntryPage', [
      {
        _id: 'before',
        'text.content':
          '@creature[Goblin|MM] and @creature[Adult Red Dragon|MM|the dragon] use @item[rope|PHB], not @item[Sword|PHB] or @creature[Nobody]',
      },
    ]);
    const answer = (await h.query('linkJournalTags', {
      journalId: 'adv',
      actorPacks: ['de.monsters', 'dnd5e.monsters'],
      itemPacks: ['dnd5e.items'],
    })) as Record<string, any>;
    expect(answer).toMatchObject({ links: 3, unresolved: ['creature: Nobody', 'item: Sword'] });
    expect(f.fromUuid('JournalEntry.adv.JournalEntryPage.before')?.['text']).toEqual({
      content:
        '@UUID[Compendium.de.monsters.Actor.gob]{Goblin} and @UUID[Compendium.de.monsters.Actor.mmAdultRedDragon]{the dragon} use ' +
        '@UUID[Compendium.dnd5e.items.Item.rope]{Rope}, not @item[Sword|PHB] or @creature[Nobody]',
    });
  });

  it('refuses an unknown pack or a pack of the wrong type before writing', async () => {
    const { h, f } = open();
    packs(f);
    await expect(
      h.query('linkJournalTags', { journalId: 'adv', actorPacks: ['missing'] })
    ).rejects.toThrow('Compendium pack not found: missing');
    await expect(
      h.query('linkJournalTags', { journalId: 'adv', actorPacks: ['dnd5e.items'] })
    ).rejects.toThrow(/holds Item documents/);
  });

  it('derives the official creature id', () => {
    expect(officialCreatureId('Adult Red Dragon')).toBe('mmAdultRedDragon');
    expect(officialCreatureId('Ogre')).toBe('mmOgre0000000000');
    expect(officialCreatureId('Young Brass Dragon Wyrmling')).toBe('mmYoungBrassDrag');
    // Only letters, digits and spaces are kept, and each word goes on in lower case.
    expect(officialCreatureId('Half-Dragon')).toBe('mmHalfdragon0000');
    expect(officialCreatureId('GIANT  rat')).toBe('mmGiantRat000000');
  });
});
