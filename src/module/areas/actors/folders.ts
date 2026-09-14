/**
 * The folder of new actors and items: an existing folder id of the right type,
 * or a path that is found or created through the core helper.
 *
 * Before, an id was taken as a name and created a folder called like the id,
 * and a typo created a folder without a word about it.
 * Now an id is recognised, and every created folder is named in the answer.
 */
import type { HandlerContext } from '../../dispatcher.js';
import { ensureFolderPath, folderPathOf } from '../../folders.js';
import { invalid } from './common.js';

export const ACTOR_FOLDER = 'Foundry MCP Actors';
export const CREATURE_FOLDER = 'Foundry MCP Creatures';

export interface ResolvedFolder {
  id: string | null;
  path: string;
  created: Array<{ id: string; name: string; path: string }>;
}

export async function resolveFolder(
  given: string,
  type: 'Actor' | 'Item',
  log: { context: HandlerContext; query: string; tool: string }
): Promise<ResolvedFolder> {
  const byId = game.folders.get(given) as FoundryActorsFolder | undefined;
  if (byId) {
    if (byId.type !== type) {
      throw invalid(
        `"${given}" is the id of a ${byId.type ?? 'different'} folder ("${byId.name}"), not of a ${type} folder. Nothing was changed.`
      );
    }
    return { id: byId.id, path: folderPathOf(byId.id).path, created: [] };
  }
  const ensured = await ensureFolderPath(given, { type, ...log });
  return { id: ensured.id, path: ensured.path, created: ensured.created };
}
