/**
 * Deleting entries and whole compendiums. Both need the level "create, change
 * and delete", which is off by default.
 *
 * - Only what is named explicitly is removed. Ids exactly, names exactly in
 *   their spelling, never as a part: "Wald" must not hit "Waldrand".
 * - An ambiguous name is reported with every id and deletes nothing.
 * - A selection that covers every entry needs the exact label as well, so a
 *   full list of ids cannot empty a compendium through the back door.
 * - Only world compendiums can be deleted.
 */
import { entriesNamed, selectEntries } from '../../../common/areas/compendiums/names.js';
import {
  DELETE_BATCH,
  type AmbiguousName,
  type EntryRef,
} from '../../../common/areas/compendiums/shapes.js';
import { QueryError, type QueryHandler } from '../../dispatcher.js';
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
import { checkWritable, withWritablePack } from './guard.js';
import { documentClass, entryRef, findPack, packLabel, readIndex, requirePack } from './packs.js';

function labelMismatch(given: string, pack: FoundryCompendiumsPack): QueryError {
  return new QueryError(
    'LABEL_MISMATCH',
    `confirmLabel "${given}" is not the label of "${pack.collection}", which is "${packLabel(pack)}". Nothing was deleted.`
  );
}

export const deleteCompendiumEntries: QueryHandler = {
  access: { kind: 'write', document: 'Compendiums', action: 'delete' },
  run: async (data, context) => {
    requireWorld();
    const input = asData(data);
    const pack = requirePack(requiredString(input, 'packId'));
    const ids = optionalStringList(input, 'ids') ?? [];
    const names = optionalStringList(input, 'names') ?? [];
    if (!ids.length && !names.length)
      throw invalid(
        'Nothing selected: pass ids or names. A call without a selection deliberately deletes nothing; there is no "empty this compendium".'
      );
    const dryRun = optionalBoolean(input, 'dryRun') ?? false;
    const unlockIfNeeded = optionalBoolean(input, 'unlockIfNeeded') ?? false;
    const confirmLabel = optionalString(input, 'confirmLabel');
    const label = packLabel(pack);
    if (confirmLabel !== undefined && confirmLabel !== label)
      throw labelMismatch(confirmLabel, pack);

    const entries = (await readIndex(pack)).map(entryRef);
    const byId = new Map(entries.map(entry => [entry.id, entry]));
    const selected = new Map<string, EntryRef>();
    const notFoundIds: string[] = [];
    for (const id of new Set(ids)) {
      const entry = byId.get(id);
      if (entry) selected.set(id, entry);
      else notFoundIds.push(id);
    }
    const byName = selectEntries(entries, names, { caseSensitive: true });
    for (const entry of byName.found) selected.set(entry.id, entry);
    const ambiguous: AmbiguousName[] = byName.ambiguous.map(match => ({
      name: match.requested,
      ids: match.matches.map(entry => entry.id),
    }));
    const spellingHints = byName.notFound
      .map(name => ({ name, candidates: entriesNamed(entries, name).map(entry => entry.name) }))
      .filter(hint => hint.candidates.length > 0);

    const chosen = [...selected.values()];
    const coversAll = chosen.length > 0 && chosen.length === entries.length;
    const labelMissing = coversAll && confirmLabel !== label;
    // A server of the previous generation writes "n of m entries would be
    // removed" and "Removed: n entries. m remain": `wouldDelete` and `deleted`
    // are counts, `entries` holds name and id, `notFound` is one list.
    const base = {
      pack: pack.collection,
      packId: pack.collection,
      label,
      dryRun,
      notFound: [...notFoundIds, ...byName.notFound],
      notFoundIds,
      notFoundNames: byName.notFound,
      spellingHints,
      ambiguous,
      requiresConfirmLabel: coversAll,
    };

    if (dryRun) {
      checkWritable(pack, { unlockIfNeeded });
      return {
        ...base,
        wouldDelete: chosen.length,
        deleted: 0,
        entries: chosen,
        totalInPack: entries.length,
        remainingAfter: entries.length - chosen.length,
        confirmLabelMissing: labelMissing,
      };
    }

    if (labelMissing)
      throw new QueryError(
        'CONFIRM_LABEL_REQUIRED',
        `The selection covers all ${entries.length} entries of "${label}" [${pack.collection}], which would empty the compendium. ` +
          `Pass confirmLabel with the exact label "${label}", or narrow the selection. Nothing was deleted.`
      );
    if (!chosen.length) {
      const parts = [
        notFoundIds.length ? `ids not found: ${notFoundIds.join(', ')}` : '',
        byName.notFound.length
          ? `names not found: ${byName.notFound.map(name => `"${name}"`).join(', ')}`
          : '',
        ambiguous.length
          ? `ambiguous: ${ambiguous.map(item => `"${item.name}" (ids ${item.ids.join(', ')})`).join(', ')}`
          : '',
        spellingHints.length
          ? `names are matched in their exact spelling; similar: ${spellingHints.map(hint => hint.candidates.join(', ')).join('; ')}`
          : '',
      ].filter(Boolean);
      throw new QueryError(
        'NOTHING_FOUND',
        `Nothing to delete in "${label}": ${parts.join('; ')}. Nothing was deleted.`
      );
    }

    const { value, lock } = await withWritablePack(pack, { unlockIfNeeded }, async () => {
      const cls = documentClass(pack.documentName);
      let failure: string | null = null;
      for (let start = 0; start < chosen.length; start += DELETE_BATCH) {
        const batch = chosen.slice(start, start + DELETE_BATCH);
        try {
          await cls.deleteDocuments(
            batch.map(entry => entry.id),
            { pack: pack.collection }
          );
        } catch (error) {
          failure = `deleting batch ${start / DELETE_BATCH + 1} failed: ${messageOf(error)}`;
          break;
        }
        context.progress({
          progress: Math.min(start + DELETE_BATCH, chosen.length),
          total: chosen.length,
          message: 'Deleting compendium entries',
        });
      }
      const after = new Set((await readIndex(pack)).map(entry => entry._id));
      return {
        deleted: chosen.filter(entry => !after.has(entry.id)),
        notDeleted: chosen.filter(entry => after.has(entry.id)),
        failure,
        totalInPack: after.size,
      };
    });

    if (value.deleted.length) {
      context.recordChange({
        query: 'deleteCompendiumEntries',
        document: 'Compendiums',
        action: 'delete',
        targets: value.deleted.map(entry => ({ id: entry.id, name: entry.name })),
        summary: `Deleted ${value.deleted.length} entries from "${label}".`,
      });
    }
    if (!value.deleted.length && value.failure)
      throw new QueryError(
        'DELETE_FAILED',
        `Nothing was deleted from "${label}": ${value.failure}`
      );

    return {
      ...base,
      deleted: value.deleted.length,
      entries: value.deleted,
      notDeleted: value.notDeleted,
      failure: value.failure,
      totalInPack: value.totalInPack,
      lock,
    };
  },
};

export const deleteCompendium: QueryHandler = {
  access: { kind: 'write', document: 'Compendiums', action: 'delete' },
  run: async (data, context) => {
    requireWorld();
    const input = asData(data);
    const pack = requirePack(requiredString(input, 'packId'));
    const confirmLabel = input['confirmLabel'];
    if (typeof confirmLabel !== 'string' || confirmLabel === '')
      throw invalid('confirmLabel is required and must be the exact label of the compendium');

    const { packageType, packageName } = pack.metadata;
    if (packageType !== 'world')
      throw new QueryError(
        'NOT_WORLD_PACK',
        `"${pack.collection}" belongs to the ${packageType} "${packageName}", not to this world, so it cannot be deleted here. ` +
          `It goes away when that ${packageType} is removed in Foundry's setup.`
      );
    checkWritable(pack, { unlockIfNeeded: false, unlockOffered: false });
    const label = packLabel(pack);
    if (confirmLabel !== label) throw labelMismatch(confirmLabel, pack);

    const count = pack.index.size;
    const type = pack.documentName;
    await pack.deleteCompendium();
    if (findPack(pack.collection))
      throw new QueryError(
        'NOT_VERIFIED',
        `Foundry reported no error, but "${pack.collection}" still exists`
      );

    context.recordChange({
      query: 'deleteCompendium',
      document: 'Compendiums',
      action: 'delete',
      targets: [{ id: pack.collection, name: label }],
      summary: `Deleted the world compendium "${label}" with ${count} entries.`,
    });
    return { packId: pack.collection, label, type, entries: count };
  },
};
