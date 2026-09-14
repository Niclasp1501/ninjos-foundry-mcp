/**
 * What generic access may never do, and where the specialised tools are.
 *
 * Generic access is the fallback. It must never be the way around a rule a
 * specialised tool keeps: who owns a document, what marks the AI's own work,
 * what a player sees right now. Those fields are listed here once, with the
 * reason and the tool that is meant for them, and the module compares them
 * before and after every planned write.
 */
import { MODULE_ID } from '../../constants.js';
import { readPath, sameJson, type Data } from './paths.js';

export type FieldAction = 'create' | 'update';

export interface ProtectedField {
  path: string;
  actions: readonly FieldAction[];
  /** Document names the rule is for; every document when absent. */
  documents?: readonly string[];
  reason: string;
}

export const OWN_FLAGS_PATH = `flags.${MODULE_ID}`;

export const PROTECTED_FIELDS: readonly ProtectedField[] = [
  {
    path: '_id',
    actions: ['create', 'update'],
    reason: 'Foundry sets the id, and it never changes.',
  },
  {
    path: '_stats',
    actions: ['create', 'update'],
    reason:
      'Foundry keeps _stats itself (creation, last change, compendium source); create-actor-from-compendium and import-from-compendium set the source.',
  },
  {
    path: 'ownership',
    actions: ['create', 'update'],
    documents: ['Actor'],
    reason:
      'Ownership decides what players see and control; use assign-actor-ownership or remove-actor-ownership.',
  },
  {
    path: 'ownership',
    actions: ['create', 'update'],
    reason:
      'Ownership decides what players see and control. No tool of this server changes it for this kind; a Gamemaster does it in Foundry.',
  },
  {
    path: OWN_FLAGS_PATH,
    actions: ['create', 'update'],
    reason: "These flags mark what Ninjo's Foundry MCP created; only its own tools write them.",
  },
  {
    path: 'type',
    actions: ['update'],
    reason:
      'The system data of an existing document keeps the shape of its type; create a new document of the other type instead.',
  },
  {
    path: 'active',
    actions: ['create', 'update'],
    documents: ['Scene'],
    reason: 'Activating a scene shows it to every player; use switch-scene.',
  },
  {
    path: 'playing',
    actions: ['create', 'update'],
    documents: ['Playlist', 'PlaylistSound'],
    reason: 'Starting and stopping sound plays it for everyone; use control-playlist.',
  },
  {
    path: 'author',
    actions: ['create', 'update'],
    documents: ['ChatMessage'],
    reason:
      'A chat message is always written by the Gamemaster the bridge runs as; speak as a character with send-chat-message.',
  },
  {
    path: 'whisper',
    actions: ['update'],
    documents: ['ChatMessage'],
    reason:
      'Who sees an existing message never changes, so nothing written earlier becomes public; send a new message with send-chat-message.',
  },
  {
    path: 'blind',
    actions: ['update'],
    documents: ['ChatMessage'],
    reason:
      'Who sees an existing message never changes, so nothing written earlier becomes public; send a new message with send-chat-message.',
  },
  {
    path: 'command',
    actions: ['update'],
    documents: ['Macro'],
    reason:
      'Changing what an existing macro runs would turn a macro someone trusts into a different one; create a new macro with create-macro.',
  },
];

function differs(before: Data, after: Data, path: string): boolean {
  const a = readPath(before, path);
  const b = readPath(after, path);
  return a.found !== b.found || !sameJson(a.value, b.value);
}

/**
 * Every protected field a planned write would touch, as one sentence each.
 * `before` is `{}` for a create. `embeddedFields` are the fields that hold
 * embedded documents; an update may not change them as a whole.
 */
export function protectedFieldProblems(
  documentName: string,
  action: FieldAction,
  before: Data,
  after: Data,
  embeddedFields: Readonly<Record<string, string>> = {}
): string[] {
  const problems: string[] = [];
  const reported = new Set<string>();
  for (const rule of PROTECTED_FIELDS) {
    if (!rule.actions.includes(action)) continue;
    if (rule.documents && !rule.documents.includes(documentName)) continue;
    if (reported.has(rule.path)) continue;
    if (!differs(before, after, rule.path)) continue;
    reported.add(rule.path);
    problems.push(`"${rule.path}" cannot be set through generic access: ${rule.reason}`);
  }
  if (action === 'update') {
    for (const [embeddedName, field] of Object.entries(embeddedFields)) {
      if (!differs(before, after, field)) continue;
      problems.push(
        `"${field}" holds the embedded ${embeddedName} documents and cannot be changed as a field: ` +
          `use create-document, update-document or delete-document with documentType "${embeddedName}" and this document as parentUuid.`
      );
    }
  }
  return problems;
}

export interface RefusedType {
  /** Reading is refused as well, not only writing. */
  read: boolean;
  reason: string;
}

/** Document types generic access refuses outright. */
export const REFUSED_TYPES: Readonly<Record<string, RefusedType>> = {
  Setting: {
    read: true,
    reason:
      "Settings are not read or written through generic access: they hold the permission settings of Ninjo's Foundry MCP " +
      'and the stored configuration of other modules, which must never be changed around their own checks.',
  },
  User: {
    read: false,
    reason:
      'Users, their roles and their access are not changed through generic access; a Gamemaster manages users in Foundry.',
  },
  FogExploration: {
    read: false,
    reason:
      'Fog exploration belongs to what each player has seen and is not changed through generic access.',
  },
  Adventure: {
    read: false,
    reason:
      'An adventure writes scenes, actors and journals with their own ids at once; import it in Foundry instead.',
  },
};

/**
 * Types that may be read and changed, but not created through generic access,
 * because the specialised tool keeps a rule a plain create would skip.
 */
export const REFUSED_CREATE: Readonly<Record<string, string>> = {
  ChatMessage:
    'Send chat messages with send-chat-message: it resolves every recipient exactly and compares the stored ' +
    'recipients after sending, so a whisper never becomes public by a wrong user id.',
};

/** Fields that are never shown, because they only matter to authentication. */
export const HIDDEN_FIELDS: Readonly<Record<string, readonly string[]>> = {
  User: ['password', 'passwordSalt'],
};

/** The four batch tools of the canvas area that read and write every element kind on a scene. */
const CANVAS_ELEMENT_TOOLS: readonly string[] = [
  'list-canvas-elements',
  'create-canvas-elements',
  'update-canvas-elements',
  'delete-canvas-elements',
];

/** The tools that are meant for a document type. Generic access names them in every answer. */
export const SPECIALISED_TOOLS: Readonly<Record<string, readonly string[]>> = {
  Actor: [
    'list-characters',
    'get-character',
    'manage-actors',
    'create-actor-from-compendium',
    'assign-actor-ownership',
  ],
  Item: ['manage-world-items', 'search-character-items', 'use-item'],
  ActiveEffect: ['manage-effects'],
  JournalEntry: [
    'list-journals',
    'search-journals',
    'journal-create',
    'journal-rename',
    'journal-delete',
  ],
  JournalEntryPage: [
    'journal-set-page',
    'journal-add-page',
    'journal-append-page',
    'replace-journal-page',
    'journal-delete-page',
  ],
  Scene: [
    'list-scenes',
    'get-current-scene',
    'create-scene',
    'update-scene',
    'switch-scene',
    'delete-scene',
  ],
  Token: [
    'get-token-details',
    'move-token',
    'update-token',
    'toggle-token-condition',
    'delete-tokens',
  ],
  Note: ['create-scene-note'],
  Playlist: ['list-playlists', 'manage-playlists', 'control-playlist', 'delete-playlist'],
  PlaylistSound: ['manage-playlists', 'control-playlist', 'update-scene-music'],
  RollTable: [
    'list-roll-tables',
    'get-roll-table',
    'create-roll-table',
    'update-roll-table',
    'draw-roll-table',
    'delete-roll-table',
  ],
  TableResult: ['update-roll-table'],
  ChatMessage: [
    'list-chat-messages',
    'send-chat-message',
    'update-chat-message',
    'delete-chat-message',
  ],
  Macro: ['list-macros', 'create-macro', 'execute-macro'],
  Folder: ['list-scene-folders', 'folder-rename', 'folder-delete'],
  // The canvas area: batches with dry run, checks before the first write and read back.
  Wall: [...CANVAS_ELEMENT_TOOLS, 'set-door-state', 'check-wall-collision', 'find-path'],
  AmbientLight: CANVAS_ELEMENT_TOOLS,
  AmbientSound: CANVAS_ELEMENT_TOOLS,
  Region: CANVAS_ELEMENT_TOOLS,
  RegionBehavior: CANVAS_ELEMENT_TOOLS,
  Tile: CANVAS_ELEMENT_TOOLS,
  Drawing: CANVAS_ELEMENT_TOOLS,
};

export function specialisedToolsFor(documentName: string): string[] {
  return [...(SPECIALISED_TOOLS[documentName] ?? [])];
}
