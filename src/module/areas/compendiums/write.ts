/**
 * Creating, saving into, sorting and locking compendiums.
 *
 * Every handler here reads its effect back before it reports success, and
 * every write goes through `withWritablePack` (release list, lock).
 */
import { MODULE_ID } from '../../../common/constants.js';
import { entriesNamed, selectEntries } from '../../../common/areas/compendiums/names.js';
import {
  COMPENDIUM_TYPES,
  EXPORT_TYPES,
  type AmbiguousName,
  type EntryRef,
} from '../../../common/areas/compendiums/shapes.js';
import { QueryError, type HandlerContext, type QueryHandler } from '../../dispatcher.js';
import { requireWorld } from '../../world-ready.js';
import {
  asData,
  invalid,
  messageOf,
  optionalBoolean,
  optionalString,
  optionalStringList,
  requiredString,
} from './args.js';
import { onReleaseList, releaseState, requireReleased, withWritablePack } from './guard.js';
import {
  documentClass,
  findPack,
  idOf,
  packLabel,
  readIndex,
  requirePack,
  worldCollection,
  worldFolders,
} from './packs.js';

const quote = (text: string) => `"${text}"`;

/** Foundry's compendium id rule: lower case letters, digits and hyphens. */
export function compendiumName(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function compendiumCollectionClass(): FoundryCompendiumsCollectionClass {
  const scope = globalThis as unknown as {
    foundry?: { documents?: { collections?: { CompendiumCollection?: unknown } } };
    CompendiumCollection?: unknown;
  };
  const candidate =
    scope.foundry?.documents?.collections?.CompendiumCollection ?? scope.CompendiumCollection;
  if (
    !candidate ||
    typeof (candidate as { createCompendium?: unknown }).createCompendium !== 'function'
  )
    throw new QueryError('NO_DOCUMENT_CLASS', 'Foundry offers no way to create a compendium here');
  return candidate as FoundryCompendiumsCollectionClass;
}

export const createCompendium: QueryHandler = {
  access: { kind: 'write', document: 'Compendiums', action: 'create' },
  run: async (data, context) => {
    requireWorld();
    const input = asData(data);
    const label = requiredString(input, 'label').trim();
    const requested = requiredString(input, 'type');
    const type = COMPENDIUM_TYPES.find(
      known => known.toLowerCase() === requested.trim().toLowerCase()
    );
    if (!type)
      throw invalid(
        `type has to be one of: ${COMPENDIUM_TYPES.join(', ')}; got ${quote(requested)}`
      );

    const name = compendiumName(label);
    if (!name)
      throw invalid(`The label ${quote(label)} contains no letter or digit to build an id from`);
    const id = `world.${name}`;
    const existing = findPack(id);
    if (existing)
      throw new QueryError(
        'PACK_EXISTS',
        `A compendium with the id "${id}" already exists ("${packLabel(existing)}", ${existing.documentName}). Choose another label.`
      );

    await compendiumCollectionClass().createCompendium({ label, type, name });
    const created = findPack(id);
    if (!created)
      throw new QueryError(
        'NOT_VERIFIED',
        `Foundry reported no error, but the compendium "${id}" is not there afterwards`
      );
    if (created.documentName !== type)
      throw new QueryError(
        'NOT_VERIFIED',
        `The compendium "${id}" was created for ${created.documentName}, not for ${type}`
      );

    const state = releaseState();
    context.recordChange({
      query: 'createCompendium',
      document: 'Compendiums',
      action: 'create',
      targets: [{ id, name: label }],
      summary: `Created the world compendium "${label}" (${type}).`,
    });
    return {
      id,
      label: packLabel(created),
      type: created.documentName,
      packageType: 'world',
      onReleaseList: onReleaseList(state, created),
      releaseListFilled: state.filled,
    };
  },
};

/** The data a world document is stored with, id kept, world folder cleared. */
function compendiumData(
  document: FoundryCompendiumsWorldDocument,
  pack: FoundryCompendiumsPack
): Record<string, unknown> {
  if (typeof document.toCompendium === 'function') {
    const data = document.toCompendium(pack, { keepId: true, clearFolder: true });
    return { ...data, _id: document.id };
  }
  const data = document.toObject();
  delete data['folder'];
  delete data['ownership'];
  return { ...data, _id: document.id };
}

interface ExportLists {
  exported: EntryRef[];
  replaced: Array<EntryRef & { rewrittenBecause?: string }>;
  skipped: Array<EntryRef & { reason: string }>;
  lost: Array<EntryRef & { reason: string }>;
}

async function saveDocuments(
  pack: FoundryCompendiumsPack,
  documents: readonly FoundryCompendiumsWorldDocument[],
  context: HandlerContext
): Promise<ExportLists> {
  const cls = documentClass(pack.documentName);
  const where = { pack: pack.collection };
  const before = new Set((await readIndex(pack)).map(entry => entry._id));
  const lists: ExportLists = { exported: [], replaced: [], skipped: [], lost: [] };
  const removed = new Set<string>();

  for (const [position, document] of documents.entries()) {
    const ref = { id: document.id, name: document.name ?? '' };
    let data: Record<string, unknown> | null = null;
    try {
      data = compendiumData(document, pack);
    } catch (error) {
      lists.skipped.push({ ...ref, reason: `could not be prepared: ${messageOf(error)}` });
    }

    if (data && !before.has(document.id)) {
      try {
        await cls.createDocuments([data], { ...where, keepId: true });
        lists.exported.push(ref);
      } catch (error) {
        lists.skipped.push({ ...ref, reason: messageOf(error) });
      }
    } else if (data) {
      try {
        await cls.updateDocuments([data], { ...where, diff: false, recursive: false });
        lists.replaced.push(ref);
      } catch (updateError) {
        // Foundry refuses to overwrite a scene with tokens whose actor is missing
        // in the compendium. Only in this case: remove the old entry and write
        // it again. Never beforehand, because removing is a risk.
        const why = messageOf(updateError);
        try {
          await cls.deleteDocuments([document.id], where);
          removed.add(document.id);
        } catch (deleteError) {
          lists.skipped.push({
            ...ref,
            reason: `overwriting failed (${why}), and the old version could not be removed (${messageOf(deleteError)}), so the old version is still there`,
          });
        }
        if (removed.has(document.id)) {
          try {
            await cls.createDocuments([data], { ...where, keepId: true });
            lists.replaced.push({ ...ref, rewrittenBecause: why });
          } catch (createError) {
            lists.lost.push({
              ...ref,
              reason: `overwriting failed (${why}), the old version was removed, and writing the new one failed: ${messageOf(createError)}`,
            });
          }
        }
      }
    }

    if ((position + 1) % 10 === 0 || position + 1 === documents.length)
      context.progress({
        progress: position + 1,
        total: documents.length,
        message: `Saved ${position + 1} of ${documents.length}`,
      });
  }

  // Read back: whatever is not in the compendium now was not saved.
  const after = new Set((await readIndex(pack)).map(entry => entry._id));
  const missing = (ref: EntryRef) => !after.has(ref.id);
  for (const ref of [...lists.exported, ...lists.replaced].filter(missing)) {
    if (removed.has(ref.id))
      lists.lost.push({
        id: ref.id,
        name: ref.name,
        reason: 'the old version was removed, and the new one is not in the compendium afterwards',
      });
    else
      lists.skipped.push({
        id: ref.id,
        name: ref.name,
        reason: 'Foundry reported no error, but it is not in the compendium afterwards',
      });
  }
  lists.exported = lists.exported.filter(ref => !missing(ref));
  lists.replaced = lists.replaced.filter(ref => !missing(ref));
  return lists;
}

export const exportToCompendium: QueryHandler = {
  access: { kind: 'write', document: 'Compendiums', action: 'update' },
  run: async (data, context) => {
    requireWorld();
    const input = asData(data);
    const pack = requirePack(requiredString(input, 'packId'));
    const documentType = requiredString(input, 'documentType');
    if (!(EXPORT_TYPES as readonly string[]).includes(documentType))
      throw invalid(
        `documentType has to be one of: ${EXPORT_TYPES.join(', ')}; got ${quote(documentType)}`
      );
    if (pack.documentName !== documentType)
      throw new QueryError(
        'WRONG_TYPE',
        `"${pack.collection}" takes ${pack.documentName}, not ${documentType}`
      );
    const names = optionalStringList(input, 'names');
    const folderName = optionalString(input, 'folderName');
    const unlockIfNeeded = optionalBoolean(input, 'unlockIfNeeded') ?? false;

    let candidates = worldCollection(documentType).contents;
    const notes: string[] = [];

    if (folderName) {
      const folders = worldFolders().filter(
        folder => folder.type === documentType && folder.name === folderName
      );
      if (!folders.length)
        throw new QueryError(
          'FOLDER_NOT_FOUND',
          `No ${documentType} folder named "${folderName}" exists in the world. Folder names are matched exactly.`
        );
      if (folders.length > 1)
        notes.push(
          `${folders.length} ${documentType} folders are named "${folderName}"; documents directly inside any of them were taken`
        );
      const ids = new Set(folders.map(folder => folder.id));
      candidates = candidates.filter(document => ids.has(idOf(document.folder) ?? ''));
      if (!candidates.length)
        throw new QueryError('NOTHING_FOUND', `No ${documentType} in the folder "${folderName}"`);
    }

    const notFound: string[] = [];
    if (names && names.length) {
      const named = candidates.map(document => ({
        id: document.id,
        name: document.name ?? '',
        document,
      }));
      const chosen = new Map<string, FoundryCompendiumsWorldDocument>();
      for (const wanted of new Set(names)) {
        const byId = named.filter(entry => entry.id === wanted);
        const matches = byId.length ? byId : entriesNamed(named, wanted);
        if (!matches.length) notFound.push(wanted);
        if (matches.length > 1)
          notes.push(
            `"${wanted}" matched ${matches.length} documents with that name; all of them were saved`
          );
        for (const match of matches) chosen.set(match.id, match.document);
      }
      candidates = [...chosen.values()];
    }

    if (!candidates.length)
      throw new QueryError(
        'NOTHING_FOUND',
        `Nothing found to save: no ${documentType} named ${notFound.map(quote).join(', ')}` +
          `${folderName ? ` in the folder "${folderName}"` : ' in the world'}. Names are matched as a whole, ignoring case, or as ids.`
      );

    const { value, lock } = await withWritablePack(pack, { unlockIfNeeded }, () =>
      saveDocuments(pack, candidates, context)
    );

    context.recordChange({
      query: 'exportToCompendium',
      document: 'Compendiums',
      action: 'update',
      targets: [...value.exported, ...value.replaced].map(ref => ({ id: ref.id, name: ref.name })),
      summary:
        `Saved ${value.exported.length + value.replaced.length} ${documentType} into "${packLabel(pack)}" ` +
        `(${value.exported.length} new, ${value.replaced.length} overwritten, ${value.skipped.length} skipped, ${value.lost.length} lost).`,
    });

    // A server of the previous generation reads `pack` and four lists under
    // the old names; its text joins them, so they hold names. The entries with
    // ids and reasons stand under the *Entries names.
    const namesOf = (refs: readonly EntryRef[]) => refs.map(ref => ref.name);
    return {
      pack: pack.collection,
      packId: pack.collection,
      label: packLabel(pack),
      documentType,
      selected: candidates.length,
      exported: namesOf(value.exported),
      replaced: namesOf(value.replaced),
      skipped: namesOf(value.skipped),
      lost: namesOf(value.lost),
      exportedEntries: value.exported,
      replacedEntries: value.replaced,
      skippedEntries: value.skipped,
      lostEntries: value.lost,
      notFound,
      notes,
      lock,
    };
  },
};

export const organizeCompendium: QueryHandler = {
  access: { kind: 'write', document: 'Compendiums', action: 'update' },
  run: async (data, context) => {
    requireWorld();
    const input = asData(data);
    const pack = requirePack(requiredString(input, 'packId'));
    const folderName = requiredString(input, 'folderName').trim();
    const entryNames = optionalStringList(input, 'entryNames');
    if (!entryNames?.length)
      throw invalid('entryNames is required and has to name at least one entry');
    const unlockIfNeeded = optionalBoolean(input, 'unlockIfNeeded') ?? false;
    const label = packLabel(pack);

    const named = (await readIndex(pack, ['folder'])).map(entry => ({
      id: entry._id,
      name: entry.name ?? '',
      folder: idOf(entry.folder),
    }));
    const selection = selectEntries(named, entryNames, { acceptIds: true });
    const ambiguous: AmbiguousName[] = selection.ambiguous.map(match => ({
      name: match.requested,
      ids: match.matches.map(entry => entry.id),
    }));
    if (!selection.found.length) {
      const parts = [
        selection.notFound.length ? `not found: ${selection.notFound.map(quote).join(', ')}` : '',
        ambiguous.length
          ? `ambiguous: ${ambiguous.map(item => `"${item.name}" (ids ${item.ids.join(', ')})`).join(', ')}`
          : '',
      ].filter(Boolean);
      throw new QueryError(
        'NOTHING_FOUND',
        `Nothing was moved in "${label}": ${parts.join('; ')}. Names are matched as a whole, ignoring case, or as ids.`
      );
    }

    const ref = (entry: { id: string; name: string }): EntryRef => ({
      id: entry.id,
      name: entry.name,
    });
    const { value, lock } = await withWritablePack(pack, { unlockIfNeeded }, async () => {
      const same = pack.folders.contents.filter(folder => folder.name === folderName);
      if (same.length > 1)
        throw new QueryError(
          'AMBIGUOUS_FOLDER',
          `"${label}" has ${same.length} folders named "${folderName}" (ids ${same.map(folder => folder.id).join(', ')}); nothing was moved`
        );
      let folder = same[0];
      let created = false;
      if (!folder) {
        await documentClass('Folder').create(
          { name: folderName, type: pack.documentName, folder: null, flags: moduleFolderFlags() },
          { pack: pack.collection }
        );
        folder = pack.folders.contents.find(candidate => candidate.name === folderName);
        if (!folder)
          throw new QueryError(
            'NOT_VERIFIED',
            `Folder "${folderName}" could not be created in "${label}"; nothing was moved`
          );
        created = true;
      }
      const target = folder.id;
      const toMove = selection.found.filter(entry => entry.folder !== target);
      const already = selection.found.filter(entry => entry.folder === target);
      if (toMove.length)
        await documentClass(pack.documentName).updateDocuments(
          toMove.map(entry => ({ _id: entry.id, folder: target })),
          { pack: pack.collection }
        );
      const after = new Map(
        (await readIndex(pack, ['folder'])).map(entry => [entry._id, idOf(entry.folder)])
      );
      return {
        folder: { id: target, name: folder.name, created },
        moved: toMove.filter(entry => after.get(entry.id) === target).map(ref),
        notMoved: toMove.filter(entry => after.get(entry.id) !== target).map(ref),
        alreadyInFolder: already.map(ref),
      };
    });

    context.recordChange({
      query: 'organizeCompendium',
      document: 'Compendiums',
      action: 'update',
      targets: value.moved.map(entry => ({ id: entry.id, name: entry.name })),
      summary: `Moved ${value.moved.length} entries of "${label}" into the folder "${value.folder.name}".`,
    });

    // A server of the previous generation reads `pack`, `folder` as the name
    // and `moved` as a list it joins, so names; the entries with ids follow
    // under `movedEntries`.
    return {
      pack: pack.collection,
      packId: pack.collection,
      label,
      folder: value.folder.name,
      folderId: value.folder.id,
      folderCreated: value.folder.created,
      moved: value.moved.map(entry => entry.name),
      movedEntries: value.moved,
      notMoved: value.notMoved,
      alreadyInFolder: value.alreadyInFolder,
      notFound: selection.notFound,
      ambiguous,
      lock,
    };
  },
};

/**
 * set-compendium-lock checks the release list, but not the lock itself:
 * changing the lock is its purpose. The previous generation refused a locked
 * compendium before unlocking it, so with an empty release list it could
 * never unlock anything.
 */
export const setCompendiumLock: QueryHandler = {
  access: { kind: 'write', document: 'Compendiums', action: 'update' },
  run: async (data, context) => {
    requireWorld();
    const input = asData(data);
    const pack = requirePack(requiredString(input, 'packId'));
    const locked = input['locked'];
    if (typeof locked !== 'boolean')
      throw invalid(
        `locked must be a boolean (true locks, false unlocks), got ${JSON.stringify(locked ?? null)}`
      );
    requireReleased(pack);

    const label = packLabel(pack);
    const before = pack.locked === true;
    if (before === locked)
      return { pack: pack.collection, packId: pack.collection, label, locked, changed: false };

    await pack.configure({ locked });
    if ((pack.locked === true) !== locked)
      throw new QueryError(
        'NOT_VERIFIED',
        `Foundry reported no error, but "${pack.collection}" is still ${before ? 'locked' : 'unlocked'}`
      );

    context.recordChange({
      query: 'setCompendiumLock',
      document: 'Compendiums',
      action: 'update',
      targets: [{ id: pack.collection, name: label }],
      summary: `${locked ? 'Locked' : 'Unlocked'} the compendium "${label}".`,
      before: { locked: before },
      after: { locked },
    });
    return { pack: pack.collection, packId: pack.collection, label, locked, changed: true };
  },
};

/**
 * The marker on every folder this package creates, in the world or in a
 * compendium. `createdByMcp` is this generation's name; `mcpGenerated` and
 * `createdAt` are what the previous generation wrote, so an evaluation over
 * both finds every folder.
 */
export function moduleFolderFlags(): Record<string, Record<string, unknown>> {
  return {
    [MODULE_ID]: { createdByMcp: true, mcpGenerated: true, createdAt: new Date().toISOString() },
  };
}
