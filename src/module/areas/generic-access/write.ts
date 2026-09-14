/**
 * createDocument, updateDocument, deleteDocument: writing any document type.
 *
 * The order is the same on every path:
 *
 * 1. The dispatcher decides switch and permission level before the handler
 *    runs. The kind is the one of the outermost document: a page counts as
 *    its journal, an item on an actor as the actor. Creating or changing an
 *    embedded document is a change of that document; deleting one needs the
 *    full level of that kind. A kind the permission settings do not know
 *    (combats, chat messages) follows the core rule for kinds without a level.
 * 2. The handler plans the result without writing, then checks the protected
 *    fields and the rules a specialised tool keeps. A dry run stops here and
 *    reports everything that would refuse the call.
 * 3. One write, then reading back. Success is only what reading back shows;
 *    the answer is the actual difference, and a requested value Foundry
 *    stored differently is named.
 * 4. The change log gets the state before and after.
 */
import { smallEnough, type ChangeTarget } from '../../../common/change-log.js';
import { MODULE_ID } from '../../../common/constants.js';
import {
  diffValues,
  isPlainRecord,
  PathError,
  planUpdate,
  readPath,
  reportDiff,
  reportValue,
  sameJson,
  type Data,
  type DiffEntry,
  type UpdatePlan,
} from '../../../common/areas/generic-access/paths.js';
import {
  protectedFieldProblems,
  REFUSED_CREATE,
  specialisedToolsFor,
} from '../../../common/areas/generic-access/rules.js';
import {
  DOCUMENT_KIND_OF,
  WRITE_SWITCH_ONLY,
  writeSwitchOn,
  type Access,
  type AccessRule,
  type DocumentKind,
  type WriteAction,
} from '../../../common/permissions.js';
import { afterWriteWarning, settleWrite } from '../../client-errors.js';
import { QueryError, type HandlerContext, type QueryHandler } from '../../dispatcher.js';
import { folderCreationFlags } from '../../folders.js';
import { readSetting } from '../../settings.js';
import { requireWorld } from '../../world-ready.js';
import { validTypes } from '../actors/common.js';
import {
  argsOf,
  describeDocument,
  invalid,
  liveContainer,
  messageOf,
  optionalRecord,
  optionalTextList,
  refuseWrite,
  requiredText,
  resolveLive,
  rootOf,
  snapshot,
  sourceOf,
  targetArgs,
  typeInfo,
  worldCollection,
  type LiveTarget,
  type TypeInfo,
} from './resolve.js';

const READ: Access = { kind: 'read' };

/** The switch and nothing else, for kinds the permission settings do not know. */
const SWITCH_ONLY: Access = WRITE_SWITCH_ONLY;

export function unknownKindDeleteRefusal(rootName: string): string {
  return (
    `Deleting ${rootName} documents is not permitted. ${rootName} documents have no level of their own in the ` +
    'permission settings yet, and deleting needs the level "create, change and delete", so it stays off.'
  );
}

/**
 * The accesses of one write. `embedded` says the document lives inside
 * `rootName`; creating or changing it then changes the root.
 */
export function writeAccesses(rootName: string, embedded: boolean, action: WriteAction): Access[] {
  const effective: WriteAction = embedded && action !== 'delete' ? 'update' : action;
  const kind = DOCUMENT_KIND_OF[rootName];
  if (kind) return [{ kind: 'write', document: kind, action: effective }];
  if (effective !== 'delete') return [SWITCH_ONLY];
  throw new QueryError('PERMISSION_DENIED', unknownKindDeleteRefusal(rootName));
}

/**
 * The kind a change is logged under. A kind the core does not know (Combat, a
 * type a game system adds) is named after its document: the log type allows
 * only known kinds, but a made-up known kind would be the lie.
 */
function logKind(rootName: string): DocumentKind {
  return DOCUMENT_KIND_OF[rootName] ?? (`${rootName}s` as unknown as DocumentKind);
}

interface Placement {
  info: TypeInfo;
  parent: FoundryDocument | null;
  rootName: string;
  where: string;
}

function placeCreate(args: Data): Placement {
  requireWorld();
  const info = typeInfo(requiredText(args, 'documentType'));
  refuseWrite(info.name);
  const noCreate = REFUSED_CREATE[info.name];
  if (noCreate) throw new QueryError('REFUSED', `${info.name}: ${noCreate}`);
  const target = targetArgs(args);
  if (target.pack) resolveLive({ pack: target.pack });
  const container = liveContainer(info, target.parentUuid);
  return {
    info,
    parent: container.parent,
    rootName: container.parent ? rootOf(container.parent).documentName : info.name,
    where: container.where,
  };
}

function placeExisting(args: Data): LiveTarget {
  const given = targetArgs(args);
  // A refused type is named as refused before it is looked up.
  if (given.documentType) refuseWrite(typeInfo(given.documentType).name);
  const target = resolveLive(given);
  refuseWrite(target.info.name);
  return target;
}

function ruleFor(action: WriteAction): AccessRule {
  return data => {
    const args = argsOf(data);
    if (args['dryRun'] === true) return READ;
    // The switch is named first, as everywhere, before anything is looked up.
    if (!writeSwitchOn(readSetting)) return SWITCH_ONLY;
    if (action === 'create') {
      const placement = placeCreate(args);
      return writeAccesses(placement.rootName, placement.parent !== null, 'create');
    }
    const target = placeExisting(args);
    return writeAccesses(target.root.documentName, target.parent !== null, action);
  };
}

/** For a dry run: the refusal switch and permission level would give, or null. */
function permissionProblem(
  context: HandlerContext,
  rootName: string,
  embedded: boolean,
  action: WriteAction
): string | null {
  try {
    return context.accessProblem(writeAccesses(rootName, embedded, action));
  } catch (error) {
    return messageOf(error);
  }
}

function targetOf(document: FoundryDocument): ChangeTarget {
  return {
    id: document.id,
    uuid: document.uuid,
    documentName: document.documentName,
    ...(document.name ? { name: document.name } : {}),
  };
}

function ownMessageProblem(info: TypeInfo, data: Data, verb: string): string | null {
  if (info.name !== 'ChatMessage') return null;
  const author = data['author'];
  if (author === game.user?.id) return null;
  return (
    `Only chat messages written by the Gamemaster the bridge runs as can be ${verb}; this one was written by ` +
    `the user "${String(author)}". Changing someone else's message would put words in their mouth.`
  );
}

/**
 * The protected fields of a new document and of every embedded document given
 * with it (the items of a new actor, the pages of a new journal), each under
 * the rules of its own type.
 */
function createProblems(info: TypeInfo, data: Data, at = 'data'): string[] {
  const problems = protectedFieldProblems(info.name, 'create', {}, data).map(problem =>
    at === 'data' ? problem : `${at}: ${problem}`
  );
  for (const [childName, field] of Object.entries(info.embedded)) {
    const list = data[field];
    if (!Array.isArray(list)) continue;
    let child: TypeInfo;
    try {
      child = typeInfo(childName);
    } catch {
      continue;
    }
    list.forEach((entry, index) => {
      if (isPlainRecord(entry))
        problems.push(...createProblems(child, entry, `${at}.${field}.${index}`));
    });
  }
  return problems;
}

function checkCreateKeys(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => checkCreateKeys(entry, `${path}[${index}]`));
    return;
  }
  if (!isPlainRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (key.includes('.') || key.startsWith('-=')) {
      throw invalid(
        `${path}.${key}: data for a new document is written as nested objects, without dotted keys or "-=".`
      );
    }
    checkCreateKeys(entry, `${path}.${key}`);
  }
}

function checkFolder(info: TypeInfo, data: Data): void {
  const folder = data['folder'];
  if (folder === undefined || folder === null) return;
  if (typeof folder !== 'string') throw invalid('data.folder must be the id of a folder');
  const found = game.folders.get(folder);
  if (!found) {
    const named = game.folders.filter(entry => entry.name === folder);
    throw invalid(
      `data.folder "${folder}" is not the id of a folder in this world.` +
        (named.length
          ? ` A folder is named so: id ${named.map(entry => entry.id).join(', ')}.`
          : '')
    );
  }
  const type = sourceOf(found)['type'];
  if (type !== info.name)
    throw invalid(
      `Folder "${found.name ?? folder}" (${folder}) holds ${String(type)} documents, not ${info.name}.`
    );
}

function checkType(info: TypeInfo, data: Data): void {
  const type = data['type'];
  if (type === undefined) return;
  const valid = validTypes(info.name);
  if (valid && (typeof type !== 'string' || !valid.includes(type))) {
    throw invalid(
      `"${String(type)}" is not a ${info.name} type of the game system "${game.system?.id ?? 'unknown'}". Types: ${valid.join(', ')}.`
    );
  }
}

interface Leaf {
  path: string;
  value: unknown;
}

/** The values a caller gave, down to texts, numbers and empty objects; list entries by position. */
function leavesOf(value: unknown, path: string, out: Leaf[] = []): Leaf[] {
  if (isPlainRecord(value) && Object.keys(value).length) {
    for (const [key, entry] of Object.entries(value))
      leavesOf(entry, path ? `${path}.${key}` : key, out);
  } else if (
    Array.isArray(value) &&
    value.some(entry => isPlainRecord(entry) || Array.isArray(entry))
  ) {
    value.forEach((entry, index) => leavesOf(entry, `${path}.${index}`, out));
  } else {
    out.push({ path, value });
  }
  return out;
}

function storedDifferently(requested: readonly Leaf[], after: Data): Data[] {
  const out: Data[] = [];
  for (const leaf of requested) {
    const hit = readPath(after, leaf.path);
    if (hit.found && sameJson(hit.value, leaf.value)) continue;
    out.push({
      path: leaf.path,
      requested: reportValue(leaf.value, 400),
      ...(hit.found ? { stored: reportValue(hit.value, 400) } : { stored: '(nothing)' }),
    });
  }
  return out;
}

function isStats(entry: DiffEntry): boolean {
  return entry.path === '_stats' || entry.path.startsWith('_stats.');
}

export const createDocument: QueryHandler = {
  access: ruleFor('create'),
  run: async (data, context) => {
    const args = argsOf(data);
    const placement = placeCreate(args);
    const { info, parent, where } = placement;
    const input = optionalRecord(args, 'data');
    if (!input) throw invalid('data is required: the fields of the new document');
    checkCreateKeys(input, 'data');
    const dryRun = args['dryRun'] === true;

    const refused: string[] = [];
    if (dryRun) {
      const problem = permissionProblem(context, placement.rootName, parent !== null, 'create');
      if (problem) refused.push(problem);
    }
    refused.push(...createProblems(info, input));
    if (!parent) checkFolder(info, input);
    checkType(info, input);
    const specialisedTools = specialisedToolsFor(info.name);

    if (dryRun) {
      return {
        dryRun: true,
        allowed: refused.length === 0,
        refused,
        documentName: info.name,
        where,
        parentUuid: parent?.uuid ?? null,
        wouldCreate: Object.fromEntries(
          Object.entries({
            name: input['name'],
            type: input['type'],
            folder: input['folder'],
          }).filter(([, value]) => value !== undefined)
        ),
        dataChars: JSON.stringify(input).length,
        specialisedTools,
      };
    }
    if (refused.length)
      throw new QueryError('PROTECTED', `Nothing was created. ${refused.join(' ')}`);

    // The same markers the folder helper writes, so a later clean-up finds one set of flags.
    const payload = structuredClone(input);
    const flags = isPlainRecord(payload['flags']) ? payload['flags'] : {};
    flags[MODULE_ID] = folderCreationFlags();
    payload['flags'] = flags;

    const collection = parent ? parent.getEmbeddedCollection(info.name) : worldCollection(info);
    const idsBefore = new Set(collection ? collection.map(entry => entry.id) : []);
    const attempt = await settleWrite(async () => {
      if (parent) return (await parent.createEmbeddedDocuments(info.name, [payload]))[0];
      const documentClass = info.documentClass;
      if (typeof documentClass.create !== 'function')
        throw new QueryError(
          'NOT_AVAILABLE',
          `Foundry offers no way to create ${info.name} documents.`
        );
      return documentClass.create(payload);
    });
    if (attempt.error instanceof QueryError) throw attempt.error;

    let fresh: FoundryDocument | undefined;
    if (attempt.threw) {
      // Foundry's client code can throw after the server created it (a placeable without a canvas): look.
      const appeared = collection ? collection.filter(entry => !idsBefore.has(entry.id)) : [];
      if (appeared.length !== 1)
        throw new QueryError(
          'WRITE_FAILED',
          `Foundry refused to create the ${info.name} ${where}: ${messageOf(attempt.error)}` +
            (appeared.length > 1
              ? `. Reading back finds ${appeared.length} new ${info.name} documents (${appeared
                  .map(entry => entry.id)
                  .join(', ')}), so which one is this call's is unclear; look with get-document.`
              : '')
        );
      fresh = appeared[0];
    } else {
      const createdId = (attempt.value as { id?: unknown } | undefined)?.id;
      fresh = typeof createdId === 'string' ? collection?.get(createdId) : undefined;
    }
    if (!fresh) {
      throw new QueryError(
        'NOT_APPLIED',
        `Foundry created no ${info.name} ${where} that can be read back; a hook of the game system or another module may have stopped it.`
      );
    }
    const after = snapshot(fresh);
    const differently = storedDifferently(leavesOf(input, ''), after);

    const label = describeDocument(fresh);
    context.recordChange({
      query: 'createDocument',
      tool: 'create-document',
      document: logKind(placement.rootName),
      action: 'create',
      targets: [targetOf(fresh)],
      summary: `Created ${label} ${where} through generic access.`,
      after: smallEnough(after),
    });

    return {
      created: true,
      documentName: info.name,
      id: fresh.id,
      uuid: fresh.uuid,
      name: fresh.name ?? null,
      type: typeof after['type'] === 'string' ? after['type'] : null,
      where,
      parentUuid: parent?.uuid ?? null,
      storedDifferently: differently.slice(0, 50),
      warnings: [
        ...(attempt.threw
          ? [
              afterWriteWarning(
                attempt.error,
                'Read back, the document exists, and its creation is recorded.'
              ),
            ]
          : []),
        ...(differently.length
          ? [
              `${differently.length} given value(s) are stored differently: Foundry's data model cast, cleaned or dropped them (see storedDifferently).`,
            ]
          : []),
      ],
      specialisedTools,
    };
  },
};

export const updateDocument: QueryHandler = {
  access: ruleFor('update'),
  run: async (data, context) => {
    const args = argsOf(data);
    const { document, info, parent, root } = placeExisting(args);
    const changes = optionalRecord(args, 'changes') ?? {};
    const replace = optionalTextList(args, 'replace') ?? [];
    const remove = optionalTextList(args, 'remove') ?? [];
    if (!Object.keys(changes).length && !remove.length)
      throw invalid('Give changes, remove or both; as it is, there is nothing to change.');
    const dryRun = args['dryRun'] === true;
    const label = describeDocument(document);

    const before = snapshot(document);
    let plan: UpdatePlan;
    try {
      plan = planUpdate(before, { changes, replace, remove });
    } catch (error) {
      if (error instanceof PathError)
        throw invalid(`Nothing was changed in ${label}: ${error.message}.`);
      throw error;
    }

    const refused: string[] = [];
    if (dryRun) {
      const problem = permissionProblem(context, root.documentName, parent !== null, 'update');
      if (problem) refused.push(problem);
    }
    refused.push(
      ...protectedFieldProblems(info.name, 'update', before, plan.expected, info.embedded)
    );
    const own = ownMessageProblem(info, before, 'changed');
    if (own) refused.push(own);

    const base = {
      documentName: info.name,
      id: document.id,
      uuid: document.uuid,
      name: document.name ?? null,
      specialisedTools: specialisedToolsFor(info.name),
    };
    if (plan.diff.length === 0) {
      return {
        ...base,
        ...(dryRun ? { dryRun: true, allowed: refused.length === 0, refused } : {}),
        changed: false,
        note: `${label} already holds these values; nothing ${dryRun ? 'would be' : 'was'} written.`,
      };
    }
    if (dryRun) {
      const preview = reportDiff(plan.diff);
      return {
        ...base,
        dryRun: true,
        allowed: refused.length === 0,
        refused,
        changed: false,
        wouldChange: preview.entries,
        omitted: preview.omitted,
        update: reportValue(plan.changes, 4000),
      };
    }
    if (refused.length)
      throw new QueryError('PROTECTED', `Nothing was changed in ${label}. ${refused.join(' ')}`);

    // A throw can come after the server stored the update: what reading back shows decides.
    const attempt = await settleWrite(() => document.update(plan.changes));
    if (attempt.threw) {
      const now = fromUuidSync(document.uuid);
      const changedAnyway = now
        ? diffValues(before, snapshot(now)).filter(entry => !isStats(entry))
        : [];
      if (!changedAnyway.length)
        throw new QueryError(
          'WRITE_FAILED',
          `Foundry refused the update of ${label}: ${messageOf(attempt.error)}. Reading back shows no change.`
        );
    }

    const fresh = fromUuidSync(document.uuid);
    if (!fresh)
      throw new QueryError(
        'NOT_APPLIED',
        `${label} was updated, but reading it back finds no document with that uuid.`
      );
    const after = snapshot(fresh);
    const actual = diffValues(before, after).filter(entry => !isStats(entry));
    const notApplied = plan.diff
      .filter(entry => {
        const hit = readPath(after, entry.path);
        return entry.after === undefined
          ? hit.found && hit.value !== undefined
          : !hit.found || !sameJson(hit.value, entry.after);
      })
      .map(entry => {
        const hit = readPath(after, entry.path);
        return {
          path: entry.path,
          requested: entry.after === undefined ? '(removed)' : reportValue(entry.after, 400),
          stored: hit.found ? reportValue(hit.value, 400) : '(nothing)',
        };
      });
    if (!actual.length) {
      throw new QueryError(
        'NOT_APPLIED',
        `Foundry accepted the update of ${label}, but reading it back shows no change. Not applied: ` +
          `${notApplied
            .map(entry => entry.path)
            .slice(0, 20)
            .join(', ')}.`
      );
    }

    context.recordChange({
      query: 'updateDocument',
      tool: 'update-document',
      document: logKind(root.documentName),
      action: 'update',
      targets: [targetOf(fresh)],
      summary: `Changed ${actual.length} field(s) of ${label} through generic access.`,
      before: smallEnough(before),
      after: smallEnough(after),
    });
    const report = reportDiff(actual);
    return {
      ...base,
      updated: true,
      changed: true,
      changes: report.entries,
      omitted: report.omitted,
      notApplied: notApplied.slice(0, 50),
      warnings: [
        ...(attempt.threw
          ? [
              afterWriteWarning(
                attempt.error,
                'Read back, the changes listed here are stored and recorded.'
              ),
            ]
          : []),
        ...(notApplied.length
          ? [
              `${notApplied.length} requested value(s) are stored differently than asked: Foundry's data model cast, cleaned or ignored them (see notApplied).`,
            ]
          : []),
      ],
    };
  },
};

function describeList(documents: readonly FoundryDocument[]): string {
  return documents
    .slice(0, 10)
    .map(document => `"${document.name ?? document.id}" (${document.id})`)
    .join(', ');
}

/** The rules specialised tools keep before deleting. */
function deleteProblems(info: TypeInfo, document: FoundryDocument, before: Data): string[] {
  const problems: string[] = [];
  const id = document.id;
  const label = describeDocument(document);
  if (info.name === 'Folder') {
    const subfolders = game.folders.filter(folder => sourceOf(folder)['folder'] === id);
    const type = before['type'];
    let contents: FoundryDocument[] | null = null;
    try {
      const collection = typeof type === 'string' ? worldCollection(typeInfo(type)) : null;
      contents = collection ? collection.filter(entry => sourceOf(entry)['folder'] === id) : null;
    } catch {
      contents = null;
    }
    if (contents === null) {
      problems.push(
        `${label} holds ${String(type)} entries, which generic access cannot count; delete it with folder-delete or in Foundry.`
      );
    } else if (subfolders.length || contents.length) {
      problems.push(
        `${label} still holds ${subfolders.length} subfolder(s) and ${contents.length} ${String(type)} document(s). ` +
          'Use folder-delete, which moves or deletes the contents under the levels of their kinds, or empty the folder first.'
      );
    }
  }
  if (info.name === 'Playlist' || info.name === 'PlaylistSound') {
    const field = info.name === 'Playlist' ? 'playlist' : 'playlistSound';
    const linked = game.scenes.filter(scene => sourceOf(scene)[field] === id);
    if (linked.length) {
      problems.push(
        `${label} is linked to ${linked.length} scene(s): ${describeList(linked)}. Remove the link first ` +
          '(set-scene-playlist or update-scene-music), so no scene loses its music without anyone noticing.'
      );
    }
  }
  if (info.name === 'Scene' && before['active'] === true) {
    problems.push(
      `${label} is the active scene every player sees; switch to another scene with switch-scene first.`
    );
  }
  const own = ownMessageProblem(info, before, 'deleted');
  if (own) problems.push(own);
  return problems;
}

function embeddedCounts(info: TypeInfo, data: Data): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [name, field] of Object.entries(info.embedded)) {
    const list = data[field];
    if (Array.isArray(list) && list.length) counts[name] = list.length;
  }
  return counts;
}

export const deleteDocument: QueryHandler = {
  access: ruleFor('delete'),
  run: async (data, context) => {
    const args = argsOf(data);
    const { document, info, parent, root } = placeExisting(args);
    const dryRun = args['dryRun'] === true;
    const label = describeDocument(document);
    const before = snapshot(document);

    const refused: string[] = [];
    if (dryRun) {
      const problem = permissionProblem(context, root.documentName, parent !== null, 'delete');
      if (problem) refused.push(problem);
    }
    refused.push(...deleteProblems(info, document, before));
    const counts = embeddedCounts(info, before);
    const base = {
      documentName: info.name,
      id: document.id,
      uuid: document.uuid,
      name: document.name ?? null,
      parentUuid: parent?.uuid ?? null,
      embeddedCounts: counts,
      specialisedTools: specialisedToolsFor(info.name),
    };
    if (dryRun) return { ...base, dryRun: true, allowed: refused.length === 0, refused };
    if (refused.length)
      throw new QueryError('PROTECTED', `Nothing was deleted. ${refused.join(' ')}`);

    // Foundry 14 without a drawn canvas throws from _onDeleteOperation after the server deleted a
    // placeable. Gone is deleted, and gets logged so undo-change can recreate it.
    const attempt = await settleWrite(() => document.delete());
    if (fromUuidSync(document.uuid)) {
      throw new QueryError(
        attempt.threw ? 'WRITE_FAILED' : 'NOT_APPLIED',
        attempt.threw
          ? `Foundry refused to delete ${label}: ${messageOf(attempt.error)}. Reading back shows it still exists.`
          : `Foundry accepted the deletion of ${label}, but reading back still finds it.`
      );
    }

    context.recordChange({
      query: 'deleteDocument',
      tool: 'delete-document',
      document: logKind(root.documentName),
      action: 'delete',
      targets: [targetOf(document)],
      summary: `Deleted ${label} through generic access.`,
      before: smallEnough(before),
    });
    return {
      ...base,
      deleted: true,
      warnings: attempt.threw
        ? [
            afterWriteWarning(
              attempt.error,
              'Read back, it is gone, and the deletion is recorded, so undo-change can recreate it.'
            ),
          ]
        : [],
    };
  },
};
