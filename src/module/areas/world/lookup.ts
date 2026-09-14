/**
 * Finding documents of the world area by id or name, and reading references.
 *
 * One rule everywhere: an id wins, then the exact name. Two documents with
 * the same exact name are reported, never resolved by taking the first one,
 * because a write on the wrong one does not show.
 */
import { QueryError } from '../../dispatcher.js';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The input of a query as an object; anything else counts as empty. */
export function inputOf(data: unknown): Record<string, unknown> {
  return isRecord(data) ? data : {};
}

/** A trimmed text, or '' for anything that is not a text. */
export function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The id behind a reference field. Foundry holds the id in the source data and
 * may hand out the document itself on the prepared document; both are read.
 */
export function idOf(value: unknown): string | null {
  if (typeof value === 'string') return value || null;
  if (isRecord(value) && typeof value['id'] === 'string') return value['id'] || null;
  return null;
}

export function quoteList(names: readonly string[], max = 20): string {
  const shown = names.slice(0, max).map(name => `"${name}"`);
  const rest = names.length - shown.length;
  return rest > 0 ? `${shown.join(', ')} and ${rest} more` : shown.join(', ');
}

/** `"Name" (id x)` for each document, for messages that must let the model pick exactly one. */
export function describeDocuments(documents: readonly FoundryDocument[]): string {
  return documents.map(doc => `"${doc.name ?? ''}" (id ${doc.id})`).join(', ');
}

/**
 * Id first, then exact name. Returns null when nothing matches; throws when the
 * exact name belongs to more than one document.
 */
export function byIdOrExactName<T extends FoundryDocument>(
  collection: FoundryCollection<FoundryDocument>,
  identifier: string,
  kind: string
): T | null {
  const byId = collection.get(identifier);
  if (byId) return byId as T;
  const named = collection.filter(doc => doc.name === identifier);
  if (named.length > 1) {
    throw new QueryError(
      'AMBIGUOUS',
      `${named.length} ${kind}s are named "${identifier}": ${describeDocuments(named)}. Pass the id instead.`
    );
  }
  return (named[0] as T | undefined) ?? null;
}

/** For a delete by id that found nothing: say so, and whether the text is a name instead. */
export function notFoundById(
  collection: FoundryCollection<FoundryDocument>,
  identifier: string,
  kind: string
): QueryError {
  const named = collection.filter(doc => doc.name === identifier);
  let message = `${kind} "${identifier}" not found. Deleting works by id only.`;
  if (named.length) {
    message += ` A ${kind.toLowerCase()} with this name exists: ${describeDocuments(named)}.`;
  }
  return new QueryError('NOT_FOUND', message);
}
