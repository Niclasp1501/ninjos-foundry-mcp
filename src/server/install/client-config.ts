/**
 * Adding, updating and removing our entry in an MCP client configuration.
 *
 * Pure functions over parsed JSON, so every rule is testable without a file.
 * The rules:
 *
 * - Other servers and other settings are never lost.
 * - An entry of ours keeps its key, its `env` and every other field; only
 *   `command` and `args` move to the new server. The previous installers
 *   replaced the whole entry and dropped variables users had added by hand.
 * - There is never a second entry for the same server. An entry under another
 *   key that starts the previous installation is taken over instead of adding
 *   `foundry-mcp` next to it, and duplicates of ours are folded into one.
 */
import { SERVER_KEY } from './layout.js';

export class ConfigShapeError extends Error {}

export type JsonObject = Record<string, unknown>;

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface DesiredEntry {
  command: string;
  args: string[];
}

export interface EntryMatcher {
  /** The entry starts this server (an old or the current installation). */
  owns(key: string, entry: unknown): boolean;
  /** Not ours, but looks like another way to run this server. */
  resembles(key: string, entry: unknown): boolean;
}

export type EntryChangeKind = 'added' | 'updated' | 'unchanged' | 'removed';

export interface EntryChange {
  key: string;
  kind: EntryChangeKind;
}

export interface ConfigEdit {
  value: JsonObject;
  changed: boolean;
  changes: EntryChange[];
  /** Keys of entries that resemble this server but were left alone. */
  lookAlikes: string[];
  /** An entry was wanted but not added, because a look-alike exists. */
  addSkipped: boolean;
}

/** Lower case with forward slashes, for comparing paths from any platform. */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase();
}

/** Every path-like string an entry starts: its command and its arguments. */
export function entryStrings(entry: unknown): string[] {
  if (!isJsonObject(entry)) return [];
  const out: string[] = [];
  if (typeof entry['command'] === 'string') out.push(entry['command']);
  if (Array.isArray(entry['args'])) {
    for (const arg of entry['args']) if (typeof arg === 'string') out.push(arg);
  }
  return out;
}

/** Entry files the previous installers wrote into configurations. */
export const LEGACY_ENTRY_SUFFIXES = [
  '/foundry-mcp-server/packages/mcp-server/dist/index.cjs',
  '/foundrymcpserver.app/contents/resources/foundry-mcp-server/index.cjs',
];

/** The wrapper of this generation inside any installation folder. */
export const CURRENT_ENTRY_SUFFIX = '/foundrymcpserver/app/build/server/wrapper.js';

const LOOK_ALIKE_SUFFIXES = ['/packages/mcp-server/dist/index.js'];
const LOOK_ALIKE_NAMES = ['ninjos-foundry-mcp', 'foundry-vtt-mcp'];

export interface MatcherOptions {
  /** Wrapper paths of installations known on this machine. */
  wrappers: string[];
  /** Treat the key `foundry-mcp` as ours whatever it starts. */
  claimKey: boolean;
}

export function serverMatcher(options: MatcherOptions): EntryMatcher {
  const wrappers = new Set(options.wrappers.map(normalizePath));
  const pointsHere = (entry: unknown) =>
    entryStrings(entry)
      .map(normalizePath)
      .some(
        path =>
          wrappers.has(path) ||
          path.endsWith(CURRENT_ENTRY_SUFFIX) ||
          LEGACY_ENTRY_SUFFIXES.some(suffix => path.endsWith(suffix))
      );
  return {
    owns: (key, entry) => (options.claimKey && key === SERVER_KEY) || pointsHere(entry),
    resembles: (key, entry) =>
      LOOK_ALIKE_NAMES.includes(key.toLowerCase()) ||
      entryStrings(entry)
        .map(normalizePath)
        .some(
          path =>
            LOOK_ALIKE_SUFFIXES.some(suffix => path.endsWith(suffix)) ||
            LOOK_ALIKE_NAMES.some(name => path.includes(name))
        ),
  };
}

function serversOf(value: unknown): { root: JsonObject; servers: JsonObject | undefined } {
  if (!isJsonObject(value)) throw new ConfigShapeError('the file does not hold a JSON object');
  const root = structuredClone(value);
  const servers = root['mcpServers'];
  if (servers !== undefined && !isJsonObject(servers)) {
    throw new ConfigShapeError('"mcpServers" is not an object');
  }
  return { root, servers };
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Point this server's entry at `desired`, adding one when `add` is set and the
 * file names none. Throws ConfigShapeError when the file has a shape that
 * cannot be edited without guessing.
 */
export function mergeServerEntry(
  value: unknown,
  desired: DesiredEntry,
  matcher: EntryMatcher,
  options: { add: boolean }
): ConfigEdit {
  const { root, servers } = serversOf(value);
  const entries = servers ?? {};
  const keys = Object.keys(entries);
  const owned = keys.filter(key => matcher.owns(key, entries[key]));
  const lookAlikes = keys.filter(
    key => !owned.includes(key) && matcher.resembles(key, entries[key])
  );
  const changes: EntryChange[] = [];
  let addSkipped = false;

  if (owned.length === 0) {
    if (options.add && lookAlikes.length > 0) {
      addSkipped = true;
    } else if (options.add) {
      entries[SERVER_KEY] = { command: desired.command, args: [...desired.args], env: {} };
      root['mcpServers'] = entries;
      changes.push({ key: SERVER_KEY, kind: 'added' });
    }
  } else {
    const keep = owned.includes(SERVER_KEY) ? SERVER_KEY : (owned[0] as string);
    const kept = entries[keep];
    const before = isJsonObject(kept) ? kept : {};
    let env: JsonObject | undefined = isJsonObject(before['env'])
      ? { ...before['env'] }
      : undefined;

    for (const key of owned) {
      if (key === keep) continue;
      const other = entries[key];
      if (isJsonObject(other) && isJsonObject(other['env'])) {
        env ??= {};
        for (const [name, setting] of Object.entries(other['env'])) {
          if (!(name in env)) env[name] = setting;
        }
      }
      delete entries[key];
      changes.push({ key, kind: 'removed' });
    }

    const next: JsonObject = { ...before, command: desired.command, args: [...desired.args] };
    if (env !== undefined) next['env'] = env;
    entries[keep] = next;
    changes.unshift({ key: keep, kind: same(kept, next) ? 'unchanged' : 'updated' });
  }

  return { value: root, changed: !same(root, value), changes, lookAlikes, addSkipped };
}

/** Remove every entry of ours. Everything else, including an empty `mcpServers`, stays. */
export function removeServerEntries(value: unknown, matcher: EntryMatcher): ConfigEdit {
  const { root, servers } = serversOf(value);
  const changes: EntryChange[] = [];
  const lookAlikes: string[] = [];
  if (servers) {
    for (const key of Object.keys(servers)) {
      if (matcher.owns(key, servers[key])) {
        delete servers[key];
        changes.push({ key, kind: 'removed' });
      } else if (matcher.resembles(key, servers[key])) {
        lookAlikes.push(key);
      }
    }
  }
  return { value: root, changed: changes.length > 0, changes, lookAlikes, addSkipped: false };
}

/** Keys of our entries and of look-alikes, without changing anything. */
export function describeEntries(
  value: unknown,
  matcher: EntryMatcher
): { owned: Array<{ key: string; paths: string[] }>; lookAlikes: string[] } {
  const { servers } = serversOf(value);
  const owned: Array<{ key: string; paths: string[] }> = [];
  const lookAlikes: string[] = [];
  for (const [key, entry] of Object.entries(servers ?? {})) {
    if (matcher.owns(key, entry)) owned.push({ key, paths: entryStrings(entry) });
    else if (matcher.resembles(key, entry)) lookAlikes.push(key);
  }
  return { owned, lookAlikes };
}
