/**
 * Settings for the server, failure messages for the Gamemaster,
 * and the answers to a server of the previous generation.
 */
import {
  DEFAULT_MAP_QUALITY,
  isMapQuality,
  MAP_QUALITIES,
  MAP_SETTING,
  MAPS_PROTOCOL,
} from '../../../common/areas/maps/constants.js';
import { QueryError, type QueryHandler } from '../../dispatcher.js';
import { readSetting, type SettingRow } from '../../settings.js';
import { requireWorld } from '../../world-ready.js';
import { announce } from '../interface/index.js';
import { UPLOAD_ACCESS } from './upload.js';

/**
 * Both keys stay registered and readable. Neither is in Foundry's settings
 * list: the map generation window of the interface area shows and saves them, and a
 * second place only doubled them.
 */
export const MAP_SETTING_ROWS: readonly SettingRow[] = [
  { key: MAP_SETTING.autoStart, kind: Boolean, initial: false, listed: false },
  {
    key: MAP_SETTING.quality,
    kind: String,
    initial: DEFAULT_MAP_QUALITY,
    listed: false,
    options: MAP_QUALITIES,
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * What the server needs before it starts a job: the quality, and whether the
 * map can become a scene. Also mapGenAutoStart, which the server
 * reads when the module introduces itself; an older server ignores the field.
 */
export const getMapSettings: QueryHandler = {
  access: { kind: 'read' },
  run: (_data, context) => {
    requireWorld();
    const notes: string[] = [];
    const stored = readSetting(MAP_SETTING.quality);
    let quality = DEFAULT_MAP_QUALITY;
    if (isMapQuality(stored)) quality = stored;
    else if (stored !== undefined)
      notes.push(
        `The world setting mapGenQuality holds "${String(stored)}", which is no quality; "low" is used.`
      );

    const problems: string[] = [];
    const refused = context.accessProblem(UPLOAD_ACCESS);
    if (refused) problems.push(refused);
    const user = game.user as FoundryMapsUser | null;
    if (typeof user?.can === 'function' && !user.can('FILES_UPLOAD'))
      problems.push(
        `The Foundry user "${user.name}" may not upload files (permission "Upload New Files").`
      );

    return {
      protocol: MAPS_PROTOCOL,
      quality,
      sceneProblem: problems.length ? problems.join(' ') : null,
      notes,
      autoStart: readSetting(MAP_SETTING.autoStart) === true,
    };
  },
};

/** A failed job, shown to the Gamemaster. */
export const mapJobFailed: QueryHandler = {
  access: { kind: 'read' },
  run: raw => {
    const data = isRecord(raw) ? raw : {};
    const name =
      typeof data['name'] === 'string' && data['name'] ? data['name'] : String(data['jobId'] ?? '');
    const reason =
      typeof data['reason'] === 'string' && data['reason'] ? data['reason'] : 'unknown cause';
    return { shown: announce('mapJobFailed', { name, reason }) };
  },
};

/**
 * `generate-map`, `check-map-status` and `cancel-map-job` came from a server of
 * the previous generation, which let the module relay them back to it. This
 * module cannot send anything to a server on its own, and the map generator of
 * this generation runs in the server alone.
 */
export const legacyMapRelay: QueryHandler = {
  access: { kind: 'read' },
  run: () => {
    throw new QueryError(
      'SERVER_TOO_OLD',
      'This version of the Foundry module no longer relays map jobs: the map generator runs entirely in the MCP server now. Update the MCP server on the PC to generate maps.'
    );
  },
};
