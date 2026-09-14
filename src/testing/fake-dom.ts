/**
 * A small element tree for tests of hooks on rendered windows, without a
 * browser: render hooks of journal sheets, windows, later the
 * canvas controls.
 *
 * What it understands:
 * - elements with a tag, attributes, children (elements and text), `id`,
 *   `className`, `classList`, `dataset`, `hidden`, `textContent`, `innerHTML`
 * - selectors: tag, `#id`, `.class`, `[name]`, `[name="value"]`, `*`, any
 *   compound of them (`section.secret[data-x]`), lists with commas and the
 *   descendant (space) and child (`>`) combinators
 * - `querySelector`, `querySelectorAll`, `matches`, `closest`, `append`,
 *   `remove`, `addEventListener`, `removeEventListener`, `dispatchEvent`
 *   (bubbling, `stopPropagation`, `preventDefault`)
 *
 * What it does not: layout, styles, pseudo classes, sibling combinators,
 * entities other than the five basic ones. A selector it cannot read throws,
 * so a test never passes because nothing matched.
 *
 * `parseHtml` reads the markup packages write themselves; it is not a general
 * HTML parser, and unbalanced closing tags throw.
 *
 * Test code only, in no build.
 */

export interface FakeEvent {
  readonly type: string;
  readonly target: FakeElement | null;
  currentTarget: FakeElement | null;
  readonly bubbles: boolean;
  defaultPrevented: boolean;
  propagationStopped: boolean;
  /** Anything a test passes along, e.g. `key` for a keydown. */
  readonly [field: string]: unknown;
  preventDefault(): void;
  stopPropagation(): void;
}

type Listener = (event: FakeEvent) => void;

const VOID_TAGS = new Set(['area', 'br', 'col', 'hr', 'img', 'input', 'link', 'meta', 'source']);

interface SimpleSelector {
  tag: string | null;
  id: string | null;
  classes: string[];
  attributes: Array<{ name: string; value: string | null }>;
}

/** One compound selector per step, each with the combinator that leads to the next step to its left. */
type ComplexSelector = Array<{ compound: SimpleSelector; combinator: ' ' | '>' | null }>;

const selectorCache = new Map<string, ComplexSelector[]>();

function parseCompound(text: string, whole: string): SimpleSelector {
  const compound: SimpleSelector = { tag: null, id: null, classes: [], attributes: [] };
  const pattern =
    /^(?:(\*|[a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[\s*([\w:-]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([\w-]+))\s*)?\])/;
  let rest = text;
  while (rest) {
    const match = pattern.exec(rest);
    if (!match)
      throw new Error(`The fake element tree does not understand the selector "${whole}"`);
    if (match[1]) compound.tag = match[1] === '*' ? null : match[1].toLowerCase();
    else if (match[2]) compound.id = match[2];
    else if (match[3]) compound.classes.push(match[3]);
    else if (match[4])
      compound.attributes.push({ name: match[4], value: match[5] ?? match[6] ?? match[7] ?? null });
    rest = rest.slice(match[0].length);
  }
  return compound;
}

function parseSelector(selector: string): ComplexSelector[] {
  const cached = selectorCache.get(selector);
  if (cached) return cached;
  const parsed = selector.split(',').map(part => {
    const tokens = part
      .trim()
      .replace(/\s*>\s*/g, ' > ')
      .split(/\s+/);
    if (!tokens[0])
      throw new Error(`The fake element tree does not understand the selector "${selector}"`);
    const steps: ComplexSelector = [];
    let combinator: ' ' | '>' | null = null;
    for (const token of tokens) {
      if (token === '>') {
        if (!steps.length || combinator === '>')
          throw new Error(`The fake element tree does not understand the selector "${selector}"`);
        combinator = '>';
        continue;
      }
      steps.push({
        compound: parseCompound(token, selector),
        combinator: steps.length ? (combinator ?? ' ') : null,
      });
      combinator = null;
    }
    if (combinator)
      throw new Error(`The fake element tree does not understand the selector "${selector}"`);
    return steps;
  });
  selectorCache.set(selector, parsed);
  return parsed;
}

function matchesCompound(element: FakeElement, compound: SimpleSelector): boolean {
  if (compound.tag && element.tagName.toLowerCase() !== compound.tag) return false;
  if (compound.id && element.id !== compound.id) return false;
  if (compound.classes.some(name => !element.classList.contains(name))) return false;
  return compound.attributes.every(({ name, value }) => {
    const actual = element.getAttribute(name);
    return actual !== null && (value === null || actual === value);
  });
}

function matchesFrom(element: FakeElement, steps: ComplexSelector, index: number): boolean {
  const step = steps[index];
  if (!step || !matchesCompound(element, step.compound)) return false;
  if (index === 0) return true;
  if (step.combinator === '>')
    return element.parentElement !== null && matchesFrom(element.parentElement, steps, index - 1);
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (matchesFrom(node, steps, index - 1)) return true;
  }
  return false;
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function unescape(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

export class FakeClassList {
  constructor(private readonly element: FakeElement) {}

  #names(): string[] {
    return (this.element.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
  }

  #store(names: string[]): void {
    if (names.length) this.element.setAttribute('class', [...new Set(names)].join(' '));
    else this.element.removeAttribute('class');
  }

  contains(name: string): boolean {
    return this.#names().includes(name);
  }

  add(...names: string[]): void {
    this.#store([...this.#names(), ...names]);
  }

  remove(...names: string[]): void {
    this.#store(this.#names().filter(name => !names.includes(name)));
  }

  toggle(name: string, force?: boolean): boolean {
    const on = force ?? !this.contains(name);
    if (on) this.add(name);
    else this.remove(name);
    return on;
  }

  get length(): number {
    return this.#names().length;
  }
}

export class FakeElement {
  readonly tagName: string;
  readonly childNodes: Array<FakeElement | string> = [];
  parentElement: FakeElement | null = null;
  readonly classList = new FakeClassList(this);
  readonly #attributes = new Map<string, string>();
  readonly #listeners = new Map<string, Listener[]>();

  constructor(tag: string, attributes: Record<string, string> = {}) {
    this.tagName = tag.toUpperCase();
    for (const [name, value] of Object.entries(attributes)) this.setAttribute(name, value);
  }

  get children(): FakeElement[] {
    return this.childNodes.filter((node): node is FakeElement => typeof node !== 'string');
  }

  get id(): string {
    return this.getAttribute('id') ?? '';
  }

  set id(value: string) {
    this.setAttribute('id', value);
  }

  get className(): string {
    return this.getAttribute('class') ?? '';
  }

  set className(value: string) {
    this.setAttribute('class', value);
  }

  get hidden(): boolean {
    return this.hasAttribute('hidden');
  }

  set hidden(value: boolean) {
    if (value) this.setAttribute('hidden', '');
    else this.removeAttribute('hidden');
  }

  /** `data-*` attributes by their camel-case name, read and written live. */
  get dataset(): Record<string, string | undefined> {
    const toAttribute = (key: string) =>
      `data-${key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`;
    return new Proxy({} as Record<string, string | undefined>, {
      get: (_target, key) =>
        typeof key === 'string' ? (this.getAttribute(toAttribute(key)) ?? undefined) : undefined,
      set: (_target, key, value) => {
        if (typeof key === 'string') this.setAttribute(toAttribute(key), String(value));
        return true;
      },
      deleteProperty: (_target, key) => {
        if (typeof key === 'string') this.removeAttribute(toAttribute(key));
        return true;
      },
      has: (_target, key) => typeof key === 'string' && this.hasAttribute(toAttribute(key)),
      ownKeys: () =>
        this.getAttributeNames()
          .filter(name => name.startsWith('data-'))
          .map(name => name.slice(5).replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())),
      getOwnPropertyDescriptor: (_target, key) =>
        typeof key === 'string' && this.hasAttribute(toAttribute(key))
          ? { enumerable: true, configurable: true, value: this.getAttribute(toAttribute(key)) }
          : undefined,
    });
  }

  get textContent(): string {
    return this.childNodes
      .map(node => (typeof node === 'string' ? node : node.textContent))
      .join('');
  }

  set textContent(value: string | null) {
    this.#detachChildren();
    if (value) this.childNodes.push(value);
  }

  get innerHTML(): string {
    return this.childNodes
      .map(node => (typeof node === 'string' ? escapeText(node) : node.outerHTML))
      .join('');
  }

  set innerHTML(html: string) {
    this.#detachChildren();
    for (const node of [...parseHtml(html).childNodes]) this.append(node);
  }

  get outerHTML(): string {
    const tag = this.tagName.toLowerCase();
    const attributes = [...this.#attributes]
      .map(([name, value]) =>
        value === '' ? ` ${name}` : ` ${name}="${value.replace(/"/g, '&quot;')}"`
      )
      .join('');
    return VOID_TAGS.has(tag)
      ? `<${tag}${attributes}>`
      : `<${tag}${attributes}>${this.innerHTML}</${tag}>`;
  }

  getAttribute(name: string): string | null {
    return this.#attributes.get(name.toLowerCase()) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.#attributes.set(name.toLowerCase(), String(value));
  }

  removeAttribute(name: string): void {
    this.#attributes.delete(name.toLowerCase());
  }

  hasAttribute(name: string): boolean {
    return this.#attributes.has(name.toLowerCase());
  }

  getAttributeNames(): string[] {
    return [...this.#attributes.keys()];
  }

  append(...nodes: Array<FakeElement | string>): void {
    for (const node of nodes) {
      if (typeof node !== 'string') {
        node.remove();
        node.parentElement = this;
      }
      this.childNodes.push(node);
    }
  }

  remove(): void {
    const parent = this.parentElement;
    if (!parent) return;
    const index = parent.childNodes.indexOf(this);
    if (index >= 0) parent.childNodes.splice(index, 1);
    this.parentElement = null;
  }

  matches(selector: string): boolean {
    return parseSelector(selector).some(steps => matchesFrom(this, steps, steps.length - 1));
  }

  /** Descendants in document order, never the element itself. */
  querySelectorAll(selector: string): FakeElement[] {
    const selectors = parseSelector(selector);
    const found: FakeElement[] = [];
    const walk = (element: FakeElement) => {
      for (const child of element.children) {
        if (selectors.some(steps => matchesFrom(child, steps, steps.length - 1))) found.push(child);
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
    for (let node: FakeElement | null = this; node; node = node.parentElement) {
      if (node.matches(selector)) return node;
    }
    return null;
  }

  addEventListener(type: string, listener: Listener): void {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener]);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.#listeners.set(
      type,
      (this.#listeners.get(type) ?? []).filter(entry => entry !== listener)
    );
  }

  /** Listeners of this element, then of each ancestor unless stopped. Returns false when prevented. */
  dispatchEvent(event: FakeEvent): boolean {
    for (let node: FakeElement | null = this; node; node = node.parentElement) {
      event.currentTarget = node;
      for (const listener of [...(node.#listeners.get(event.type) ?? [])]) listener(event);
      if (event.propagationStopped || !event.bubbles) break;
    }
    event.currentTarget = null;
    return !event.defaultPrevented;
  }

  /** Fire an event at this element. `fields` become properties of the event (`key`, `button`). */
  dispatch(type: string, fields: Record<string, unknown> = {}): FakeEvent {
    const event = fakeEvent(type, this, fields);
    this.dispatchEvent(event);
    return event;
  }

  /** A click, as a user makes it: bubbling and cancelable. */
  click(): FakeEvent {
    return this.dispatch('click');
  }

  #detachChildren(): void {
    for (const node of this.childNodes) if (typeof node !== 'string') node.parentElement = null;
    this.childNodes.length = 0;
  }
}

/** An event for `dispatchEvent`. Bubbles unless `bubbles: false` is among the fields. */
export function fakeEvent(
  type: string,
  target: FakeElement | null,
  fields: Record<string, unknown> = {}
): FakeEvent {
  const event: FakeEvent = {
    bubbles: true,
    ...fields,
    type,
    target,
    currentTarget: null,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() {
      event.defaultPrevented = true;
    },
    stopPropagation() {
      event.propagationStopped = true;
    },
  };
  return event;
}

/** Parse markup into a tree under a `div` root. */
export function parseHtml(html: string): FakeElement {
  const root = new FakeElement('div');
  let current = root;
  const tokens = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/g;
  for (let token = tokens.exec(html); token; token = tokens.exec(html)) {
    if (token[0].startsWith('<!--')) continue;
    if (token[4] !== undefined) {
      current.childNodes.push(unescape(token[4]));
      continue;
    }
    const tag = (token[2] as string).toLowerCase();
    if (token[1]) {
      if (current === root || current.tagName.toLowerCase() !== tag)
        throw new Error(`Unbalanced </${tag}> in ${html.slice(0, 80)}`);
      current = current.parentElement ?? root;
      continue;
    }
    const element = new FakeElement(tag);
    const rawAttributes = token[3] ?? '';
    for (const attribute of rawAttributes.matchAll(
      /([^\s=/"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g
    ))
      element.setAttribute(
        attribute[1] as string,
        unescape(attribute[2] ?? attribute[3] ?? attribute[4] ?? '')
      );
    current.append(element);
    if (!VOID_TAGS.has(tag) && !rawAttributes.trim().endsWith('/')) current = element;
  }
  if (current !== root)
    throw new Error(`Unclosed <${current.tagName.toLowerCase()}> in ${html.slice(0, 80)}`);
  return root;
}

/** Let pending promises of event handlers finish. */
export async function settle(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await new Promise(resolve => setTimeout(resolve, 0));
}
