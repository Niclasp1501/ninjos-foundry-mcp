/**
 * The HTML of the package: escaping, finding elements in stored text, and
 * the insertion rules of link-quest-to-npc and update-quest-journal.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeFoundry } from '../../../testing/fake-foundry.js';
import {
  contentHtml,
  dashboardHtml,
  findElement,
  looksLikeHtml,
  planNpcLink,
  planQuestUpdate,
  questHtml,
  questObjectives,
  textToHtml,
  updateSection,
} from './html.js';
import { buildStructure } from './model.js';

let foundry: FakeFoundry;
beforeEach(() => {
  foundry = new FakeFoundry().install();
});
afterEach(() => foundry.uninstall());

describe('text and HTML', () => {
  it('escapes plain text into paragraphs and keeps single line breaks', () => {
    expect(textToHtml('a <b> & c\nd\n\n**e**')).toBe('<p>a &lt;b&gt; &amp; c<br>d</p><p>**e**</p>');
    expect(looksLikeHtml('I <3 dragons')).toBe(false);
    expect(contentHtml('<p>kept</p>')).toBe('<p>kept</p>');
  });

  it('finds an element with its matching closing tag, counting nested ones', () => {
    const html = '<div a><div data-x="1"><div>inner</div>text</div></div>';
    const range = findElement(html, 'data-x');
    expect(range).not.toBeNull();
    expect(html.slice(range!.start, range!.end)).toBe('<div data-x="1"><div>inner</div>text</div>');
    expect(html.slice(range!.openEnd, range!.closeStart)).toBe('<div>inner</div>text');
    expect(findElement(html, 'data-x', '2')).toBeNull();
    expect(findElement('<div data-x>no end', 'data-x')).toBeNull();
    expect(findElement('<div data-xy>', 'data-x')).toBeNull();
  });
});

describe('quest page', () => {
  it('escapes every given value', () => {
    const html = questHtml(
      {
        title: '<script>alert(1)</script>',
        description: 'Find "the" <b>thing</b>',
        location: 'A & B',
        questGiver: '<i>Mira</i>',
        rewards: '100 <gp>',
      },
      '13.9.2026'
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('A &amp; B');
    expect(html).toContain('&lt;i&gt;Mira&lt;/i&gt;');
    expect(html).not.toContain('<gp>');
    expect(html).toContain('data-campaign-quest-status="active"');
  });

  it('takes objectives from the quest type or the given facts, never from words of the description', () => {
    expect(
      questObjectives({ title: 't', description: 'kill the cult', questType: 'fetch' })
    ).toEqual([
      'Find out where the sought item is.',
      'Obtain the item.',
      'Bring the item back safely.',
      'Report the outcome to the appropriate authorities.',
    ]);
    expect(
      questObjectives({
        title: 't',
        description: 'x',
        npcName: 'Vex',
        location: 'Tor',
        questGiver: 'Mira',
        rewards: 'gold',
      })
    ).toEqual([
      'Find out more about Vex.',
      'Travel to Tor.',
      'Deal with Vex.',
      'Report back to Mira upon completion.',
      'Claim the promised rewards.',
    ]);
    const long =
      'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen';
    expect(questObjectives({ title: 't', description: long })[0]).toBe(
      'Complete the main objective: one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen ...'
    );
  });
});

describe('planNpcLink', () => {
  const link = { name: 'Mira', actorUuid: 'Actor.abc', relationship: 'ally' as const };

  it('creates the list once in the status column and extends it afterwards', () => {
    const page = questHtml({ title: 'Q', description: 'd' }, 'today');
    const first = planNpcLink(page, link);
    expect(first.placement).toBe('overview');
    expect(first.html).toContain('@UUID[Actor.abc]{Mira}: ally');
    const second = planNpcLink(first.html, { ...link, relationship: 'contact' });
    expect(second.placement).toBe('list');
    expect(second.html.match(/data-campaign-npc-list/g)).toHaveLength(1);
    expect(planNpcLink(second.html, link)).toEqual({
      html: second.html,
      changed: false,
      placement: 'already',
    });
  });

  it('appends at the end of a page without markers and keeps everything before it', () => {
    const page = `<p>${'x'.repeat(250_000)}</p>`;
    const plan = planNpcLink(page, { name: 'A <b>', actorUuid: null, relationship: 'enemy' });
    expect(plan.placement).toBe('end');
    expect(plan.html.startsWith(page)).toBe(true);
    expect(plan.html).toContain('A &lt;b&gt;: enemy');
  });
});

describe('planQuestUpdate', () => {
  it('adds the section to the progress notes and sets the status on completion', () => {
    const page = questHtml({ title: 'Q', description: 'd' }, 'today');
    const section = updateSection('completion', 'They won.', '14.9.2026');
    const plan = planQuestUpdate(page, section, 'completion');
    expect(plan).toMatchObject({ placement: 'progress', status: 'completed', statusChanged: true });
    expect(plan.html).toContain('<span data-campaign-quest-status="completed">Completed</span>');
    expect(plan.html).not.toContain('data-campaign-quest-status="active"');
    const progress = findElement(plan.html, 'data-campaign-progress');
    expect(plan.html.slice(progress!.openEnd, progress!.closeStart)).toContain(
      'Quest completed, 14.9.2026'
    );
    expect(section).toContain(
      '<blockquote class="ninjo-campaign-readaloud"><p>They won.</p></blockquote>'
    );
  });

  it('appends to a foreign page, leaves it as it was, and reports that no status marker was there', () => {
    const page = '<h1>Old quest</h1><p>Status: Active</p>';
    const plan = planQuestUpdate(page, '<p>new</p>', 'failure');
    expect(plan).toEqual({
      html: `${page}<p>new</p>`,
      placement: 'end',
      status: 'failed',
      statusChanged: false,
    });
  });

  it('leaves out the generated heading when the content brings its own, and keeps other updates secret', () => {
    const section = updateSection('progress', '<h2>Found the map</h2><p>x</p>', 'today');
    expect(section).not.toContain('Progress update');
    expect(section).toMatch(/<section class="secret" id="secret-[A-Za-z0-9]{16}">/);
  });
});

describe('dashboard page', () => {
  it('writes toggles, lock markers after the first part and an escaped title', () => {
    const structure = buildStructure({
      id: 'campaign-x',
      title: 'The <Whisperstone>',
      description: 'd',
      template: 'custom',
      questGiver: null,
      location: null,
      parts: [
        { title: 'A', description: 'a', type: 'chapter', levelStart: 1, levelEnd: 1, subParts: [] },
        {
          title: 'B',
          description: 'b',
          type: 'main_part',
          levelStart: 2,
          levelEnd: 4,
          subParts: [{ title: 'B1', description: 'b1' }],
        },
      ],
    });
    const html = dashboardHtml(structure, {}, 'today');
    expect(html).toContain('<h1>The &lt;Whisperstone&gt;</h1>');
    expect(html.match(/data-campaign-toggle=/g)).toHaveLength(3);
    expect(html.match(/data-campaign-lock/g)).toHaveLength(1);
    expect(html).toContain('Level 1');
    expect(html).toContain('Levels 2 to 4');
    expect(html).toContain('Campaign progress: 0 of 2 parts done (0%)');
    expect(html).toContain('Requires completion of: Part 1: A');
  });
});
