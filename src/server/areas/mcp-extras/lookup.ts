/**
 * Completion of ids for prompts and resource templates.
 *
 * Each completer asks one list query that another package already answers
 * and reads ids and names from the answer, whichever of the known shapes it
 * has (a bare list, or a list under one key). A client shows the values while
 * the Gamemaster types, so they are ids ranked by how well id or name fit.
 */
import type { Completer, CompletionContext } from '../../tools/resources.js';
import { legacyFailure } from '../../tools/results.js';

export interface Candidate {
  id: string;
  name: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function candidatesIn(answer: unknown, keys: readonly string[]): Candidate[] {
  let list: unknown[] = [];
  if (Array.isArray(answer)) list = answer;
  else if (isRecord(answer)) {
    const key = keys.find(k => Array.isArray(answer[k]));
    if (key) list = answer[key] as unknown[];
  }
  const found: Candidate[] = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const id = text(item['id']) || text(item['_id']) || text(item['collection']);
    if (!id) continue;
    found.push({ id, name: text(item['name']) || text(item['label']) || text(item['title']) });
  }
  return found;
}

/** Ids whose id or name fits the typed text: id prefix, name prefix, name part, id part. */
export function rankCandidates(candidates: readonly Candidate[], typed: string): string[] {
  const wanted = typed.trim().toLowerCase();
  const scored: Array<{ candidate: Candidate; score: number }> = [];
  for (const candidate of candidates) {
    const id = candidate.id.toLowerCase();
    const name = candidate.name.toLowerCase();
    let score: number;
    if (!wanted || id.startsWith(wanted)) score = 0;
    else if (name.startsWith(wanted)) score = 1;
    else if (name.includes(wanted)) score = 2;
    else if (id.includes(wanted)) score = 3;
    else continue;
    scored.push({ candidate, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.candidate.name.localeCompare(b.candidate.name))
    .map(entry => entry.candidate.id);
}

async function listed(
  context: CompletionContext,
  query: string,
  data: Record<string, unknown>
): Promise<unknown> {
  const answer = await context.query(
    query,
    data,
    context.signal ? { signal: context.signal } : undefined
  );
  const failure = legacyFailure(answer);
  if (failure !== null) throw new Error(`${query} failed: ${failure}`);
  return answer;
}

function fromList(
  query: string,
  data: Record<string, unknown>,
  keys: readonly string[]
): Completer {
  return async (value, context) =>
    rankCandidates(candidatesIn(await listed(context, query, data), keys), value);
}

export const completeSceneId = fromList('list-scenes', { filter: '', include_active_only: false }, [
  'scenes',
]);
export const completeJournalId = fromList('listJournals', {}, ['journals']);
export const completeActorId = fromList('listActors', {}, ['actors']);
export const completePackId = fromList('listCompendiums', {}, ['compendiums', 'packs']);
export const completeCombatId = fromList('listCombats', {}, ['combats']);

/** Pages of the journal named in the arguments; nothing without a journal id. */
export const completePageId: Completer = async (value, context) => {
  const journalId = context.arguments['journalId'];
  if (!journalId) return [];
  const journals = await listed(context, 'listJournals', {});
  const list = Array.isArray(journals)
    ? journals
    : isRecord(journals) && Array.isArray(journals['journals'])
      ? journals['journals']
      : [];
  const journal = list.find(item => isRecord(item) && item['id'] === journalId);
  return isRecord(journal) ? rankCandidates(candidatesIn(journal['pages'], []), value) : [];
};

export const DIFFICULTIES = ['easy', 'medium', 'hard', 'deadly'] as const;

/** A fixed list, filtered by what is typed. */
export function completeFrom(values: readonly string[]): Completer {
  return async value => {
    const wanted = value.trim().toLowerCase();
    return values.filter(v => v.toLowerCase().startsWith(wanted));
  };
}
