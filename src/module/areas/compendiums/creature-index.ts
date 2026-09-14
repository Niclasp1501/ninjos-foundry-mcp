/**
 * The creature index: one row per creature of every actor compendium.
 *
 * Loading actor compendiums in full is slow, so the rows are kept, in memory
 * and as a JSON file in the world folder. Decisions against the previous
 * generation:
 *
 * - **Never deleted to invalidate.** It used to be discarded by removing the
 *   file with an HTTP delete, which Foundry may not allow at all. Here a
 *   change only marks the index as stale, and the file is overwritten by the
 *   next build.
 * - **A fingerprint decides validity**: format, adapter and its version, system,
 *   and for every actor compendium its id, label and entry count. With
 *   `autoRebuildIndex` on, the system version and the newest modification time
 *   of each compendium count too, so changed values after a module update are
 *   noticed without a hook.
 * - A failing file never blocks the search: the rows in memory are used and the
 *   problem is reported in the answer.
 */
import type { ProgressPayload } from '../../../common/protocol.js';
import { localize } from '../../notify.js';
import { readSetting } from '../../settings.js';
import {
  activeCompendiumAdapter,
  noAdapterText,
  type CompendiumAdapter,
  type CreatureRow,
} from './adapter.js';
import { messageOf } from './args.js';
import { allPacks, packLabel, readIndex } from './packs.js';

export const INDEX_SETTING = 'enableEnhancedCreatureIndex';
export const AUTO_REBUILD_SETTING = 'autoRebuildIndex';
export const INDEX_FILE = 'ninjos-foundry-mcp-creature-index.json';
/** Version of the file layout itself; the adapter versions its rows separately. */
export const INDEX_FORMAT = 1;
const FAILURES_KEPT = 20;

export interface PackStamp {
  id: string;
  label: string;
  count: number;
  modified: number | null;
}

export interface CreatureIndexData {
  format: number;
  adapterId: string;
  adapterVersion: number;
  systemId: string;
  systemVersion: string;
  builtAt: string;
  packs: PackStamp[];
  rows: CreatureRow[];
  failed: number;
  failures: Array<{ packId: string; id: string; name: string; reason: string }>;
}

export interface CreatureIndexStore {
  /** Where the index lives, for messages. */
  readonly where: string;
  /** The stored data, or null when there is none. */
  load(): Promise<unknown>;
  save(data: CreatureIndexData): Promise<void>;
}

export interface IndexAnswer {
  data: CreatureIndexData;
  rebuilt: boolean;
  /** Why reading or writing the stored file failed, or null. */
  storeProblem: string | null;
}

type Progress = (progress: ProgressPayload) => void;

export function indexEnabled(): boolean {
  return readSetting(INDEX_SETTING) !== false;
}

export function autoRebuildEnabled(): boolean {
  return readSetting(AUTO_REBUILD_SETTING) !== false;
}

function actorPacks(): FoundryCompendiumsPack[] {
  return allPacks().filter(pack => pack.documentName === 'Actor');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function modifiedOf(entry: FoundryCompendiumsIndexEntry): number | null {
  const stats = entry['_stats'];
  const time = isRecord(stats) ? stats['modifiedTime'] : undefined;
  return typeof time === 'number' ? time : null;
}

function looksLikeIndex(value: unknown): value is CreatureIndexData {
  return (
    isRecord(value) &&
    typeof value['format'] === 'number' &&
    typeof value['adapterId'] === 'string' &&
    Array.isArray(value['packs']) &&
    Array.isArray(value['rows'])
  );
}

/** The file in the world folder, read over HTTP and written with Foundry's file upload. */
export function worldFileStore(): CreatureIndexStore {
  const worldId = game.world?.id;
  if (!worldId) throw new Error('No world is loaded, so the creature index has no place to live');
  const folder = `worlds/${worldId}`;
  const scope = globalThis as unknown as {
    foundry?: {
      utils?: { getRoute?: (path: string) => string };
      applications?: { apps?: { FilePicker?: { implementation?: unknown } } };
    };
    FilePicker?: unknown;
  };
  const route = (path: string) => scope.foundry?.utils?.getRoute?.(path) ?? path;

  return {
    where: `${folder}/${INDEX_FILE}`,
    load: async () => {
      const response = await fetch(`${route(`${folder}/${INDEX_FILE}`)}?t=${Date.now()}`, {
        cache: 'no-store',
      });
      if (response.status === 404) return null;
      if (!response.ok)
        throw new Error(`reading ${folder}/${INDEX_FILE} answered HTTP ${response.status}`);
      return (await response.json()) as unknown;
    },
    save: async data => {
      const picker = (scope.foundry?.applications?.apps?.FilePicker?.implementation ??
        scope.FilePicker) as
        | {
            upload(
              source: string,
              path: string,
              file: File,
              body?: Record<string, unknown>,
              options?: Record<string, unknown>
            ): Promise<unknown>;
          }
        | undefined;
      if (!picker) throw new Error('Foundry offers no file upload');
      const file = new File([JSON.stringify(data)], INDEX_FILE, { type: 'application/json' });
      const answer = await picker.upload('data', folder, file, {}, { notify: false });
      if (!answer || (isRecord(answer) && answer['status'] === 'error'))
        throw new Error(
          `Foundry did not store ${folder}/${INDEX_FILE}${isRecord(answer) && typeof answer['message'] === 'string' ? `: ${answer['message']}` : ''}`
        );
    },
  };
}

export class CreatureIndex {
  #cache: CreatureIndexData | null = null;
  #stale = false;
  #store: CreatureIndexStore | null = null;
  #building: Promise<IndexAnswer> | null = null;

  constructor(private readonly createStore: () => CreatureIndexStore) {}

  /** Replace the store, for tests. `null` goes back to the world file. */
  useStore(store: CreatureIndexStore | null): void {
    this.#store = store;
    this.#cache = null;
    this.#stale = false;
    this.#building = null;
  }

  /** Mark the index stale. The next access rebuilds it. */
  invalidate(): void {
    this.#stale = true;
  }

  get stale(): boolean {
    return this.#stale;
  }

  #storeNow(): CreatureIndexStore {
    this.#store ??= this.createStore();
    return this.#store;
  }

  async stamps(withModified: boolean): Promise<PackStamp[]> {
    const stamps: PackStamp[] = [];
    for (const pack of actorPacks()) {
      let modified: number | null = null;
      let count = pack.index.size;
      if (withModified) {
        const entries = await readIndex(pack, ['_stats.modifiedTime']);
        count = entries.length;
        for (const entry of entries) {
          const time = modifiedOf(entry);
          if (time !== null && (modified === null || time > modified)) modified = time;
        }
      }
      stamps.push({ id: pack.collection, label: packLabel(pack), count, modified });
    }
    return stamps.sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Whether stored rows still describe the compendiums as they are. */
  matches(
    data: CreatureIndexData,
    adapter: CompendiumAdapter,
    stamps: readonly PackStamp[],
    strict: boolean
  ): boolean {
    if (data.format !== INDEX_FORMAT) return false;
    if (data.adapterId !== adapter.id || data.adapterVersion !== adapter.creatures?.version)
      return false;
    if (data.systemId !== (game.system?.id ?? 'unknown')) return false;
    if (strict && data.systemVersion !== (game.system?.version ?? '')) return false;
    if (data.packs.length !== stamps.length) return false;
    const stored = [...data.packs].sort((a, b) => a.id.localeCompare(b.id));
    return stamps.every((stamp, i) => {
      const other = stored[i];
      return (
        !!other &&
        other.id === stamp.id &&
        other.label === stamp.label &&
        other.count === stamp.count &&
        (!strict || other.modified === stamp.modified)
      );
    });
  }

  /**
   * The index in memory or in the stored file, when it still fits. Never
   * builds. A file that cannot be read counts as missing here; the build that
   * follows reports its own outcome.
   */
  async current(
    adapter: CompendiumAdapter,
    stamps: readonly PackStamp[],
    strict: boolean
  ): Promise<CreatureIndexData | null> {
    if (this.#stale) return null;
    if (this.#cache && this.matches(this.#cache, adapter, stamps, strict)) return this.#cache;
    try {
      const stored = await this.#storeNow().load();
      if (looksLikeIndex(stored) && this.matches(stored, adapter, stamps, strict)) {
        this.#cache = stored;
        return stored;
      }
    } catch {
      return null;
    }
    return null;
  }

  /** The rows, from memory, the stored file or a fresh build, whichever is still valid. */
  async get(adapter: CompendiumAdapter, progress?: Progress): Promise<IndexAnswer> {
    if (this.#building) return this.#building;
    const strict = autoRebuildEnabled();
    const stamps = await this.stamps(strict);
    let storeProblem: string | null = null;

    if (!this.#stale) {
      if (this.#cache && this.matches(this.#cache, adapter, stamps, strict))
        return { data: this.#cache, rebuilt: false, storeProblem };
      try {
        const stored = await this.#storeNow().load();
        if (looksLikeIndex(stored) && this.matches(stored, adapter, stamps, strict)) {
          this.#cache = stored;
          return { data: stored, rebuilt: false, storeProblem };
        }
      } catch (error) {
        storeProblem = `the stored creature index could not be read: ${messageOf(error)}`;
      }
    }

    const answer = await this.build(adapter, progress, stamps);
    return {
      ...answer,
      storeProblem: [storeProblem, answer.storeProblem].filter(Boolean).join('; ') || null,
    };
  }

  /** Build from the full documents of every actor compendium and store the result. */
  build(
    adapter: CompendiumAdapter,
    progress?: Progress,
    stamps?: PackStamp[]
  ): Promise<IndexAnswer> {
    if (this.#building) return this.#building;
    this.#building = this.#build(adapter, progress, stamps).finally(() => {
      this.#building = null;
    });
    return this.#building;
  }

  async #build(
    adapter: CompendiumAdapter,
    progress?: Progress,
    known?: PackStamp[]
  ): Promise<IndexAnswer> {
    const creatures = adapter.creatures;
    if (!creatures) throw new Error(`The adapter "${adapter.title}" builds no creature index`);
    const packs = actorPacks();
    const data: CreatureIndexData = {
      format: INDEX_FORMAT,
      adapterId: adapter.id,
      adapterVersion: creatures.version,
      systemId: game.system?.id ?? 'unknown',
      systemVersion: game.system?.version ?? '',
      builtAt: new Date().toISOString(),
      packs: known ?? (await this.stamps(true)),
      rows: [],
      failed: 0,
      failures: [],
    };
    // Built while compendiums may change; a change during the build marks it stale again.
    this.#stale = false;

    for (const [position, pack] of packs.entries()) {
      progress?.({
        progress: position,
        total: packs.length,
        message: `Building the creature index: ${packLabel(pack)}`,
      });
      const documents = await pack.getDocuments();
      for (const document of documents) {
        if (creatures.actorTypes && !creatures.actorTypes.includes(document.type ?? '')) continue;
        const common: CreatureRow = {
          id: document.id,
          name: document.name ?? '',
          type: document.type ?? '',
          packId: pack.collection,
          packLabel: packLabel(pack),
          img: typeof document.img === 'string' ? document.img : null,
        };
        try {
          data.rows.push({ ...creatures.row(document), ...common });
        } catch (error) {
          data.failed += 1;
          if (data.failures.length < FAILURES_KEPT)
            data.failures.push({
              packId: pack.collection,
              id: common.id,
              name: common.name,
              reason: messageOf(error),
            });
          // Kept with the common fields, so it is still found by name; it matches no value filter.
          data.rows.push({ ...common, indexError: messageOf(error) });
        }
      }
    }
    progress?.({ progress: packs.length, total: packs.length, message: 'Creature index built' });

    this.#cache = data;
    let storeProblem: string | null = null;
    try {
      await this.#storeNow().save(data);
    } catch (error) {
      storeProblem = `the creature index was built but could not be stored at ${this.#storeNow().where}: ${messageOf(error)}`;
    }
    return { data, rebuilt: true, storeProblem };
  }
}

export const creatureIndex = new CreatureIndex(worldFileStore);

/**
 * Rebuild on request, for the button in the creature index window of package
 * 4.5. Resolves with the outcome and rejects with the cause, so the window can
 * report the end and a failure, not only the start.
 */
export async function rebuildCreatureIndex(progress?: Progress): Promise<IndexAnswer> {
  const adapter = activeCompendiumAdapter();
  if (!adapter?.creatures) throw new Error(`${noAdapterText()} that builds a creature index`);
  creatureIndex.invalidate();
  return creatureIndex.build(adapter, progress);
}

/** Actor changes inside a compendium mark the index stale, with autoRebuildIndex on. */
export function watchCompendiumActors(index: CreatureIndex = creatureIndex): void {
  const onChange = (document: unknown) => {
    if (typeof document !== 'object' || document === null) return;
    const actor = document as Partial<FoundryCompendiumsDocument>;
    if (!actor.pack || !autoRebuildEnabled()) return;
    const types = activeCompendiumAdapter()?.creatures?.actorTypes;
    if (types && !types.includes(actor.type ?? '')) return;
    index.invalidate();
  };
  for (const hook of ['createActor', 'updateActor', 'deleteActor']) Hooks.on(hook, onChange);
}

/**
 * At ready, for a Gamemaster: build the index when none is stored or the
 * stored one no longer fits, with a notification. Never throws.
 */
export async function prepareCreatureIndex(index: CreatureIndex = creatureIndex): Promise<void> {
  if (!game.user?.isGM || !indexEnabled()) return;
  const adapter = activeCompendiumAdapter();
  if (!adapter?.creatures) return;
  try {
    const strict = autoRebuildEnabled();
    const stamps = await index.stamps(strict);
    if (await index.current(adapter, stamps, strict)) return;
    ui.notifications?.info(
      localize(
        'compendiums.indexBuilding',
        'Building the creature index for the compendiums. This can take a moment.'
      )
    );
    const answer = await index.build(adapter, undefined, stamps);
    ui.notifications?.info(
      localize('compendiums.indexBuilt', 'Creature index built: {count} creatures.', {
        count: answer.data.rows.length,
      })
    );
    if (answer.storeProblem) console.warn(`Ninjo's Foundry MCP | ${answer.storeProblem}`);
  } catch (error) {
    ui.notifications?.error(
      localize('compendiums.indexFailed', 'The creature index could not be built: {reason}', {
        reason: messageOf(error),
      })
    );
  }
}
