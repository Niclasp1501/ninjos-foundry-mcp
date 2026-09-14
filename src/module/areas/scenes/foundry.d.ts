/**
 * Foundry types as the scenes area uses them. A global script: no
 * import, no export; the names carry the package id so no other package
 * declares the same name differently.
 *
 * Globals Foundry offers (canvas, Scene, Folder, foundry.utils) are not
 * declared here, because another package may need them too. The code reads
 * them from globalThis with the interfaces below.
 */

interface FoundryScenesTexture {
  src?: string | null;
  tint?: string | number | null;
  alphaThreshold?: number;
}

/** Foundry 14: the level carries the background that is actually drawn. */
interface FoundryScenesLevel extends FoundryDocument {
  sort?: number;
  background?: FoundryScenesTexture & { color?: string | number | null };
  foreground?: FoundryScenesTexture;
  elevation?: { bottom?: number | null; top?: number | null };
  textures?: Record<string, unknown>;
}

interface FoundryScenesScene extends FoundryDocument {
  name: string;
  active: boolean;
  width: number;
  height: number;
  padding?: number;
  navigation?: boolean;
  navName?: string;
  grid?: { size?: number };
  /** Before Foundry 14 the background lived here only. */
  background?: FoundryScenesTexture;
  backgroundColor?: string | null;
  /** A Folder document in Foundry, an id in stored data. */
  folder?: unknown;
  /** A JournalEntry document in Foundry, an id in stored data. */
  journal?: unknown;
  journalEntryPage?: string | null;
  thumb?: string | null;
  initialLevel?: unknown;
  /** Absent before Foundry 14. */
  levels?: FoundryCollection<FoundryScenesLevel>;
  walls?: FoundryCollection<FoundryDocument>;
  tokens?: FoundryCollection<FoundryScenesToken>;
  lights?: FoundryCollection<FoundryDocument>;
  sounds?: FoundryCollection<FoundryDocument>;
  notes?: FoundryCollection<FoundryScenesNote>;
  tiles?: FoundryCollection<FoundryDocument>;
  activate?(options?: Record<string, unknown>): Promise<unknown>;
  createThumbnail?(options?: Record<string, unknown>): Promise<{ thumb?: string | null } | null>;
}

interface FoundryScenesToken extends FoundryDocument {
  x: number;
  y: number;
  width?: number;
  height?: number;
  hidden?: boolean;
  disposition?: number;
  actorId?: string | null;
  texture?: { src?: string | null };
}

interface FoundryScenesNote extends FoundryDocument {
  x: number;
  y: number;
  text?: string | null;
  entryId?: string | null;
  pageId?: string | null;
}

interface FoundryScenesFolder extends FoundryDocument {
  name: string;
  type: string;
  /** The parent: a Folder document in Foundry, an id in stored data. */
  folder?: unknown;
}

interface FoundryScenesJournal extends FoundryDocument {
  name: string;
  pages?: FoundryCollection<FoundryScenesPage>;
}

interface FoundryScenesPage extends FoundryDocument {
  name: string;
}

interface FoundryScenesDocumentClass {
  create(
    data: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Promise<FoundryDocument | FoundryDocument[] | undefined | null>;
}

interface FoundryScenesCanvas {
  ready?: boolean;
  scene?: { id: string } | null;
  dimensions?: { width: number; height: number } | null;
  screenDimensions?: number[];
  animatePan?(view: { x: number; y: number; scale: number; duration?: number }): Promise<unknown>;
  pan?(view: { x: number; y: number; scale: number }): void;
}
