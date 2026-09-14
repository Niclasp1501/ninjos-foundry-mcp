/**
 * What the campaign area needs beyond the default fake: a small element tree built
 * from stored page HTML, so the dashboard code runs against the markup it
 * wrote, without a browser. Only what dashboard-sheet.ts uses: attribute
 * selectors (`[name]`, `[name="value"]`), text, `hidden`, and events.
 */
import type { CampaignElement, CampaignEvent } from './dashboard-sheet.js';

const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link']);

export class FakeElement implements CampaignElement {
  readonly attributes = new Map<string, string>();
  readonly children: Array<FakeElement | string> = [];
  readonly listeners = new Map<string, Array<(event: CampaignEvent) => void>>();
  parent: FakeElement | null = null;

  constructor(readonly tag: string) {}

  get textContent(): string {
    return this.children
      .map(child => (typeof child === 'string' ? child : child.textContent))
      .join('');
  }

  set textContent(value: string | null) {
    this.children.splice(0, this.children.length, value ?? '');
  }

  get hidden(): boolean {
    return this.attributes.has('hidden');
  }

  set hidden(value: boolean) {
    if (value) this.attributes.set('hidden', '');
    else this.attributes.delete('hidden');
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  matches(selector: string): boolean {
    const match = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(selector);
    if (!match) throw new Error(`The fake element does not understand the selector ${selector}`);
    const value = this.attributes.get(match[1] as string);
    return value !== undefined && (match[2] === undefined || value === match[2]);
  }

  querySelectorAll(selector: string): FakeElement[] {
    const found: FakeElement[] = [];
    const walk = (element: FakeElement) => {
      for (const child of element.children) {
        if (typeof child === 'string') continue;
        if (child.matches(selector)) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  closest(selector: string): FakeElement | null {
    for (let node: FakeElement | null = this; node; node = node.parent) {
      if (node.matches(selector)) return node;
    }
    return null;
  }

  addEventListener(type: string, listener: (event: CampaignEvent) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  /** Fire an event at this element; it bubbles to every ancestor with listeners. */
  dispatch(type: string, key?: string): { defaultPrevented: boolean } {
    const state = { defaultPrevented: false };
    const event: CampaignEvent = {
      type,
      target: this,
      ...(key !== undefined ? { key } : {}),
      preventDefault: () => {
        state.defaultPrevented = true;
      },
    };
    for (let node: FakeElement | null = this; node; node = node.parent) {
      for (const listener of node.listeners.get(type) ?? []) listener(event);
    }
    return state;
  }
}

/** Parse the HTML a package writes into a tree under a `div` root. Not a general HTML parser. */
export function parseHtml(html: string): FakeElement {
  const root = new FakeElement('div');
  let current = root;
  const tokens = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+)/g;
  for (let token = tokens.exec(html); token; token = tokens.exec(html)) {
    if (token[4] !== undefined) {
      if (token[4].trim()) current.children.push(token[4]);
      continue;
    }
    const tag = (token[2] as string).toLowerCase();
    if (token[1]) {
      if (current.tag !== tag) throw new Error(`Unbalanced </${tag}> in ${html.slice(0, 80)}`);
      current = current.parent ?? root;
      continue;
    }
    const element = new FakeElement(tag);
    for (const attribute of (token[3] ?? '').matchAll(/([^\s=/]+)(?:="([^"]*)")?/g))
      element.attributes.set(attribute[1] as string, attribute[2] ?? '');
    element.parent = current;
    current.children.push(element);
    if (!VOID.has(tag) && !(token[3] ?? '').trim().endsWith('/')) current = element;
  }
  return root;
}

/** Let pending promises of an event handler finish. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise(resolve => setTimeout(resolve, 0));
}
