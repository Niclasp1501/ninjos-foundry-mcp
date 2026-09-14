/**
 * Reaching compendiums, their indexes, world collections and document classes.
 *
 * Only Foundry's own API, no system knowledge. `game.packs`, `CONFIG` and the
 * document class globals are read through narrow casts, see foundry.d.ts.
 */
import type { EntryRef, PackRef } from '../../../common/areas/compendiums/shapes.js';
import { QueryError } from '../../dispatcher.js';

type PackCollection = ReadonlyMap<string, FoundryCompendiumsPack>;

function packCollection(): PackCollection {
  const packs = (game as unknown as { packs?: PackCollection }).packs;
  if (!packs)
    throw new QueryError(
      'NO_PACKS',
      'Foundry has not loaded its compendiums yet; try again in a moment'
    );
  return packs;
}

export function allPacks(): FoundryCompendiumsPack[] {
  return [...packCollection().values()];
}

export function findPack(id: string): FoundryCompendiumsPack | undefined {
  return packCollection().get(id);
}

export function requirePack(id: string): FoundryCompendiumsPack {
  const pack = findPack(id);
  if (!pack)
    throw new QueryError(
      'PACK_NOT_FOUND',
      `Compendium "${id}" not found. list-compendiums shows the id of every compendium.`
    );
  return pack;
}

export function packLabel(pack: FoundryCompendiumsPack): string {
  return pack.metadata.label || pack.title || pack.collection;
}

export function packRef(pack: FoundryCompendiumsPack): PackRef {
  return { id: pack.collection, label: packLabel(pack) };
}

export async function readIndex(
  pack: FoundryCompendiumsPack,
  fields: readonly string[] = []
): Promise<FoundryCompendiumsIndexEntry[]> {
  const index = fields.length
    ? await pack.getIndex({ fields: [...fields] })
    : await pack.getIndex();
  return [...index.values()];
}

export function entryRef(entry: FoundryCompendiumsIndexEntry): EntryRef {
  return { id: entry._id, name: typeof entry.name === 'string' ? entry.name : '' };
}

/** The id behind a folder reference: a folder document, or the id in stored data. */
export function idOf(value: unknown): string | null {
  if (typeof value === 'string') return value || null;
  if (typeof value === 'object' && value !== null) {
    const id = (value as { id?: unknown }).id;
    return typeof id === 'string' && id ? id : null;
  }
  return null;
}

/** The property of `game` that holds the world documents of a type. Foundry's own names. */
const WORLD_COLLECTIONS: Readonly<Record<string, string>> = {
  Actor: 'actors',
  Cards: 'cards',
  Item: 'items',
  JournalEntry: 'journal',
  Macro: 'macros',
  Playlist: 'playlists',
  RollTable: 'tables',
  Scene: 'scenes',
};

export function worldCollection(type: string): FoundryCollection<FoundryCompendiumsWorldDocument> {
  const key = WORLD_COLLECTIONS[type];
  const collection = key ? (game as unknown as Record<string, unknown>)[key] : undefined;
  if (!collection)
    throw new QueryError('NO_COLLECTION', `The world has no collection for ${type} documents`);
  return collection as FoundryCollection<FoundryCompendiumsWorldDocument>;
}

export function documentClass(name: string): FoundryCompendiumsDocumentClass {
  const scope = globalThis as unknown as Record<string, unknown> & {
    CONFIG?: Record<string, { documentClass?: unknown } | undefined>;
  };
  const candidate = scope.CONFIG?.[name]?.documentClass ?? scope[name];
  if (!candidate || typeof (candidate as { create?: unknown }).create !== 'function')
    throw new QueryError('NO_DOCUMENT_CLASS', `Foundry offers no document class for ${name}`);
  return candidate as FoundryCompendiumsDocumentClass;
}

export function worldFolders(): Array<FoundryDocument & { type?: string; folder?: unknown }> {
  return game.folders.contents as Array<FoundryDocument & { type?: string; folder?: unknown }>;
}

/** Plain text of a stored description, for short previews. */
export function plainText(html: string, max = 0): string {
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return max > 0 && text.length > max ? `${text.slice(0, max)}...` : text;
}
