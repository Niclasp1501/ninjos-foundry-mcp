/**
 * How replace-journal-page turns the text a model sends into page HTML.
 *
 * Shared by server and module: the module prepares it for the new query, the
 * server for a module of the previous generation, which stores `content`
 * exactly as it gets it.
 *
 * The rule is deliberately small. Markup stays untouched, byte for byte:
 * the previous generation removed asterisks, hash signs and list markers even
 * inside real HTML and never said so. Plain text becomes paragraphs and
 * nothing in it is removed; when it looks like Markdown, the result says so,
 * so the model can send HTML next time instead of losing characters silently.
 */

export interface PreparedContent {
  html: string;
  /** `html` when the content already held markup, `text` when paragraphs were built. */
  format: 'html' | 'text';
  /** A hint for the model, or null. */
  note: string | null;
}

/** An opening, closing or self-closing tag of an element. A lone "<" or "a < b" is not one. */
const ELEMENT = /<\/?[a-zA-Z][a-zA-Z0-9-]*(\s[^<>]*)?\/?>/;

const MARKDOWN = [
  /(^|\n)[ \t]*#{1,6}[ \t]+\S/,
  /(^|\n)[ \t]*[-*+][ \t]+\S/,
  /(^|\n)[ \t]*\d+\.[ \t]+\S/,
  /\*\*[^*\n]+\*\*/,
  /`[^`\n]+`/,
  /\[[^\]\n]+\]\([^)\s]+\)/,
];

/** `<` and `>` become entities; an `&` only when it does not already start one, so "&amp;" stays. */
function escapeText(text: string): string {
  return text
    .replace(/&(?!#\d+;|#x[0-9a-fA-F]+;|[a-zA-Z][a-zA-Z0-9]*;)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** True when the text has nothing but white space. Such content is refused, never stored as an empty page. */
export function isBlank(content: string): boolean {
  return content.trim() === '';
}

export function prepareContent(content: string): PreparedContent {
  if (ELEMENT.test(content)) return { html: content, format: 'html', note: null };

  const normalised = content.replace(/\r\n?/g, '\n').trim();
  const paragraphs = normalised
    .split(/\n[ \t]*\n/)
    .map(block => block.trim())
    .filter(block => block !== '')
    .map(block => `<p>${escapeText(block).replace(/\n/g, '<br>')}</p>`);

  const looksLikeMarkdown = MARKDOWN.some(pattern => pattern.test(normalised));
  return {
    html: paragraphs.join(''),
    format: 'text',
    note: looksLikeMarkdown
      ? 'The content had no HTML tags and was stored as plain text paragraphs. It looks like Markdown; ' +
        'Foundry shows Markdown characters as they are, so send HTML (for example <h2>, <strong>, <ul>) for formatting.'
      : null,
  };
}
