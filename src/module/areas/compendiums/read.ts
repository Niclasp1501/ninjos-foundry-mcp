/**
 * Reading compendiums: the list, the packs, the entries of one pack, its raw index.
 *
 * Reading is never held back by the permission level, the release list or a
 * lock. Only the index is read, never full documents: a compendium with close
 * to 2000 journals would otherwise tear the bridge.
 */
import { byName, foldName } from '../../../common/areas/compendiums/names.js';
import { ENTRY_LIMIT, type PackSummary } from '../../../common/areas/compendiums/shapes.js';
import type { QueryHandler } from '../../dispatcher.js';
import { requireWorld } from '../../world-ready.js';
import {
  asData,
  integerInRange,
  optionalString,
  optionalStringList,
  requiredString,
} from './args.js';
import { packWriteState, releaseState, writeAccessSummary, type ReleaseState } from './guard.js';
import { allPacks, idOf, packLabel, readIndex, requirePack } from './packs.js';

export function packSummary(pack: FoundryCompendiumsPack, state: ReleaseState): PackSummary {
  const write = packWriteState(pack, state);
  return {
    id: pack.collection,
    label: packLabel(pack),
    type: pack.documentName,
    locked: pack.locked === true,
    packageType: pack.metadata.packageType,
    packageName: pack.metadata.packageName,
    system: pack.metadata.system ?? null,
    count: pack.index.size,
    writable: write.writable,
    notWritableReason: write.reason,
    onReleaseList: write.onList,
  };
}

export const listCompendiums: QueryHandler = {
  access: { kind: 'read' },
  run: () => {
    requireWorld();
    const state = releaseState();
    const packs = allPacks()
      .map(pack => packSummary(pack, state))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
    // Under `compendiums` with `entries` as the count: a server of the previous
    // generation reads exactly that. `writable` covers every layer, so such a
    // server never shows a compendium as editable that refuses the write.
    const compendiums = packs.map(pack => ({ ...pack, entries: pack.count }));
    return { compendiums, total: packs.length, writeAccess: writeAccessSummary(state) };
  },
};

function isPrivate(pack: FoundryCompendiumsPack): boolean {
  if (pack.metadata.private === true) return true;
  return pack.metadata.ownership?.['PLAYER'] === 'NONE';
}

/**
 * A bare list, as a server of either generation reads it. The server filters
 * by type and collects the available types itself; a given `type` is still
 * honoured here for callers that send one.
 */
export const getAvailablePacks: QueryHandler = {
  access: { kind: 'read' },
  run: data => {
    requireWorld();
    const type = optionalString(asData(data), 'type')?.trim();
    const packs = allPacks();
    const chosen = type
      ? packs.filter(pack => pack.documentName.toLowerCase() === type.toLowerCase())
      : packs;
    return chosen.map(pack => ({
      id: pack.collection,
      label: packLabel(pack),
      type: pack.documentName,
      system: pack.metadata.system ?? null,
      private: isPrivate(pack),
    }));
  },
};

export const listCompendiumEntries: QueryHandler = {
  access: { kind: 'read' },
  run: async data => {
    requireWorld();
    const input = asData(data);
    const pack = requirePack(requiredString(input, 'packId'));
    const namePattern = optionalString(input, 'namePattern')?.trim() || undefined;
    const folderName = optionalString(input, 'folderName')?.trim() || undefined;
    const limit = integerInRange(input, 'limit', {
      min: 1,
      max: ENTRY_LIMIT.max,
      fallback: ENTRY_LIMIT.fallback,
    });
    const offset = integerInRange(input, 'offset', {
      min: 0,
      max: Number.MAX_SAFE_INTEGER,
      fallback: 0,
    });

    const folders = pack.folders?.contents ?? [];
    const folderNames = new Map(folders.map(folder => [folder.id, folder.name]));
    let entries = await readIndex(pack, ['folder']);
    const totalInPack = entries.length;

    let folderFound: boolean | null = null;
    if (folderName) {
      const ids = new Set(
        folders
          .filter(folder => foldName(folder.name) === foldName(folderName))
          .map(folder => folder.id)
      );
      folderFound = ids.size > 0;
      entries = entries.filter(entry => ids.has(idOf(entry.folder) ?? ''));
    }
    if (namePattern) {
      const pattern = foldName(namePattern);
      entries = entries.filter(entry => foldName(entry.name ?? '').includes(pattern));
    }

    const rows = entries
      .map(entry => ({
        id: entry._id,
        name: entry.name ?? '',
        type: entry.type ?? pack.documentName,
        folder: folderNames.get(idOf(entry.folder) ?? '') ?? null,
      }))
      .sort(byName);
    const page = rows.slice(offset, offset + limit);
    const hasMore = offset + page.length < rows.length;

    return {
      packId: pack.collection,
      label: packLabel(pack),
      type: pack.documentName,
      // The name a server of the previous generation reads.
      documentType: pack.documentName,
      packageType: pack.metadata.packageType,
      locked: pack.locked === true,
      totalInPack,
      total: rows.length,
      returned: page.length,
      offset,
      hasMore,
      nextOffset: hasMore ? offset + page.length : null,
      namePattern: namePattern ?? null,
      folderName: folderName ?? null,
      folderFound,
      folders: folderFound === false ? folders.map(folder => folder.name).sort() : null,
      entries: page,
    };
  },
};

/**
 * getPackIndex: the raw index of one pack. No tool of this server uses it any
 * more; it keeps answering because it costs nothing, only reads, and a server
 * of the previous generation or a system package may still ask for it.
 */
export const getPackIndex: QueryHandler = {
  access: { kind: 'read' },
  run: async data => {
    requireWorld();
    const input = asData(data);
    const pack = requirePack(requiredString(input, 'packId'));
    const fields = optionalStringList(input, 'fields') ?? [];
    const entries = await readIndex(pack, fields);
    return {
      packId: pack.collection,
      label: packLabel(pack),
      type: pack.documentName,
      total: entries.length,
      entries: entries.map(entry => ({ ...entry })),
    };
  },
};
