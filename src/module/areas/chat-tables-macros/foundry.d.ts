/**
 * The Foundry documents the chat-tables-macros area reads and writes, narrowed from the loose
 * core types. Global script without import or export.
 *
 * Reference fields (`author`, `whisper`, `folder`, `actorId`) are `unknown`:
 * depending on the Foundry version and on source or prepared data they hold
 * the id or the document. The area reads them through `idOf`.
 */

interface FoundryChatTablesMessage extends FoundryDocument {
  author?: unknown;
  /** Before Foundry 12 the author was `user`. */
  user?: unknown;
  speaker?: unknown;
  whisper?: unknown;
  blind?: unknown;
  style?: unknown;
  timestamp?: unknown;
  content?: unknown;
  flavor?: unknown;
  rolls?: unknown;
  flags?: unknown;
}

interface FoundryChatTablesDraw {
  roll?: unknown;
  results?: FoundryChatTablesResult[];
}

interface FoundryChatTablesTable extends FoundryDocument {
  name: string;
  formula?: unknown;
  replacement?: unknown;
  displayRoll?: unknown;
  description?: unknown;
  folder?: unknown;
  results: FoundryCollection<FoundryChatTablesResult>;
  roll?: (options?: Record<string, unknown>) => Promise<FoundryChatTablesDraw>;
  draw?: (options?: Record<string, unknown>) => Promise<FoundryChatTablesDraw>;
  /** The entries that are not drawn and whose range holds `value`. */
  getResultsForRoll?: (value: number) => FoundryChatTablesResult[];
  toMessage?: (
    results: FoundryChatTablesResult[],
    options?: Record<string, unknown>
  ) => Promise<unknown>;
  resetResults?: () => Promise<unknown>;
}

interface FoundryChatTablesResult extends FoundryDocument {
  type?: unknown;
  range?: unknown;
  weight?: unknown;
  drawn?: unknown;
  description?: unknown;
  text?: unknown;
  img?: unknown;
  documentUuid?: unknown;
  sort?: unknown;
}

interface FoundryChatTablesMacro extends FoundryDocument {
  name: string;
  type?: unknown;
  command?: unknown;
  author?: unknown;
  folder?: unknown;
  img?: unknown;
}

interface FoundryChatTablesScene extends FoundryDocument {
  name: string;
  tokens?: FoundryCollection<FoundryChatTablesToken>;
}

interface FoundryChatTablesToken extends FoundryDocument {
  actorId?: unknown;
}
