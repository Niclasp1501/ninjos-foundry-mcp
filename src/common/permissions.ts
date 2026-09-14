/**
 * The one place that decides whether a change to the world is allowed.
 *
 * Two layers, always in this order:
 *
 * 1. The switch "Allow Write Operations". Off means the AI changes nothing at
 *    all, whatever the matrix below says.
 * 2. The permission matrix: one level per document kind, `read`, `write`
 *    (create and change) or `full` (also delete).
 *
 * The previous generation checked only one of the two in each tool group, so
 * scenes and compendiums wrote with the switch off, and journals ignored the
 * matrix. Here no handler checks anything itself: it declares what it does,
 * and the dispatcher asks this module before the handler runs.
 *
 * A handler may declare several accesses, or derive them from the data of the
 * call (a dry run only reads, a delete flag needs "full"). All of them are
 * decided here, in one call, so a refusal names every kind that is missing.
 */

/** The kinds with their own level in the matrix. */
export type MatrixKind =
  'Scenes' | 'Playlists' | 'Journals' | 'RollTables' | 'Actors' | 'Folders' | 'Compendiums';

/**
 * World documents without a level of their own yet. Rule until they get one:
 * creating and changing needs the switch,
 * deleting is refused, because deleting needs "full" and there is no setting
 * that could say "full" for them.
 */
export type UnleveledKind = 'Items' | 'Macros' | 'Cards' | 'ChatMessages' | 'Combats';

export type DocumentKind = MatrixKind | UnleveledKind;

export type PermissionLevel = 'read' | 'write' | 'full';

export type WriteAction = 'create' | 'update' | 'delete';

/**
 * What a handler does, declared next to it.
 *
 * `extension` is a tool of another module that did not declare itself read
 * only. Its matrix belongs to that module, but the general switch applies.
 *
 * `switch` changes the world without a document kind of its own:
 * only the switch "Allow Write Operations" is asked, no level. Declare a kind
 * instead whenever one fits, so a level can take effect once the kind has one.
 */
export type Access =
  | { kind: 'read' }
  | { kind: 'write'; document: DocumentKind; action: WriteAction }
  | { kind: 'extension'; readOnly: boolean }
  | { kind: 'switch' };

/** The switch and nothing else, for a change that has no document kind. */
export const WRITE_SWITCH_ONLY: Access = { kind: 'switch' };

/**
 * What a query handler declares: one access, several (all must be allowed),
 * or a function of the call data that returns either. A dry run returns
 * `{ kind: 'read' }`; a flag that deletes adds the delete access.
 */
export type AccessRule =
  Access | readonly Access[] | ((data: unknown) => Access | readonly Access[]);

export const WRITE_SWITCH_SETTING = 'allowWriteOperations';

export const PERMISSION_SETTINGS: Readonly<Record<MatrixKind, { key: string; label: string }>> = {
  Scenes: { key: 'permScenes', label: 'scenes' },
  Playlists: { key: 'permPlaylists', label: 'playlists' },
  Journals: { key: 'permJournals', label: 'journals' },
  RollTables: { key: 'permRollTables', label: 'roll tables' },
  Actors: { key: 'permActors', label: 'actors' },
  Folders: { key: 'permFolders', label: 'folders' },
  Compendiums: { key: 'permCompendiums', label: 'compendiums' },
};

export const UNLEVELED_KINDS: Readonly<Record<UnleveledKind, { label: string }>> = {
  Items: { label: 'items' },
  Macros: { label: 'macros' },
  Cards: { label: 'card stacks' },
  ChatMessages: { label: 'chat messages' },
  Combats: { label: 'combat encounters' },
};

/** The kind of a Foundry document name, for the documents the rules above know. */
export const DOCUMENT_KIND_OF: Readonly<Record<string, DocumentKind>> = {
  Scene: 'Scenes',
  Playlist: 'Playlists',
  JournalEntry: 'Journals',
  RollTable: 'RollTables',
  Actor: 'Actors',
  Folder: 'Folders',
  Item: 'Items',
  Macro: 'Macros',
  Cards: 'Cards',
  ChatMessage: 'ChatMessages',
  Combat: 'Combats',
};

export function isMatrixKind(document: DocumentKind): document is MatrixKind {
  return document in PERMISSION_SETTINGS;
}

/** Stored default of every matrix setting. Deleting is off everywhere. */
export const DEFAULT_PERMISSION_LEVEL: PermissionLevel = 'write';

export type SettingReader = (key: string) => unknown;

export type GateDecision =
  | { allowed: true }
  | { allowed: false; code: 'WRITE_DISABLED' | 'PERMISSION_DENIED'; reason: string };

const LEVEL_TEXT: Record<PermissionLevel, string> = {
  read: 'read only',
  write: 'create and change',
  full: 'create, change and delete',
};

const ACTION_VERB: Record<WriteAction, string> = {
  create: 'Creating',
  update: 'Changing',
  delete: 'Deleting',
};

const SWITCH_OFF_REASON =
  '"Allow Write Operations" is off in the settings of Ninjo\'s Foundry MCP, so the AI changes ' +
  'nothing in this world. A Gamemaster can turn it on there.';

/** The switch. Only an explicit `false` turns it off; unset means the default, on. */
export function writeSwitchOn(read: SettingReader): boolean {
  return read(WRITE_SWITCH_SETTING) !== false;
}

/**
 * The level for one kind. Unset means the stored default. A value that is set
 * but not understood counts as read only: a damaged setting must never grant
 * more than it was meant to.
 */
export function permissionLevel(read: SettingReader, document: MatrixKind): PermissionLevel {
  const raw = read(PERMISSION_SETTINGS[document].key);
  if (raw === undefined || raw === null || raw === '') return DEFAULT_PERMISSION_LEVEL;
  return raw === 'read' || raw === 'write' || raw === 'full' ? raw : 'read';
}

export function levelAllows(level: PermissionLevel, action: WriteAction): boolean {
  if (action === 'delete') return level === 'full';
  return level === 'write' || level === 'full';
}

/** Why one write access is refused by its level, or null. The switch is not part of this. */
function levelProblem(
  document: DocumentKind,
  action: WriteAction,
  read: SettingReader
): string | null {
  if (!isMatrixKind(document)) {
    if (action !== 'delete') return null;
    const { label } = UNLEVELED_KINDS[document];
    return (
      `Deleting ${label} is not permitted. ${label[0]?.toUpperCase()}${label.slice(1)} have no level of their own ` +
      'in the permission settings yet, and deleting needs the level "create, change and delete", so it stays off.'
    );
  }
  const level = permissionLevel(read, document);
  if (levelAllows(level, action)) return null;
  const { key, label } = PERMISSION_SETTINGS[document];
  const needed: PermissionLevel = action === 'delete' ? 'full' : 'write';
  let reason =
    `${ACTION_VERB[action]} ${label} is not permitted. The level for ${label} is ` +
    `"${LEVEL_TEXT[level]}" (setting "${key}"); it has to be "${LEVEL_TEXT[needed]}".`;
  if (action === 'delete') {
    reason +=
      ' Deleting is off by default for every kind, because it is the one change that cannot be undone.';
  }
  return reason;
}

export function checkAccess(access: Access, read: SettingReader): GateDecision {
  return checkAccessAll([access], read);
}

/**
 * Decide several accesses at once. The switch is asked once, before any
 * level. Every refused level is named in one reason, so a model does not
 * fix one setting only to be refused for the next.
 */
export function checkAccessAll(accesses: readonly Access[], read: SettingReader): GateDecision {
  const writes = accesses.filter(
    access =>
      access.kind === 'write' ||
      access.kind === 'switch' ||
      (access.kind === 'extension' && !access.readOnly)
  );
  if (writes.length === 0) return { allowed: true };

  if (!writeSwitchOn(read)) {
    return { allowed: false, code: 'WRITE_DISABLED', reason: SWITCH_OFF_REASON };
  }

  const reasons: string[] = [];
  const seen = new Set<string>();
  for (const access of writes) {
    if (access.kind !== 'write') continue;
    const key = `${access.document}:${access.action}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const problem = levelProblem(access.document, access.action, read);
    if (problem) reasons.push(problem);
  }
  if (reasons.length === 0) return { allowed: true };
  return { allowed: false, code: 'PERMISSION_DENIED', reason: reasons.join(' ') };
}

/**
 * Turn a rule into its accesses for one call. A function that throws passes
 * the error on (usually invalid arguments). An empty list is refused: a rule
 * that means "only reads" says `{ kind: 'read' }`, so a forgotten entry never
 * slips through as a read.
 */
export function resolveAccess(rule: AccessRule, data: unknown): readonly Access[] {
  const resolved = typeof rule === 'function' ? rule(data) : rule;
  const list: readonly Access[] = Array.isArray(resolved) ? resolved : [resolved as Access];
  if (list.length === 0) {
    throw new Error(
      'The access rule of this query declares no access at all; declare { kind: "read" } for a query that only reads'
    );
  }
  return list;
}

export interface PermissionOverview {
  writeOperationsEnabled: boolean;
  kinds: Array<{
    document: MatrixKind;
    key: string;
    label: string;
    level: PermissionLevel;
    canCreate: boolean;
    canUpdate: boolean;
    canDelete: boolean;
  }>;
}

/** Everything the matrix says, with the switch already taken into account. */
export function permissionOverview(read: SettingReader): PermissionOverview {
  const on = writeSwitchOn(read);
  return {
    writeOperationsEnabled: on,
    kinds: (Object.keys(PERMISSION_SETTINGS) as MatrixKind[]).map(document => {
      const level = permissionLevel(read, document);
      return {
        document,
        key: PERMISSION_SETTINGS[document].key,
        label: PERMISSION_SETTINGS[document].label,
        level,
        canCreate: on && levelAllows(level, 'create'),
        canUpdate: on && levelAllows(level, 'update'),
        canDelete: on && levelAllows(level, 'delete'),
      };
    }),
  };
}
