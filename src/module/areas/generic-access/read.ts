/**
 * listDocuments, getDocument, describeDocumentType: reading any document type.
 *
 * Large worlds must never tear the bridge. Every answer has a character
 * budget (`maxChars`): a listing stops before it and says where to go on, a
 * single document comes in parts, each part carrying a fingerprint of the
 * whole so a change between two parts is noticed instead of stitched together.
 */
import {
  compareFound,
  fingerprint,
  isPlainRecord,
  matchesCondition,
  parsePath,
  readPath,
  selectFields,
  WHERE_OPERATORS,
  type Data,
  type WhereCondition,
  type WhereOperator,
} from '../../../common/areas/generic-access/paths.js';
import {
  PROTECTED_FIELDS,
  REFUSED_TYPES,
  specialisedToolsFor,
} from '../../../common/areas/generic-access/rules.js';
import {
  DOCUMENT_KIND_OF,
  isMatrixKind,
  PERMISSION_SETTINGS,
  UNLEVELED_KINDS,
} from '../../../common/permissions.js';
import { QueryError, type QueryHandler } from '../../dispatcher.js';
import { requireWorld } from '../../world-ready.js';
import {
  argsOf,
  checkedPath,
  invalid,
  knownTypes,
  listRows,
  optionalInteger,
  optionalText,
  optionalTextList,
  parentsOf,
  refuseRead,
  requiredText,
  resolveForRead,
  targetArgs,
  typeInfo,
  worldCollection,
  type Row,
  type TypeInfo,
} from './resolve.js';

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 200;
export const DEFAULT_MAX_CHARS = 60_000;
export const MIN_MAX_CHARS = 1_000;
export const MAX_MAX_CHARS = 200_000;

function whereOf(args: Data): WhereCondition[] {
  const raw = args['where'];
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw invalid('where must be a list of conditions');
  return raw.map((entry, index) => {
    if (!isPlainRecord(entry)) throw invalid(`where[${index}] must be an object with path and op`);
    const path = entry['path'];
    const op = entry['op'];
    if (typeof path !== 'string' || !path.trim()) throw invalid(`where[${index}].path is required`);
    if (typeof op !== 'string' || !WHERE_OPERATORS.includes(op as WhereOperator))
      throw invalid(`where[${index}].op must be one of ${WHERE_OPERATORS.join(', ')}`);
    checkedPath(path, `where[${index}].path`);
    const value = entry['value'];
    if (op === 'in' && !Array.isArray(value))
      throw invalid(`where[${index}]: "in" needs a list as value`);
    if (op === 'exists' && value !== undefined && typeof value !== 'boolean')
      throw invalid(`where[${index}]: "exists" takes true or false as value`);
    if (
      ['gt', 'gte', 'lt', 'lte'].includes(op) &&
      typeof value !== 'number' &&
      typeof value !== 'string'
    )
      throw invalid(`where[${index}]: "${op}" compares with a number or a text`);
    if (['eq', 'ne', 'contains'].includes(op) && value === undefined)
      throw invalid(`where[${index}]: "${op}" needs a value`);
    const condition: WhereCondition = { path, op: op as WhereOperator };
    if (value !== undefined) condition.value = value;
    return condition;
  });
}

function fieldsOf(args: Data): string[] | undefined {
  const fields = optionalTextList(args, 'fields');
  if (!fields) return undefined;
  if (!fields.length) throw invalid('fields must name at least one path, or be left out');
  for (const field of fields) if (field !== '*') checkedPath(field, 'fields');
  return fields;
}

function defined(entries: Record<string, unknown>): Data {
  return Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined));
}

function rowOutput(row: Row, fields: readonly string[] | undefined): Data {
  if (!fields) {
    return defined({
      id: row.id,
      uuid: row.uuid,
      name: row.data['name'],
      type: row.data['type'],
      folder: row.data['folder'],
    });
  }
  if (fields.includes('*')) return { id: row.id, uuid: row.uuid, data: row.data };
  const selected = selectFields(row.data, fields);
  return {
    id: row.id,
    uuid: row.uuid,
    fields: selected.fields,
    ...(selected.missing.length ? { missingFields: selected.missing } : {}),
  };
}

/** The part of a path a compendium index can be asked for: up to the first `*`. */
function indexPath(path: string): string {
  const segments = parsePath(path);
  const cut = segments.indexOf('*');
  return (cut < 0 ? segments : segments.slice(0, cut)).join('.');
}

export const listDocuments: QueryHandler = {
  access: { kind: 'read' },
  run: async (data, context) => {
    requireWorld();
    const args = argsOf(data);
    const info = typeInfo(requiredText(args, 'documentType'));
    refuseRead(info.name);
    const where = whereOf(args);
    const fields = fieldsOf(args);
    const sortBy = optionalText(args, 'sortBy');
    if (sortBy) checkedPath(sortBy, 'sortBy');
    const direction = args['sortDirection'] ?? 'asc';
    if (direction !== 'asc' && direction !== 'desc')
      throw invalid('sortDirection must be "asc" or "desc"');
    const offset = optionalInteger(args, 'offset', 0, Number.MAX_SAFE_INTEGER) ?? 0;
    const limit = optionalInteger(args, 'limit', 1, MAX_LIMIT) ?? DEFAULT_LIMIT;
    const maxChars =
      optionalInteger(args, 'maxChars', MIN_MAX_CHARS, MAX_MAX_CHARS) ?? DEFAULT_MAX_CHARS;
    const target = targetArgs(args);

    const wanted = [
      ...where.map(condition => condition.path),
      ...(fields ?? ['name', 'type', 'folder']).filter(field => field !== '*'),
      ...(sortBy ? [sortBy] : []),
    ];
    const indexFields = [...new Set(wanted.map(indexPath))].filter(
      path => path && !['_id', 'name', 'type', 'img'].includes(path)
    );
    const listing = await listRows(
      info,
      {
        ...(target.parentUuid ? { parentUuid: target.parentUuid } : {}),
        ...(target.pack ? { pack: target.pack } : {}),
      },
      indexFields
    );

    let rows = listing.rows;
    if (rows.length > 2000)
      context.progress({ progress: 0, total: rows.length, message: 'Filtering' });
    if (where.length)
      rows = rows.filter(row => where.every(condition => matchesCondition(row.data, condition)));
    if (sortBy) {
      const sign = direction === 'desc' ? -1 : 1;
      rows = rows
        .map(row => ({ row, key: readPath(row.data, sortBy) }))
        .sort((a, b) => sign * compareFound(a.key, b.key))
        .map(entry => entry.row);
    }

    const documents: Data[] = [];
    let used = 0;
    let index = offset;
    let stoppedByBudget = false;
    while (index < rows.length && documents.length < limit) {
      const row = rows[index] as Row;
      let item = rowOutput(row, fields);
      let size = JSON.stringify(item).length;
      if (used + size > maxChars) {
        stoppedByBudget = true;
        if (documents.length > 0) break;
        item = defined({
          id: row.id,
          uuid: row.uuid,
          name: row.data['name'],
          tooLarge: `This row alone has ${size} characters, more than maxChars ${maxChars}; choose fewer fields or read it with get-document.`,
        });
        size = JSON.stringify(item).length;
      }
      documents.push(item);
      used += size;
      index += 1;
      if (stoppedByBudget) break;
    }

    const warnings: string[] = [];
    if (listing.source === 'compendium' && !target.parentUuid) {
      warnings.push(
        'Compendium rows come from the index, asked for the fields of this call; a field the index cannot give reads as missing. get-document loads the whole entry.'
      );
    }
    if (offset > rows.length)
      warnings.push(`offset ${offset} is beyond the ${rows.length} matching documents.`);
    if (fields?.includes('*') && fields.length > 1)
      warnings.push(
        'fields contains "*", so the whole data is returned and the other paths are ignored.'
      );

    return {
      documentType: info.name,
      source: listing.source,
      where: listing.where,
      available: listing.rows.length,
      total: rows.length,
      offset,
      limit,
      returned: documents.length,
      nextOffset: index < rows.length ? index : null,
      stoppedByBudget,
      maxChars,
      documents,
      specialisedTools: specialisedToolsFor(info.name),
      warnings,
    };
  },
};

function summariseEmbedded(info: TypeInfo, data: Data): Data {
  const out = { ...data };
  for (const field of Object.values(info.embedded)) {
    const list = out[field];
    if (!Array.isArray(list)) continue;
    out[field] = {
      count: list.length,
      entries: list
        .filter(isPlainRecord)
        .map(entry => defined({ _id: entry['_id'], name: entry['name'], type: entry['type'] })),
    };
  }
  return out;
}

export const getDocument: QueryHandler = {
  access: { kind: 'read' },
  run: async data => {
    requireWorld();
    const args = argsOf(data);
    const given = targetArgs(args);
    if (given.documentType) refuseRead(typeInfo(given.documentType).name);
    const target = await resolveForRead(given);
    refuseRead(target.documentName);
    const info = typeInfo(target.documentName);
    const fields = fieldsOf(args);
    const embedded = args['embedded'] ?? 'include';
    if (embedded !== 'include' && embedded !== 'summary')
      throw invalid('embedded must be "include" or "summary"');
    const maxChars =
      optionalInteger(args, 'maxChars', MIN_MAX_CHARS, MAX_MAX_CHARS) ?? DEFAULT_MAX_CHARS;
    const chunkStart = optionalInteger(args, 'chunkStart', 0, Number.MAX_SAFE_INTEGER);
    const expected = optionalText(args, 'fingerprint');

    const source = embedded === 'summary' ? summariseEmbedded(info, target.data) : target.data;
    const selected = fields && !fields.includes('*') ? selectFields(source, fields) : null;
    const payload = selected ? selected.fields : source;
    const json = JSON.stringify(payload);
    const mark = fingerprint(json);
    if (expected !== undefined && expected !== mark) {
      throw new QueryError(
        'CHANGED',
        `The answer changed since the part with fingerprint "${expected}" was read (now "${mark}"): ` +
          'the document was changed or other parameters were given. Read it again from chunkStart 0.'
      );
    }

    const base = {
      documentName: target.documentName,
      id: target.id,
      uuid: target.uuid,
      name: target.name,
      type: typeof target.data['type'] === 'string' ? target.data['type'] : null,
      parentUuid: target.parentUuid,
      pack: target.pack,
      embedded: info.embedded,
      specialisedTools: specialisedToolsFor(target.documentName),
      totalChars: json.length,
      fingerprint: mark,
      ...(selected?.missing.length ? { missingFields: selected.missing } : {}),
    };
    const of = selected ? 'fields' : 'data';
    if (chunkStart === undefined && json.length <= maxChars) return { ...base, [of]: payload };
    const start = chunkStart ?? 0;
    if (start > 0 && start >= json.length)
      throw invalid(
        `chunkStart ${start} is beyond the end of the answer (${json.length} characters).`
      );
    const end = Math.min(json.length, start + maxChars);
    return {
      ...base,
      chunk: {
        of,
        start,
        end,
        nextStart: end < json.length ? end : null,
        text: json.slice(start, end),
      },
    };
  },
};

interface FieldEntry {
  path: string;
  type: string;
  required?: true;
  nullable?: true;
  initial?: unknown;
  choices?: unknown[];
  element?: string;
  embeddedDocument?: string;
  deeper?: true;
}

const FIELD_LIMIT = 400;

function fieldClass(field: unknown): string {
  const name = (field as { constructor?: { name?: unknown } } | null)?.constructor?.name;
  return typeof name === 'string' && name && name !== 'Object' ? name : 'DataField';
}

function choicesOf(raw: unknown): unknown[] | undefined {
  if (Array.isArray(raw)) return raw.slice(0, 30);
  if (isPlainRecord(raw)) return Object.keys(raw).slice(0, 30);
  return undefined;
}

/** The fields of a schema as a flat list of paths, down to `maxDepth` levels. */
export function walkSchema(
  fields: Record<string, FoundryGenericAccessField> | undefined,
  prefix: string,
  maxDepth: number
): { entries: FieldEntry[]; truncated: boolean } {
  const entries: FieldEntry[] = [];
  let truncated = false;
  const walk = (current: Record<string, FoundryGenericAccessField>, at: string, depth: number) => {
    for (const [name, field] of Object.entries(current)) {
      if (entries.length >= FIELD_LIMIT) {
        truncated = true;
        return;
      }
      const path = at ? `${at}.${name}` : name;
      const entry: FieldEntry = { path, type: fieldClass(field) };
      if (field?.required === true) entry.required = true;
      if (field?.nullable === true) entry.nullable = true;
      const initial = field?.initial;
      if (initial === null || ['string', 'number', 'boolean'].includes(typeof initial))
        entry.initial = initial;
      const choices = choicesOf(field?.choices);
      if (choices) entry.choices = choices;
      if (field?.model?.documentName) entry.embeddedDocument = field.model.documentName;
      entries.push(entry);
      const nested = field?.fields ?? field?.model?.schema?.fields;
      if (nested && !field?.model?.documentName) {
        if (depth < maxDepth) walk(nested, path, depth + 1);
        else entry.deeper = true;
      } else if (field?.element) {
        entry.element = fieldClass(field.element);
        const inner = field.element.fields ?? field.element.model?.schema?.fields;
        if (inner) {
          if (depth < maxDepth) walk(inner, `${path}.*`, depth + 1);
          else entry.deeper = true;
        }
      }
    }
  };
  if (fields) walk(fields, prefix, 1);
  return { entries, truncated };
}

/** A template object (template.json of older systems) as field paths with their example values. */
function templateFields(template: Data, prefix: string, maxDepth: number): FieldEntry[] {
  const entries: FieldEntry[] = [];
  const walk = (node: Data, at: string, depth: number) => {
    for (const [key, value] of Object.entries(node)) {
      if (entries.length >= FIELD_LIMIT) return;
      const path = `${at}.${key}`;
      if (isPlainRecord(value)) {
        const entry: FieldEntry = { path, type: 'object' };
        entries.push(entry);
        if (depth < maxDepth) walk(value, path, depth + 1);
        else entry.deeper = true;
      } else {
        const entry: FieldEntry = { path, type: Array.isArray(value) ? 'array' : typeof value };
        if (value === null || ['string', 'number', 'boolean'].includes(typeof value))
          entry.initial = value;
        entries.push(entry);
      }
    }
  };
  walk(template, prefix, 1);
  return entries;
}

export function documentTypesOf(documentName: string): string[] | null {
  const all = (game as unknown as { documentTypes?: Record<string, unknown> }).documentTypes;
  const list = all?.[documentName];
  return Array.isArray(list)
    ? list.filter((entry): entry is string => typeof entry === 'string')
    : null;
}

/** What writing a document whose outermost document has this name needs. */
export function permissionRule(rootName: string): string {
  const kind = DOCUMENT_KIND_OF[rootName];
  if (kind && isMatrixKind(kind)) {
    const { key, label } = PERMISSION_SETTINGS[kind];
    return (
      `${rootName} counts as ${label}: after the switch "Allow Write Operations", creating and changing need the level ` +
      `"create and change", deleting needs "create, change and delete" (setting "${key}").`
    );
  }
  if (kind) {
    return (
      `${rootName} counts as ${UNLEVELED_KINDS[kind].label}, which have no level of their own yet: creating and changing ` +
      'need the switch "Allow Write Operations", deleting is refused.'
    );
  }
  return (
    `${rootName} has no kind in the permission settings: creating and changing need the switch ` +
    '"Allow Write Operations", deleting is refused.'
  );
}

function typeOverview(info: TypeInfo, types: Map<string, TypeInfo>): Data {
  const collection = worldCollection(info);
  const refusal = REFUSED_TYPES[info.name];
  return defined({
    documentName: info.name,
    world: collection !== null,
    count: collection ? collection.size : undefined,
    embedded: Object.keys(info.embedded).length ? Object.keys(info.embedded) : undefined,
    embeddedIn: parentsOf(info.name, types).length ? parentsOf(info.name, types) : undefined,
    subtypes: documentTypesOf(info.name) ?? undefined,
    refused: refusal ? (refusal.read ? 'read and write' : 'write') : undefined,
    specialisedTools: specialisedToolsFor(info.name).length
      ? specialisedToolsFor(info.name)
      : undefined,
  });
}

export const describeDocumentType: QueryHandler = {
  access: { kind: 'read' },
  run: async data => {
    requireWorld();
    const args = argsOf(data);
    const types = knownTypes();
    const name = optionalText(args, 'documentType');
    if (!name) {
      return {
        types: [...types.values()]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(info => typeOverview(info, types)),
        note: 'Call again with documentType for the fields, subtypes, permissions and protected fields of one type.',
      };
    }
    const info = typeInfo(name);
    refuseRead(info.name);
    const depth = optionalInteger(args, 'depth', 1, 8) ?? 4;
    const subtype = optionalText(args, 'subtype');
    const subtypes = documentTypesOf(info.name);
    if (subtype && subtypes && !subtypes.includes(subtype)) {
      throw invalid(
        `"${subtype}" is not a ${info.name} type of the game system "${game.system?.id ?? 'unknown'}". Types: ${subtypes.join(', ')}.`
      );
    }

    const notes: string[] = [];
    const schema = walkSchema(info.documentClass.schema?.fields, '', depth);
    if (!info.documentClass.schema?.fields)
      notes.push(`Foundry exposes no schema for ${info.name}; only the stored data can be read.`);
    if (schema.truncated)
      notes.push(`Only the first ${FIELD_LIMIT} fields are listed; lower depth.`);

    let systemFields: FieldEntry[] | undefined;
    let systemSource: string | undefined;
    if (subtype) {
      const model = info.config.dataModels?.[subtype];
      const template = (game as unknown as { model?: Record<string, Record<string, unknown>> })
        .model?.[info.name]?.[subtype];
      if (model?.schema?.fields) {
        systemFields = walkSchema(model.schema.fields, 'system', depth).entries;
        systemSource = `data model of ${game.system?.id ?? 'the game system'}`;
      } else if (isPlainRecord(template)) {
        systemFields = templateFields(template, 'system', depth);
        systemSource = `template of ${game.system?.id ?? 'the game system'}`;
      } else {
        notes.push(
          `The game system describes no fields for ${info.name} type "${subtype}"; read a document of that type to see its data.`
        );
      }
    } else if (subtypes && subtypes.length > 1) {
      notes.push(`Give subtype (${subtypes.join(', ')}) to see the system fields of that type.`);
    }

    const collection = worldCollection(info);
    const parents = parentsOf(info.name, types);
    const rules: string[] = [];
    if (collection) rules.push(permissionRule(info.name));
    if (parents.length) {
      rules.push(
        `Inside ${parents.join(' or ')}: creating, changing and deleting count as changing the outermost document ` +
          '(an Item on an Actor counts as the Actor), and deleting needs the full level of that kind. ' +
          permissionRule(parents[0] as string)
      );
    }
    const refusal = REFUSED_TYPES[info.name];

    return {
      documentName: info.name,
      world: collection !== null,
      ...(collection ? { count: collection.size } : {}),
      embedded: info.embedded,
      embeddedIn: parents,
      subtypes,
      permissions: rules,
      ...(refusal ? { refusedForWriting: refusal.reason } : {}),
      protectedFields: PROTECTED_FIELDS.filter(
        rule => !rule.documents || rule.documents.includes(info.name)
      )
        .map(rule => ({ path: rule.path, on: rule.actions, reason: rule.reason }))
        .filter((rule, index, all) => all.findIndex(other => other.path === rule.path) === index),
      specialisedTools: specialisedToolsFor(info.name),
      fields: schema.entries,
      ...(systemFields ? { systemFields, systemSource } : {}),
      notes,
    };
  },
};
