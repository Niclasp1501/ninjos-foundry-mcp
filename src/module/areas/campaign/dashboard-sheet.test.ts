/**
 * The dashboard toggles on the page the package wrote: figures and locks
 * follow the saved status, a Gamemaster's click is saved and read back, a
 * player's click changes nothing, and a failed save puts the toggle back.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { FakeFoundry, type FakeDocument } from '../../../testing/fake-foundry.js';
import {
  enhanceDashboards,
  installDashboardHooks,
  journalOfSheet,
  onJournalSheetRender,
  toggleStatus,
} from './dashboard-sheet.js';
import { parseHtml, settle, type FakeElement } from './testing.js';

let harness: AreaHarness | null = null;
afterEach(() => {
  harness?.close();
  harness = null;
});

async function dashboard() {
  const h = (harness = createAreaHarness({
    foundry: new FakeFoundry({
      users: [
        { id: 'gm', name: 'GM', isGM: true },
        { id: 'p', name: 'Player' },
      ],
    }),
  }));
  const answer = (await h.query('createCampaignDashboard', {
    campaignTitle: 'C',
    campaignDescription: 'd',
    template: 'dungeon-crawl',
  })) as { dashboardJournalId: string; campaignId: string };
  const journal = h.foundry
    .collection('JournalEntry')
    .get(answer.dashboardJournalId) as FakeDocument;
  const page = journal.getEmbeddedCollection('JournalEntryPage').contents[0] as FakeDocument;
  const element = parseHtml((page['text'] as { content: string }).content);
  const journalView = journal as unknown as FoundryCampaignJournal;
  const root = element.querySelector('[data-campaign-dashboard]') as FakeElement;
  const toggle = (id: string) =>
    root.querySelector(`[data-campaign-toggle="${id}"]`) as FakeElement;
  const text = (selector: string) => root.querySelector(selector)?.textContent;
  const lock = (id: string) =>
    root
      .querySelector(`[data-campaign-part="${id}"]`)
      ?.querySelector('[data-campaign-lock]') as FakeElement;
  const status = () =>
    (journal['flags'] as Record<string, Record<string, Record<string, string>>>)['world']?.[
      'campaignStatus'
    ];
  const click = (id: string) => toggleStatus(root, toggle(id), journalView, structureOf(journal));
  return {
    h,
    answer,
    journal,
    journalView,
    page,
    element,
    root,
    toggle,
    text,
    lock,
    status,
    click,
  };
}

function structureOf(journal: FakeDocument) {
  return (journal['flags'] as Record<string, Record<string, never>>)['ninjos-foundry-mcp']?.[
    'campaign'
  ] as never;
}

describe('campaign dashboard in the journal sheet', () => {
  it('finds the journal of an entry sheet and of a page sheet', async () => {
    const d = await dashboard();
    expect(journalOfSheet({ document: d.journal })).toBe(d.journal);
    expect(journalOfSheet({ document: d.page })).toBe(d.journal);
    expect(journalOfSheet({ document: d.h.foundry.seed('Actor', { name: 'A' }) })).toBeNull();
  });

  it('makes toggles buttons and shows locks from the saved status', async () => {
    const d = await dashboard();
    expect(enhanceDashboards(d.element, d.journalView)).toBe(1);
    expect(d.toggle('part-1').getAttribute('role')).toBe('button');
    expect(d.toggle('part-1').getAttribute('aria-label')).toBe(
      'Part 1: Approach and entry: Not started. Activate to change the progress.'
    );
    expect(d.lock('part-2').hidden).toBe(false);
    expect(d.text('[data-campaign-figure="progress"]')).toBe(
      'Campaign progress: 0 of 6 parts done (0%)'
    );
  });

  it('saves a Gamemaster click on the journal and updates figures, current part and locks', async () => {
    const d = await dashboard();
    enhanceDashboards(d.element, d.journalView);
    await d.click('part-1');
    expect(d.status()).toEqual({ [`${d.answer.campaignId}-part-1`]: 'in_progress' });
    expect(d.toggle('part-1').textContent).toBe('In progress');
    expect(d.text('[data-campaign-figure="current"]')).toBe(
      'Current part: Part 1: Approach and entry'
    );
    await d.click('part-1');
    expect(d.lock('part-2').hidden).toBe(true);
    expect(d.text('[data-campaign-figure="progress"]')).toBe(
      'Campaign progress: 1 of 6 parts done (17%)'
    );
    expect(d.text('[data-campaign-figure="current"]')).toBe(
      'Current part: Part 2: Upper levels, 2.1: Entrance halls'
    );
  });

  it('reacts to a click and to Enter through the listener, but not to other keys', async () => {
    const d = await dashboard();
    enhanceDashboards(d.element, d.journalView);
    enhanceDashboards(d.element, d.journalView); // a second render binds nothing twice
    d.toggle('part-2-1').dispatch('click');
    await settle();
    expect(d.status()).toEqual({ [`${d.answer.campaignId}-part-2-1`]: 'in_progress' });
    d.toggle('part-2-1').dispatch('keydown', 'a');
    await settle();
    expect(d.toggle('part-2-1').textContent).toBe('In progress');
    d.toggle('part-2-1').dispatch('keydown', 'Enter');
    await settle();
    expect(d.toggle('part-2-1').textContent).toBe('Completed');
  });

  it('lets a player change nothing and tells them why', async () => {
    const d = await dashboard();
    enhanceDashboards(d.element, d.journalView);
    const writes = d.h.foundry.operations.length;
    d.h.foundry.setUser('p');
    await d.click('part-1');
    expect(d.h.foundry.operations).toHaveLength(writes);
    expect(d.toggle('part-1').textContent).toBe('Not started');
    expect(d.h.foundry.notifications.at(-1)).toEqual({
      level: 'warn',
      message: 'Only a Gamemaster can change the campaign progress.',
    });
  });

  it('puts the toggle back and names the cause when saving fails', async () => {
    const d = await dashboard();
    enhanceDashboards(d.element, d.journalView);
    d.h.foundry.onWrite(() => {
      throw new Error('the server is gone');
    });
    await d.click('part-1');
    expect(d.toggle('part-1').textContent).toBe('Not started');
    expect(d.h.foundry.notifications.at(-1)).toEqual({
      level: 'error',
      message: 'The campaign progress was not saved: the server is gone',
    });
  });

  it('listens only to journal sheet hooks and ignores journals that are no dashboard', async () => {
    const d = await dashboard();
    installDashboardHooks();
    d.h.foundry.hooks.callAll('renderApplicationV2', { document: d.journal }, d.element);
    expect(d.toggle('part-1').getAttribute('role')).toBeNull();
    d.h.foundry.hooks.callAll('renderJournalEntrySheet', { document: d.journal }, d.element);
    expect(d.toggle('part-1').getAttribute('role')).toBe('button');

    const other = d.h.foundry.seed('JournalEntry', { name: 'Plain', pages: [] });
    const element = parseHtml(`<div data-campaign-dashboard="${d.answer.campaignId}"></div>`);
    onJournalSheetRender({ document: other }, [element]);
    expect(
      element.querySelector('[data-campaign-dashboard]')?.getAttribute('data-campaign-bound')
    ).toBeNull();
  });
});
