/**
 * import-from-compendium: a document out of a compendium into the world.
 *
 * Always with a fresh id. Dragging an entry out by hand keeps the id and
 * silently replaces whatever carries it; that must never happen here.
 *
 * Permissions: the document kind is only known from the compendium, so the
 * dispatcher checks the write switch, and this handler asks the same
 * `checkAccess` for the kind of the target and, when folders have to be
 * created, for folders (guard.ts, `requireAccess`).
 */
import { byName, entriesNamed, similarNames } from '../../../common/areas/compendiums/names.js';
import { NAMES_IN_ERROR } from '../../../common/areas/compendiums/shapes.js';
import type { DocumentKind } from '../../../common/permissions.js';
import { QueryError, type HandlerContext, type QueryHandler } from '../../dispatcher.js';
import { requireWorld } from '../../world-ready.js';
import { asData, invalid, optionalString, requiredString } from './args.js';
import { requireAccess } from './guard.js';
import {
  documentClass,
  entryRef,
  idOf,
  packLabel,
  readIndex,
  requirePack,
  worldCollection,
  worldFolders,
} from './packs.js';
import { moduleFolderFlags } from './write.js';

/**
 * Matrix row per imported type. Items, macros and cards have no row of their
 * own yet; until the core adds one, the compendium level stands in for them.
 */
const KIND_OF: Readonly<Record<string, DocumentKind>> = {
  Actor: 'Actors',
  JournalEntry: 'Journals',
  Playlist: 'Playlists',
  RollTable: 'RollTables',
  Scene: 'Scenes',
  Item: 'Compendiums',
  Macro: 'Compendiums',
  Cards: 'Compendiums',
};

interface FolderPlan {
  type: string;
  parent: string | null;
  missing: string[];
}

/** Find each level of "A/B/C" under the previous one, exact name, folders of the type. */
function planFolders(path: string, type: string): FolderPlan {
  const parts = path
    .split('/')
    .map(part => part.trim())
    .filter(Boolean);
  let parent: string | null = null;
  for (const [position, part] of parts.entries()) {
    const matches = worldFolders().filter(
      folder => folder.type === type && folder.name === part && idOf(folder.folder) === parent
    );
    if (matches.length > 1)
      throw new QueryError(
        'AMBIGUOUS_FOLDER',
        `The folder path "${path}" is ambiguous at "${part}": ${matches.length} ${type} folders carry that name there ` +
          `(ids ${matches.map(folder => folder.id).join(', ')}). Nothing was imported.`
      );
    const match = matches[0];
    if (!match) return { type, parent, missing: parts.slice(position) };
    parent = match.id;
  }
  return { type, parent, missing: [] };
}

async function createFolders(plan: FolderPlan, context: HandlerContext): Promise<string | null> {
  let parent = plan.parent;
  for (const name of plan.missing) {
    const created = await documentClass('Folder').create({
      name,
      type: plan.type,
      folder: parent,
      flags: moduleFolderFlags(),
    });
    const id = (Array.isArray(created) ? created[0] : created)?.id;
    if (!id || !game.folders.get(id))
      throw new QueryError(
        'FOLDER_NOT_CREATED',
        `Folder "${name}" could not be created. Nothing was imported.`
      );
    context.recordChange({
      query: 'importFromCompendium',
      document: 'Folders',
      action: 'create',
      targets: [{ id, name }],
      summary: `Created the ${plan.type} folder "${name}" for an import.`,
    });
    parent = id;
  }
  return parent;
}

export const importFromCompendium: QueryHandler = {
  // The switch only; the matrix level of the target kind follows in run.
  access: { kind: 'extension', readOnly: false },
  run: async (data, context) => {
    requireWorld();
    const input = asData(data);
    const pack = requirePack(requiredString(input, 'packId'));
    const entryId = optionalString(input, 'entryId')?.trim() || undefined;
    const entryName = optionalString(input, 'entryName');
    if (!entryId && !entryName?.trim()) throw invalid('entryName or entryId is required');
    const newName = optionalString(input, 'newName')?.trim() || undefined;
    const folderPath = optionalString(input, 'folderPath') ?? '';
    const type = pack.documentName;
    const label = packLabel(pack);

    if (type === 'Adventure')
      throw new QueryError(
        'UNSUPPORTED_TYPE',
        `"${pack.collection}" holds adventures. Importing an adventure writes scenes, actors, journals and more at once ` +
          "and keeps their ids, which can replace world documents. Use the adventure's own import in Foundry instead."
      );
    const kind = KIND_OF[type];
    if (!kind)
      throw new QueryError(
        'UNSUPPORTED_TYPE',
        `Documents of the type ${type} cannot be imported into the world`
      );
    requireAccess(kind, 'create');

    const entries = (await readIndex(pack)).map(entryRef);
    let chosen = entryId ? entries.find(entry => entry.id === entryId) : undefined;
    if (entryId && !chosen)
      throw new QueryError(
        'ENTRY_NOT_FOUND',
        `No entry with the id "${entryId}" in "${label}" [${pack.collection}]`
      );
    if (!chosen && entryName) {
      const matches = entriesNamed(entries, entryName);
      if (matches.length > 1)
        throw new QueryError(
          'AMBIGUOUS_NAME',
          `"${entryName}" matches ${matches.length} entries in "${label}" (ids ${matches.map(entry => entry.id).join(', ')}). ` +
            'Pass entryId to choose one. Nothing was imported.'
        );
      chosen = matches[0];
      if (!chosen) {
        const similar = similarNames(entries, entryName);
        const first = [...entries]
          .sort(byName)
          .slice(0, NAMES_IN_ERROR)
          .map(entry => entry.name);
        throw new QueryError(
          'ENTRY_NOT_FOUND',
          `No entry named "${entryName}" in "${label}" [${pack.collection}]. Names are matched as a whole, ignoring case.` +
            (similar.length ? ` Names containing the text: ${similar.join(', ')}.` : '') +
            ` First names in the compendium: ${first.join(', ') || '(none)'}${entries.length > first.length ? ', ...' : ''}`
        );
      }
    }
    if (!chosen) throw invalid('entryName or entryId is required');

    const plan = planFolders(folderPath, type);
    if (plan.missing.length) requireAccess('Folders', 'create');

    const document = await pack.getDocument(chosen.id);
    if (!document)
      throw new QueryError(
        'ENTRY_NOT_FOUND',
        `Document ${chosen.id} not found in pack ${pack.collection}`
      );
    const source = document.toObject();
    for (const key of ['_id', 'folder', 'sort', 'ownership', '_stats']) delete source[key];
    if (newName) source['name'] = newName;

    const folderId = await createFolders(plan, context);
    if (folderId) source['folder'] = folderId;

    const created = await documentClass(type).create(source);
    const newId = (Array.isArray(created) ? created[0] : created)?.id;
    const inWorld = newId ? worldCollection(type).get(newId) : undefined;
    if (!newId || !inWorld)
      throw new QueryError(
        'NOT_VERIFIED',
        `Foundry reported no error, but the imported ${type} "${String(source['name'])}" is not in the world afterwards`
      );

    const name = inWorld.name ?? String(source['name'] ?? '');
    context.recordChange({
      query: 'importFromCompendium',
      document: kind,
      action: 'create',
      targets: [{ id: newId, name }],
      summary: `Imported ${type} "${name}" from "${label}" with a new id.`,
    });
    // `pack` is the id as text: a server of the previous generation writes it
    // into its sentence "imported from <pack>".
    return {
      id: newId,
      name,
      type,
      pack: pack.collection,
      packLabel: label,
      sourceId: chosen.id,
      folderId: folderId ?? null,
      createdFolders: plan.missing,
    };
  },
};
