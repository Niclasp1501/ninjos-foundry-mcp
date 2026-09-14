/**
 * list-documents, get-document, describe-document-type, create-document,
 * update-document, delete-document: generic access to every document type.
 *
 * The descriptions send the model to the specialised tools first. Generic
 * access is for types no tool covers, for game systems without an adapter,
 * and for exact fields.
 */
import { WHERE_OPERATORS } from '../../../common/areas/generic-access/paths.js';
import { readOnlyTool, writingTool, type ToolDefinition } from '../../tools/types.js';
import {
  ask,
  isRecord,
  listOf,
  param,
  pick,
  schema,
  str,
  unknownShape,
  warningLines,
} from '../chat-tables-macros/shared.js';

const TARGET = {
  uuid: param(
    'string',
    'uuid of the document, e.g. "Actor.abc", "Scene.abc.Token.def", "Compendium.dnd5e.monsters.Actor.abc"'
  ),
  documentType: param(
    'string',
    'Foundry document name, e.g. "Actor", "JournalEntryPage", "Combat", "Wall"; with id when no uuid is given'
  ),
  id: param('string', 'Id of the document, together with documentType'),
  parentUuid: param(
    'string',
    'uuid of the document that holds an embedded one, e.g. "Actor.abc" for its items, "Scene.abc" for its walls'
  ),
};

const PACK = param(
  'string',
  'Compendium id "package.name" to read from; compendiums are read only here'
);
const DRY_RUN = param(
  'boolean',
  'Only check and preview; nothing is written. Recommended before the real call'
);
const FIELDS = param(
  'array',
  'Dotted paths to return, list positions as ".0" or "[0]" and "*" for every entry, e.g. "system.attributes.hp.value", ' +
    '"items.*.name". ["*"] returns all data',
  { items: { type: 'string' } }
);
const MAX_CHARS = param('integer', 'Character budget of the answer, 1000 to 200000; default 60000');

const TARGET_KEYS = ['uuid', 'documentType', 'id', 'parentUuid'] as const;

function tools(answer: Record<string, unknown>, documentName: string): string[] {
  const names = listOf(answer['specialisedTools']).map(String);
  return names.length ? [`Specialised tools for ${documentName}: ${names.join(', ')}.`] : [];
}

function label(answer: Record<string, unknown>): string {
  const name = str(answer['name']);
  return `${str(answer['documentName'])}${name ? ` "${name}"` : ''} (${str(answer['uuid'])})`;
}

function shown(value: unknown): string {
  return value === undefined ? '(nothing)' : JSON.stringify(value);
}

function diffLines(entries: unknown): string[] {
  return listOf(entries)
    .filter(isRecord)
    .map(entry => `- ${str(entry['path'])}: ${shown(entry['before'])} -> ${shown(entry['after'])}`);
}

export function formatListing(answer: unknown): string {
  if (!isRecord(answer) || !Array.isArray(answer['documents'])) return unknownShape(answer);
  const type = str(answer['documentType']);
  const where = str(answer['where']);
  const documents = answer['documents'];
  const lines = documents.length
    ? [
        `${documents.length} of ${String(answer['total'])} matching ${type} documents ${where}, from position ${String(answer['offset'])}:`,
        ...documents.map(document => JSON.stringify(document)),
      ]
    : [`No ${type} documents ${where} match (${String(answer['available'])} there in all).`];
  if (typeof answer['nextOffset'] === 'number')
    lines.push(`More match: call again with offset ${answer['nextOffset']}.`);
  else if (documents.length) lines.push('No more documents match.');
  if (answer['stoppedByBudget'] === true)
    lines.push(
      `Stopped at the character budget of ${String(answer['maxChars'])}; choose fewer fields or raise maxChars.`
    );
  return [...lines, ...warningLines(answer), ...tools(answer, type)].join('\n');
}

export function formatDocument(answer: unknown): string {
  if (!isRecord(answer) || typeof answer['uuid'] !== 'string') return unknownShape(answer);
  const where = [
    ...(typeof answer['pack'] === 'string' ? [`compendium ${answer['pack']}`] : []),
    ...(typeof answer['parentUuid'] === 'string' ? [`inside ${answer['parentUuid']}`] : []),
  ];
  const lines = [
    `${label(answer)}${where.length ? `, ${where.join(', ')}` : ''}: ${String(answer['totalChars'])} characters, ` +
      `fingerprint "${str(answer['fingerprint'])}".`,
  ];
  const embedded = isRecord(answer['embedded']) ? Object.entries(answer['embedded']) : [];
  if (embedded.length)
    lines.push(
      `Holds: ${embedded.map(([name, field]) => `${name} in "${String(field)}"`).join(', ')}.`
    );
  const missing = listOf(answer['missingFields']).map(String);
  if (missing.length) lines.push(`Missing fields: ${missing.join(', ')}.`);
  const chunk = answer['chunk'];
  if (isRecord(chunk)) {
    const next = chunk['nextStart'];
    lines.push(
      `Part of the ${str(chunk['of'])} JSON: characters ${String(chunk['start'])} to ${String(chunk['end'])} of ${String(answer['totalChars'])}. ` +
        (typeof next === 'number'
          ? `Continue with chunkStart ${next} and fingerprint "${str(answer['fingerprint'])}", then join the parts into one JSON text.`
          : 'This is the last part; join the parts into one JSON text.'),
      str(chunk['text'])
    );
  } else {
    lines.push(JSON.stringify(answer['fields'] ?? answer['data']));
  }
  return [...lines, ...tools(answer, str(answer['documentName']))].join('\n');
}

function refusedLines(answer: Record<string, unknown>): string[] {
  const refused = listOf(answer['refused']).map(String);
  return [
    `Dry run, nothing was changed. ${refused.length ? 'The real call would be REFUSED:' : 'The real call would be allowed.'}`,
    ...refused.map(reason => `- ${reason}`),
  ];
}

export function formatCreated(answer: unknown): string {
  if (!isRecord(answer)) return unknownShape(answer);
  const type = str(answer['documentName']);
  if (answer['dryRun'] === true) {
    return [
      ...refusedLines(answer),
      `Would create ${type} ${JSON.stringify(answer['wouldCreate'] ?? {})} ${str(answer['where'])} (${String(answer['dataChars'])} characters of data).`,
      ...tools(answer, type),
    ].join('\n');
  }
  if (answer['created'] !== true) return unknownShape(answer);
  const differently = listOf(answer['storedDifferently'])
    .filter(isRecord)
    .map(
      entry =>
        `- ${str(entry['path'])}: given ${shown(entry['requested'])}, stored ${shown(entry['stored'])}`
    );
  return [
    `Created ${label(answer)} ${str(answer['where'])}, read back from Foundry.`,
    ...(differently.length ? ['Stored differently than given:', ...differently] : []),
    ...warningLines(answer),
    ...tools(answer, type),
  ].join('\n');
}

export function formatUpdated(answer: unknown): string {
  if (!isRecord(answer) || typeof answer['uuid'] !== 'string') return unknownShape(answer);
  const type = str(answer['documentName']);
  const lines: string[] = [];
  if (answer['dryRun'] === true) lines.push(...refusedLines(answer));
  if (answer['changed'] === false && !Array.isArray(answer['wouldChange'])) {
    lines.push(str(answer['note']));
  } else if (answer['dryRun'] === true) {
    lines.push(`Would change ${label(answer)}:`, ...diffLines(answer['wouldChange']));
    if (Number(answer['omitted']) > 0) lines.push(`... and ${String(answer['omitted'])} more.`);
    lines.push(`Update sent to Foundry: ${JSON.stringify(answer['update'])}`);
  } else if (answer['updated'] === true) {
    lines.push(
      `Changed ${label(answer)}, as read back from Foundry:`,
      ...diffLines(answer['changes'])
    );
    if (Number(answer['omitted']) > 0) lines.push(`... and ${String(answer['omitted'])} more.`);
    const notApplied = listOf(answer['notApplied'])
      .filter(isRecord)
      .map(
        entry =>
          `- ${str(entry['path'])}: asked ${shown(entry['requested'])}, stored ${shown(entry['stored'])}`
      );
    if (notApplied.length) lines.push('NOT APPLIED as asked:', ...notApplied);
  } else {
    return unknownShape(answer);
  }
  return [...lines, ...warningLines(answer), ...tools(answer, type)].join('\n');
}

export function formatDeleted(answer: unknown): string {
  if (!isRecord(answer) || typeof answer['uuid'] !== 'string') return unknownShape(answer);
  const counts = isRecord(answer['embeddedCounts']) ? Object.entries(answer['embeddedCounts']) : [];
  const holding = counts.length
    ? ` with ${counts.map(([name, count]) => `${String(count)} ${name}`).join(', ')} inside`
    : '';
  const type = str(answer['documentName']);
  if (answer['dryRun'] === true)
    return [
      ...refusedLines(answer),
      `Would delete ${label(answer)}${holding}.`,
      ...tools(answer, type),
    ].join('\n');
  if (answer['deleted'] !== true) return unknownShape(answer);
  return [
    `Deleted ${label(answer)}${holding}; reading back no longer finds it.`,
    ...warningLines(answer),
    ...tools(answer, type),
  ].join('\n');
}

export const listDocumentsTool: ToolDefinition = {
  name: 'list-documents',
  title: 'List documents of any type',
  group: 'documents',
  description:
    'Generic fallback: list documents of any type in the world, inside one document (parentUuid) or in a compendium ' +
    '(pack, read only), with conditions, sorting, paging and field selection. Prefer the specialised tools where one ' +
    'fits: list-journals, list-scenes, list-characters, list-compendium-entries, list-chat-messages, list-macros, ' +
    'list-playlists, list-roll-tables. Use this for types they do not cover (Combat, Cards, Wall, Region, Drawing), ' +
    'for game systems without an adapter, or to get exactly the fields needed. Without fields each row shows id, uuid, ' +
    'name, type and folder. describe-document-type shows the field paths.',
  inputSchema: schema(
    {
      documentType: TARGET.documentType,
      parentUuid: TARGET.parentUuid,
      pack: PACK,
      where: param('array', 'Conditions that must all hold', {
        items: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Dotted field path; "*" matches when any entry passes',
            },
            op: { type: 'string', enum: [...WHERE_OPERATORS] },
            value: { description: 'Value to compare; a list for "in", true or false for "exists"' },
          },
          required: ['path', 'op'],
        },
      }),
      fields: FIELDS,
      sortBy: param('string', "Field path to sort by; default is Foundry's order"),
      sortDirection: param('string', 'Sort direction; default asc', { enum: ['asc', 'desc'] }),
      offset: param(
        'integer',
        'Skip this many matching documents; nextOffset of the previous answer'
      ),
      limit: param('integer', 'Documents per answer, 1 to 200; default 25'),
      maxChars: MAX_CHARS,
    },
    ['documentType']
  ),
  annotations: readOnlyTool('List documents of any type'),
  handler: async (args, context) =>
    formatListing(
      await ask(
        context,
        'listDocuments',
        pick(args, [
          'documentType',
          'parentUuid',
          'pack',
          'where',
          'fields',
          'sortBy',
          'sortDirection',
          'offset',
          'limit',
          'maxChars',
        ]),
        'list documents'
      )
    ),
};

export const getDocumentTool: ToolDefinition = {
  name: 'get-document',
  title: 'Read one document of any type',
  group: 'documents',
  description:
    'Generic fallback: read one document of any type by uuid, or by documentType and id (with parentUuid for an ' +
    'embedded document, pack for a compendium), whole or only the given fields. A large answer comes in parts: call ' +
    'again with chunkStart and the fingerprint of the first part and join the parts. embedded "summary" shortens ' +
    'embedded collections to ids and names. Prefer get-character, get-current-scene, get-roll-table, ' +
    'get-compendium-item and get-token-details where they fit.',
  inputSchema: schema({
    ...TARGET,
    pack: PACK,
    fields: FIELDS,
    embedded: param('string', 'Embedded documents in full or as ids and names; default include', {
      enum: ['include', 'summary'],
    }),
    chunkStart: param('integer', 'Character position to continue from, from the previous part'),
    fingerprint: param(
      'string',
      'Fingerprint of the first part, so a change in between is noticed'
    ),
    maxChars: MAX_CHARS,
  }),
  annotations: readOnlyTool('Read one document of any type'),
  handler: async (args, context) =>
    formatDocument(
      await ask(
        context,
        'getDocument',
        pick(args, [
          ...TARGET_KEYS,
          'pack',
          'fields',
          'embedded',
          'chunkStart',
          'fingerprint',
          'maxChars',
        ]),
        'read document'
      )
    ),
};

export const describeDocumentTypeTool: ToolDefinition = {
  name: 'describe-document-type',
  title: 'Describe a document type',
  group: 'documents',
  description:
    "List the document types of this Foundry, or describe one: its fields from Foundry's data model, its subtypes, " +
    'the system fields of a subtype in the active game system, what it holds and belongs to, the permission level ' +
    'writing it needs, the fields generic access never changes, and the specialised tools for it. Call it before ' +
    'creating or changing a type through generic access for the first time.',
  inputSchema: schema({
    documentType: param('string', 'Foundry document name; leave out for the list of all types'),
    subtype: param('string', 'Type within it, e.g. "npc", for the system fields'),
    depth: param('integer', 'How deep nested fields are listed, 1 to 8; default 4'),
  }),
  annotations: readOnlyTool('Describe a document type'),
  handler: async (args, context) => {
    const answer = await ask(
      context,
      'describeDocumentType',
      pick(args, ['documentType', 'subtype', 'depth']),
      'describe document type'
    );
    return isRecord(answer) ? answer : unknownShape(answer);
  },
};

export const createDocumentTool: ToolDefinition = {
  name: 'create-document',
  title: 'Create a document of any type',
  group: 'documents',
  description:
    'Generic fallback: create one document of any type in the world, or inside another document with parentUuid ' +
    '(a page in a journal, an item on an actor, a wall on a scene). data holds the fields as nested objects, as ' +
    'describe-document-type shows them. The permission settings apply as for the specialised tools; ids, ownership, ' +
    '_stats and the flags of this module cannot be given. The answer is read back from Foundry. Use dryRun first. ' +
    'Prefer journal-create, journal-add-page, create-scene, manage-actors, manage-world-items, create-macro ' +
    'and create-roll-table where they fit. Chat messages are sent only with send-chat-message; settings, users ' +
    'and compendiums are not written here.',
  inputSchema: schema(
    {
      documentType: TARGET.documentType,
      parentUuid: TARGET.parentUuid,
      data: param(
        'object',
        'Fields of the new document as nested objects, e.g. { "name": "Goblin", "type": "npc" }'
      ),
      dryRun: DRY_RUN,
    },
    ['documentType', 'data']
  ),
  annotations: writingTool('Create a document of any type', {
    destructive: false,
    idempotent: false,
  }),
  handler: async (args, context) =>
    formatCreated(
      await ask(
        context,
        'createDocument',
        pick(args, ['documentType', 'parentUuid', 'data', 'dryRun']),
        'create document'
      )
    ),
};

export const updateDocumentTool: ToolDefinition = {
  name: 'update-document',
  title: 'Change a document of any type',
  group: 'documents',
  description:
    "Generic fallback: change fields of one document of any type. changes follows Foundry's update rules: keys may " +
    'be dotted paths, an object merges into the object that is there, lists and other values replace it. A list ' +
    'position in a key ("system.skills.2.value") changes only that entry. replace names keys of changes whose object ' +
    'replaces the stored object instead of merging; remove names paths to delete. The answer is the change as read ' +
    'back from Foundry, and what was stored differently. Ids, ownership, _stats, the type, embedded collections, the ' +
    'flags of this module and what a specialised tool guards (active scene, playback, chat recipients, macro commands) ' +
    'cannot be changed here. Use dryRun first. Prefer update-scene, manage-actors, journal-set-page, update-token, ' +
    'update-roll-table, manage-effects and the other specialised tools where they fit.',
  inputSchema: schema({
    ...TARGET,
    changes: param(
      'object',
      'Changes by field, e.g. { "system.attributes.hp.value": 7, "name": "Grok" }'
    ),
    replace: param(
      'array',
      'Keys of changes whose object replaces the stored object instead of merging',
      {
        items: { type: 'string' },
      }
    ),
    remove: param(
      'array',
      'Field paths to delete: a key, or a list entry such as "system.skills.1"',
      {
        items: { type: 'string' },
      }
    ),
    dryRun: DRY_RUN,
  }),
  annotations: writingTool('Change a document of any type', {
    destructive: true,
    idempotent: true,
  }),
  handler: async (args, context) =>
    formatUpdated(
      await ask(
        context,
        'updateDocument',
        pick(args, [...TARGET_KEYS, 'changes', 'replace', 'remove', 'dryRun']),
        'update document'
      )
    ),
};

export const deleteDocumentTool: ToolDefinition = {
  name: 'delete-document',
  title: 'Delete a document of any type',
  group: 'documents',
  description:
    'Generic fallback: delete one document of any type, by uuid or by documentType and id. Needs the level "create, ' +
    'change and delete" of its kind, for an embedded document that of the document it belongs to; kinds without a ' +
    'level cannot be deleted. Refused for a folder with contents, a playlist or track a scene is linked to, the active ' +
    'scene and chat messages of others. dryRun shows what would go, embedded documents included. Prefer ' +
    'journal-delete, journal-delete-page, delete-scene, manage-actors, delete-playlist, delete-roll-table and ' +
    'delete-tokens where they fit. Compendium entries are deleted with delete-compendium-entries.',
  inputSchema: schema({ ...TARGET, dryRun: DRY_RUN }),
  annotations: writingTool('Delete a document of any type', {
    destructive: true,
    idempotent: true,
  }),
  handler: async (args, context) =>
    formatDeleted(
      await ask(
        context,
        'deleteDocument',
        pick(args, [...TARGET_KEYS, 'dryRun']),
        'delete document'
      )
    ),
};

export const GENERIC_ACCESS_TOOLS: readonly ToolDefinition[] = [
  listDocumentsTool,
  getDocumentTool,
  describeDocumentTypeTool,
  createDocumentTool,
  updateDocumentTool,
  deleteDocumentTool,
];
