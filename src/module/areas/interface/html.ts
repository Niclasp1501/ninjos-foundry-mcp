/**
 * The windows build their content as HTML text. Every value that comes from
 * the world or from a translation goes through escapeHtml: compendium labels
 * and module titles are written by other people.
 */

const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, char => ENTITIES[char] ?? char);
}

/** ` disabled` or nothing. */
export function disabledIf(condition: boolean): string {
  return condition ? ' disabled' : '';
}

/** ` checked` or nothing. */
export function checkedIf(condition: boolean): string {
  return condition ? ' checked' : '';
}

/** A Font Awesome icon, hidden from screen readers: the name stands next to it. */
export function icon(name: string): string {
  return `<i class="fa-solid ${escapeHtml(name)}" aria-hidden="true"></i>`;
}
