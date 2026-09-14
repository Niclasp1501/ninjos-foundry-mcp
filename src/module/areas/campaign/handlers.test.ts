/**
 * The handlers of the campaign area through the dispatcher: permissions, what is
 * written, that it is read back, and that no content of a long page is lost.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import {
  FakeFoundry,
  type FakeDocument,
  type FakeFoundryOptions,
} from '../../../testing/fake-foundry.js';

let harness: AreaHarness | null = null;
afterEach(() => {
  harness?.close();
  harness = null;
});

const open = (options: FakeFoundryOptions = {}) =>
  (harness = createAreaHarness({ foundry: new FakeFoundry(options) }));

const journals = (h: AreaHarness) => h.foundry.collection('JournalEntry');
const pagesOf = (journal: FakeDocument) =>
  journal.getEmbeddedCollection('JournalEntryPage').contents;
const contentOf = (page: FakeDocument) => (page['text'] as { content: string }).content;

async function quest(h: AreaHarness, args: Record<string, unknown> = {}) {
  return (await h.query('createQuestJournal', {
    questTitle: 'The Lost Seal',
    questDescription: 'Recover the seal.',
    questGiver: 'Mira',
    ...args,
  })) as { journalId: string; pageCount: number; pages: Array<{ id: string }> };
}

describe('createCampaignDashboard', () => {
  it('creates a Gamemaster-only dashboard in a folder named after the campaign, with its structure in the flags', async () => {
    const h = open();
    const answer = (await h.query('createCampaignDashboard', {
      campaignTitle: 'Whisperstone',
      campaignDescription: 'A conspiracy.',
      template: 'dungeon-crawl',
      defaultLocation: 'Harbour',
    })) as Record<string, unknown>;
    expect(answer).toMatchObject({
      success: true,
      dashboardName: 'Whisperstone (Campaign Dashboard)',
      message: 'Campaign dashboard "Whisperstone" created successfully with 4 parts',
      folder: { path: 'Whisperstone', created: true },
    });
    const journal = journals(h).get(answer['dashboardJournalId'] as string) as FakeDocument;
    expect(journal['ownership']).toEqual({ default: 0 });
    const structure = (
      journal['flags'] as Record<string, Record<string, { id: string; parts: unknown[] }>>
    )['ninjos-foundry-mcp']?.['campaign'];
    expect(structure?.id).toBe(answer['campaignId']);
    expect(structure?.parts).toHaveLength(4);
    const [page] = pagesOf(journal);
    expect(page?.['name']).toBe('Dashboard');
    expect(contentOf(page as FakeDocument)).toContain(
      `data-campaign-dashboard="${answer['campaignId']}"`
    );
    const folder = h.foundry.collection('Folder').contents[0];
    expect(folder?.['flags']).toEqual({
      'ninjos-foundry-mcp': {
        createdByMcp: true,
        mcpGenerated: true,
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        questContext: 'Whisperstone',
      },
    });
    expect(answer).not.toHaveProperty('warnings');
    // The change log lists newest first: the folder was created before the journal.
    expect(h.changeLog.list().map(entry => entry.document)).toEqual(['Journals', 'Folders']);
  });

  it('refuses custom without parts, parts without custom, and levels out of order, before writing', async () => {
    const h = open();
    const base = { campaignTitle: 'C', campaignDescription: 'd' };
    await expect(
      h.query('createCampaignDashboard', { ...base, template: 'custom' })
    ).rejects.toThrow('template "custom" needs customParts with at least one part');
    await expect(
      h.query('createCampaignDashboard', { ...base, template: 'sandbox', customParts: [] })
    ).rejects.toThrow('customParts is only used with template "custom"');
    await expect(
      h.query('createCampaignDashboard', {
        ...base,
        template: 'custom',
        customParts: [
          { title: 'A', description: 'a', type: 'chapter', levelStart: 5, levelEnd: 2 },
        ],
      })
    ).rejects.toMatchObject({ moduleCode: 'INVALID_ARGUMENT' });
    expect(h.foundry.operations).toEqual([]);
  });

  it('is refused with the write switch off and for a player', async () => {
    const args = { campaignTitle: 'C', campaignDescription: 'd', template: 'sandbox' };
    const off = open({ settings: { 'ninjos-foundry-mcp.allowWriteOperations': false } });
    await expect(off.query('createCampaignDashboard', args)).rejects.toMatchObject({
      moduleCode: expect.stringMatching(/WRITE|DENIED/),
    });
    expect(off.foundry.operations).toEqual([]);
    off.close();
    const player = open({
      users: [
        { id: 'gm', name: 'GM', isGM: true },
        { id: 'p', name: 'Player' },
      ],
      user: 'p',
    });
    await expect(player.query('createCampaignDashboard', args)).rejects.toMatchObject({
      moduleCode: 'ACCESS_DENIED',
    });
  });
});

describe('createQuestJournal and createJournalEntry', () => {
  it('creates the quest page and the additional pages as sent, without a folder unless one is named', async () => {
    const h = open();
    const handout = '<p>Handout <strong>as sent</strong></p>';
    const answer = await quest(h, { additionalPages: [{ name: 'Handout', content: handout }] });
    expect(answer).toMatchObject({ success: true, pageCount: 2, folder: null });
    expect(answer).not.toHaveProperty('html');
    const journal = journals(h).get(answer.journalId) as FakeDocument;
    expect(journal['folder']).toBeUndefined();
    const [first, second] = pagesOf(journal);
    expect(first?.['name']).toBe('Quest details');
    expect(contentOf(second as FakeDocument)).toBe(handout);
  });

  it('puts the quest into an existing folder by exact name', async () => {
    const h = open();
    const folder = h.foundry.seed('Folder', { name: 'Quests', type: 'JournalEntry' });
    const answer = await quest(h, { folderName: 'Quests' });
    expect(journals(h).get(answer.journalId)?.['folder']).toBe(folder.id);
    expect(h.foundry.collection('Folder').size).toBe(1);
  });

  it('answers the query of the previous server with id, name and pageCount', async () => {
    const h = open();
    const answer = (await h.query('createJournalEntry', {
      name: 'Old style',
      content: '<h1>Built by the server</h1>',
      folderName: 'Old style',
    })) as Record<string, unknown>;
    expect(answer).toMatchObject({ success: true, name: 'Old style', pageCount: 1 });
    expect(
      contentOf(pagesOf(journals(h).get(answer['id'] as string) as FakeDocument)[0] as FakeDocument)
    ).toBe('<h1>Built by the server</h1>');
  });
});

describe('linkQuestToNpc', () => {
  it('links an actor once per role and writes nothing the second time', async () => {
    const h = open();
    const actor = h.foundry.seed('Actor', { name: 'Vex', type: 'npc' });
    const { journalId } = await quest(h);
    const first = (await h.query('linkQuestToNpc', {
      journalId,
      npcName: 'Vex',
      relationship: 'quest_giver',
    })) as Record<string, unknown>;
    expect(first).toMatchObject({
      changed: true,
      placement: 'overview',
      npc: { linked: true, actorId: actor.id },
      message: 'Linked Vex to quest as quest giver',
    });
    const writes = h.foundry.operations.length;
    const again = (await h.query('linkQuestToNpc', {
      journalId,
      npcName: actor.id,
      relationship: 'quest_giver',
    })) as Record<string, unknown>;
    expect(again['changed']).toBe(false);
    expect(h.foundry.operations).toHaveLength(writes);
    const html = contentOf(pagesOf(journals(h).get(journalId) as FakeDocument)[0] as FakeDocument);
    expect(html).toContain(`@UUID[Actor.${actor.id}]{Vex}: quest giver`);
  });

  it('writes an unknown figure as text and says so, and refuses an ambiguous name', async () => {
    const h = open();
    const { journalId } = await quest(h);
    const answer = (await h.query('linkQuestToNpc', {
      journalId,
      npcName: 'Nobody',
      relationship: 'enemy',
    })) as Record<string, unknown>;
    expect(answer['npc']).toMatchObject({ linked: false, actorId: null });
    expect(answer['notes']).toEqual([
      'No actor named "Nobody" is in the world, so the name was written as text without a link.',
    ]);
    h.foundry.seed('Actor', { name: 'Twin', type: 'npc' });
    h.foundry.seed('Actor', { name: 'Twin', type: 'npc' });
    await expect(
      h.query('linkQuestToNpc', { journalId, npcName: 'Twin', relationship: 'ally' })
    ).rejects.toMatchObject({
      moduleCode: 'AMBIGUOUS',
    });
  });

  it('keeps every character of a long foreign page', async () => {
    const h = open();
    const long = `<p>${'Lore '.repeat(60_000)}</p>`;
    const journal = h.foundry.seed('JournalEntry', {
      name: 'Old',
      pages: [{ name: 'Text', type: 'text', text: { content: long, format: 1 }, sort: 100 }],
    });
    await h.query('linkQuestToNpc', {
      journalId: journal.id,
      npcName: 'Mira',
      relationship: 'contact',
    });
    const stored = contentOf(pagesOf(journal)[0] as FakeDocument);
    expect(stored.length).toBeGreaterThan(300_000);
    expect(stored.startsWith(long)).toBe(true);
  });

  it('names a journal without a text page', async () => {
    const h = open();
    const journal = h.foundry.seed('JournalEntry', {
      name: 'Pictures',
      pages: [{ name: 'Map', type: 'image', src: 'map.webp' }],
    });
    await expect(
      h.query('linkQuestToNpc', { journalId: journal.id, npcName: 'Mira', relationship: 'ally' })
    ).rejects.toThrow('journal "Pictures"');
  });
});

describe('updateQuestJournal', () => {
  it('adds a completion to the progress notes, sets the status and reports lengths instead of HTML', async () => {
    const h = open();
    const { journalId } = await quest(h);
    const answer = (await h.query('updateQuestJournal', {
      journalId,
      newContent: 'The seal is back.\nEveryone cheers.',
      updateType: 'completion',
    })) as Record<string, unknown>;
    expect(answer).toMatchObject({
      success: true,
      placement: 'progress',
      statusChanged: true,
      status: 'completed',
      verified: true,
      message: 'Quest journal updated with completion',
    });
    expect(answer['lengthAfter']).toBeGreaterThan(answer['lengthBefore'] as number);
    expect(answer).not.toHaveProperty('content');
    const html = contentOf(pagesOf(journals(h).get(journalId) as FakeDocument)[0] as FakeDocument);
    expect(html).toContain('<p>The seal is back.<br>Everyone cheers.</p>');
    expect(html).toContain('data-campaign-quest-status="completed"');
    expect(h.changeLog.list()[0]?.before).toBeDefined();
  });

  it('appends to a chosen page as sent, and keeps a long page whole', async () => {
    const h = open();
    const long = `<p>${'x'.repeat(260_000)}</p>`;
    const journal = h.foundry.seed('JournalEntry', {
      name: 'Old',
      pages: [
        { _id: 'first', name: 'First', type: 'text', text: { content: '<p>a</p>' }, sort: 100 },
        { _id: 'second', name: 'Second', type: 'text', text: { content: long }, sort: 200 },
      ],
    });
    const answer = (await h.query('updateQuestJournal', {
      journalId: journal.id,
      pageId: 'second',
      newContent: '**not markdown** <em>html</em>',
      updateType: 'progress',
    })) as Record<string, unknown>;
    expect(answer).toMatchObject({ pageId: 'second', lengthBefore: long.length });
    expect(
      contentOf(journal.getEmbeddedCollection('JournalEntryPage').get('second') as FakeDocument)
    ).toBe(`${long}**not markdown** <em>html</em>`);
  });

  it('creates a new page, refuses pageId together with newPageName, and a picture page', async () => {
    const h = open();
    const { journalId } = await quest(h);
    const created = (await h.query('updateQuestJournal', {
      journalId,
      newPageName: 'Session 3',
      newContent: 'They met the king.',
      updateType: 'modification',
    })) as Record<string, unknown>;
    expect(created).toMatchObject({ createdPage: true, pageName: 'Session 3', verified: true });
    await expect(
      h.query('updateQuestJournal', {
        journalId,
        pageId: 'x',
        newPageName: 'y',
        newContent: 'z',
        updateType: 'progress',
      })
    ).rejects.toThrow('Pass either pageId');
    const pictures = h.foundry.seed('JournalEntry', {
      name: 'Pictures',
      pages: [{ _id: 'img', name: 'Map', type: 'image', src: 'map.webp' }],
    });
    await expect(
      h.query('updateQuestJournal', {
        journalId: pictures.id,
        pageId: 'img',
        newContent: 'z',
        updateType: 'progress',
      })
    ).rejects.toMatchObject({ moduleCode: 'INVALID_ARGUMENT' });
  });

  it('fails with the cause when Foundry stores something else than was sent', async () => {
    const h = open();
    h.foundry.defineDocumentType('JournalEntryPage', {
      extend: page => {
        const update = page.update.bind(page);
        page['update'] = (changes: Record<string, unknown>) =>
          update({
            ...changes,
            'text.content': String(changes['text.content']).replace(/<em>.*<\/em>/, ''),
          });
      },
    });
    const journal = h.foundry.seed('JournalEntry', {
      name: 'Old',
      pages: [{ name: 'Text', type: 'text', text: { content: '<p>a</p>' } }],
    });
    await expect(
      h.query('updateQuestJournal', {
        journalId: journal.id,
        newContent: '<em>gone</em>',
        updateType: 'progress',
      })
    ).rejects.toMatchObject({ moduleCode: 'VERIFY_FAILED' });
  });
});

describe('updateCampaignProgress', () => {
  it('answers as before and says that it changed nothing', async () => {
    const h = open();
    await expect(
      h.query('updateCampaignProgress', {
        campaignId: 'c',
        partId: 'part-1',
        newStatus: 'completed',
      })
    ).resolves.toMatchObject({ success: true, changed: false, campaignId: 'c', partId: 'part-1' });
    expect(h.foundry.operations).toEqual([]);
  });
});
