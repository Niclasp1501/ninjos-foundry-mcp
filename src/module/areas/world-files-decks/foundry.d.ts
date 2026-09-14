/**
 * The parts of Foundry the world-files-decks area reads, narrowed from the loose core types.
 * Global script without import or export. Game
 * members are reached through a cast to FoundryWorldFilesDecksGame instead of
 * merging into FoundryGame, so no other package can declare them differently.
 */

interface FoundryWorldFilesDecksCalendar {
  name?: string;
  timeToComponents?(time: number): Record<string, unknown>;
  format?(time: number | Record<string, unknown>, formatter?: string): string;
}

interface FoundryWorldFilesDecksTime {
  worldTime: number;
  advance(seconds: number, options?: Record<string, unknown>): Promise<unknown> | unknown;
  calendar?: FoundryWorldFilesDecksCalendar;
}

interface FoundryWorldFilesDecksSocket {
  emit(event: string, payload: unknown, ...rest: unknown[]): unknown;
  on(event: string, callback: (payload: unknown, ...rest: unknown[]) => unknown): unknown;
}

interface FoundryWorldFilesDecksSettingConfig {
  namespace?: string;
  key?: string;
  name?: string;
  hint?: string;
  scope?: string;
  config?: boolean;
  type?: unknown;
  default?: unknown;
  choices?: Record<string, string>;
  range?: { min?: number; max?: number; step?: number };
}

interface FoundryWorldFilesDecksGame {
  time?: FoundryWorldFilesDecksTime;
  paused?: boolean;
  togglePause?(pause: boolean, options?: Record<string, unknown>): unknown;
  socket?: FoundryWorldFilesDecksSocket;
  settings: {
    settings?: ReadonlyMap<string, FoundryWorldFilesDecksSettingConfig>;
    get(namespace: string, key: string): unknown;
    set(namespace: string, key: string, value: unknown): Promise<unknown>;
  };
  modules: {
    get(
      id: string
    ): ({ id: string; socket?: boolean; active?: boolean } & Record<string, unknown>) | undefined;
  };
}

interface FoundryWorldFilesDecksUser extends FoundryUser {
  role?: number;
  avatar?: string | null;
  color?: unknown;
  character?: unknown;
  viewedScene?: string | null;
  can?(permission: string): boolean;
}

interface FoundryWorldFilesDecksCard extends FoundryDocument {
  type?: string;
  suit?: string;
  value?: number | null;
  drawn?: boolean;
  origin?: unknown;
  sort?: number;
  face?: number | null;
  faces?: Array<{ name?: string; text?: string; img?: string }>;
  back?: { name?: string; text?: string; img?: string };
  /** The saved data; `name` there is the real name even while Foundry shows "Unknown". */
  _source?: unknown;
}

interface FoundryWorldFilesDecksStack extends FoundryDocument {
  type?: string;
  description?: string;
  img?: string;
  folder?: unknown;
  cards: FoundryCollection<FoundryWorldFilesDecksCard>;
  shuffle?(options?: Record<string, unknown>): Promise<unknown>;
  deal?(
    to: FoundryWorldFilesDecksStack[],
    number?: number,
    options?: Record<string, unknown>
  ): Promise<unknown>;
  draw?(
    from: FoundryWorldFilesDecksStack,
    number?: number,
    options?: Record<string, unknown>
  ): Promise<unknown>;
  pass?(
    to: FoundryWorldFilesDecksStack,
    ids: string[],
    options?: Record<string, unknown>
  ): Promise<unknown>;
  recall?(options?: Record<string, unknown>): Promise<unknown>;
  reset?(options?: Record<string, unknown>): Promise<unknown>;
}

interface FoundryWorldFilesDecksBrowse {
  target?: string;
  dirs?: unknown;
  files?: unknown;
  private?: boolean;
}

interface FoundryWorldFilesDecksFilePicker {
  browse(source: string, target: string, options?: Record<string, unknown>): Promise<unknown>;
  createDirectory(
    source: string,
    target: string,
    options?: Record<string, unknown>
  ): Promise<unknown>;
  upload(
    source: string,
    path: string,
    file: File,
    body?: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Promise<unknown>;
}
