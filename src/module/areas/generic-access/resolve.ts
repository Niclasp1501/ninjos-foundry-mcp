/**
 * Finding document types, collections and documents for generic access.
 *
 * Types come from Foundry itself: every `CONFIG.<Name>.documentClass` whose
 * document name is its key. So a type a game system or a later Foundry adds is
 * found without a change here. A world collection is asked from
 * `game.collections` first and from `game[metadata.collection]` second.
 *
 * Writing only reaches live documents of the world. A compendium uuid, or a
 * pack, is read only: compendiums have their own release list and lock, kept
 * by the compendium tools, and generic access never goes around them.
 */
import {
  isPlainRecord,
  parsePath,
  PathError,
  type Data,
} from '../../../common/areas/generic-access/paths.js';
import { HIDDEN_FIELDS, REFUSED_TYPES } from '../../../common/areas/generic-access/rules.js';
import { QueryError } from '../../dispatcher.js';
import { requireWorld } from '../../world-ready.js';

export const COMPENDIUM_PREFIX = 'Compendium.';

export interface TypeInfo {
  name: string;
  /** Embedded document names and the field of this type that holds them. */
  embedded: Record<string, string>;
  isEmbedded: boolean;
  collectionName: string | null;
  documentClass: FoundryGenericAccessDocumentClass;
  config: FoundryGenericAccessConfigEntry;
}

export function invalid(message: string): QueryError {
  return new QueryError('INVALID_ARGUMENT', message);
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Every document type Foundry's CONFIG describes, by name. */
export function knownTypes(): Map<string, TypeInfo> {
  const types = new Map<string, TypeInfo>();
  const config = (typeof CONFIG === 'object' && CONFIG !== null ? CONFIG : {}) as Record<
    string,
    unknown
  >;
  for (const [key, raw] of Object.entries(config)) {
    if (!isPlainRecord(raw)) continue;
    const entry = raw as FoundryGenericAccessConfigEntry;
    const documentClass = entry.documentClass;
    if (
      !documentClass ||
      (typeof documentClass !== 'object' && typeof documentClass !== 'function')
    )
      continue;
    const name = documentClass.documentName ?? documentClass.metadata?.name;
    if (name !== key) continue;
    const metadata = documentClass.metadata ?? {};
    types.set(name, {
      name,
      embedded: { ...(metadata.embedded ?? {}) },
      isEmbedded: metadata.isEmbedded === true,
      collectionName: metadata.collection ?? null,
      documentClass,
      config: entry,
    });
  }
  return types;
}

export function typeInfo(input: string): TypeInfo {
  const types = knownTypes();
  const exact = types.get(input);
  if (exact) return exact;
  const folded = [...types.values()].filter(
    type => type.name.toLowerCase() === input.trim().toLowerCase()
  );
  if (folded.length === 1) return folded[0] as TypeInfo;
  if (!types.size) {
    throw new QueryError(
      'NOT_AVAILABLE',
      "Foundry's CONFIG describes no document classes, so no document type can be read."
    );
  }
  throw invalid(
    `"${input}" is not a document type of this Foundry. Known types: ${[...types.keys()].sort().join(', ')}.`
  );
}

export function refuseRead(documentName: string): void {
  const refusal = REFUSED_TYPES[documentName];
  if (refusal?.read) throw new QueryError('REFUSED', `${documentName}: ${refusal.reason}`);
}

export function refuseWrite(documentName: string): void {
  const refusal = REFUSED_TYPES[documentName];
  if (refusal) throw new QueryError('REFUSED', `${documentName}: ${refusal.reason}`);
}

/** Types that hold this one as an embedded document. */
export function parentsOf(documentName: string, types = knownTypes()): string[] {
  return [...types.values()]
    .filter(type => documentName in type.embedded)
    .map(type => type.name)
    .sort();
}

function isCollection(value: unknown): value is FoundryCollection<FoundryDocument> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { get?: unknown }).get === 'function' &&
    'contents' in value
  );
}

/** The world collection of a type, or null for a type that only lives inside other documents. */
export function worldCollection(info: TypeInfo): FoundryCollection<FoundryDocument> | null {
  const scope = game as unknown as Record<string, unknown> & {
    collections?: { get?(name: string): unknown };
  };
  const registered = scope.collections?.get?.(info.name);
  if (isCollection(registered)) return registered;
  if (info.isEmbedded || !info.collectionName) return null;
  const named = scope[info.collectionName];
  return isCollection(named) && (named as { documentName?: unknown }).documentName === info.name
    ? named
    : null;
}

/** The stored data of a document, index row or plain object. Read it, never change it. */
export function sourceOf(document: unknown): Data {
  const candidate = document as { _source?: unknown; toObject?: () => unknown } | null;
  if (isPlainRecord(candidate?._source)) return candidate._source;
  if (typeof candidate?.toObject === 'function') {
    const data = candidate.toObject();
    if (isPlainRecord(data)) return data;
  }
  return isPlainRecord(document) ? document : {};
}

/** A copy of the stored data, to compare before and after a write. */
export function snapshot(document: unknown): Data {
  return structuredClone(sourceOf(document));
}

/** The data without fields that are never shown. */
export function visible(documentName: string, data: Data): Data {
  const hidden = HIDDEN_FIELDS[documentName];
  if (!hidden?.some(field => field in data)) return data;
  const out = { ...data };
  for (const field of hidden) delete out[field];
  return out;
}

export function rootOf(document: FoundryDocument): FoundryDocument {
  let root = document;
  while (root.parent) root = root.parent;
  return root;
}

export function describeDocument(document: {
  documentName: string;
  name?: string;
  uuid: string;
}): string {
  return `${document.documentName}${document.name ? ` "${document.name}"` : ''} (${document.uuid})`;
}

// Arguments ---------------------------------------------------------------------------------------

export function argsOf(data: unknown): Data {
  if (data === undefined || data === null) return {};
  if (!isPlainRecord(data)) throw invalid('The query data must be an object');
  return data;
}

export function optionalText(args: Data, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !value.trim())
    throw invalid(`${key} must be a text that is not empty`);
  return value.trim();
}

export function requiredText(args: Data, key: string): string {
  const value = optionalText(args, key);
  if (value === undefined) throw invalid(`${key} is required`);
  return value;
}

export function optionalInteger(
  args: Data,
  key: string,
  min: number,
  max: number
): number | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
    throw invalid(
      `${key} must be a whole number from ${min} to ${max}, got ${JSON.stringify(value)}`
    );
  return value;
}

export function optionalTextList(args: Data, key: string): string[] | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string' || !entry.trim()))
    throw invalid(`${key} must be a list of texts that are not empty`);
  return value.map(entry => (entry as string).trim());
}

export function optionalRecord(args: Data, key: string): Data | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (!isPlainRecord(value)) throw invalid(`${key} must be an object`);
  return value;
}

/** Check a path given as an argument; a bad one is an invalid argument naming the parameter. */
export function checkedPath(path: string, parameter: string): string {
  try {
    parsePath(path);
  } catch (error) {
    if (error instanceof PathError) throw invalid(`${parameter}: ${error.message}`);
    throw error;
  }
  return path;
}

export interface TargetArgs {
  uuid?: string;
  documentType?: string;
  id?: string;
  parentUuid?: string;
  pack?: string;
}

export function targetArgs(args: Data): TargetArgs {
  const out: TargetArgs = {};
  for (const key of ['uuid', 'documentType', 'id', 'parentUuid', 'pack'] as const) {
    const value = optionalText(args, key);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

// Live documents ----------------------------------------------------------------------------------

function readOnlyCompendium(what: string): QueryError {
  return new QueryError(
    'READ_ONLY',
    `${what} is in a compendium. Generic access only reads compendiums; change them with export-to-compendium, ` +
      'import-from-compendium, organize-compendium or delete-compendium-entries, which keep the release list and the lock.'
  );
}

function embeddedCollection(
  parent: FoundryDocument,
  info: TypeInfo
): FoundryCollection<FoundryDocument> {
  const parentInfo = typeInfo(parent.documentName);
  if (!(info.name in parentInfo.embedded)) {
    const holds = Object.keys(parentInfo.embedded);
    throw invalid(
      `${describeDocument(parent)} holds no ${info.name} documents. ` +
        (holds.length ? `It holds: ${holds.join(', ')}.` : 'It holds no embedded documents.')
    );
  }
  return parent.getEmbeddedCollection(info.name);
}

export interface Container {
  collection: FoundryCollection<FoundryDocument>;
  parent: FoundryDocument | null;
  /** "in the world" or "in <document>". */
  where: string;
}

/** The live collection a type is read from or created in. */
export function liveContainer(info: TypeInfo, parentUuid?: string): Container {
  if (parentUuid) {
    if (parentUuid.startsWith(COMPENDIUM_PREFIX)) throw readOnlyCompendium(`"${parentUuid}"`);
    const parent = fromUuidSync(parentUuid);
    if (!parent)
      throw new QueryError('NOT_FOUND', `No document has the uuid "${parentUuid}" in this world.`);
    return {
      collection: embeddedCollection(parent, info),
      parent,
      where: `in ${describeDocument(parent)}`,
    };
  }
  const collection = worldCollection(info);
  if (!collection) {
    const parents = parentsOf(info.name);
    throw invalid(
      `${info.name} documents have no world collection` +
        (parents.length
          ? `; they live inside ${parents.join(' or ')} documents, so give parentUuid.`
          : '.')
    );
  }
  return { collection, parent: null, where: 'in the world' };
}

export interface LiveTarget {
  document: FoundryDocument;
  info: TypeInfo;
  parent: FoundryDocument | null;
  root: FoundryDocument;
}

/** A live document of the world, for reading or writing. */
export function resolveLive(target: TargetArgs): LiveTarget {
  requireWorld();
  if (target.pack) throw readOnlyCompendium(`The pack "${target.pack}"`);
  let document: FoundryDocument | null;
  if (target.uuid) {
    if (target.uuid.startsWith(COMPENDIUM_PREFIX)) throw readOnlyCompendium(`"${target.uuid}"`);
    document = fromUuidSync(target.uuid);
    if (!document)
      throw new QueryError('NOT_FOUND', `No document has the uuid "${target.uuid}" in this world.`);
    if (target.documentType) {
      const wanted = typeInfo(target.documentType).name;
      if (wanted !== document.documentName)
        throw invalid(`"${target.uuid}" is a ${document.documentName}, not a ${wanted}.`);
    }
  } else {
    if (!target.documentType || !target.id) {
      throw invalid(
        'Name the document with uuid, or with documentType and id (and parentUuid for an embedded document).'
      );
    }
    const info = typeInfo(target.documentType);
    const container = liveContainer(info, target.parentUuid);
    document = container.collection.get(target.id) ?? null;
    if (!document) {
      const named = container.collection.filter(entry => entry.name === target.id);
      throw new QueryError(
        'NOT_FOUND',
        `No ${info.name} has the id "${target.id}" ${container.where}.` +
          (named.length
            ? ` ${named.length === 1 ? `A ${info.name} is` : `${named.length} are`} named "${target.id}": ` +
              `id ${named.map(entry => entry.id).join(', ')}. Documents are addressed by id only.`
            : '')
      );
    }
  }
  return {
    document,
    info: typeInfo(document.documentName),
    parent: document.parent,
    root: rootOf(document),
  };
}

// Reading, compendiums included -------------------------------------------------------------------

export interface ReadTarget {
  documentName: string;
  id: string;
  uuid: string;
  name: string | null;
  data: Data;
  parentUuid: string | null;
  pack: string | null;
}

export function packOf(packId: string): FoundryCompendium {
  const pack = game.packs.get(packId);
  if (!pack) {
    throw new QueryError(
      'NOT_FOUND',
      `No compendium has the id "${packId}". list-compendiums shows the ids ("package.name").`
    );
  }
  return pack;
}

async function compendiumTarget(uuid: string): Promise<ReadTarget> {
  const parts = uuid.split('.');
  if (parts.length < 5 || parts.length % 2 === 0) {
    throw invalid(
      `"${uuid}" is not a compendium document uuid of the form Compendium.<package>.<pack>.<Type>.<id>.`
    );
  }
  const packId = `${parts[1]}.${parts[2]}`;
  const pack = packOf(packId);
  const type = parts[3] as string;
  const id = parts[4] as string;
  if (pack.documentName !== type)
    throw invalid(`The compendium ${packId} holds ${pack.documentName} documents, not ${type}.`);
  const loaded = await pack.getDocument(id);
  if (!loaded)
    throw new QueryError(
      'NOT_FOUND',
      `The compendium ${packId} has no ${type} with the id "${id}".`
    );
  let data = sourceOf(loaded);
  let documentName = type;
  let currentId = id;
  for (let index = 5; index < parts.length; index += 2) {
    const childType = parts[index] as string;
    const childId = parts[index + 1] as string;
    const field = typeInfo(documentName).embedded[childType];
    if (!field)
      throw invalid(`${documentName} documents hold no ${childType} documents ("${uuid}").`);
    const list = Array.isArray(data[field]) ? (data[field] as unknown[]) : [];
    const child = list.find(entry => isPlainRecord(entry) && entry['_id'] === childId);
    if (!isPlainRecord(child)) {
      throw new QueryError(
        'NOT_FOUND',
        `${parts.slice(0, index).join('.')} holds no ${childType} with the id "${childId}".`
      );
    }
    data = child;
    documentName = childType;
    currentId = childId;
  }
  return {
    documentName,
    id: currentId,
    uuid,
    name: typeof data['name'] === 'string' ? data['name'] : null,
    data: visible(documentName, data),
    parentUuid: parts.length > 5 ? parts.slice(0, -2).join('.') : null,
    pack: packId,
  };
}

/** One document for reading: live, or loaded from a compendium. */
export async function resolveForRead(target: TargetArgs): Promise<ReadTarget> {
  requireWorld();
  let uuid = target.uuid;
  if (!uuid && target.documentType && target.id) {
    const inPack = target.pack !== undefined || target.parentUuid?.startsWith(COMPENDIUM_PREFIX);
    if (inPack) {
      if (target.pack && target.parentUuid) throw invalid('Give pack or parentUuid, not both.');
      const info = typeInfo(target.documentType);
      if (target.parentUuid) {
        uuid = `${target.parentUuid}.${info.name}.${target.id}`;
      } else {
        const pack = packOf(target.pack as string);
        if (pack.documentName !== info.name)
          throw invalid(
            `The compendium ${pack.collection} holds ${pack.documentName} documents, not ${info.name}.`
          );
        uuid = `${COMPENDIUM_PREFIX}${pack.collection}.${info.name}.${target.id}`;
      }
    }
  }
  if (uuid?.startsWith(COMPENDIUM_PREFIX)) return await compendiumTarget(uuid);
  const live = resolveLive(
    uuid ? { uuid, ...(target.documentType ? { documentType: target.documentType } : {}) } : target
  );
  const document = live.document;
  return {
    documentName: document.documentName,
    id: document.id,
    uuid: document.uuid,
    name: document.name ?? null,
    data: visible(document.documentName, sourceOf(document)),
    parentUuid: document.parent?.uuid ?? null,
    pack: null,
  };
}

export interface Row {
  id: string;
  uuid: string;
  data: Data;
}

export interface Listing {
  rows: Row[];
  source: 'world' | 'embedded' | 'compendium';
  where: string;
}

/**
 * Every document a listing looks at. A compendium is read from its index,
 * asked for the fields the listing needs, so no document is loaded.
 */
export async function listRows(
  info: TypeInfo,
  target: { parentUuid?: string; pack?: string },
  indexFields: readonly string[]
): Promise<Listing> {
  if (target.pack && target.parentUuid) throw invalid('Give pack or parentUuid, not both.');
  if (target.pack) {
    const pack = packOf(target.pack);
    if (pack.documentName !== info.name)
      throw invalid(
        `The compendium ${pack.collection} holds ${pack.documentName} documents, not ${info.name}.`
      );
    const index = (await pack.getIndex({ fields: [...indexFields] })) as {
      values(): Iterable<unknown>;
    };
    const rows = [...index.values()].filter(isPlainRecord).map(row => ({
      id: String(row['_id']),
      uuid: `${COMPENDIUM_PREFIX}${pack.collection}.${info.name}.${String(row['_id'])}`,
      data: row,
    }));
    return { rows, source: 'compendium', where: `in the compendium ${pack.collection}` };
  }
  if (target.parentUuid?.startsWith(COMPENDIUM_PREFIX)) {
    const parent = await compendiumTarget(target.parentUuid);
    const field = typeInfo(parent.documentName).embedded[info.name];
    if (!field) throw invalid(`${parent.documentName} documents hold no ${info.name} documents.`);
    const list = Array.isArray(parent.data[field]) ? (parent.data[field] as unknown[]) : [];
    const rows = list.filter(isPlainRecord).map(entry => ({
      id: String(entry['_id']),
      uuid: `${parent.uuid}.${info.name}.${String(entry['_id'])}`,
      data: visible(info.name, entry),
    }));
    return { rows, source: 'compendium', where: `in ${parent.documentName} ${parent.uuid}` };
  }
  const container = liveContainer(info, target.parentUuid);
  const rows = container.collection.contents.map(document => ({
    id: document.id,
    uuid: document.uuid,
    data: visible(info.name, sourceOf(document)),
  }));
  return { rows, source: container.parent ? 'embedded' : 'world', where: container.where };
}
