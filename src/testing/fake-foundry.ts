/**
 * A stand-in for the parts of Foundry an area needs, for tests without Foundry.
 *
 * What it imitates: world collections of documents with create, update and
 * delete, embedded documents, the static helpers of a document class
 * (`JournalEntry.create`, `createDocuments`, ...), `fromUuid`, settings with
 * register, get and set, users with the Gamemaster flag, hooks and
 * notifications. Every write is recorded in `operations`.
 *
 * How an area extends it without editing this file: `defineDocumentType`
 * for a type or an embedded type that is missing, `extend` in that spec to
 * add methods to its documents (`Scene#activate`), and `setGlobal` for
 * anything else (`canvas`, `foundry.applications`). Put those calls in
 * src/module/areas/<id>/testing.ts.
 *
 * Mind the order: `defineDocumentType` (and its `extend`) only shapes
 * documents created after the call. A document that is already seeded or
 * created keeps the embedded collections and methods it was built with, so
 * define types first and seed afterwards, or pass them to the constructor in
 * `documentTypes`.
 *
 * Rendered windows: `renderHook(name, html)` parses markup into the element
 * tree of fake-dom.ts and calls the hook with (application, element, context),
 * as Foundry calls `render<Application>` hooks.
 *
 * Deliberately strict where Foundry's exact behaviour is not described:
 * updating or deleting an embedded id that does not exist throws, and a user
 * who is not a Gamemaster cannot write at all. A test that needs something
 * else says so with `onWrite`.
 *
 * This is test code only. It is not part of either build.
 */

import { FakeElement, parseHtml } from './fake-dom.js';

export type DocumentData = Record<string, unknown>;

export interface DocumentTypeSpec {
  /** Property of `game` that holds the world collection, e.g. "journal". Absent for embedded types. */
  collection?: string;
  /** Embedded document types and the field that holds them, e.g. `{ JournalEntryPage: 'pages' }`. */
  embedded?: Record<string, string>;
  /** Called for every new document of this type, to add methods. */
  extend?: (document: FakeDocument) => void;
}

export interface WriteOperation {
  action: 'create' | 'update' | 'delete';
  documentName: string;
  id: string;
  /** uuid of the parent document, for embedded documents. */
  parent?: string;
  /** The data of a create, the changes of an update. */
  data?: DocumentData;
  userId: string;
}

export interface FakeUser {
  id: string;
  name: string;
  isGM: boolean;
  active: boolean;
  /** The targeted tokens, not enumerable. Set by `updateTokenTargets`. */
  targets?: Set<FakeTokenTarget>;
  /** Target these tokens of the viewed scene (`canvas.scene`, else the active one). */
  updateTokenTargets?(ids: string[]): void;
}

/** A target as Foundry keeps it: the token placeable, here only its id and document. */
export interface FakeTokenTarget {
  id: string;
  document: FakeDocument;
}

export interface FakeFoundryOptions {
  /** Default: one active Gamemaster "Gamemaster" with id "gm". */
  users?: Array<Partial<FakeUser> & { name: string }>;
  /** Id or name of the logged in user. Default: the first user. */
  user?: string;
  /** Default: `{ id: 'test-world', title: 'Test World' }`; null for no world. */
  world?: { id: string; title: string } | null;
  system?: { id: string; version: string };
  version?: string;
  ready?: boolean;
  /** Added to, or replacing, the default document types. */
  documentTypes?: Record<string, DocumentTypeSpec>;
  /** Stored setting values by "namespace.key", as if the world had saved them. */
  settings?: Record<string, unknown>;
  /** Texts for game.i18n; a key without a text comes back unchanged, as in Foundry. */
  translations?: Record<string, string>;
  /** Installed modules for game.modules.get. */
  modules?: Array<{ id: string; version?: string; active?: boolean }>;
  /**
   * Scenes carry an embedded Level collection (`scene.levels`), as in Foundry 14.
   * Default: on when `version` is 14 or higher.
   */
  levels?: boolean;
  /** Compendiums in `game.packs`. More with `addPack`. */
  packs?: FakePackOptions[];
  /**
   * `game.documentTypes`, the valid subtypes per document name, e.g.
   * `{ Actor: ['character', 'npc'] }`. Absent by default, so code that checks
   * types against it leaves the check to Foundry, as without this option.
   */
  documentSubtypes?: Record<string, string[]>;
}

export interface FakePackOptions {
  /** The full id, "package.name". */
  id: string;
  /** Document type inside, e.g. "Actor". */
  documentName: string;
  label?: string;
  /** Default: the part of the id before the dot. */
  packageName?: string;
  packageType?: 'world' | 'module' | 'system';
  system?: string;
  locked?: boolean;
  /** Stored documents; each needs `_id`. */
  documents?: DocumentData[];
}

/**
 * A compendium: an index, loading documents as plain data, and the lock.
 * Package tests that need more (writing into a pack) extend or replace it
 * in their testing.ts, as the journals and compendiums areas do.
 */
export class FakePack {
  readonly collection: string;
  readonly documentName: string;
  readonly metadata: {
    id: string;
    name: string;
    label: string;
    type: string;
    system?: string;
    packageName: string;
    packageType: string;
  };
  locked: boolean;
  readonly documents = new Map<string, DocumentData>();

  constructor(options: FakePackOptions) {
    const [packageName = options.id, name = options.id] = options.id.split('.');
    this.collection = options.id;
    this.documentName = options.documentName;
    this.metadata = {
      id: options.id,
      name,
      label: options.label ?? name,
      type: options.documentName,
      packageName: options.packageName ?? packageName,
      packageType: options.packageType ?? (packageName === 'world' ? 'world' : 'module'),
      ...(options.system ? { system: options.system } : {}),
    };
    this.locked = options.locked ?? packageName !== 'world';
    for (const document of options.documents ?? []) {
      if (typeof document['_id'] !== 'string')
        throw new Error(`A document of ${options.id} has no _id`);
      this.documents.set(document['_id'], clone(document));
    }
  }

  get id(): string {
    return this.collection;
  }

  get title(): string {
    return this.metadata.label;
  }

  /** The default index fields: _id, name, type, img. */
  get index(): Map<string, DocumentData> {
    return this.#indexWith([]);
  }

  async getIndex(options: { fields?: string[] } = {}): Promise<Map<string, DocumentData>> {
    return this.#indexWith(options.fields ?? []);
  }

  async getDocument(id: string): Promise<DocumentData | undefined> {
    const data = this.documents.get(id);
    return data ? this.#loaded(id, data) : undefined;
  }

  async getDocuments(): Promise<DocumentData[]> {
    return [...this.documents].map(([id, data]) => this.#loaded(id, data));
  }

  async configure(settings: { locked?: boolean }): Promise<this> {
    if (settings.locked !== undefined) this.locked = settings.locked;
    return this;
  }

  #indexWith(fields: readonly string[]): Map<string, DocumentData> {
    const index = new Map<string, DocumentData>();
    for (const [id, data] of this.documents) {
      const row: DocumentData = { _id: id };
      for (const key of ['name', 'type', 'img', ...fields]) {
        let node: unknown = data;
        for (const part of key.split('.')) node = isPlainObject(node) ? node[part] : undefined;
        if (node !== undefined) row[key] = clone(node);
      }
      index.set(id, row);
    }
    return index;
  }

  #loaded(id: string, data: DocumentData): DocumentData {
    const copy = clone(data);
    Object.defineProperties(copy, {
      id: { value: id, enumerable: false },
      uuid: {
        value: `Compendium.${this.collection}.${this.documentName}.${id}`,
        enumerable: false,
      },
      pack: { value: this.collection, enumerable: false },
      documentName: { value: this.documentName, enumerable: false },
      toObject: { value: () => clone(data), enumerable: false },
    });
    return copy;
  }
}

/** The world document types of Foundry 13 and 14 and their embedded collections. */
export const DEFAULT_DOCUMENT_TYPES: Readonly<Record<string, DocumentTypeSpec>> = {
  Actor: { collection: 'actors', embedded: { Item: 'items', ActiveEffect: 'effects' } },
  Adventure: { collection: 'adventures' },
  Cards: { collection: 'cards', embedded: { Card: 'cards' } },
  ChatMessage: { collection: 'messages' },
  Combat: { collection: 'combats', embedded: { Combatant: 'combatants' } },
  Folder: { collection: 'folders' },
  Item: { collection: 'items', embedded: { ActiveEffect: 'effects' } },
  JournalEntry: { collection: 'journal', embedded: { JournalEntryPage: 'pages' } },
  Macro: { collection: 'macros' },
  Playlist: { collection: 'playlists', embedded: { PlaylistSound: 'sounds' } },
  RollTable: { collection: 'tables', embedded: { TableResult: 'results' } },
  Scene: {
    collection: 'scenes',
    embedded: {
      AmbientLight: 'lights',
      AmbientSound: 'sounds',
      Drawing: 'drawings',
      MeasuredTemplate: 'templates',
      Note: 'notes',
      Region: 'regions',
      Tile: 'tiles',
      Token: 'tokens',
      Wall: 'walls',
    },
  },
  ActiveEffect: {},
  Card: {},
  Combatant: {},
  JournalEntryPage: {},
  PlaylistSound: {},
  TableResult: {},
  AmbientLight: {},
  AmbientSound: {},
  Drawing: {},
  MeasuredTemplate: {},
  Note: {},
  Region: {},
  Tile: {},
  Token: { embedded: {} },
  Wall: {},
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

/** Foundry's update rules: dotted keys reach into objects, "-=key" removes, objects merge, the rest replaces. */
export function applyChanges(target: Record<string, unknown>, changes: DocumentData): void {
  for (const [rawKey, value] of Object.entries(changes)) {
    if (rawKey === '_id') continue;
    const path = rawKey.split('.');
    const last = path.pop() as string;
    let node = target;
    for (const part of path) {
      if (!isPlainObject(node[part])) node[part] = {};
      node = node[part] as Record<string, unknown>;
    }
    if (last.startsWith('-=')) {
      delete node[last.slice(2)];
    } else if (isPlainObject(value)) {
      if (!isPlainObject(node[last])) node[last] = {};
      applyChanges(node[last] as Record<string, unknown>, value);
    } else {
      node[last] = clone(value);
    }
  }
}

export class FakeCollection<T extends { id: string }> extends Map<string, T> {
  constructor(readonly documentName: string) {
    super();
  }

  get contents(): T[] {
    return [...this.values()];
  }

  getName(name: string): T | undefined {
    return this.find(entry => (entry as { name?: unknown }).name === name);
  }

  find(predicate: (entry: T) => boolean): T | undefined {
    return this.contents.find(predicate);
  }

  filter(predicate: (entry: T) => boolean): T[] {
    return this.contents.filter(predicate);
  }

  map<U>(mapper: (entry: T) => U): U[] {
    return this.contents.map(mapper);
  }

  some(predicate: (entry: T) => boolean): boolean {
    return this.contents.some(predicate);
  }
}

export class FakeDocument {
  readonly #foundry: FakeFoundry;
  readonly #documentName: string;
  readonly #parent: FakeDocument | null;
  readonly #embedded = new Map<string, FakeCollection<FakeDocument>>();
  [field: string]: unknown;

  constructor(
    foundry: FakeFoundry,
    documentName: string,
    data: DocumentData,
    parent: FakeDocument | null
  ) {
    this.#foundry = foundry;
    this.#documentName = documentName;
    this.#parent = parent;
    const spec = foundry.documentType(documentName);
    const embedded = spec.embedded ?? {};
    const fields = new Set(Object.values(embedded));

    for (const [key, value] of Object.entries(data)) {
      if (!fields.has(key)) this[key] = clone(value);
    }
    if (typeof this['_id'] !== 'string' || !this['_id']) this['_id'] = foundry.nextId();

    for (const [childName, field] of Object.entries(embedded)) {
      const collection = new FakeCollection<FakeDocument>(childName);
      this.#embedded.set(childName, collection);
      Object.defineProperty(this, field, { value: collection, enumerable: false });
      const seeds = data[field];
      if (Array.isArray(seeds)) {
        for (const seed of seeds) {
          const child = new FakeDocument(foundry, childName, seed as DocumentData, this);
          collection.set(child.id, child);
        }
      }
    }
    foundry.addCoreMethods(this);
    spec.extend?.(this);
  }

  get id(): string {
    return this['_id'] as string;
  }

  get documentName(): string {
    return this.#documentName;
  }

  get parent(): FakeDocument | null {
    return this.#parent;
  }

  get uuid(): string {
    const own = `${this.#documentName}.${this.id}`;
    return this.#parent ? `${this.#parent.uuid}.${own}` : own;
  }

  /** The stored data, embedded documents included, as plain objects. */
  toObject(): DocumentData {
    const out: DocumentData = {};
    for (const [key, value] of Object.entries(this)) out[key] = clone(value);
    const spec = this.#foundry.documentType(this.#documentName);
    for (const [childName, field] of Object.entries(spec.embedded ?? {})) {
      out[field] = this.getEmbeddedCollection(childName).map(child => child.toObject());
    }
    return out;
  }

  async update(changes: DocumentData, options: DocumentData = {}): Promise<this> {
    this.#foundry.recordWrite('update', this, changes);
    applyChanges(this, changes);
    this.#foundry.hooks.callAll(
      `update${this.#documentName}`,
      this,
      changes,
      options,
      this.#foundry.userId()
    );
    return this;
  }

  async delete(options: DocumentData = {}): Promise<this> {
    this.#foundry.recordWrite('delete', this);
    this.#container().delete(this.id);
    this.#foundry.hooks.callAll(
      `delete${this.#documentName}`,
      this,
      options,
      this.#foundry.userId()
    );
    return this;
  }

  getEmbeddedCollection(embeddedName: string): FakeCollection<FakeDocument> {
    const collection = this.#embedded.get(embeddedName);
    if (!collection)
      throw new Error(`${this.#documentName} has no embedded collection ${embeddedName}`);
    return collection;
  }

  async createEmbeddedDocuments(
    embeddedName: string,
    data: DocumentData[],
    options: DocumentData = {}
  ): Promise<FakeDocument[]> {
    this.getEmbeddedCollection(embeddedName);
    const created: FakeDocument[] = [];
    for (const entry of data)
      created.push(await this.#foundry.createDocument(embeddedName, entry, this, options));
    return created;
  }

  async updateEmbeddedDocuments(
    embeddedName: string,
    updates: DocumentData[],
    options: DocumentData = {}
  ): Promise<FakeDocument[]> {
    const collection = this.getEmbeddedCollection(embeddedName);
    const targets = updates.map(update => this.#existing(collection, update['_id']));
    const updated: FakeDocument[] = [];
    for (const [index, target] of targets.entries())
      updated.push(await target.update(updates[index] as DocumentData, options));
    return updated;
  }

  async deleteEmbeddedDocuments(
    embeddedName: string,
    ids: string[],
    options: DocumentData = {}
  ): Promise<FakeDocument[]> {
    const collection = this.getEmbeddedCollection(embeddedName);
    const targets = ids.map(id => this.#existing(collection, id));
    const deleted: FakeDocument[] = [];
    for (const target of targets) deleted.push(await target.delete(options));
    return deleted;
  }

  /** Every id is checked before the first change, so a bad id never leaves half a batch behind. */
  #existing(collection: FakeCollection<FakeDocument>, id: unknown): FakeDocument {
    const found = typeof id === 'string' ? collection.get(id) : undefined;
    if (!found)
      throw new Error(`${collection.documentName} "${String(id)}" does not exist in ${this.uuid}`);
    return found;
  }

  #container(): FakeCollection<FakeDocument> {
    return this.#parent
      ? this.#parent.getEmbeddedCollection(this.#documentName)
      : this.#foundry.collection(this.#documentName);
  }
}

interface HookEntry {
  id: number;
  callback: (...args: unknown[]) => unknown;
  once: boolean;
}

export class FakeHooks {
  readonly calls: Array<{ name: string; args: unknown[] }> = [];
  readonly #listeners = new Map<string, HookEntry[]>();
  #nextId = 1;

  on(name: string, callback: (...args: unknown[]) => unknown): number {
    return this.#add(name, callback, false);
  }

  once(name: string, callback: (...args: unknown[]) => unknown): number {
    return this.#add(name, callback, true);
  }

  off(name: string, idOrCallback: number | ((...args: unknown[]) => unknown)): void {
    const list = this.#listeners.get(name) ?? [];
    this.#listeners.set(
      name,
      list.filter(entry => entry.id !== idOrCallback && entry.callback !== idOrCallback)
    );
  }

  /** Runs every listener. */
  callAll(name: string, ...args: unknown[]): boolean {
    this.#run(name, args, false);
    return true;
  }

  /** Runs listeners until one returns false; returns false then. */
  call(name: string, ...args: unknown[]): boolean {
    return this.#run(name, args, true);
  }

  #add(name: string, callback: (...args: unknown[]) => unknown, once: boolean): number {
    const id = this.#nextId++;
    this.#listeners.set(name, [...(this.#listeners.get(name) ?? []), { id, callback, once }]);
    return id;
  }

  #run(name: string, args: unknown[], stoppable: boolean): boolean {
    this.calls.push({ name, args });
    for (const entry of [...(this.#listeners.get(name) ?? [])]) {
      if (entry.once) this.off(name, entry.id);
      if (entry.callback(...args) === false && stoppable) return false;
    }
    return true;
  }
}

interface SettingConfig {
  default?: unknown;
  onChange?: (value: unknown) => void;
  [key: string]: unknown;
}

export interface FakeDocumentClass {
  documentName: string;
  create(
    data: DocumentData | DocumentData[],
    options?: { parent?: FakeDocument } & DocumentData
  ): Promise<FakeDocument | FakeDocument[]>;
  createDocuments(
    data: DocumentData[],
    options?: { parent?: FakeDocument } & DocumentData
  ): Promise<FakeDocument[]>;
  updateDocuments(
    updates: DocumentData[],
    options?: { parent?: FakeDocument } & DocumentData
  ): Promise<FakeDocument[]>;
  deleteDocuments(
    ids: string[],
    options?: { parent?: FakeDocument } & DocumentData
  ): Promise<FakeDocument[]>;
}

export class FakeFoundry {
  /** Every write through a document or a document class, in order. Seeding is not recorded. */
  readonly operations: WriteOperation[] = [];
  readonly notifications: Array<{ level: 'info' | 'warn' | 'error'; message: string }> = [];
  readonly hooks = new FakeHooks();
  readonly users = new FakeCollection<FakeUser>('User');
  /** `game.packs`, unless a package test replaces it. */
  readonly packs = new FakeCollection<FakePack>('Compendium');
  readonly game: Record<string, unknown> & {
    ready: boolean;
    version: string;
    world: { id: string; title: string } | undefined;
    system: { id: string; version: string };
    readonly user: FakeUser | null;
  };

  readonly #types = new Map<string, DocumentTypeSpec>();
  readonly #collections = new Map<string, FakeCollection<FakeDocument>>();
  readonly #settingConfigs = new Map<string, SettingConfig>();
  readonly #settingValues = new Map<string, unknown>();
  readonly #interceptors: Array<(operation: WriteOperation) => void> = [];
  readonly #globals = new Map<string, unknown>();
  readonly #saved = new Map<string, { had: boolean; value: unknown }>();
  #userId: string | null = null;
  #counter = 0;
  #installed = false;

  constructor(options: FakeFoundryOptions = {}) {
    const translations = options.translations ?? {};
    const modules = new Map(
      (options.modules ?? []).map(module => [module.id, { active: true, ...module }])
    );
    const localize = (key: string) => translations[key] ?? key;
    const version = options.version ?? '14.350';
    const levels = options.levels ?? Number.parseInt(version, 10) >= 14;

    const game = {
      ready: options.ready ?? true,
      version,
      packs: this.packs,
      world:
        options.world === null
          ? undefined
          : (options.world ?? { id: 'test-world', title: 'Test World' }),
      system: options.system ?? { id: 'dnd5e', version: '5.1.0' },
      users: this.users,
      settings: {
        register: (namespace: string, key: string, config: SettingConfig) => {
          this.#settingConfigs.set(`${namespace}.${key}`, config);
        },
        get: (namespace: string, key: string) => {
          const id = `${namespace}.${key}`;
          const config = this.#settingConfigs.get(id);
          if (!config) throw new Error(`"${id}" is not a registered game setting`);
          return clone(this.#settingValues.has(id) ? this.#settingValues.get(id) : config.default);
        },
        set: async (namespace: string, key: string, value: unknown) => {
          const id = `${namespace}.${key}`;
          const config = this.#settingConfigs.get(id);
          if (!config) throw new Error(`"${id}" is not a registered game setting`);
          this.#settingValues.set(id, clone(value));
          config.onChange?.(clone(value));
          return value;
        },
      },
      i18n: {
        lang: 'en',
        has: (key: string) => key in translations,
        localize,
        format: (key: string, data: Record<string, unknown> = {}) =>
          localize(key).replace(/\{(\w+)\}/g, (match, name: string) =>
            name in data ? String(data[name]) : match
          ),
      },
      modules: { get: (id: string) => modules.get(id) },
    };
    Object.defineProperty(game, 'user', {
      get: () => (this.#userId ? (this.users.get(this.#userId) ?? null) : null),
      enumerable: true,
    });
    this.game = game as unknown as FakeFoundry['game'];
    if (options.documentSubtypes) this.setDocumentSubtypes(options.documentSubtypes);

    for (const [key, value] of Object.entries(options.settings ?? {}))
      this.#settingValues.set(key, clone(value));
    const scene = DEFAULT_DOCUMENT_TYPES['Scene'] as DocumentTypeSpec;
    const levelTypes: Record<string, DocumentTypeSpec> = levels
      ? { Level: {}, Scene: { ...scene, embedded: { ...scene.embedded, Level: 'levels' } } }
      : {};
    for (const [name, spec] of Object.entries({
      ...DEFAULT_DOCUMENT_TYPES,
      ...levelTypes,
      ...options.documentTypes,
    }))
      this.defineDocumentType(name, spec);
    for (const pack of options.packs ?? []) this.addPack(pack);

    for (const user of options.users ?? [
      { id: 'gm', name: 'Gamemaster', isGM: true, active: true },
    ])
      this.addUser(user);
    if (options.user) this.setUser(options.user);
  }

  /** Put a compendium into `game.packs`. Not recorded, like `seed`. */
  addPack(options: FakePackOptions): FakePack {
    if (this.packs.has(options.id)) throw new Error(`The compendium ${options.id} exists already`);
    const pack = new FakePack(options);
    this.packs.set(pack.id, pack);
    return pack;
  }

  /**
   * Fire a render hook as Foundry does after drawing a window: the
   * application, its root element, and the render context. Markup is parsed
   * into a `FakeElement` under a `div` root; an element is passed as it is.
   * Returns the element, so a test can look at what the hook changed.
   */
  renderHook(
    hook: string,
    content: string | FakeElement,
    application: unknown = {},
    context: Record<string, unknown> = {}
  ): FakeElement {
    const element = typeof content === 'string' ? parseHtml(content) : content;
    this.hooks.callAll(hook, application, element, context);
    return element;
  }

  /**
   * Add or replace a document type. Only documents created after this call
   * get the new embedded collections and `extend` methods; documents that
   * exist already keep their shape.
   */
  defineDocumentType(name: string, spec: DocumentTypeSpec): this {
    this.#types.set(name, spec);
    if (spec.collection) {
      const collection = this.#collections.get(name) ?? new FakeCollection<FakeDocument>(name);
      this.#collections.set(name, collection);
      this.game[spec.collection] = collection;
    }
    this.#globals.set(name, this.documentClass(name));
    if (this.#installed) this.setGlobal(name, this.#globals.get(name));
    return this;
  }

  documentType(name: string): DocumentTypeSpec {
    const spec = this.#types.get(name);
    if (!spec) throw new Error(`Unknown document type ${name}; add it with defineDocumentType`);
    return spec;
  }

  /** The world collection of a type. */
  collection(documentName: string): FakeCollection<FakeDocument> {
    const collection = this.#collections.get(documentName);
    if (!collection) throw new Error(`${documentName} has no world collection`);
    return collection;
  }

  /** Put a document into the world as it was before the test. Not recorded, no hooks, no permission check. */
  seed(documentName: string, data: DocumentData, parent?: FakeDocument): FakeDocument {
    const document = new FakeDocument(this, documentName, data, parent ?? null);
    (parent ? parent.getEmbeddedCollection(documentName) : this.collection(documentName)).set(
      document.id,
      document
    );
    return document;
  }

  /** Set `game.documentTypes`, the valid subtypes per document name. */
  setDocumentSubtypes(subtypes: Record<string, string[]>): this {
    this.game['documentTypes'] = clone(subtypes);
    return this;
  }

  /**
   * Methods Foundry gives every document of a type, whatever spec a test
   * defines for it. Runs before `extend`, so a package can still
   * replace one. Not enumerable, so `toObject` never copies them.
   */
  addCoreMethods(document: FakeDocument): void {
    if (document.documentName !== 'Actor') return;
    Object.defineProperty(document, 'getTokenDocument', {
      enumerable: false,
      configurable: true,
      writable: true,
      value: async (data: DocumentData = {}) => {
        const prototype = isPlainObject(document['prototypeToken'])
          ? clone(document['prototypeToken'])
          : {};
        return new FakeDocument(
          this,
          'Token',
          {
            ...prototype,
            name: prototype['name'] ?? document['name'],
            actorId: document.id,
            actorLink: prototype['actorLink'] ?? false,
            ...clone(data),
          },
          null
        );
      },
    });
  }

  /** The scene tokens are targeted on: `canvas.scene` when a test set one, else the active scene. */
  #targetScene(): FakeDocument | undefined {
    const canvas = (globalThis as { canvas?: { scene?: unknown } }).canvas;
    if (canvas?.scene instanceof FakeDocument) return canvas.scene;
    return this.#collections.get('Scene')?.find(scene => scene['active'] === true);
  }

  addUser(data: Partial<FakeUser> & { name: string }): FakeUser {
    const user: FakeUser = {
      id: data.id ?? this.nextId(),
      name: data.name,
      isGM: data.isGM ?? false,
      active: data.active ?? true,
    };
    // Not enumerable: code that copies users field by field does not see them.
    Object.defineProperty(user, 'targets', {
      value: new Set<FakeTokenTarget>(),
      enumerable: false,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(user, 'updateTokenTargets', {
      enumerable: false,
      configurable: true,
      writable: true,
      value: (ids: string[]) => {
        // As Foundry: ids that are no token of the viewed scene are left out.
        const tokens = this.#targetScene()?.getEmbeddedCollection('Token');
        const targets = new Set<FakeTokenTarget>();
        for (const id of ids) {
          const token = tokens?.get(id);
          if (token) targets.add({ id: token.id, document: token });
        }
        user.targets = targets;
      },
    });
    this.users.set(user.id, user);
    this.#userId ??= user.id;
    return user;
  }

  /** Log in as another user, by id or name. */
  setUser(idOrName: string): FakeUser {
    const user = this.users.get(idOrName) ?? this.users.getName(idOrName);
    if (!user) throw new Error(`No user "${idOrName}"`);
    this.#userId = user.id;
    return user;
  }

  /** Watch or refuse writes: throw inside to make the write fail before anything changes. Returns a remover. */
  onWrite(interceptor: (operation: WriteOperation) => void): () => void {
    this.#interceptors.push(interceptor);
    return () => {
      const index = this.#interceptors.indexOf(interceptor);
      if (index >= 0) this.#interceptors.splice(index, 1);
    };
  }

  /** Any other global a test needs (canvas, foundry, CONFIG). Restored by uninstall. */
  setGlobal(name: string, value: unknown): this {
    this.#globals.set(name, value);
    if (this.#installed) {
      const scope = globalThis as Record<string, unknown>;
      if (!this.#saved.has(name)) this.#saved.set(name, { had: name in scope, value: scope[name] });
      scope[name] = value;
    }
    return this;
  }

  /** Make game, ui, Hooks, fromUuid and the document classes global. */
  install(): this {
    if (this.#installed) return this;
    this.#installed = true;
    const notify = (level: 'info' | 'warn' | 'error') => (message: string) =>
      void this.notifications.push({ level, message });
    this.setGlobal('game', this.game);
    this.setGlobal('ui', {
      notifications: { info: notify('info'), warn: notify('warn'), error: notify('error') },
    });
    this.setGlobal('Hooks', this.hooks);
    this.setGlobal('fromUuidSync', (uuid: string) => this.fromUuid(uuid));
    this.setGlobal('fromUuid', async (uuid: string) => this.fromUuid(uuid));
    for (const [name, value] of this.#globals) this.setGlobal(name, value);
    return this;
  }

  uninstall(): void {
    const scope = globalThis as Record<string, unknown>;
    for (const [name, saved] of this.#saved) {
      if (saved.had) scope[name] = saved.value;
      else delete scope[name];
    }
    this.#saved.clear();
    this.#installed = false;
  }

  fromUuid(uuid: string): FakeDocument | null {
    const parts = uuid.split('.');
    let current: FakeDocument | null = null;
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const type = parts[i] as string;
      const id = parts[i + 1] as string;
      const collection: FakeCollection<FakeDocument> | undefined = current
        ? current.getEmbeddedCollection(type)
        : this.#collections.get(type);
      current = collection?.get(id) ?? null;
      if (!current) return null;
    }
    return current;
  }

  documentClass(documentName: string): FakeDocumentClass {
    const within = (options?: { parent?: FakeDocument }) =>
      options?.parent
        ? options.parent.getEmbeddedCollection(documentName)
        : this.collection(documentName);
    return {
      documentName,
      create: async (data, options) =>
        Array.isArray(data)
          ? Promise.all(
              data.map(entry =>
                this.createDocument(documentName, entry, options?.parent ?? null, options)
              )
            )
          : this.createDocument(documentName, data, options?.parent ?? null, options),
      createDocuments: async (data, options) => {
        const created: FakeDocument[] = [];
        for (const entry of data)
          created.push(
            await this.createDocument(documentName, entry, options?.parent ?? null, options)
          );
        return created;
      },
      updateDocuments: async (updates, options) => {
        const collection = within(options);
        const targets = updates.map(update => {
          const target = collection.get(String(update['_id']));
          if (!target) throw new Error(`${documentName} "${String(update['_id'])}" does not exist`);
          return target;
        });
        const updated: FakeDocument[] = [];
        for (const [index, target] of targets.entries())
          updated.push(await target.update(updates[index] as DocumentData));
        return updated;
      },
      deleteDocuments: async (ids, options) => {
        const collection = within(options);
        const targets = ids.map(id => {
          const target = collection.get(id);
          if (!target) throw new Error(`${documentName} "${id}" does not exist`);
          return target;
        });
        const deleted: FakeDocument[] = [];
        for (const target of targets) deleted.push(await target.delete());
        return deleted;
      },
    };
  }

  /** Create through the recorded path, as a document class or an embedded create does. */
  async createDocument(
    documentName: string,
    data: DocumentData,
    parent: FakeDocument | null,
    options: DocumentData = {}
  ): Promise<FakeDocument> {
    const document = new FakeDocument(this, documentName, data, parent);
    this.recordWrite('create', document, document.toObject());
    (parent ? parent.getEmbeddedCollection(documentName) : this.collection(documentName)).set(
      document.id,
      document
    );
    this.hooks.callAll(`create${documentName}`, document, options, this.userId());
    return document;
  }

  /** Permission and interceptors first, then the record. Throws before anything changed. */
  recordWrite(action: WriteOperation['action'], document: FakeDocument, data?: DocumentData): void {
    const user = this.game.user;
    const operation: WriteOperation = {
      action,
      documentName: document.documentName,
      id: document.id,
      userId: user?.id ?? '',
    };
    if (document.parent) operation.parent = document.parent.uuid;
    if (data) operation.data = clone(data);
    if (!user?.isGM) {
      throw new Error(
        `User "${user?.name ?? 'nobody'}" lacks permission to ${action} ${document.documentName} [${document.id}]`
      );
    }
    for (const interceptor of this.#interceptors) interceptor(operation);
    this.operations.push(operation);
  }

  userId(): string {
    return this.#userId ?? '';
  }

  nextId(): string {
    this.#counter += 1;
    return `fake${String(this.#counter).padStart(12, '0')}`;
  }
}
