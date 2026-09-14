/**
 * Compendiums for the Foundry fake, without changing src/testing/.
 *
 * `withCompendiums` puts `game.packs` into the fake world, a `CONFIG` whose
 * document classes send writes with `{ pack }` to the right fake compendium
 * and everything else to the fake world, and `CompendiumCollection.createCompendium`.
 *
 * Deliberately strict like Foundry: a locked compendium refuses every write,
 * an unknown id refuses an update or delete before anything changes, and a
 * create with an id that exists is refused. `failures` lets a test make single
 * writes fail, for example an overwrite of a scene with tokens.
 */
import {
  applyChanges,
  type DocumentData,
  type FakeFoundry,
} from '../../../testing/fake-foundry.js';
import type { CreatureIndexData, CreatureIndexStore } from './creature-index.js';

export interface FakePackOptions {
  /** Full id, "package.name". */
  id: string;
  label: string;
  type: string;
  packageType?: 'world' | 'module' | 'system';
  /** Default: the part of the id before the dot. */
  packageName?: string;
  system?: string;
  locked?: boolean;
  entries?: DocumentData[];
  folders?: Array<{ _id: string; name: string; folder?: string | null }>;
}

export interface FakePackFailures {
  create?: (data: DocumentData) => string | undefined;
  update?: (data: DocumentData) => string | undefined;
  delete?: (id: string) => string | undefined;
  lock?: (locked: boolean) => string | undefined;
}

export interface PackWrite {
  action: 'create' | 'update' | 'delete' | 'lock' | 'folder';
  ids: string[];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function readPath(source: DocumentData, path: string): unknown {
  let node: unknown = source;
  for (const part of path.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

function writePath(target: DocumentData, path: string, value: unknown): void {
  const parts = path.split('.');
  const last = parts.pop() as string;
  let node = target;
  for (const part of parts) {
    if (typeof node[part] !== 'object' || node[part] === null) node[part] = {};
    node = node[part] as DocumentData;
  }
  node[last] = clone(value);
}

export class FakePackDocument {
  constructor(
    readonly pack: FakePack,
    private readonly data: DocumentData
  ) {}

  get id(): string {
    return this.data['_id'] as string;
  }
  get uuid(): string {
    return `Compendium.${this.pack.collection}.${this.pack.documentName}.${this.id}`;
  }
  get documentName(): string {
    return this.pack.documentName;
  }
  get name(): string | undefined {
    return this.data['name'] as string | undefined;
  }
  get type(): string | undefined {
    return this.data['type'] as string | undefined;
  }
  get img(): string | null {
    return (this.data['img'] as string | undefined) ?? null;
  }
  toObject(): DocumentData {
    return clone(this.data);
  }
}

export class FakePack {
  readonly collection: string;
  readonly documentName: string;
  readonly metadata: {
    id: string;
    name: string;
    label: string;
    type: string;
    system?: string;
    packageType: string;
    packageName: string;
  };
  locked: boolean;
  readonly docs = new Map<string, DocumentData>();
  readonly folderDocs = new Map<
    string,
    { id: string; name: string; type: string; folder: string | null }
  >();
  readonly writes: PackWrite[] = [];
  failures: FakePackFailures = {};
  /** How often getDocuments ran, to see whether the creature index was rebuilt. */
  documentLoads = 0;

  constructor(
    private readonly foundry: FakeFoundry,
    private readonly all: Map<string, FakePack>,
    options: FakePackOptions
  ) {
    const [packageName, name] = options.id.split('.') as [string, string];
    this.collection = options.id;
    this.documentName = options.type;
    this.metadata = {
      id: options.id,
      name,
      label: options.label,
      type: options.type,
      packageType: options.packageType ?? (packageName === 'world' ? 'world' : 'module'),
      packageName: options.packageName ?? packageName,
      ...(options.system ? { system: options.system } : {}),
    };
    this.locked = options.locked ?? false;
    for (const entry of options.entries ?? []) {
      const data = clone(entry);
      data['_id'] ??= foundry.nextId();
      this.docs.set(data['_id'] as string, data);
    }
    for (const folder of options.folders ?? [])
      this.folderDocs.set(folder._id, {
        id: folder._id,
        name: folder.name,
        type: options.type,
        folder: folder.folder ?? null,
      });
  }

  get title(): string {
    return this.metadata.label;
  }

  #entry(data: DocumentData, fields: readonly string[] = []): DocumentData {
    const entry: DocumentData = { _id: data['_id'], name: data['name'] };
    for (const key of ['type', 'img']) if (data[key] !== undefined) entry[key] = data[key];
    entry['folder'] = data['folder'] ?? null;
    for (const field of fields) {
      const value = readPath(data, field);
      if (value !== undefined) writePath(entry, field, value);
    }
    return entry;
  }

  get index(): Map<string, DocumentData> {
    return new Map([...this.docs].map(([id, data]) => [id, this.#entry(data)]));
  }

  get folders(): {
    contents: Array<{ id: string; name: string; type: string; folder: string | null }>;
  } {
    return { contents: [...this.folderDocs.values()] };
  }

  async getIndex(options: { fields?: string[] } = {}): Promise<Map<string, DocumentData>> {
    return new Map(
      [...this.docs].map(([id, data]) => [id, this.#entry(data, options.fields ?? [])])
    );
  }

  async getDocument(id: string): Promise<FakePackDocument | null> {
    const data = this.docs.get(id);
    return data ? new FakePackDocument(this, data) : null;
  }

  async getDocuments(): Promise<FakePackDocument[]> {
    this.documentLoads += 1;
    return [...this.docs.values()].map(data => new FakePackDocument(this, data));
  }

  async configure(settings: { locked?: boolean }): Promise<void> {
    if (settings.locked === undefined) return;
    const failure = this.failures.lock?.(settings.locked);
    if (failure) throw new Error(failure);
    this.locked = settings.locked;
    this.writes.push({ action: 'lock', ids: [] });
  }

  async deleteCompendium(): Promise<void> {
    this.all.delete(this.collection);
  }

  #writable(): void {
    if (!this.foundry.game.user?.isGM)
      throw new Error('Only a Gamemaster can write to compendiums');
    if (this.locked) throw new Error(`You may not modify the locked compendium ${this.collection}`);
  }

  async create(
    data: DocumentData[],
    options: { keepId?: boolean } = {}
  ): Promise<FakePackDocument[]> {
    this.#writable();
    const prepared = data.map(entry => {
      const copy = clone(entry);
      if (!options.keepId || typeof copy['_id'] !== 'string') copy['_id'] = this.foundry.nextId();
      if (this.docs.has(copy['_id'] as string))
        throw new Error(`The document ${String(copy['_id'])} already exists in ${this.collection}`);
      const failure = this.failures.create?.(copy);
      if (failure) throw new Error(failure);
      return copy;
    });
    for (const copy of prepared) this.docs.set(copy['_id'] as string, copy);
    this.writes.push({ action: 'create', ids: prepared.map(copy => copy['_id'] as string) });
    return prepared.map(copy => new FakePackDocument(this, copy));
  }

  async update(
    updates: DocumentData[],
    options: { recursive?: boolean } = {}
  ): Promise<DocumentData[]> {
    this.#writable();
    for (const update of updates) {
      if (!this.docs.has(String(update['_id'])))
        throw new Error(
          `The document ${String(update['_id'])} does not exist in ${this.collection}`
        );
      const failure = this.failures.update?.(update);
      if (failure) throw new Error(failure);
    }
    for (const update of updates) {
      const id = String(update['_id']);
      if (options.recursive === false) this.docs.set(id, { ...clone(update), _id: id });
      else applyChanges(this.docs.get(id) as DocumentData, update);
    }
    this.writes.push({ action: 'update', ids: updates.map(update => String(update['_id'])) });
    return updates;
  }

  async delete(ids: string[]): Promise<string[]> {
    this.#writable();
    for (const id of ids) {
      if (!this.docs.has(id))
        throw new Error(`The document ${id} does not exist in ${this.collection}`);
      const failure = this.failures.delete?.(id);
      if (failure) throw new Error(failure);
    }
    for (const id of ids) this.docs.delete(id);
    this.writes.push({ action: 'delete', ids });
    return ids;
  }

  async createFolder(data: DocumentData): Promise<{ id: string }> {
    this.#writable();
    const id = this.foundry.nextId();
    this.folderDocs.set(id, {
      id,
      name: String(data['name']),
      type: String(data['type'] ?? this.documentName),
      folder: (data['folder'] as string | null | undefined) ?? null,
    });
    this.writes.push({ action: 'folder', ids: [id] });
    return { id };
  }
}

export interface CompendiumWorld {
  packs: Map<string, FakePack>;
  add(options: FakePackOptions): FakePack;
  get(id: string): FakePack;
}

const DOCUMENT_NAMES = [
  'Actor',
  'Adventure',
  'Cards',
  'Folder',
  'Item',
  'JournalEntry',
  'Macro',
  'Playlist',
  'RollTable',
  'Scene',
];

/** Add compendiums to a fake Foundry. Call before createAreaHarness installs it. */
export function withCompendiums(
  foundry: FakeFoundry,
  packs: FakePackOptions[] = []
): CompendiumWorld {
  const all = new Map<string, FakePack>();
  foundry.game['packs'] = all;

  const packOf = (options: DocumentData | undefined): FakePack | null => {
    const id = options?.['pack'];
    if (typeof id !== 'string') return null;
    const pack = all.get(id);
    if (!pack) throw new Error(`No compendium ${id}`);
    return pack;
  };

  const CONFIG: Record<string, { documentClass: unknown }> = {};
  for (const name of DOCUMENT_NAMES) {
    const world = () => foundry.documentClass(name);
    CONFIG[name] = {
      documentClass: {
        documentName: name,
        create: async (data: DocumentData, options?: DocumentData) => {
          const pack = packOf(options);
          if (!pack) return world().create(data, options);
          if (name === 'Folder') return pack.createFolder(data);
          return (await pack.create([data], options))[0];
        },
        createDocuments: async (data: DocumentData[], options?: DocumentData) => {
          const pack = packOf(options);
          return pack ? pack.create(data, options) : world().createDocuments(data, options);
        },
        updateDocuments: async (updates: DocumentData[], options?: DocumentData) => {
          const pack = packOf(options);
          return pack ? pack.update(updates, options) : world().updateDocuments(updates, options);
        },
        deleteDocuments: async (ids: string[], options?: DocumentData) => {
          const pack = packOf(options);
          return pack ? pack.delete(ids) : world().deleteDocuments(ids, options);
        },
      },
    };
  }
  foundry.setGlobal('CONFIG', CONFIG);

  const world: CompendiumWorld = {
    packs: all,
    add: options => {
      const pack = new FakePack(foundry, all, options);
      all.set(pack.collection, pack);
      return pack;
    },
    get: id => {
      const pack = all.get(id);
      if (!pack) throw new Error(`No compendium ${id}`);
      return pack;
    },
  };

  foundry.setGlobal('CompendiumCollection', {
    createCompendium: async (metadata: { label: string; type: string; name: string }) => {
      const id = `world.${metadata.name}`;
      if (all.has(id)) throw new Error(`A compendium ${id} already exists`);
      return world.add({ id, label: metadata.label, type: metadata.type, packageType: 'world' });
    },
  });

  for (const options of packs) world.add(options);
  return world;
}

interface FakeSettings {
  get(namespace: string, key: string): unknown;
  set(namespace: string, key: string, value: unknown): Promise<unknown>;
}

/** Change a setting of this module in the fake world, as a Gamemaster would in the settings. */
export function setModuleSetting(
  foundry: FakeFoundry,
  key: string,
  value: unknown
): Promise<unknown> {
  return (foundry.game['settings'] as FakeSettings).set('ninjos-foundry-mcp', key, value);
}

export function getModuleSetting(foundry: FakeFoundry, key: string): unknown {
  return (foundry.game['settings'] as FakeSettings).get('ninjos-foundry-mcp', key);
}

/** A creature index store in memory that counts loads and saves. */
export function memoryIndexStore(initial: CreatureIndexData | null = null): CreatureIndexStore & {
  data: CreatureIndexData | null;
  loads: number;
  saves: number;
  failSave: string | undefined;
} {
  const store = {
    where: 'memory',
    data: initial,
    loads: 0,
    saves: 0,
    failSave: undefined as string | undefined,
    load: async () => {
      store.loads += 1;
      return store.data ? clone(store.data) : null;
    },
    save: async (data: CreatureIndexData) => {
      if (store.failSave) throw new Error(store.failSave);
      store.saves += 1;
      store.data = clone(data);
    },
  };
  return store;
}
