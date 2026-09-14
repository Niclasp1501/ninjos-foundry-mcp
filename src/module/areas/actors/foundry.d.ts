/**
 * The Foundry documents the actors area reads and writes, narrowed from the loose
 * core types. Global script without import or export.
 *
 * Reference fields (`folder`, `character`) are `unknown`: depending on the
 * Foundry version and on source or prepared data they hold the id or the
 * document. They are read through `idOf`.
 */

interface FoundryActorsItem extends FoundryDocument {
  name: string;
  type: string;
  img?: string | null;
  folder?: unknown;
  system?: unknown;
}

interface FoundryActorsEffect extends FoundryDocument {
  name?: string;
  label?: string;
  description?: string;
  disabled?: boolean;
  img?: string | null;
  icon?: string | null;
  duration?: unknown;
  statuses?: unknown;
}

interface FoundryActorsActor extends FoundryDocument {
  name: string;
  type: string;
  img?: string | null;
  folder?: unknown;
  ownership?: Record<string, unknown>;
  prototypeToken?: unknown;
  items: FoundryCollection<FoundryActorsItem>;
  effects: FoundryCollection<FoundryActorsEffect>;
  getTokenDocument?: (data?: Record<string, unknown>) => Promise<unknown>;
}

interface FoundryActorsToken extends FoundryDocument {
  name?: string;
  actorId?: string | null;
  actorLink?: boolean;
  disposition?: number;
  hidden?: boolean;
  x?: number;
  y?: number;
  actor?: FoundryActorsActor | null;
}

interface FoundryActorsScene extends FoundryDocument {
  name: string;
  active?: boolean;
  width?: number;
  height?: number;
  padding?: number;
  grid?: unknown;
  dimensions?: unknown;
  tokens: FoundryCollection<FoundryActorsToken>;
}

interface FoundryActorsFolder extends FoundryDocument {
  name: string;
  type?: string;
  folder?: unknown;
}

interface FoundryActorsUser extends FoundryUser {
  character?: unknown;
  targets?: unknown;
  updateTokenTargets?: (ids: string[]) => unknown;
}

interface FoundryActorsDocumentClass {
  create(data: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
  createDocuments?(
    data: Record<string, unknown>[],
    options?: Record<string, unknown>
  ): Promise<unknown[]>;
  deleteDocuments?(ids: string[], options?: Record<string, unknown>): Promise<unknown[]>;
}

interface FoundryActorsLoadedEntry {
  id?: string;
  uuid?: string;
  name?: string;
  type?: string;
  documentName?: string;
  toObject(): Record<string, unknown>;
}
