/**
 * The mcp-extras area, module part: tell the server about changes it cannot see.
 *
 * The server hears about writes of its own tools. A change made by hand in
 * Foundry, or a new release list of modules with their own tools, reaches it
 * only through this part: Foundry's hooks in the Gamemaster's browser are
 * gathered for a moment and sent as one request `mcpListsChanged`, which the
 * server of the mcp-extras area already accepts.
 *
 * - Documents: the resource prefixes of the kind that changed.
 * - The release list (`toolProviderModules`, and its old key): the
 *   registration hook runs once more, so a newly released module can register,
 *   and the server compares its tool list.
 *
 * A server without requests (older) or no bridge in this browser is not an
 * error: the server compares everything again when a module connects. Any
 * other failure is written to the console, never shown as a notification,
 * because nobody at the table can act on it.
 */
import { MODULE_ID } from '../../../common/constants.js';
import { extensionTools, requestServer, serverRequestsAvailable } from '../../core-services.js';
import { LEGACY_PROVIDERS_SETTING, TOOL_PROVIDERS_SETTING } from '../../extension-tools.js';
import { ServerRequestError } from '../../server-requests.js';

const SCENES = 'foundry://scene/';
const JOURNALS = 'foundry://journal/';
const ACTORS = 'foundry://actor/';
const COMBATS = 'foundry://combat/';
const WORLD = 'foundry://world/';
const COMPENDIUMS = 'foundry://compendium';

/** The resource prefixes a change of a Foundry document may have touched. */
export const PREFIXES_OF: Readonly<Record<string, readonly string[]>> = {
  Scene: [SCENES, WORLD],
  Token: [SCENES, ACTORS, COMBATS],
  JournalEntry: [JOURNALS, WORLD],
  JournalEntryPage: [JOURNALS],
  Actor: [ACTORS, COMBATS, WORLD],
  Item: [ACTORS],
  ActiveEffect: [ACTORS],
  Combat: [COMBATS, WORLD],
  Combatant: [COMBATS],
  Folder: [WORLD],
  User: [WORLD],
};

export const WATCHED_SETTINGS: readonly string[] = [
  `${MODULE_ID}.${TOOL_PROVIDERS_SETTING}`,
  `${MODULE_ID}.${LEGACY_PROVIDERS_SETTING}`,
];

/** How long changes are gathered before one request goes out. */
export const GATHER_MS = 400;

export interface ListChange {
  tools?: boolean;
  resources?: readonly string[];
}

export interface ListsChangedOptions {
  send?: (change: { tools?: true; resources?: string[] }) => Promise<unknown>;
  available?: () => boolean;
  gatherMs?: number;
  warn?: (message: string, error: unknown) => void;
}

/** Gathers changes and sends them as one request. */
export class ListsChangedReporter {
  readonly #options: Required<ListsChangedOptions>;
  #tools = false;
  readonly #prefixes = new Set<string>();
  #timer: ReturnType<typeof setTimeout> | null = null;
  #sending: Promise<void> = Promise.resolve();

  constructor(options: ListsChangedOptions = {}) {
    this.#options = {
      send: options.send ?? (change => requestServer('mcpListsChanged', change)),
      available: options.available ?? serverRequestsAvailable,
      gatherMs: options.gatherMs ?? GATHER_MS,
      warn: options.warn ?? ((message, error) => console.warn(message, error)),
    };
  }

  note(change: ListChange): void {
    if (change.tools) this.#tools = true;
    for (const prefix of change.resources ?? []) this.#prefixes.add(prefix);
    if (!this.#tools && this.#prefixes.size === 0) return;
    if (this.#timer) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#sending = this.#sending.then(() => this.#flush());
    }, this.#options.gatherMs);
  }

  /** Resolves when nothing is gathered or being sent any more. For tests. */
  async settled(): Promise<void> {
    while (this.#timer) await new Promise(resolve => setTimeout(resolve, 5));
    await this.#sending;
  }

  /** Forget what is gathered, for tests and when the module stops. */
  reset(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.#tools = false;
    this.#prefixes.clear();
  }

  async #flush(): Promise<void> {
    const change = {
      ...(this.#tools ? { tools: true as const } : {}),
      ...(this.#prefixes.size ? { resources: [...this.#prefixes] } : {}),
    };
    this.#tools = false;
    this.#prefixes.clear();
    if (!change.tools && !change.resources) return;
    if (!this.#options.available()) return;
    try {
      await this.#options.send(change);
    } catch (error) {
      if (
        error instanceof ServerRequestError &&
        (error.code === 'SERVER_TOO_OLD' || error.code === 'NOT_CONNECTED')
      )
        return;
      this.#options.warn(
        `${MODULE_ID} | Could not tell the server about a change in Foundry`,
        error
      );
    }
  }
}

export const listsChanged = new ListsChangedReporter();

interface Hooked {
  name: string;
  id: number;
}

let hooked: Hooked[] = [];

/** The key of a setting document or of the data a hook passes. */
function settingKey(setting: unknown): string {
  if (typeof setting !== 'object' || setting === null) return '';
  const key = (setting as { key?: unknown }).key;
  return typeof key === 'string' ? key : '';
}

/**
 * Listen in the Gamemaster's browser. Only there a bridge runs; a player's
 * browser would have nobody to tell.
 */
export function watchForListChanges(reporter: ListsChangedReporter = listsChanged): void {
  if (game.user?.isGM !== true || hooked.length) return;
  const on = (name: string, callback: (...args: unknown[]) => void) =>
    hooked.push({ name, id: Hooks.on(name, callback) });

  for (const [documentName, prefixes] of Object.entries(PREFIXES_OF)) {
    for (const verb of ['create', 'update', 'delete']) {
      on(`${verb}${documentName}`, () => reporter.note({ resources: prefixes }));
    }
  }
  for (const verb of ['create', 'update']) {
    on(`${verb}Setting`, setting => {
      if (!WATCHED_SETTINGS.includes(settingKey(setting))) return;
      // A module released just now registers its tools only when the hook runs again.
      extensionTools.collect({ clear: false });
      reporter.note({ tools: true, resources: [WORLD] });
    });
  }
  on('updateCompendium', () => reporter.note({ resources: [COMPENDIUMS] }));
}

/** Stop listening. For tests. */
export function stopWatchingListChanges(): void {
  for (const entry of hooked) Hooks.off(entry.name, entry.id);
  hooked = [];
}
