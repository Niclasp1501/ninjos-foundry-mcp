/**
 * Finding documents by what a model passes, and reading arguments.
 *
 * Two rules, one for writing and one for reading:
 *
 * - Writing: the id, then the exact name, then the same name ignoring case.
 *   Never a part of a name. The previous generation took a unique partial
 *   match for playlists and tracks; a name that happens to be unique today
 *   ("Rain") silently lands on another document tomorrow ("Rain heavy").
 * - Reading (manage-playlists describe): the same, and after that a unique
 *   part of the name, because a wrong guess there changes nothing.
 *
 * On every step more than one match is an error that lists the matches with
 * their ids. Nothing is ever resolved by taking the first one.
 */
import { QueryError } from '../../dispatcher.js';
import { describeDocuments, quoteList } from '../world/lookup.js';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function invalid(message: string): never {
  throw new QueryError('INVALID_ARGUMENT', message);
}

export function notFound(message: string): never {
  throw new QueryError('NOT_FOUND', message);
}

/** A write that Foundry accepted but that does not read back as sent. */
export function notApplied(message: string): never {
  throw new QueryError(
    'NOT_APPLIED',
    `${message}. The change was sent to Foundry, so check the document before retrying.`
  );
}

/** The message of anything thrown, so the cause always reaches the text. */
export function causeOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return typeof error === 'string' && error ? error : 'unknown error';
}

/** The arguments of a query as an object; anything else is refused. */
export function argsOf(data: unknown): Record<string, unknown> {
  if (data === undefined || data === null) return {};
  if (!isRecord(data)) invalid('The query data must be an object');
  return data;
}

/** Keys the query does not know are an error, not ignored. */
export function refuseUnknown(
  args: Record<string, unknown>,
  known: readonly string[],
  where = ''
): string[] {
  return Object.keys(args)
    .filter(key => !known.includes(key) && args[key] !== undefined)
    .map(key => `${where}${key} is not a known parameter`);
}

export type Match = 'write' | 'read';

/**
 * One document of `candidates` for `identifier`, or null when none matches.
 * Throws AMBIGUOUS when a step has more than one match.
 */
export function pickOne<T extends FoundryDocument>(
  candidates: readonly T[],
  identifier: string,
  kind: string,
  match: Match
): T | null {
  const byId = candidates.find(entry => entry.id === identifier);
  if (byId) return byId;

  const lower = identifier.toLowerCase();
  const steps: Array<[string, (entry: T) => boolean]> = [
    ['named', entry => entry.name === identifier],
    ['named, ignoring case,', entry => (entry.name ?? '').toLowerCase() === lower],
  ];
  if (match === 'read') {
    steps.push(['containing', entry => (entry.name ?? '').toLowerCase().includes(lower)]);
  }
  for (const [how, test] of steps) {
    const found = candidates.filter(test);
    if (found.length === 1) return found[0] as T;
    if (found.length > 1) {
      throw new QueryError(
        'AMBIGUOUS',
        `${found.length} ${kind}s are ${how} "${identifier}": ${describeDocuments(found)}. Pass the id instead.`
      );
    }
  }
  return null;
}

/**
 * The end of a not found message: names that contain the text as suggestions,
 * otherwise what exists, so the model can pick without another call.
 */
export function suggestions(
  candidates: readonly FoundryDocument[],
  identifier: string,
  kind: string
): string {
  if (candidates.length === 0) return `There are no ${kind}s.`;
  const lower = identifier.toLowerCase();
  const close = candidates.filter(entry => (entry.name ?? '').toLowerCase().includes(lower));
  if (close.length) {
    return `Names containing it (a part of a name is not used for changes): ${describeDocuments(close.slice(0, 20))}.`;
  }
  return `Existing ${kind}s: ${quoteList(candidates.map(entry => entry.name ?? ''))}.`;
}

/** A text that must be present and not blank. */
export function requiredText(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string') {
    invalid(
      value === undefined ? `${key} is required` : `${key} must be a string, got ${typeOf(value)}`
    );
  }
  if (value.trim() === '') invalid(`${key} must not be empty`);
  return value;
}

export function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** A readable form of a value in a message, kept short. */
export function shown(value: unknown): string {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

/**
 * Where the stored data differs from what was sent: one entry per leaf of
 * `sent`. Objects are compared key by key, lists and values as a whole.
 */
export function differences(sent: unknown, stored: unknown, path = ''): string[] {
  if (isRecord(sent)) {
    if (!isRecord(stored)) return [`${path || '(root)'} (sent an object, stored ${shown(stored)})`];
    return Object.entries(sent).flatMap(([key, value]) =>
      differences(value, stored[key], path ? `${path}.${key}` : key)
    );
  }
  if (JSON.stringify(sent) === JSON.stringify(stored)) return [];
  return [`${path || '(root)'} (sent ${shown(sent)}, stored ${shown(stored)})`];
}

/** Foundry's playlist modes by their stored number. */
export const PLAYLIST_MODES: Readonly<Record<string, string>> = {
  '-1': 'disabled',
  '0': 'sequential',
  '1': 'shuffle',
  '2': 'simultaneous',
};

export function modeName(mode: unknown): string {
  return PLAYLIST_MODES[String(mode)] ?? String(mode ?? 'unknown');
}

export function playlists(): FoundryEffectsPlaybackPlaylist[] {
  return game.playlists.contents as FoundryEffectsPlaybackPlaylist[];
}
