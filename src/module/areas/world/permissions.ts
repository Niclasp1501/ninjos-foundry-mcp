/**
 * getPermissions: the permission overview.
 *
 * It shows what the checks actually enforce, not only the matrix: the switch
 * and the matrix come from the same functions the dispatcher asks
 * (checkAccess in src/common/permissions.ts), the release list for tools of
 * other modules from the same ExtensionTools logic the call uses, and the
 * release list of compendiums through the same reading the compendium checks
 * use (src/common/compendium-release.ts). Before, the overview left both
 * release lists out, so a refused compendium or tool could not be explained
 * from it.
 *
 * Two lists describe the matrix: `kinds` for this generation's server, and
 * `permissions` for a server of the previous generation, which reads that
 * list with `label` and `level` and fails without it.
 * Both carry the same rows.
 */
import { MODULE_ID } from '../../../common/constants.js';
import type { ReleaseList } from '../../../common/compendium-release.js';
import { permissionOverview, type PermissionOverview } from '../../../common/permissions.js';
import { readReleaseList } from '../../compendium-release.js';
import type { QueryHandler } from '../../dispatcher.js';
import {
  ExtensionTools,
  LEGACY_PROVIDERS_SETTING,
  TOOL_PROVIDERS_SETTING,
} from '../../extension-tools.js';
import { readSetting } from '../../settings.js';
import { isRecord } from './lookup.js';

export interface ExtensionToolRelease {
  setting: string;
  legacySetting: string;
  releasedModules: string[];
  /** Tools registered right now; null when the module API is not there to ask. */
  registeredTools: Array<{ name: string; moduleId: string; readOnly: boolean }> | null;
}

/** One row in the shape a previous generation server reads. */
export interface LegacyPermissionRow {
  kind: string;
  label: string;
  level: 'read' | 'write' | 'full';
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}

export interface WorldPermissionOverview extends PermissionOverview {
  permissions: LegacyPermissionRow[];
  gamemasterOnly: true;
  compendiumReleaseList: ReleaseList;
  extensionTools: ExtensionToolRelease;
}

function registeredExtensionTools(): ExtensionToolRelease['registeredTools'] {
  const api = game.modules.get(MODULE_ID)?.api;
  if (!isRecord(api) || typeof api['listTools'] !== 'function') return null;
  const listed: unknown = (api['listTools'] as () => unknown)();
  if (!Array.isArray(listed)) return null;
  return listed.filter(isRecord).map(tool => ({
    name: String(tool['name'] ?? ''),
    moduleId: String(tool['moduleId'] ?? ''),
    readOnly: isRecord(tool['annotations']) && tool['annotations']['readOnlyHint'] === true,
  }));
}

export function buildPermissionOverview(): WorldPermissionOverview {
  // The same release logic the call of an extension tool uses; nothing is written.
  const releasedModules = new ExtensionTools({
    readSetting,
    writeSetting: async () => undefined,
    isGM: () => false,
    callHook: () => undefined,
  }).releasedModules();

  const matrix = permissionOverview(readSetting);
  return {
    ...matrix,
    permissions: matrix.kinds.map(row => ({
      kind: row.key,
      label: row.label,
      level: row.level,
      canCreate: row.canCreate,
      canUpdate: row.canUpdate,
      canDelete: row.canDelete,
    })),
    gamemasterOnly: true,
    compendiumReleaseList: readReleaseList(),
    extensionTools: {
      setting: TOOL_PROVIDERS_SETTING,
      legacySetting: LEGACY_PROVIDERS_SETTING,
      releasedModules,
      registeredTools: registeredExtensionTools(),
    },
  };
}

export const getPermissions: QueryHandler = {
  access: { kind: 'read' },
  run: () => buildPermissionOverview(),
};
