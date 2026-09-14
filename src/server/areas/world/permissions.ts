/**
 * get-permissions: what the AI may do in this world right now, and why.
 */
import { readOnlyTool, type ToolDefinition } from '../../tools/types.js';
import { askModule, isRecord, str, unknownShape } from './shared.js';

const CAPABILITY: ReadonlyArray<[string, string]> = [
  ['canDelete', 'create, change, delete'],
  ['canUpdate', 'create, change'],
];

/**
 * What a row allows. A row of this generation and of the previous module both
 * carry canCreate, canUpdate and canDelete with the switch included; a row
 * without them is derived from its level and the switch.
 */
function capability(kind: Record<string, unknown>, level: string, switchOn: boolean): string {
  const flagged = CAPABILITY.find(([field]) => kind[field] === true)?.[1];
  if (flagged) return flagged;
  const hasFlags = ['canCreate', 'canUpdate', 'canDelete'].some(field => field in kind);
  if (hasFlags || !switchOn) return 'read only';
  if (level === 'full') return 'create, change, delete';
  if (level === 'write') return 'create, change';
  return 'read only';
}

function kindLine(kind: Record<string, unknown>, switchOn: boolean): string {
  const label = str(kind['label'], str(kind['document'], 'unknown kind'));
  const level = str(kind['level'], 'unknown');
  // The previous module names the row in `kind`; it is shown only when it is a setting key.
  const legacyKey = str(kind['kind']);
  const key = str(kind['key']) || (legacyKey.startsWith('perm') ? legacyKey : '');
  const may = capability(kind, level, switchOn);
  const setting = key ? ` (${key}: ${level})` : '';
  const held =
    !switchOn && (level === 'write' || level === 'full') ? ', held back by the switch' : '';
  return `- ${label}: ${may}${setting}${held}`;
}

function compendiumLines(list: unknown): string[] {
  if (!isRecord(list)) return [];
  const setting = str(list['setting'], 'writableCompendiums');
  const entries = Array.isArray(list['entries']) ? list['entries'].map(String) : [];
  switch (list['mode']) {
    case 'all-unlocked':
      return [
        `Compendium release list (${setting}): empty, so every compendium that is not locked may be written, ` +
          'within the level for compendiums above. A locked one is refused unless unlockIfNeeded is passed.',
      ];
    case 'listed':
      return [
        `Compendium release list (${setting}): only ${entries.join(', ')}. An entry is a full compendium id or ` +
          'a package name; a listed compendium may be written even while it is locked. Every other one is refused.',
      ];
    default:
      // `problem` since the core reading; `reason` from modules built before it.
      return [
        `Compendium release list (${setting}): could not be read, ${str(list['problem'], str(list['reason'], 'no reason given'))}. ` +
          'Until it is saved again, no compendium counts as released.',
      ];
  }
}

function extensionLines(tools: unknown, switchOn: boolean): string[] {
  if (!isRecord(tools)) return [];
  const setting = str(tools['setting'], 'toolProviderModules');
  const released = Array.isArray(tools['releasedModules'])
    ? tools['releasedModules'].map(String)
    : [];
  const lines = [
    released.length
      ? `Tools of other modules (${setting}): released for ${released.join(', ')}.`
      : `Tools of other modules (${setting}): no module is released, so none can register a tool.`,
  ];
  const registered = Array.isArray(tools['registeredTools'])
    ? tools['registeredTools'].filter(isRecord)
    : null;
  if (registered && registered.length) {
    for (const tool of registered) {
      const readOnly = tool['readOnly'] === true;
      const runs = readOnly
        ? 'read only, runs'
        : switchOn
          ? 'writing, runs'
          : 'writing, held back by the switch';
      lines.push(`- ${str(tool['name'])} from ${str(tool['moduleId'])}: ${runs}`);
    }
  } else if (registered) {
    if (released.length) lines.push('- no tool is registered right now');
  }
  if (released.length) {
    lines.push(
      'Their own permission rules belong to those modules; the switch holds every tool that does not declare ' +
        'itself read only.'
    );
  }
  return lines;
}

/**
 * The overview as text. Accepts this generation's answer (`kinds`) and the
 * previous module's (`permissions`, each with `label` and `level`); the
 * release lists only exist in the first and are left out otherwise.
 */
export function formatPermissions(answer: unknown): string {
  if (!isRecord(answer)) return unknownShape(answer);
  const rows = Array.isArray(answer['kinds'])
    ? answer['kinds']
    : Array.isArray(answer['permissions'])
      ? answer['permissions']
      : null;
  if (!rows) return unknownShape(answer);
  const switchOn = answer['writeOperationsEnabled'] !== false;
  const lines = [
    switchOn
      ? 'Writing is permitted in principle.'
      : 'CAUTION: "Allow Write Operations" is off, the AI changes nothing at all.',
    'Per kind (setting: level; deleting needs "full" and is off by default):',
    ...rows.filter(isRecord).map(kind => kindLine(kind, switchOn)),
    ...compendiumLines(answer['compendiumReleaseList']),
    ...extensionLines(answer['extensionTools'], switchOn),
  ];
  if (answer['gamemasterOnly'] === true)
    lines.push('Only a Gamemaster logged in to the world can run any of this.');
  return lines.join('\n');
}

export const getPermissionsTool: ToolDefinition = {
  name: 'get-permissions',
  title: 'Permissions',
  group: 'world',
  description:
    'Show what the AI is currently allowed to do in this world: the switch "Allow Write Operations", the level ' +
    'per document kind (scenes, playlists, journals, roll tables, actors, folders, compendiums: read only, ' +
    'create and change, or additionally delete), the release list of compendiums and the modules released to ' +
    'offer tools of their own. Deleting is off by default everywhere. Call this when an action was refused, to ' +
    'see which setting has to change.',
  inputSchema: { type: 'object', properties: {} },
  annotations: readOnlyTool('Permissions'),
  handler: async (_args, context) =>
    formatPermissions(await askModule(context, 'getPermissions', {}, 'get permissions')),
};
