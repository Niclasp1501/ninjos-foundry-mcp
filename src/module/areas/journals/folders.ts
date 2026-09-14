/**
 * Renaming and deleting sidebar folders.
 *
 * A folder is named by its id or its exact name. Several folders with that
 * name is an error that lists them, so the model can pass the id instead of
 * silently getting the first one.
 *
 * Deleting does the moving and the deleting explicitly instead of leaving it
 * to Foundry's options, so every step can be permission checked beforehand
 * and read back afterwards.
 */
import type { DocumentKind } from '../../../common/permissions.js';
import type { QueryHandler } from '../../dispatcher.js';
import { QueryError } from '../../dispatcher.js';
import { requireWorld } from '../../world-ready.js';
import {
  argsOf,
  documentClass,
  findByIdOrName,
  folderIdOf,
  optionalBoolean,
  optionalText,
  requireAccess,
  requiredText,
  smallEnough,
  verifyFailed,
} from './common.js';

/** Folder types, their world collection and the permission kind of their contents. */
export const FOLDER_TYPES: Readonly<
  Record<string, { collection: string; kind: DocumentKind | null } | null>
> = {
  JournalEntry: { collection: 'journal', kind: 'Journals' },
  Actor: { collection: 'actors', kind: 'Actors' },
  Item: { collection: 'items', kind: null },
  Scene: { collection: 'scenes', kind: 'Scenes' },
  Macro: { collection: 'macros', kind: null },
  Playlist: { collection: 'playlists', kind: 'Playlists' },
  RollTable: { collection: 'tables', kind: 'RollTables' },
  Cards: { collection: 'cards', kind: null },
  Adventure: { collection: 'adventures', kind: null },
  /** Compendium folders hold packs, which live in a setting, not in a collection. */
  Compendium: null,
};

function allFolders(): FoundryJournalsFolder[] {
  return game.folders.contents as FoundryJournalsFolder[];
}

function describeFolder(folder: FoundryJournalsFolder): string {
  const parentId = folderIdOf(folder);
  const parent = parentId ? game.folders.get(parentId)?.name : null;
  return `"${folder.name}" (${folder.id}, ${folder.type}${parent ? `, in "${parent}"` : ''})`;
}

export function findFolder(identifier: string, type: string | undefined): FoundryJournalsFolder {
  if (type !== undefined && !(type in FOLDER_TYPES)) {
    throw new QueryError(
      'INVALID_ARGUMENT',
      `Unknown folder type "${type}". Known: ${Object.keys(FOLDER_TYPES).join(', ')}`
    );
  }
  const candidates = allFolders().filter(folder => type === undefined || folder.type === type);
  return findByIdOrName(candidates, identifier, 'Folder', describeFolder);
}

export const renameFolder: QueryHandler = {
  access: { kind: 'write', document: 'Folders', action: 'update' },
  run: async (data, context) => {
    requireWorld();
    const args = argsOf(data);
    const folder = findFolder(requiredText(args, 'folderName'), optionalText(args, 'type'));
    const newName = requiredText(args, 'newName').trim();
    const oldName = folder.name;

    await folder.update({ name: newName });
    const stored = game.folders.get(folder.id)?.name;
    if (stored !== newName)
      verifyFailed(`The folder ${folder.id} reads back with the name "${String(stored)}"`);

    context.recordChange({
      query: 'renameFolder',
      tool: 'folder-rename',
      document: 'Folders',
      action: 'update',
      targets: [{ id: folder.id, uuid: folder.uuid, name: newName }],
      summary: `Renamed the ${folder.type} folder "${oldName}" to "${newName}".`,
      before: { name: oldName },
    });
    return {
      success: true,
      id: folder.id,
      folderId: folder.id,
      type: folder.type,
      oldName,
      name: newName,
    };
  },
};

function contentsOf(collection: string, folderIds: ReadonlySet<string>): FoundryDocument[] {
  const documents = (game as unknown as Record<string, unknown>)[collection] as
    FoundryCollection<FoundryDocument> | undefined;
  if (!documents) return [];
  return documents.contents.filter(document => {
    const id = folderIdOf(document as { folder?: unknown });
    return id !== null && folderIds.has(id);
  });
}

export const deleteFolder: QueryHandler = {
  access: { kind: 'write', document: 'Folders', action: 'delete' },
  run: async (data, context) => {
    requireWorld();
    const args = argsOf(data);
    const folder = findFolder(requiredText(args, 'folderName'), optionalText(args, 'type'));
    const deleteContents = optionalBoolean(args, 'deleteContents') ?? false;
    const config = FOLDER_TYPES[folder.type];
    if (!config) {
      throw new QueryError(
        'NOT_SUPPORTED',
        `Folder ${describeFolder(folder)} is a ${folder.type} folder; folder-delete handles folders of ` +
          `${Object.keys(FOLDER_TYPES)
            .filter(type => FOLDER_TYPES[type])
            .join(', ')}`
      );
    }

    const folders = allFolders();
    const childrenOf = (id: string) => folders.filter(entry => folderIdOf(entry) === id);
    const parentId = folderIdOf(folder);
    const before = smallEnough(folder.toObject());

    if (!deleteContents) {
      const documents = contentsOf(config.collection, new Set([folder.id]));
      const subfolders = childrenOf(folder.id);
      if (documents.length && config.kind) requireAccess(config.kind, 'update');
      if (subfolders.length) requireAccess('Folders', 'update');

      if (documents.length) {
        await documentClass(folder.type).updateDocuments(
          documents.map(document => ({ _id: document.id, folder: parentId }))
        );
      }
      if (subfolders.length) {
        await documentClass('Folder').updateDocuments(
          subfolders.map(entry => ({ _id: entry.id, folder: parentId }))
        );
      }
      await folder.delete();

      const stillInside = [
        ...contentsOf(config.collection, new Set([folder.id])),
        ...allFolders().filter(entry => folderIdOf(entry) === folder.id),
      ];
      if (game.folders.get(folder.id))
        verifyFailed(`The folder ${folder.id} still exists after deleting it`);
      if (stillInside.length) {
        verifyFailed(
          `${stillInside.length} document(s) still point to the deleted folder ${folder.id}`
        );
      }

      context.recordChange({
        query: 'deleteFolder',
        tool: 'folder-delete',
        document: 'Folders',
        action: 'delete',
        targets: [{ id: folder.id, uuid: folder.uuid, name: folder.name }],
        summary: `Deleted the ${folder.type} folder "${folder.name}" and moved ${documents.length} documents and ${subfolders.length} folders up a level.`,
        before,
      });
      return {
        success: true,
        id: folder.id,
        name: folder.name,
        deletedFolder: folder.name,
        type: folder.type,
        deleteContents,
        moved: { documents: documents.length, folders: subfolders.length },
        deleted: { documents: 0, folders: 1 },
      };
    }

    // Collect the subtree with depths, so folders go deepest first.
    const subtree: Array<{ folder: FoundryJournalsFolder; depth: number }> = [];
    const walk = (id: string, depth: number) => {
      for (const child of childrenOf(id)) {
        subtree.push({ folder: child, depth });
        walk(child.id, depth + 1);
      }
    };
    walk(folder.id, 1);
    const ids = new Set([folder.id, ...subtree.map(entry => entry.folder.id)]);
    const documents = contentsOf(config.collection, ids);
    if (documents.length && config.kind) requireAccess(config.kind, 'delete');

    if (documents.length) {
      await documentClass(folder.type).deleteDocuments(documents.map(document => document.id));
    }
    const depths = [...new Set(subtree.map(entry => entry.depth))].sort((a, b) => b - a);
    for (const depth of depths) {
      await documentClass('Folder').deleteDocuments(
        subtree.filter(entry => entry.depth === depth).map(entry => entry.folder.id)
      );
    }
    await folder.delete();

    const survivors = [...ids].filter(id => game.folders.get(id));
    const remaining =
      contentsOf(config.collection, ids).length +
      documents.filter(document => {
        const collection = (game as unknown as Record<string, unknown>)[config.collection] as
          FoundryCollection<FoundryDocument> | undefined;
        return collection?.get(document.id);
      }).length;
    if (survivors.length || remaining) {
      verifyFailed(
        `After deleting, ${survivors.length} folder(s) and ${remaining} document(s) of the subtree still exist`
      );
    }

    context.recordChange({
      query: 'deleteFolder',
      tool: 'folder-delete',
      document: 'Folders',
      action: 'delete',
      targets: [{ id: folder.id, uuid: folder.uuid, name: folder.name }],
      summary: `Deleted the ${folder.type} folder "${folder.name}" with ${subtree.length} subfolders and ${documents.length} documents.`,
      before,
    });
    return {
      success: true,
      id: folder.id,
      name: folder.name,
      deletedFolder: folder.name,
      type: folder.type,
      deleteContents,
      moved: { documents: 0, folders: 0 },
      deleted: { documents: documents.length, folders: subtree.length + 1 },
    };
  },
};
