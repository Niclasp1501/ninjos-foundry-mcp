/**
 * manage-world-items on the module side: createWorldItems, listWorldItems,
 * updateWorldItems, addActorItems, removeActorItems, getSystemSchema.
 *
 * World items follow the core rule for items:
 * creating and changing need the write switch, deleting world items is not
 * offered here. Items on an actor are part of the actor, so adding needs the
 * actor level "write" and removing the level "full".
 */
import { smallEnough } from '../../../common/change-log.js';
import { QueryError, type QueryHandler } from '../../dispatcher.js';
import { folderPathOf } from '../../folders.js';
import { systemAnswer } from '../../game-systems.js';
import { requireWorld } from '../../world-ready.js';
import {
  describeDocuments,
  documentClass,
  expandDotted,
  idOf,
  inputOf,
  invalid,
  isRecord,
  items,
  messageOf,
  mismatches,
  quoteList,
  records,
  requireValidTypes,
  textList,
  textOf,
  validTypes,
} from './common.js';
import { resolveFolder, type ResolvedFolder } from './folders.js';
import { findActor } from './lookup.js';
import { removeItems } from './actors-write.js';

type Data = Record<string, unknown>;
const TOOL = 'manage-world-items';

function itemData(entry: Data, index: number, field: string, full: boolean): Data {
  const name = textOf(entry['name']);
  const type = textOf(entry['type']);
  if (!name || !type) throw invalid(`${field}[${index}] needs a name and a type.`);
  const out: Data = { name, type };
  if (typeof entry['img'] === 'string' && entry['img']) out['img'] = entry['img'];
  if (isRecord(entry['system'])) out['system'] = expandDotted(entry['system']);
  if (full && Array.isArray(entry['effects'])) out['effects'] = entry['effects'];
  if (full && isRecord(entry['flags'])) out['flags'] = entry['flags'];
  return out;
}

function itemFolders(): FoundryActorsFolder[] {
  return (game.folders.contents as unknown as FoundryActorsFolder[]).filter(
    folder => folder.type === 'Item'
  );
}

export const createWorldItems: QueryHandler = {
  access: { kind: 'write', document: 'Items', action: 'create' },
  run: async (data, context) => {
    requireWorld();
    const input = inputOf(data);
    const list = records(input['items']);
    if (!list.length) throw invalid('items needs at least one entry with name and type.');
    const prepared = list.map((entry, index) => itemData(entry, index, 'items', true));
    requireValidTypes(
      'Item',
      prepared.map(entry => entry['type'] as string)
    );

    const given = textOf(input['folder']);
    const folder: ResolvedFolder = given
      ? await resolveFolder(given, 'Item', { context, query: 'createWorldItems', tool: TOOL })
      : { id: null, path: '', created: [] };
    for (const entry of prepared) entry['folder'] = folder.id;

    const ItemClass = documentClass('Item');
    let made: unknown[];
    try {
      made = ItemClass.createDocuments
        ? await ItemClass.createDocuments(prepared)
        : [await ItemClass.create(prepared[0] as Data)];
    } catch (error) {
      throw new QueryError('NOT_CREATED', `The items could not be created: ${messageOf(error)}`);
    }
    const created = made.map(document => items().get(idOf(document) ?? ''));
    if (created.length !== prepared.length || created.some(item => !item)) {
      throw new QueryError(
        'NOT_APPLIED',
        `${prepared.length} item(s) were written, but only ${created.filter(Boolean).length} are in the world when read back.`
      );
    }
    const result = (created as FoundryActorsItem[]).map(item => ({
      id: item.id,
      name: item.name,
      type: item.type,
    }));
    context.recordChange({
      query: 'createWorldItems',
      tool: TOOL,
      document: 'Items',
      action: 'create',
      targets: result.map(item => ({ id: item.id, name: item.name })),
      summary: `Created ${result.length} world item(s)${folder.path ? ` in folder "${folder.path}"` : ''}.`,
    });
    return {
      folderId: folder.id,
      folderName: folder.path ? (folder.path.split('/').pop() ?? null) : null,
      folderPath: folder.path || null,
      created: result,
      total: result.length,
      createdFolders: folder.created,
    };
  },
};

export const listWorldItems: QueryHandler = {
  access: { kind: 'read' },
  run: data => {
    requireWorld();
    const input = inputOf(data);
    const type = textOf(input['type']);
    const folderGiven = textOf(input['folder']);
    const nameFilter = textOf(input['nameFilter']).toLowerCase();

    let folderId: string | null = null;
    if (folderGiven) {
      const folders = itemFolders();
      const byId = folders.find(folder => folder.id === folderGiven);
      const named = byId ? [byId] : folders.filter(folder => folder.name === folderGiven);
      if (named.length > 1) {
        throw new QueryError(
          'AMBIGUOUS',
          `${named.length} item folders are named "${folderGiven}": ${named
            .map(folder => `"${folderPathOf(folder.id).path}" (id ${folder.id})`)
            .join(', ')}. Pass the id instead.`
        );
      }
      if (!named[0]) {
        throw new QueryError(
          'NOT_FOUND',
          `Item folder "${folderGiven}" not found. Item folders: ${folders.length ? quoteList(folders.map(folder => folder.name)) : 'none'}.`
        );
      }
      folderId = named[0].id;
    }

    // A bare list, as servers of either generation read it.
    return items()
      .filter(
        item =>
          (!type || item.type === type) &&
          (!folderId || idOf(item.folder) === folderId) &&
          (!nameFilter || (item.name ?? '').toLowerCase().includes(nameFilter))
      )
      .map(item => {
        const folder = idOf(item.folder);
        return {
          id: item.id,
          name: item.name,
          type: item.type,
          img: item.img ?? null,
          folder: folder ? (game.folders.get(folder)?.name ?? null) : null,
        };
      });
  },
};

export const updateWorldItems: QueryHandler = {
  access: { kind: 'write', document: 'Items', action: 'update' },
  run: async (data, context) => {
    requireWorld();
    const updates = records(inputOf(data)['updates']);
    if (!updates.length) throw invalid('updates needs at least one entry with id.');
    const ids = updates.map((entry, index) => {
      const id = textOf(entry['id']);
      if (!id) throw invalid(`updates[${index}].id is required.`);
      return id;
    });
    if (new Set(ids).size !== ids.length)
      throw invalid('updates names an item twice; merge the changes.');
    const missing = ids.filter(id => !items().get(id));
    if (missing.length) {
      throw new QueryError(
        'NOT_FOUND',
        `World item id(s) ${quoteList(missing)} not found. Nothing was changed, and no folder was created.`
      );
    }
    for (const [index, entry] of updates.entries()) {
      if (!['name', 'img', 'system', 'folder'].some(key => entry[key] !== undefined))
        throw invalid(`updates[${index}] changes nothing; give name, img, system or folder.`);
    }

    const createdFolders: ResolvedFolder['created'] = [];
    const plans: Array<{ item: FoundryActorsItem; changes: Data }> = [];
    for (const entry of updates) {
      const item = items().get(textOf(entry['id'])) as FoundryActorsItem;
      const changes: Data = {};
      if (typeof entry['name'] === 'string' && entry['name'].trim())
        changes['name'] = entry['name'].trim();
      if (typeof entry['img'] === 'string') changes['img'] = entry['img'];
      if (isRecord(entry['system'])) changes['system'] = expandDotted(entry['system']);
      const folder = textOf(entry['folder']);
      if (folder) {
        const resolved = await resolveFolder(folder, 'Item', {
          context,
          query: 'updateWorldItems',
          tool: TOOL,
        });
        createdFolders.push(...resolved.created);
        changes['folder'] = resolved.id;
      }
      plans.push({ item, changes });
    }

    const done: string[] = [];
    const updated: Data[] = [];
    for (const { item, changes } of plans) {
      const before = item.toObject();
      try {
        await item.update(changes);
      } catch (error) {
        throw new QueryError(
          'WRITE_FAILED',
          `Updating item "${item.name}" (${item.id}) failed: ${messageOf(error)}. ` +
            (done.length
              ? `Already changed before it, and still changed: ${quoteList(done)}.`
              : 'No item was changed.')
        );
      }
      const after = (items().get(item.id) ?? item).toObject();
      done.push(item.name);
      updated.push({ id: item.id, name: after['name'], mismatches: mismatches(changes, after) });
      context.recordChange({
        query: 'updateWorldItems',
        tool: TOOL,
        document: 'Items',
        action: 'update',
        targets: [{ id: item.id, uuid: item.uuid, name: item.name }],
        summary: `Updated world item "${item.name}".`,
        before,
        after,
      });
    }
    return { updated, total: updated.length, createdFolders };
  },
};

export const addActorItems: QueryHandler = {
  access: { kind: 'write', document: 'Actors', action: 'update' },
  run: async (data, context) => {
    requireWorld();
    const input = inputOf(data);
    const identifier = textOf(input['actorIdentifier']);
    if (!identifier) throw invalid('actorIdentifier is required: an actor id or its exact name.');
    const { actor } = findActor(identifier);
    const list = records(input['items']);
    if (!list.length) throw invalid('items needs at least one entry with name and type.');
    const prepared = list.map((entry, index) => itemData(entry, index, 'items', false));
    requireValidTypes(
      'Item',
      prepared.map(entry => entry['type'] as string)
    );

    let made: FoundryDocument[];
    try {
      made = await actor.createEmbeddedDocuments('Item', prepared);
    } catch (error) {
      throw new QueryError(
        'NOT_CREATED',
        `The items could not be added to "${actor.name}": ${messageOf(error)}`
      );
    }
    const created = made.map(document => actor.items.get(document.id));
    if (created.length !== prepared.length || created.some(item => !item)) {
      throw new QueryError(
        'NOT_APPLIED',
        `${prepared.length} item(s) were written to "${actor.name}", but only ${created.filter(Boolean).length} are on it when read back.`
      );
    }
    const result = (created as FoundryActorsItem[]).map(item => ({
      id: item.id,
      name: item.name,
      type: item.type,
    }));
    // Logged as a create of the embedded items with their data, so undo-change removes exactly
    // these items while they are unchanged. An update of the
    // actor without its state before could never be undone.
    context.recordChange({
      query: 'addActorItems',
      tool: TOOL,
      document: 'Actors',
      action: 'create',
      targets: (created as FoundryActorsItem[]).map(item => ({
        id: item.id,
        uuid: item.uuid,
        name: item.name,
        documentName: 'Item',
      })),
      summary: `Added ${result.length} item(s) to actor "${actor.name}" (id ${actor.id}).`,
      after: smallEnough((created as FoundryActorsItem[]).map(item => item.toObject())),
    });
    return { actorId: actor.id, actorName: actor.name, created: result, total: result.length };
  },
};

export const removeActorItems: QueryHandler = {
  access: { kind: 'write', document: 'Actors', action: 'delete' },
  run: async (data, context) => {
    requireWorld();
    const input = inputOf(data);
    const identifier = textOf(input['actorIdentifier']);
    if (!identifier) throw invalid('actorIdentifier is required: an actor id or its exact name.');
    const { actor } = findActor(identifier);
    const ids = [...new Set(textList(input['itemIds']))];
    const names = [...new Set(textList(input['itemNames']))];
    const type = textOf(input['type']).toLowerCase();
    if (!ids.length && !names.length) throw invalid('Give itemIds or itemNames (or both).');

    const targets = new Map<string, FoundryActorsItem>();
    const notFound: string[] = [];
    for (const id of ids) {
      const item = actor.items.get(id);
      if (item) targets.set(item.id, item);
      else notFound.push(id);
    }
    for (const name of names) {
      const lower = name.toLowerCase();
      const matching = actor.items.filter(
        item =>
          (item.name ?? '').toLowerCase() === lower && (!type || item.type.toLowerCase() === type)
      );
      if (matching.length > 1) {
        throw new QueryError(
          'AMBIGUOUS',
          `${matching.length} items on "${actor.name}" are named "${name}"${type ? ` with type "${type}"` : ''}: ` +
            `${describeDocuments(matching)}. Nothing was deleted; pass itemIds or a type.`
        );
      }
      if (matching[0]) targets.set(matching[0].id, matching[0]);
      else notFound.push(name);
    }
    if (!targets.size) {
      throw new QueryError(
        'NOT_FOUND',
        `None of ${quoteList([...ids, ...names])} is on actor "${actor.name}" (id ${actor.id}); nothing was deleted.`
      );
    }
    return removeItems(
      context,
      'removeActorItems',
      actor,
      [...targets.values()],
      notFound,
      'removed'
    );
  },
};

export const getSystemSchema: QueryHandler = {
  access: { kind: 'read' },
  run: () => {
    requireWorld();
    const answer = systemAnswer('worldItems');
    const system = answer.system;
    let enums: Record<string, Record<string, readonly string[]>> = {};
    let problem: string | null = null;
    try {
      // Read through globalThis: before Foundry set it up, CONFIG is not defined at all.
      enums = answer.questions.enums((globalThis as { CONFIG?: unknown }).CONFIG);
    } catch (error) {
      problem = `The adapter could not read the enumerated values: ${messageOf(error)}`;
    }
    const note = answer.questions.note?.() ?? null;
    return {
      system: system.rawId,
      adapter: system.adapter?.id ?? null,
      fromAdapter: answer.fromAdapter,
      itemTypes: validTypes('Item'),
      enums,
      message:
        [note, problem].filter(Boolean).join(' ') ||
        `Enumerated values from the adapter "${system.title}".`,
    };
  },
};
