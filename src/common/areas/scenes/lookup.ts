/**
 * The one lookup rule for scenes, journals, pages and folders.
 *
 * The previous generation had two rules (exact name here, any case there)
 * and silently took the first of several hits. Here every identifier goes
 * through the same steps:
 *
 * 1. an exact id
 * 2. an exact name, when exactly one entry has it
 * 3. the same name in any case, when exactly one entry has it
 *
 * Several entries on step 2 or 3 are an error that names them all with their
 * ids. There is never a substring match; names containing the text are only
 * offered as a hint in the "not found" message.
 */

export interface Named {
  id: string;
  name: string;
}

export type LookupResult<T extends Named> =
  | { found: true; entry: T; by: 'id' | 'name' | 'name-any-case' }
  | { found: false; reason: 'missing' | 'ambiguous' | 'empty'; matches: T[]; hints: T[] };

export interface LookupOptions {
  /** Whether step 1 applies. Folders along a path are looked up by name only. */
  byId?: boolean;
}

export function lookup<T extends Named>(
  entries: readonly T[],
  identifier: string,
  options: LookupOptions = {}
): LookupResult<T> {
  const wanted = identifier.trim();
  if (!wanted) return { found: false, reason: 'empty', matches: [], hints: [] };

  if (options.byId !== false) {
    const byId = entries.find(entry => entry.id === wanted);
    if (byId) return { found: true, entry: byId, by: 'id' };
  }

  const exact = entries.filter(entry => entry.name === wanted);
  if (exact.length === 1 && exact[0]) return { found: true, entry: exact[0], by: 'name' };
  if (exact.length > 1) return { found: false, reason: 'ambiguous', matches: exact, hints: [] };

  const lower = wanted.toLowerCase();
  const anyCase = entries.filter(entry => entry.name.toLowerCase() === lower);
  if (anyCase.length === 1 && anyCase[0])
    return { found: true, entry: anyCase[0], by: 'name-any-case' };
  if (anyCase.length > 1) return { found: false, reason: 'ambiguous', matches: anyCase, hints: [] };

  const hints = entries.filter(entry => entry.name.toLowerCase().includes(lower)).slice(0, 5);
  return { found: false, reason: 'missing', matches: [], hints };
}

function list(entries: readonly Named[]): string {
  return entries.map(entry => `"${entry.name}" [${entry.id}]`).join(', ');
}

/** The English message for a failed lookup, naming what matched or what comes close. */
export function lookupFailure(
  kind: string,
  identifier: string,
  result: Extract<LookupResult<Named>, { found: false }>,
  where = ''
): string {
  const place = where ? ` in ${where}` : '';
  if (result.reason === 'empty') return `A ${kind} identifier is required`;
  if (result.reason === 'ambiguous') {
    return (
      `The ${kind} identifier "${identifier}" is ambiguous${place}: it matches ${result.matches.length} ` +
      `${kind}s (${list(result.matches)}). Pass the id instead.`
    );
  }
  const hint = result.hints.length ? ` Names containing it: ${list(result.hints)}.` : '';
  return `${kind[0]?.toUpperCase() ?? ''}${kind.slice(1)} not found${place}: "${identifier}".${hint}`;
}
