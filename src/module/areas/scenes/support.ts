/**
 * What every scene handler shares. Errors with their cause,
 * reading documents that Foundry and stored data shape differently, and the
 * one lookup rule applied to scenes, journals and pages.
 */
import { lookup, lookupFailure, type Named } from '../../../common/areas/scenes/lookup.js';
import { QueryError } from '../../dispatcher.js';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return 'unknown cause';
}

export function fail(code: string, message: string): never {
  throw new QueryError(code, message);
}

/**
 * Run the work of one query and put "Failed to <operation>: " in front of any
 * error, keeping its code. That is the documented error form; the cause is
 * always part of it.
 */
export async function operation<T>(name: string, work: () => Promise<T> | T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const code = error instanceof QueryError ? error.code : 'FAILED';
    throw new QueryError(code, `Failed to ${name}: ${messageOf(error)}`);
  }
}

/** A trimmed string, or undefined for anything else and for an empty string. */
export function textArg(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function numberArg(data: Record<string, unknown>, key: string): number | undefined {
  const value = data[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value))
    fail('INVALID_ARGUMENT', `${key} must be a finite number`);
  return value;
}

export function booleanArg(data: Record<string, unknown>, key: string): boolean | undefined {
  const value = data[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') fail('INVALID_ARGUMENT', `${key} must be true or false`);
  return value;
}

export function dataOf(data: unknown): Record<string, unknown> {
  return isRecord(data) ? data : {};
}

/** Foundry returns the document for a reference field; stored data holds the id. Both give the id. */
export function idOf(value: unknown): string | null {
  if (typeof value === 'string') return value || null;
  if (isRecord(value) && typeof value['id'] === 'string') return value['id'] || null;
  return null;
}

export function sceneList(): FoundryScenesScene[] {
  return game.scenes.contents as FoundryScenesScene[];
}

export function activeScene(): FoundryScenesScene | undefined {
  return sceneList().find(scene => scene.active === true);
}

function named<T extends FoundryDocument>(documents: readonly T[]): Array<Named & { doc: T }> {
  return documents.map(doc => ({ id: doc.id, name: doc.name ?? '', doc }));
}

function resolve<T extends FoundryDocument>(
  kind: string,
  documents: readonly T[],
  identifier: string,
  code: string,
  where = ''
): T {
  const result = lookup(named(documents), identifier);
  if (result.found) return result.entry.doc;
  fail(
    result.reason === 'ambiguous' ? 'AMBIGUOUS' : code,
    lookupFailure(kind, identifier, result, where)
  );
}

/** `kind` names the role in messages, e.g. "template" gives "Template not found". */
export function findScene(identifier: string, kind = 'scene'): FoundryScenesScene {
  return resolve(kind, sceneList(), identifier, 'SCENE_NOT_FOUND');
}

export function findJournal(identifier: string): FoundryScenesJournal {
  return resolve(
    'journal',
    game.journal.contents as FoundryScenesJournal[],
    identifier,
    'JOURNAL_NOT_FOUND'
  );
}

/** A page by id or name. When none matches, the error lists every page, so the model can pick the right one. */
export function findPage(journal: FoundryScenesJournal, identifier: string): FoundryScenesPage {
  const pages = journal.pages?.contents ?? [];
  const result = lookup(named(pages), identifier);
  if (result.found) return result.entry.doc;
  const where = `the journal "${journal.name}"`;
  if (result.reason === 'ambiguous')
    fail('AMBIGUOUS', lookupFailure('page', identifier, result, where));
  const all = pages.length
    ? pages.map(page => `"${page.name}" [${page.id}]`).join(', ')
    : 'it has no pages';
  fail('PAGE_NOT_FOUND', `Page not found in ${where}: "${identifier}". Pages: ${all}.`);
}

/** The document class Foundry offers as a global, e.g. Scene or Folder. */
export function documentClass(name: string): FoundryScenesDocumentClass {
  const candidate = (globalThis as Record<string, unknown>)[name];
  const create = isRecord(candidate) || typeof candidate === 'function' ? candidate : undefined;
  if (!create || typeof (create as { create?: unknown }).create !== 'function')
    fail('FOUNDRY_API', `Foundry's ${name} document class is not available`);
  return create as unknown as FoundryScenesDocumentClass;
}

export function firstCreated(result: unknown, kind: string): FoundryDocument {
  const document = Array.isArray(result) ? result[0] : result;
  if (!isRecord(document) || typeof document['id'] !== 'string')
    fail('NOT_CREATED', `Foundry did not return the new ${kind}`);
  return document as unknown as FoundryDocument;
}

/** Size of an embedded collection, 0 when the collection does not exist. */
export function sizeOf(collection: { size: number } | undefined): number {
  return collection?.size ?? 0;
}

/** What Foundry's own route helper makes of a path in the data directory, the path itself without it. */
export function route(path: string): string {
  const utils = (globalThis as { foundry?: { utils?: { getRoute?: (p: string) => string } } })
    .foundry?.utils;
  return typeof utils?.getRoute === 'function' ? utils.getRoute(path) : path;
}
