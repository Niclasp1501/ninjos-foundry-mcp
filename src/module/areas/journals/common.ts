/**
 * What every handler of the journals area shares: reading arguments, finding
 * documents by id or exact name, and the second permission layer for tools
 * that touch more than the one document kind the dispatcher checked.
 */
import { MODULE_ID } from '../../../common/constants.js';
import { checkAccess, type DocumentKind, type WriteAction } from '../../../common/permissions.js';
import { QueryError } from '../../dispatcher.js';
import { readSetting } from '../../settings.js';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The arguments of a query as an object; anything else is refused with its type named. */
export function argsOf(data: unknown): Record<string, unknown> {
  if (data === undefined || data === null) return {};
  if (!isRecord(data)) {
    throw new QueryError(
      'INVALID_ARGUMENT',
      `The query data must be an object, got ${Array.isArray(data) ? 'an array' : typeof data}`
    );
  }
  return data;
}

function invalid(message: string): never {
  throw new QueryError('INVALID_ARGUMENT', message);
}

/** A required text. `allowEmpty` for HTML that may legitimately be empty. */
export function requiredText(
  args: Record<string, unknown>,
  key: string,
  { allowEmpty = false }: { allowEmpty?: boolean } = {}
): string {
  const value = args[key];
  if (typeof value !== 'string') {
    invalid(
      value === undefined ? `${key} is required` : `${key} must be a string, got ${typeof value}`
    );
  }
  if (!allowEmpty && value.trim() === '') invalid(`${key} must not be empty`);
  return value;
}

export function optionalText(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') invalid(`${key} must be a string, got ${typeof value}`);
  return value;
}

export function optionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') invalid(`${key} must be true or false, got ${typeof value}`);
  return value;
}

export function optionalNumber(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value))
    invalid(`${key} must be a number, got ${JSON.stringify(value)}`);
  return value;
}

export function optionalTextList(args: Record<string, unknown>, key: string): string[] | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string'))
    invalid(`${key} must be a list of strings`);
  return value as string[];
}

export function notFound(message: string): never {
  throw new QueryError('NOT_FOUND', message);
}

/** A write that happened but does not read back as intended. Says that it happened. */
export function verifyFailed(message: string): never {
  throw new QueryError(
    'VERIFY_FAILED',
    `${message}. The write was sent to Foundry, so check the document before retrying.`
  );
}

export function getJournal(journalId: string): FoundryJournalsEntry {
  const journal = game.journal.get(journalId) as FoundryJournalsEntry | undefined;
  if (!journal) notFound(`Journal not found: ${journalId}`);
  return journal;
}

export function getPage(journal: FoundryJournalsEntry, pageId: string): FoundryJournalsPage {
  const page = journal.pages.get(pageId);
  if (!page) notFound(`Page not found: ${pageId} (journal "${journal.name}", ${journal.id})`);
  return page;
}

export function isTextPage(page: FoundryJournalsPage): boolean {
  return page.type === 'text';
}

export function pageHtml(page: FoundryJournalsPage): string {
  const content = page.text?.content;
  return typeof content === 'string' ? content : '';
}

export function requireTextPage(page: FoundryJournalsPage, what: string): void {
  if (!isTextPage(page)) {
    invalid(
      `${what}: page "${page.name}" (${page.id}) is a ${page.type} page; only text pages have HTML content`
    );
  }
}

/** Pages in the order Foundry shows them: by sort, ties in stored order. */
export function orderedPages(journal: FoundryJournalsEntry): FoundryJournalsPage[] {
  return [...journal.pages.contents].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
}

/** Foundry's spacing between sort values (CONST.SORT_INTEGER_DENSITY). */
export const SORT_STEP = 100_000;

/** CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML */
export const HTML_FORMAT = 1;

/** The id of a folder field, whether Foundry resolved it to a document or kept the id. */
export function folderIdOf(document: { folder?: unknown }): string | null {
  const folder = document.folder;
  if (typeof folder === 'string' && folder) return folder;
  if (isRecord(folder) && typeof folder['id'] === 'string') return folder['id'];
  return null;
}

/** A Foundry document class by name, e.g. JournalEntry or Folder. */
export function documentClass(name: string): FoundryJournalsDocumentClass {
  const found = (globalThis as Record<string, unknown>)[name];
  if (typeof found !== 'function' && !isRecord(found))
    throw new QueryError('NOT_AVAILABLE', `Foundry has no document class ${name}`);
  return found as unknown as FoundryJournalsDocumentClass;
}

export function packsOf(): FoundryJournalsPacks {
  const packs = (game as unknown as { packs?: FoundryJournalsPacks }).packs;
  if (!packs) throw new QueryError('NOT_AVAILABLE', 'Foundry has no compendium collection');
  return packs;
}

/**
 * The second permission layer. The dispatcher checks the switch and the level
 * of the one kind a handler declares; a tool that also creates folders or
 * writes into scenes asks the same function for those kinds, before its
 * first write.
 */
export function requireAccess(document: DocumentKind, action: WriteAction): void {
  const decision = checkAccess({ kind: 'write', document, action }, readSetting);
  if (!decision.allowed) throw new QueryError(decision.code, decision.reason);
}

/** Whether a write would be allowed, for dry runs that report instead of failing. */
export function accessProblem(document: DocumentKind, action: WriteAction): string | null {
  const decision = checkAccess({ kind: 'write', document, action }, readSetting);
  return decision.allowed ? null : decision.reason;
}

/** Undo data for the change log only while it stays small; a 2 MB page times 200 entries would not. */
const BEFORE_LIMIT = 200_000;

export function smallEnough(value: unknown): unknown {
  try {
    return JSON.stringify(value).length <= BEFORE_LIMIT ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Find one document by id, or else by exact name. Several documents with that
 * name is an error listing them, never the first one silently.
 */
export function findByIdOrName<T extends FoundryDocument>(
  candidates: readonly T[],
  identifier: string,
  what: string,
  describe: (entry: T) => string
): T {
  const byId = candidates.find(entry => entry.id === identifier);
  if (byId) return byId;
  const byName = candidates.filter(entry => entry.name === identifier);
  if (byName.length === 1) return byName[0] as T;
  if (byName.length === 0) notFound(`${what} not found: ${identifier}`);
  throw new QueryError(
    'AMBIGUOUS',
    `${byName.length} ${what.toLowerCase()}s are named "${identifier}": ${byName.map(describe).join('; ')}. ` +
      'Pass the id instead of the name.'
  );
}

/** A visible text of this package. */
export function localize(key: string, data: Record<string, string> = {}): string {
  return game.i18n.format(`${MODULE_ID}.journals.${key}`, data);
}

/** Read a value at a dotted path of plain data. */
export function valueAt(data: unknown, path: string): unknown {
  let node = data;
  for (const part of path.split('.')) {
    if (!isRecord(node)) return undefined;
    node = node[part];
  }
  return node;
}

/** Whether every leaf of `expected` is present in `actual` with the same value. */
export function containsAll(actual: unknown, expected: unknown): boolean {
  if (isRecord(expected)) {
    if (!isRecord(actual)) return false;
    return Object.entries(expected).every(([key, value]) => containsAll(actual[key], value));
  }
  return JSON.stringify(actual) === JSON.stringify(expected);
}
