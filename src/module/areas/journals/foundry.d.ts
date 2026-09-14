/**
 * The Foundry documents the journals area works with, narrowed from the loose core
 * declarations. A global script: no import, no export.
 *
 * Nothing here is added to the core interfaces. `game.packs`, the document
 * classes and `foundry.utils` are reached through casts to these interfaces,
 * so no other package can collide with a declaration made here.
 */

interface FoundryJournalsPage extends FoundryDocument {
  name: string;
  type: string;
  sort?: number;
  src?: string | null;
  text?: { content?: string | null; format?: number };
}

interface FoundryJournalsEntry extends FoundryDocument {
  name: string;
  /** A Folder document in Foundry, a folder id in older data and in the test fake. */
  folder?: unknown;
  pages: FoundryCollection<FoundryJournalsPage>;
}

interface FoundryJournalsFolder extends FoundryDocument {
  name: string;
  type: string;
  folder?: unknown;
}

interface FoundryJournalsIndexEntry {
  _id: string;
  name?: string;
}

interface FoundryJournalsPack {
  collection: string;
  documentName: string;
  getIndex(options?: { fields?: string[] }): Promise<Iterable<FoundryJournalsIndexEntry>>;
}

interface FoundryJournalsPacks {
  get(id: string): FoundryJournalsPack | undefined;
}

interface FoundryJournalsDocumentClass {
  create(data: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
  updateDocuments(
    updates: Record<string, unknown>[],
    options?: Record<string, unknown>
  ): Promise<unknown[]>;
  deleteDocuments(ids: string[], options?: Record<string, unknown>): Promise<unknown[]>;
}
