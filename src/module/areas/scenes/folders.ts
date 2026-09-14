/**
 * Scene folders along a path such as "Locations/Harbour".
 *
 * Each step is looked up under the previous one with the one lookup rule.
 * Two folders of the same name on the same step are an error, not a coin
 * toss: the previous generation took the first one it found. A missing step
 * is created, flagged as created by this module (createdByMcp, and the
 * mcpGenerated and createdAt of the previous generation), and read back.
 */
import { lookup, lookupFailure } from '../../../common/areas/scenes/lookup.js';
import { splitFolderPath } from '../../../common/areas/scenes/names.js';
import { MODULE_ID } from '../../../common/constants.js';
import { documentClass, fail, firstCreated, idOf } from './support.js';

/** How far up a path is resolved, as documented. */
const MAX_DEPTH = 10;

export function sceneFolders(): FoundryScenesFolder[] {
  return (game.folders.contents as FoundryScenesFolder[]).filter(folder => folder.type === 'Scene');
}

export function parentId(folder: FoundryScenesFolder): string | null {
  return idOf(folder.folder);
}

/** Full path of a folder, resolved over at most ten steps; `complete` is false when it went deeper. */
export function folderPath(folder: FoundryScenesFolder): { path: string; complete: boolean } {
  const byId = new Map(sceneFolders().map(entry => [entry.id, entry]));
  const names = [folder.name];
  let current: FoundryScenesFolder | undefined = folder;
  for (let step = 1; step < MAX_DEPTH; step += 1) {
    const parent: string | null = current ? parentId(current) : null;
    current = parent ? byId.get(parent) : undefined;
    if (!current) return { path: names.join('/'), complete: true };
    names.unshift(current.name);
  }
  const deeper = current ? parentId(current) : null;
  return { path: names.join('/'), complete: deeper === null };
}

export interface EnsuredFolder {
  /** Id of the last folder of the path, null for an empty path. */
  id: string | null;
  /** Names of the folders that had to be created, outermost first. */
  created: Array<{ id: string; name: string }>;
}

export async function ensureFolderPath(path: string): Promise<EnsuredFolder> {
  const parts = splitFolderPath(path);
  const created: EnsuredFolder['created'] = [];
  let parent: string | null = null;

  for (const [index, name] of parts.entries()) {
    const siblings = sceneFolders()
      .filter(folder => parentId(folder) === parent)
      .map(folder => ({ id: folder.id, name: folder.name }));
    const where =
      index === 0 ? 'the top level of scene folders' : `"${parts.slice(0, index).join('/')}"`;
    const result = lookup(siblings, name, { byId: false });
    if (result.found) {
      parent = result.entry.id;
      continue;
    }
    if (result.reason === 'ambiguous') {
      fail('AMBIGUOUS', lookupFailure('folder', name, result, where));
    }

    let newId: string;
    try {
      const document = firstCreated(
        await documentClass('Folder').create({
          name,
          type: 'Scene',
          folder: parent,
          // The core marker plus the one of the previous generation, so a cleanup over both finds it.
          flags: {
            [MODULE_ID]: {
              createdByMcp: true,
              mcpGenerated: true,
              createdAt: new Date().toISOString(),
            },
          },
        }),
        'folder'
      );
      newId = document.id;
    } catch (error) {
      fail(
        'FOLDER_NOT_CREATED',
        `Folder "${name}" could not be created: ${String((error as Error)?.message ?? error)}`
      );
    }
    const check = game.folders.get(newId) as FoundryScenesFolder | undefined;
    if (!check || check.name !== name || parentId(check) !== parent) {
      fail(
        'FOLDER_NOT_CREATED',
        `Folder "${name}" could not be created: it is not in the world afterwards`
      );
    }
    created.push({ id: newId, name });
    parent = newId;
  }
  return { id: parent, created };
}
