/**
 * The part of Foundry's compendium API the compendiums area uses (Foundry 13 and 14).
 *
 * A global script without import or export; it merges with src/module/foundry.d.ts.
 * `game.packs`, `CONFIG` and `FilePicker` are deliberately not declared as
 * globals here: other packages need them too, and two declarations with
 * different types would break the type check. The code reaches them through
 * narrow casts in packs.ts and creature-index.ts instead.
 */

/** One row of a compendium index. Index rows carry `_id`, not `id`. */
interface FoundryCompendiumsIndexEntry {
  _id: string;
  name?: string;
  type?: string;
  img?: string | null;
  folder?: string | null;
  [field: string]: unknown;
}

interface FoundryCompendiumsIndex {
  readonly size: number;
  get(id: string): FoundryCompendiumsIndexEntry | undefined;
  values(): IterableIterator<FoundryCompendiumsIndexEntry>;
}

interface FoundryCompendiumsMetadata {
  id?: string;
  name: string;
  label: string;
  type: string;
  system?: string;
  packageType: string;
  packageName: string;
  private?: boolean;
  ownership?: Record<string, string>;
}

interface FoundryCompendiumsFolder {
  id: string;
  name: string;
  type?: string;
  folder?: unknown;
}

/** A document loaded from a compendium. */
interface FoundryCompendiumsDocument {
  readonly id: string;
  readonly uuid: string;
  readonly documentName: string;
  name?: string;
  type?: string;
  img?: string | null;
  /** Id of the compendium the document belongs to; absent for world documents. */
  pack?: string | null;
  toObject(): Record<string, unknown>;
}

interface FoundryCompendiumsPack {
  /** The full id, "package.name". */
  readonly collection: string;
  readonly metadata: FoundryCompendiumsMetadata;
  readonly documentName: string;
  readonly title: string;
  readonly locked: boolean;
  readonly index: FoundryCompendiumsIndex;
  readonly folders: { readonly contents: FoundryCompendiumsFolder[] };
  getIndex(options?: { fields?: string[] }): Promise<FoundryCompendiumsIndex>;
  getDocument(id: string): Promise<FoundryCompendiumsDocument | null | undefined>;
  getDocuments(query?: Record<string, unknown>): Promise<FoundryCompendiumsDocument[]>;
  configure(settings: { locked?: boolean }): Promise<unknown>;
  deleteCompendium(): Promise<unknown>;
}

/** The static side of a document class, used with `{ pack }` for compendium writes. */
interface FoundryCompendiumsDocumentClass {
  create(
    data: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Promise<FoundryCompendiumsDocument | FoundryCompendiumsDocument[] | undefined>;
  createDocuments(
    data: Record<string, unknown>[],
    options?: Record<string, unknown>
  ): Promise<FoundryCompendiumsDocument[]>;
  updateDocuments(
    updates: Record<string, unknown>[],
    options?: Record<string, unknown>
  ): Promise<unknown[]>;
  deleteDocuments(ids: string[], options?: Record<string, unknown>): Promise<unknown[]>;
}

/** A world document as export-to-compendium reads it. */
interface FoundryCompendiumsWorldDocument extends FoundryDocument {
  type?: string;
  /** The folder document, or its id in stored data. */
  folder?: unknown;
  toCompendium?(
    pack: FoundryCompendiumsPack,
    options?: Record<string, unknown>
  ): Record<string, unknown>;
}

interface FoundryCompendiumsCollectionClass {
  createCompendium(
    metadata: { label: string; type: string; name?: string },
    options?: Record<string, unknown>
  ): Promise<FoundryCompendiumsPack | undefined>;
}
