/**
 * What the handlers of the actors area share: reading the call data, the world
 * collections, document classes, type checks, dotted keys, reading back.
 */
import { MODULE_ID } from '../../../common/constants.js';
import { QueryError } from '../../dispatcher.js';
import { readSetting } from '../../settings.js';
import { describeDocuments, idOf, inputOf, isRecord, quoteList, textOf } from '../world/lookup.js';

export { describeDocuments, idOf, inputOf, isRecord, quoteList, textOf };

/** Setting key of the upper limit for actors in one request. */
export const MAX_ACTORS_SETTING = 'maxActorsPerRequest';
export const MAX_ACTORS_DEFAULT = 10;
/** create-actor-from-compendium never makes more than this, whatever the setting says. */
export const COMPENDIUM_COPY_LIMIT = 10;

export const actors = () => game.actors as unknown as FoundryCollection<FoundryActorsActor>;
export const items = () => game.items as unknown as FoundryCollection<FoundryActorsItem>;
export const scenes = () => game.scenes as unknown as FoundryCollection<FoundryActorsScene>;
export const users = () =>
  (game.users ?? { contents: [] }) as unknown as { contents: FoundryActorsUser[] } & Partial<
    FoundryCollection<FoundryActorsUser>
  >;

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function invalid(message: string): QueryError {
  return new QueryError('INVALID_ARGUMENT', message);
}

/** The limit from the setting; a damaged value counts as the default. */
export function maxActorsPerRequest(): number {
  const raw = readSetting(MAX_ACTORS_SETTING);
  return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : MAX_ACTORS_DEFAULT;
}

export function requireWithinLimit(
  count: number,
  what: string,
  limit = maxActorsPerRequest()
): void {
  if (count > limit) {
    throw new QueryError(
      'LIMIT_EXCEEDED',
      `${what}: ${count} requested, at most ${limit} per request (setting "${MAX_ACTORS_SETTING}" of ${MODULE_ID}). ` +
        'Nothing was changed. Split the request.'
    );
  }
}

/** A list of non-empty texts from the data, trimmed. */
export function textList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(textOf).filter(Boolean) : [];
}

export function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function documentClass(name: string): FoundryActorsDocumentClass {
  const found = (globalThis as Record<string, unknown>)[name] as
    FoundryActorsDocumentClass | undefined;
  if (typeof found?.create !== 'function')
    throw new QueryError('NOT_AVAILABLE', `Foundry's ${name} class is not available`);
  return found;
}

/**
 * The types Foundry accepts for a document name, from `game.documentTypes`
 * (without "base"). Null when this Foundry does not tell; Foundry then checks
 * the type itself when writing.
 */
export function validTypes(documentName: string): string[] | null {
  // game.documentTypes is declared, optional, in the core.
  const list: unknown = game.documentTypes?.[documentName];
  if (!Array.isArray(list)) return null;
  const types = list.filter((type): type is string => typeof type === 'string' && type !== 'base');
  return types.length ? types : null;
}

export function requireValidTypes(documentName: string, types: readonly string[]): void {
  const valid = validTypes(documentName);
  if (!valid) return;
  const wrong = [...new Set(types.filter(type => !valid.includes(type)))];
  if (wrong.length) {
    throw invalid(
      `Unknown ${documentName} type(s) ${quoteList(wrong)} in the game system "${game.system?.id ?? 'unknown'}". ` +
        `Valid types: ${quoteList(valid, 50)}. Nothing was changed.`
    );
  }
}

/** `{ "a.b": 1 }` becomes `{ a: { b: 1 } }`, at every depth. */
export function expandDotted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(expandDotted);
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const parts = key.startsWith('-=') ? [key] : key.split('.');
    let node = out;
    for (const part of parts.slice(0, -1)) {
      if (!isRecord(node[part])) node[part] = {};
      node = node[part] as Record<string, unknown>;
    }
    const last = parts[parts.length - 1] as string;
    const expanded = expandDotted(entry);
    if (isRecord(node[last]) && isRecord(expanded))
      node[last] = { ...(node[last] as Record<string, unknown>), ...expanded };
    else node[last] = expanded;
  }
  return out;
}

/** Every leaf of an object as a dotted path, arrays counted as leaves. */
export function leaves(value: unknown, prefix = ''): Array<[string, unknown]> {
  if (!isRecord(value) || (prefix && Object.keys(value).length === 0))
    return prefix ? [[prefix, value]] : [];
  return Object.entries(value).flatMap(([key, entry]) =>
    key.startsWith('-=') ? [] : leaves(entry, prefix ? `${prefix}.${key}` : key)
  );
}

export function valueAt(value: unknown, path: string): unknown {
  let node = value;
  for (const part of path.split('.')) node = isRecord(node) ? node[part] : undefined;
  return node;
}

export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The given leaves that do not read back as written. Foundry's data models
 * coerce or drop values they do not accept, which a success message would
 * otherwise hide.
 */
export function mismatches(
  written: Record<string, unknown>,
  readBack: Record<string, unknown>
): Array<{ path: string; written: unknown; stored: unknown }> {
  return leaves(written)
    .filter(([path, entry]) => !sameValue(entry, valueAt(readBack, path)))
    .map(([path, entry]) => ({ path, written: entry, stored: valueAt(readBack, path) ?? null }));
}

export function activeScene(): FoundryActorsScene | null {
  return scenes().find(scene => scene.active === true) ?? null;
}

export function requireActiveScene(what: string): FoundryActorsScene {
  const scene = activeScene();
  if (!scene) {
    throw new QueryError(
      'NO_ACTIVE_SCENE',
      `${what} needs an active scene, and no scene is active. Activate one (switch-scene) first. Nothing was changed.`
    );
  }
  return scene;
}

/** An address in the local data directory, never a remote one; a remote image does not load at the table. */
export function isRemoteUrl(value: unknown): boolean {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim());
}

/** Drop a remote token image, so Foundry uses its default. Returns whether it did. */
export function dropRemoteTokenImage(token: unknown): boolean {
  if (!isRecord(token) || !isRecord(token['texture'])) return false;
  const texture = token['texture'];
  if (!isRemoteUrl(texture['src'])) return false;
  delete texture['src'];
  return true;
}

/** Description by Foundry's common convention (`system.description`, text or `{ value }`). */
export function descriptionOf(data: Record<string, unknown>): string {
  const system = data['system'];
  if (isRecord(system)) {
    const description = system['description'];
    if (typeof description === 'string') return description;
    if (isRecord(description) && typeof description['value'] === 'string')
      return description['value'];
  }
  return typeof data['description'] === 'string' ? data['description'] : '';
}
