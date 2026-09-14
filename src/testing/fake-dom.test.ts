import { afterEach, describe, expect, it } from 'vitest';
import { FakeElement, fakeEvent, parseHtml, settle } from './fake-dom.js';
import { FakeFoundry } from './fake-foundry.js';

const MARKUP = `
<section class="dashboard open" data-campaign-dashboard="c1">
  <h2 id="title">Lost &amp; Found</h2>
  <ul class="parts">
    <li data-part="p1" class="part done"><button type="button" data-toggle>One</button></li>
    <li data-part='p2' class="part"><button type="button" data-toggle disabled>Two</button><br></li>
  </ul>
  <!-- a comment -->
  <section class="secret" id="s1"><p>Hidden <em>text</em></p></section>
</section>`;

describe('parseHtml and selectors', () => {
  it('builds the tree with text, attributes, void tags and entities', () => {
    const root = parseHtml(MARKUP);
    expect(root.children).toHaveLength(1);
    expect(root.querySelector('#title')?.textContent).toBe('Lost & Found');
    expect(root.querySelector('[data-part="p2"]')?.getAttribute('class')).toBe('part');
    expect(root.querySelector('button[disabled]')?.textContent).toBe('Two');
    expect(root.querySelector('section.secret')?.innerHTML).toBe('<p>Hidden <em>text</em></p>');
  });

  it('understands tags, ids, classes, attributes, lists and both combinators', () => {
    const root = parseHtml(MARKUP);
    expect(root.querySelectorAll('li.part').map(li => li.dataset['part'])).toEqual(['p1', 'p2']);
    expect(root.querySelectorAll('.dashboard li > button')).toHaveLength(2);
    expect(root.querySelectorAll('ul > button')).toHaveLength(0);
    expect(root.querySelectorAll('h2, em').map(e => e.tagName)).toEqual(['H2', 'EM']);
    expect(root.querySelector('[data-campaign-dashboard]')?.matches('section.open')).toBe(true);
    expect(root.querySelector('em')?.closest('[data-campaign-dashboard]')?.id).toBe('');
    expect(root.querySelector('*')?.tagName).toBe('SECTION');
  });

  it('throws on selectors and markup it cannot read, instead of matching nothing', () => {
    const root = parseHtml(MARKUP);
    expect(() => root.querySelector('li:first-child')).toThrow(/does not understand/);
    expect(() => root.querySelector('a ~ b')).toThrow(/does not understand/);
    expect(() => parseHtml('<div></span>')).toThrow(/Unbalanced/);
    expect(() => parseHtml('<div><p>open')).toThrow(/Unclosed/);
  });
});

describe('FakeElement', () => {
  it('changes attributes, classes, dataset, hidden, text and markup', () => {
    const element = new FakeElement('div', { class: 'a' });
    element.classList.add('b');
    element.classList.toggle('a');
    element.dataset['campaignPart'] = 'p1';
    element.hidden = true;
    expect(element.outerHTML).toBe('<div class="b" data-campaign-part="p1" hidden></div>');
    expect({ ...element.dataset }).toEqual({ campaignPart: 'p1' });

    element.innerHTML = '<span>x</span><span>y</span>';
    expect(element.querySelectorAll('span').map(s => s.parentElement)).toEqual([element, element]);
    element.textContent = 'plain';
    expect(element.children).toEqual([]);
    expect(element.innerHTML).toBe('plain');
  });

  it('moves an appended element out of its old parent', () => {
    const root = parseHtml('<ul><li>a</li></ul><ol></ol>');
    const li = root.querySelector('li') as FakeElement;
    root.querySelector('ol')?.append(li);
    expect(root.querySelector('ul')?.children).toEqual([]);
    expect(li.closest('ol')).not.toBeNull();
    li.remove();
    expect(root.querySelector('li')).toBeNull();
  });

  it('bubbles events to ancestors, and honours stopPropagation, preventDefault and bubbles', () => {
    const root = parseHtml(MARKUP);
    const seen: string[] = [];
    const section = root.querySelector('section') as FakeElement;
    section.addEventListener('click', event => {
      seen.push(`section:${(event.target as FakeElement).tagName}`);
      event.preventDefault();
    });
    const button = root.querySelector('button') as FakeElement;
    const onButton = () => void seen.push('button');
    button.addEventListener('click', onButton);

    expect(button.click().defaultPrevented).toBe(true);
    expect(seen).toEqual(['button', 'section:BUTTON']);

    button.removeEventListener('click', onButton);
    button.addEventListener('click', event => event.stopPropagation());
    seen.length = 0;
    button.dispatch('click');
    expect(seen).toEqual([]);

    expect(button.dispatchEvent(fakeEvent('click', button, { bubbles: false }))).toBe(true);
    expect(seen).toEqual([]);
    expect(button.dispatch('keydown', { key: 'Enter' })['key']).toBe('Enter');
  });
});

describe('FakeFoundry.renderHook', () => {
  let foundry: FakeFoundry | null = null;
  afterEach(() => {
    foundry?.uninstall();
    foundry = null;
  });

  it('calls a render hook with application, element and context, and returns the element', async () => {
    foundry = new FakeFoundry().install();
    const application = { id: 'sheet' };
    Hooks.on('renderJournalEntrySheet', (app: unknown, html: unknown) => {
      const element = html as FakeElement;
      element.querySelector('[data-toggle]')?.addEventListener('click', () => {
        void Promise.resolve().then(() =>
          element.querySelector('#title')?.classList.add('clicked')
        );
      });
      expect(app).toBe(application);
    });

    const element = foundry.renderHook('renderJournalEntrySheet', MARKUP, application, {
      editable: true,
    });
    element.querySelector('[data-toggle]')?.click();
    await settle();
    expect(element.querySelector('#title')?.classList.contains('clicked')).toBe(true);
    expect(foundry.hooks.calls.at(-1)).toMatchObject({
      name: 'renderJournalEntrySheet',
      args: [application, element, { editable: true }],
    });
  });
});
