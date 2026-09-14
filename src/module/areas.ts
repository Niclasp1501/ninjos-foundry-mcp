/**
 * What one area contributes to the module.
 *
 * Every area owns one folder under src/module/areas/<id>/ and exports one
 * ModuleArea from its index.ts. main.ts installs the list from
 * areas/index.ts once, so an area adds query handlers and settings without
 * touching a file another area touches.
 */
import type { SystemAdapter, SystemAdapterRegistry } from '../common/game-systems.js';
import type { QueryDispatcher, QueryHandler } from './dispatcher.js';
import { moduleSystemAdapters } from './game-systems.js';
import type { SettingRow } from './settings.js';

export interface AreaQuery {
  /** The query name, or every spelling a server of either generation uses. */
  names: string | readonly string[];
  handler: QueryHandler;
}

export interface ModuleArea {
  /** Folder name of the area, the same on the server side. */
  id: string;
  queries?: readonly AreaQuery[];
  /** Registered together with the core settings, at init. */
  settings?: readonly SettingRow[];
  /** Game system adapters this area brings (src/common/game-systems.ts), installed at init before `init`. */
  adapters?: readonly SystemAdapter[];
  /** Runs at init after settings and queries are in place. */
  init?(): void;
  /** Runs at ready, for a Gamemaster and for players alike; check game.user yourself. */
  ready?(): void | Promise<void>;
}

/** Register the query handlers of every area. A name taken twice stops with both owners named. */
export function installAreaQueries(
  areas: readonly ModuleArea[],
  dispatcher: Pick<QueryDispatcher, 'register' | 'has'>
): void {
  const ids = new Set<string>();
  const owners = new Map<string, string>();
  for (const area of areas) {
    if (ids.has(area.id)) throw new Error(`The area "${area.id}" is listed twice`);
    ids.add(area.id);
    for (const query of area.queries ?? []) {
      const names = typeof query.names === 'string' ? [query.names] : [...query.names];
      for (const name of names) {
        const owner = owners.get(name);
        if (owner || dispatcher.has(name)) {
          throw new Error(
            `The query "${name}" of area "${area.id}" is already registered by ${owner ? `area "${owner}"` : 'the core'}`
          );
        }
        owners.set(name, area.id);
      }
      dispatcher.register(names, query.handler);
    }
  }
}

/** Register the adapters of every area. An adapter id taken by another area stops with both owners named. */
export function installAreaAdapters(
  areas: readonly ModuleArea[],
  registry: Pick<SystemAdapterRegistry, 'register'> = moduleSystemAdapters
): void {
  for (const area of areas) {
    for (const adapter of area.adapters ?? []) registry.register(adapter, area.id);
  }
}

/** Every setting row the areas contribute, in the order of the list. */
export function areaSettings(areas: readonly ModuleArea[]): SettingRow[] {
  return areas.flatMap(area => [...(area.settings ?? [])]);
}
