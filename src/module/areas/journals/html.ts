/**
 * A small HTML scanner for splitting pages at headings.
 *
 * It keeps offsets into the original string instead of building DOM nodes,
 * so every section is an exact slice of the stored markup: nothing is
 * re-serialised, attributes and entities stay byte for byte. It also runs
 * without a browser, which lets the tests cover the splitting rules.
 *
 * Not a full HTML parser. It knows void elements, raw text elements,
 * comments, stray closing tags and the common optional end tags (p, li, dt,
 * dd, tr, td, th, option). That is what imported adventure chapters contain.
 */

export interface HtmlElement {
  kind: 'element';
  tag: string;
  start: number;
  end: number;
  innerStart: number;
  innerEnd: number;
  children: HtmlNode[];
}

export interface HtmlOther {
  kind: 'text' | 'other';
  start: number;
  end: number;
}

export type HtmlNode = HtmlElement | HtmlOther;

const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title']);

const CLOSES_P = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'details',
  'div',
  'dl',
  'fieldset',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'ul',
]);

/** Opening one of these closes an open element of the listed tags first. */
const IMPLICIT_CLOSE: Readonly<Record<string, readonly string[]>> = {
  li: ['li'],
  dt: ['dt', 'dd'],
  dd: ['dt', 'dd'],
  tr: ['tr', 'td', 'th'],
  td: ['td', 'th'],
  th: ['td', 'th'],
  option: ['option'],
};

/** Index of the '>' that ends a tag starting at `from`, honouring quoted attribute values. */
function tagEnd(html: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < html.length; i += 1) {
    const char = html[i];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return i;
    }
  }
  return -1;
}

export function parseHtml(html: string): HtmlNode[] {
  const root: HtmlNode[] = [];
  const stack: HtmlElement[] = [];
  const add = (node: HtmlNode) => (stack.at(-1)?.children ?? root).push(node);
  const closeTop = (at: number, after: number) => {
    const element = stack.pop();
    if (element) {
      element.innerEnd = at;
      element.end = after;
    }
  };

  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) {
      add({ kind: 'text', start: i, end: html.length });
      break;
    }
    if (lt > i) add({ kind: 'text', start: i, end: lt });

    if (html.startsWith('<!--', lt)) {
      const close = html.indexOf('-->', lt + 4);
      const end = close < 0 ? html.length : close + 3;
      add({ kind: 'other', start: lt, end });
      i = end;
      continue;
    }

    const closing = /^<\/([a-zA-Z][a-zA-Z0-9-]*)/.exec(html.slice(lt, lt + 64));
    if (closing) {
      const gt = tagEnd(html, lt);
      const end = gt < 0 ? html.length : gt + 1;
      const tag = (closing[1] as string).toLowerCase();
      const depth = stack.map(element => element.tag).lastIndexOf(tag);
      if (depth < 0) {
        add({ kind: 'other', start: lt, end });
      } else {
        while (stack.length > depth + 1) closeTop(lt, lt);
        closeTop(lt, end);
      }
      i = end;
      continue;
    }

    const opening = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(html.slice(lt, lt + 64));
    if (!opening) {
      if (html[lt + 1] === '!' || html[lt + 1] === '?') {
        const gt = tagEnd(html, lt);
        const end = gt < 0 ? html.length : gt + 1;
        add({ kind: 'other', start: lt, end });
        i = end;
      } else {
        add({ kind: 'text', start: lt, end: lt + 1 });
        i = lt + 1;
      }
      continue;
    }

    const tag = (opening[1] as string).toLowerCase();
    const gt = tagEnd(html, lt);
    const end = gt < 0 ? html.length : gt + 1;

    const top = stack.at(-1);
    if (top && top.tag === 'p' && CLOSES_P.has(tag)) closeTop(lt, lt);
    const implicit = IMPLICIT_CLOSE[tag];
    if (implicit) {
      const current = stack.at(-1);
      if (current && implicit.includes(current.tag)) closeTop(lt, lt);
    }

    const element: HtmlElement = {
      kind: 'element',
      tag,
      start: lt,
      end,
      innerStart: end,
      innerEnd: end,
      children: [],
    };
    add(element);
    i = end;

    if (VOID.has(tag) || html[end - 2] === '/') continue;
    if (RAW_TEXT.has(tag)) {
      const close = html.toLowerCase().indexOf(`</${tag}`, end);
      if (close < 0) {
        element.innerEnd = element.end = html.length;
        i = html.length;
      } else {
        const closeGt = tagEnd(html, close);
        element.innerEnd = close;
        element.end = closeGt < 0 ? html.length : closeGt + 1;
        i = element.end;
      }
      continue;
    }
    stack.push(element);
  }
  while (stack.length) closeTop(html.length, html.length);
  return root;
}

export function headingLevel(node: HtmlNode): number | null {
  if (node.kind !== 'element') return null;
  const match = /^h([1-6])$/.exec(node.tag);
  return match ? Number(match[1]) : null;
}

/** Headings up to `maxLevel` at or below this node, in document order. */
export function headingsIn(node: HtmlNode, maxLevel: number): HtmlElement[] {
  const level = headingLevel(node);
  if (node.kind !== 'element') return [];
  if (level !== null && level <= maxLevel) return [node];
  return node.children.flatMap(child => headingsIn(child, maxLevel));
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** The readable text of a piece of markup: tags removed, common entities decoded, spaces collapsed. */
export function textOf(markup: string): string {
  return markup
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
      if (body.startsWith('#x') || body.startsWith('#X'))
        return String.fromCodePoint(parseInt(body.slice(2), 16));
      if (body.startsWith('#')) return String.fromCodePoint(Number(body.slice(1)));
      return ENTITIES[body.toLowerCase()] ?? entity;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

export interface HtmlSection {
  /** Text of the first heading of the section; empty when that heading has no text. */
  title: string;
  html: string;
}

export interface SplitResult {
  /** Everything before the first heading, when it holds more than white space and comments. */
  intro: string | null;
  sections: HtmlSection[];
}

/**
 * Cut markup into sections at headings up to `maxLevel`.
 *
 * A section starts at a top level element that is or contains such a
 * heading and runs to the next one. While exactly one element holds the
 * headings and it holds at least two, the search goes into it, because
 * imported chapters often sit in one wrapper. The wrapper's own tags are
 * dropped then; what stood around it is kept, before the first heading as
 * intro, after the wrapper at the end of the last section.
 */
export function splitAtHeadings(html: string, maxLevel: number): SplitResult {
  let nodes = parseHtml(html);
  let rangeStart = 0;
  let rangeEnd = html.length;
  let lead = '';
  let trail = '';

  for (;;) {
    const marked = nodes.filter(node => headingsIn(node, maxLevel).length > 0);
    const only = marked[0];
    if (
      marked.length === 1 &&
      only?.kind === 'element' &&
      headingLevel(only) === null &&
      headingsIn(only, maxLevel).length >= 2
    ) {
      lead += html.slice(rangeStart, only.start);
      trail = html.slice(only.end, rangeEnd) + trail;
      rangeStart = only.innerStart;
      rangeEnd = only.innerEnd;
      nodes = only.children;
      continue;
    }
    break;
  }

  const marked = nodes.filter(node => headingsIn(node, maxLevel).length > 0);
  if (marked.length === 0) {
    return { intro: null, sections: [] };
  }
  const first = marked[0] as HtmlNode;
  const introHtml = lead + html.slice(rangeStart, first.start);
  const sections = marked.map((node, index) => {
    const next = marked[index + 1];
    let piece = html.slice(node.start, next ? next.start : rangeEnd);
    if (!next) piece += trail;
    const heading = headingsIn(node, maxLevel)[0] as HtmlElement;
    return { title: textOf(html.slice(heading.innerStart, heading.innerEnd)), html: piece };
  });
  const meaningful = introHtml.replace(/<!--[\s\S]*?-->/g, '').trim() !== '';
  return { intro: meaningful ? introHtml : null, sections };
}
