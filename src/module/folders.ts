/**
 * Folder paths such as "Locations/Harbour", shared by every package.
 *
 * Grown from what the scenes and world areas each built for
 * themselves, with the stricter rule wherever the two differed:
 *
 * - Each level is looked up under the one before, among folders of the one
 *   document type. Two folders of the same name on one level are an error
 *   naming both, never the first one found.
 * - An empty level ("a//b") is an error, not skipped.
 * - Nothing is written before the whole path is known. Creating a folder is a
 *   write of the kind Folders, so the helper asks the dispatcher's decision
 *   (`context.requireAccess`) before the first folder, and only when one is
 *   actually missing. A handler that wants to declare it up front uses
 *   `planFolderPath` inside its access rule instead.
 * - Every created folder carries the flag `createdByMcp`, is read back, and
 *   gets its own entry in the change log.
 * - It also carries the markers of the previous generation, `mcpGenerated`
 *   and `createdAt` (ISO time), in the same create, so a later cleanup finds
 *   the folders of both generations and no package writes a folder twice.
 * A package adds its own
 *   markers (`questContext`) with `flags`; the three markers above win.
 */
import { MODULE_ID } from '../common/constants.js';
import type { Access } from '../common/permissions.js';
import { QueryError, type HandlerContext } from './dispatcher.js';

/** Flag under `flags["ninjos-foundry-mcp"]` on every folder this module created. */
export const FOLDER_CREATED_FLAG = 'createdByMcp';

/** The marker the previous generation wrote, next to `createdAt`. */
export const FOLDER_PREVIOUS_FLAG = 'mcpGenerated';

/** The flags a folder gets under `flags["ninjos-foundry-mcp"]`: extra markers first, the fixed ones win. */
export function folderCreationFlags(
  extra: Readonly<Record<string, unknown>> = {},
  now: Date = new Date()
): Record<string, unknown> {
  return {
    ...extra,
    [FOLDER_CREATED_FLAG]: true,
    [FOLDER_PREVIOUS_FLAG]: true,
    createdAt: now.toISOString(),
  };
}

/** How far up `folderPathOf` follows parents. */
export const FOLDER_PATH_MAX_DEPTH = 10;

/**
 * How a level name matches. `exact`: same text. `ignoreCaseWhenUnique`: same
 * text, or else the one folder whose name differs only in case; several such
 * folders are an error.
 */
export type FolderNameMatch = 'exact' | 'ignoreCaseWhenUnique';

export interface FolderPathOptions {
  /** Folder type, e.g. "Scene", "RollTable", "JournalEntry". */
  type: string;
  /** Default `exact`. */
  nameMatch?: FolderNameMatch;
}

export interface FolderPlan {
  levels: string[];
  path: string;
  /** Id of the deepest existing folder of the path, null when none exists (or the path is empty). */
  existingId: string | null;
  /** How many levels exist. */
  existingDepth: number;
  /** The levels that would have to be created, outermost first. */
  missing: string[];
}

export interface EnsuredFolderPath {
  /** Id of the last folder of the path, null for an empty path. */
  id: string | null;
  path: string;
  created: Array<{ id: string; name: string; path: string }>;
}

interface FolderLike {
  id: string;
  uuid?: string;
  name?: string;
  type?: string;
  folder?: unknown;
}

/** The id of a folder field, whether Foundry resolved it to a document or kept the id. */
export function folderIdOf(value: unknown): string | null {
  if (typeof value === 'string') return value || null;
  if (typeof value === 'object' && value !== null) {
    const record = value as { id?: unknown; _id?: unknown };
    const id = record.id ?? record._id;
    return typeof id === 'string' && id ? id : null;
  }
  return null;
}

function allFolders(): FolderLike[] {
  return game.folders.contents as unknown as FolderLike[];
}

function describe(folder: FolderLike): string {
  const parent = folderIdOf(folder.folder);
  const parentName = parent ? (game.folders.get(parent)?.name ?? parent) : null;
  return `"${folder.name}" (${folder.id}${parentName ? `, in "${parentName}"` : ''})`;
}

/**
 * The levels of a path. A text is split at slashes; a list is taken as it is,
 * so a folder name that contains a slash can still be reached.
 */
export function splitFolderPath(path: string | readonly string[]): string[] {
  const shown = typeof path === 'string' ? path : path.join('/');
  const raw = typeof path === 'string' ? (path.trim() ? path.trim().split('/') : []) : [...path];
  const levels = raw.map(level => level.trim());
  if (levels.some(level => !level)) {
    throw new QueryError(
      'INVALID_ARGUMENT',
      `The folder path "${shown}" has an empty level. Separate levels with a single slash, e.g. "Locations/Harbour".`
    );
  }
  return levels;
}

function findLevel(
  levels: readonly string[],
  depth: number,
  parent: string | null,
  options: FolderPathOptions
): FolderLike | null {
  const name = levels[depth] as string;
  const siblings = allFolders().filter(
    folder => folder.type === options.type && folderIdOf(folder.folder) === parent
  );
  let matches = siblings.filter(folder => folder.name === name);
  if (matches.length === 0 && options.nameMatch === 'ignoreCaseWhenUnique') {
    const lower = name.toLowerCase();
    matches = siblings.filter(folder => (folder.name ?? '').toLowerCase() === lower);
  }
  if (matches.length > 1) {
    const where = depth === 0 ? 'the top level' : `"${levels.slice(0, depth).join('/')}"`;
    throw new QueryError(
      'AMBIGUOUS',
      `${matches.length} ${options.type} folders named "${name}" are in ${where}: ${matches.map(describe).join('; ')}. ` +
        'Rename one of them, or use a path that is unique.'
    );
  }
  return matches[0] ?? null;
}

/** Walk the path without writing: what exists and what would have to be created. */
export function planFolderPath(
  path: string | readonly string[],
  options: FolderPathOptions
): FolderPlan {
  const levels = splitFolderPath(path);
  let parent: string | null = null;
  let depth = 0;
  for (; depth < levels.length; depth += 1) {
    const match = findLevel(levels, depth, parent, options);
    if (!match) break;
    parent = match.id;
  }
  return {
    levels,
    path: levels.join('/'),
    existingId: parent,
    existingDepth: depth,
    missing: levels.slice(depth),
  };
}

/** The access creating the missing levels needs; empty when nothing is missing. For access rules. */
export function folderCreationAccess(plan: FolderPlan): Access[] {
  return plan.missing.length ? [{ kind: 'write', document: 'Folders', action: 'create' }] : [];
}

function folderClass(): { create(data: Record<string, unknown>): Promise<unknown> } {
  const found = (globalThis as Record<string, unknown>)['Folder'];
  const create = (found as { create?: unknown } | undefined)?.create;
  if (typeof create !== 'function')
    throw new QueryError('NOT_AVAILABLE', "Foundry's Folder class is not available");
  return found as { create(data: Record<string, unknown>): Promise<unknown> };
}

/**
 * Find the path and create what is missing. Returns the id of the last
 * folder. Refuses before the first write when creating folders is not allowed.
 */
export async function ensureFolderPath(
  path: string | readonly string[],
  options: FolderPathOptions & {
    context: HandlerContext;
    query: string;
    tool?: string;
    /** More markers under `flags["ninjos-foundry-mcp"]` of every created folder, e.g. `questContext`. */
    flags?: Readonly<Record<string, unknown>>;
  }
): Promise<EnsuredFolderPath> {
  const plan = planFolderPath(path, options);
  if (!plan.missing.length) return { id: plan.existingId, path: plan.path, created: [] };

  options.context.requireAccess(
    { kind: 'write', document: 'Folders', action: 'create' },
    `The folder "${plan.missing[0]}" of "${plan.path}" does not exist and would have to be created.`
  );

  const Folder = folderClass();
  const created: EnsuredFolderPath['created'] = [];
  let parent = plan.existingId;
  for (let depth = plan.existingDepth; depth < plan.levels.length; depth += 1) {
    const name = plan.levels[depth] as string;
    const subPath = plan.levels.slice(0, depth + 1).join('/');
    const before = created.length
      ? ` Created before it: ${created.map(entry => `"${entry.path}" (${entry.id})`).join(', ')}.`
      : '';

    let made: unknown;
    try {
      made = await Folder.create({
        name,
        type: options.type,
        folder: parent,
        flags: { [MODULE_ID]: folderCreationFlags(options.flags) },
      });
    } catch (error) {
      throw new QueryError(
        'FOLDER_NOT_CREATED',
        `The ${options.type} folder "${subPath}" could not be created: ${error instanceof Error ? error.message : String(error)}.${before}`
      );
    }
    const id = folderIdOf(Array.isArray(made) ? made[0] : made);
    const readBack = id ? (game.folders.get(id) as unknown as FolderLike | undefined) : undefined;
    if (
      !id ||
      !readBack ||
      readBack.name !== name ||
      readBack.type !== options.type ||
      folderIdOf(readBack.folder) !== parent
    ) {
      throw new QueryError(
        'FOLDER_NOT_CREATED',
        `The ${options.type} folder "${subPath}" could not be created: it is not in the world afterwards.${before}`
      );
    }

    options.context.recordChange({
      query: options.query,
      ...(options.tool ? { tool: options.tool } : {}),
      document: 'Folders',
      action: 'create',
      targets: [
        { id, name, documentName: 'Folder', ...(readBack.uuid ? { uuid: readBack.uuid } : {}) },
      ],
      summary: `Created the ${options.type} folder "${subPath}".`,
    });
    created.push({ id, name, path: subPath });
    parent = id;
  }
  return { id: parent, path: plan.path, created };
}

/**
 * The full path of a folder, outermost first. `complete` is false when the
 * chain was deeper than `FOLDER_PATH_MAX_DEPTH` or a parent is missing.
 */
export function folderPathOf(folderOrId: string | { id: string }): {
  path: string;
  levels: string[];
  complete: boolean;
} {
  const start = typeof folderOrId === 'string' ? folderOrId : folderOrId.id;
  const levels: string[] = [];
  let current = game.folders.get(start) as unknown as FolderLike | undefined;
  if (!current) return { path: '', levels, complete: false };
  for (let step = 0; step < FOLDER_PATH_MAX_DEPTH && current; step += 1) {
    levels.unshift(current.name ?? current.id);
    const parent = folderIdOf(current.folder);
    if (!parent) return { path: levels.join('/'), levels, complete: true };
    current = game.folders.get(parent) as unknown as FolderLike | undefined;
  }
  return { path: levels.join('/'), levels, complete: false };
}
