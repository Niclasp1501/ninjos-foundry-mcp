/**
 * The settings of the bridge, the write switch, the permission matrix and the
 * release list for tools of other modules.
 *
 * Every key is the one stored in existing worlds. Settings of later stages
 * (creature index, map generation, limits) are registered when their tools
 * return; their stored values stay untouched in the meantime.
 *
 * One table, in the order of the settings list in the behaviour description:
 * connection, writing, behaviour. All live in the world. Names and hints come
 * from language keys derived from the setting key.
 */
import { MODULE_ID } from '../common/constants.js';
import {
  PERMISSION_SETTINGS,
  WRITE_SWITCH_SETTING,
  type MatrixKind,
} from '../common/permissions.js';

export const SETTING = {
  enabled: 'enabled',
  connectionType: 'connectionType',
  serverHost: 'serverHost',
  serverPort: 'serverPort',
  heartbeatInterval: 'heartbeatInterval',
  enableNotifications: 'enableNotifications',
  autoReconnectEnabled: 'autoReconnectEnabled',
  toolProviderModules: 'toolProviderModules',
  legacyToolProviderModules: 'werkzeugModule',
} as const;

export type SettingChange = (key: string, value: unknown) => void;

/** Read a setting without ever throwing; unregistered or not yet loaded is undefined. */
export function readSetting(key: string): unknown {
  try {
    return game.settings.get(MODULE_ID, key);
  } catch {
    return undefined;
  }
}

/**
 * One setting. Name and hint come from `ninjos-foundry-mcp.settings.<key>.name`
 * and `.hint`, choices from `ninjos-foundry-mcp.settings.<key>.<option>`.
 * Areas contribute rows of the same shape (src/module/areas.ts).
 */
export interface SettingRow {
  key: string;
  kind: typeof String | typeof Number | typeof Boolean;
  initial: string | number | boolean;
  /** Shown in Foundry's settings list. */
  listed: boolean;
  /** Where the value lives. Default: the world. */
  scope?: 'world' | 'client';
  /** Language key suffixes of the offered values, when the value is a choice. */
  options?: readonly string[];
  range?: { min: number; max: number; step: number };
}

type Row = SettingRow;

const LEVELS = ['read', 'write', 'full'] as const;

const matrixRows: Row[] = (Object.keys(PERMISSION_SETTINGS) as MatrixKind[]).map(document => ({
  key: PERMISSION_SETTINGS[document].key,
  kind: String,
  initial: 'write',
  listed: true,
  options: LEVELS,
}));

const ROWS: readonly Row[] = [
  { key: SETTING.enabled, kind: Boolean, initial: true, listed: true },
  {
    key: SETTING.connectionType,
    kind: String,
    initial: 'auto',
    listed: true,
    options: ['auto', 'websocket', 'webrtc'],
  },
  { key: SETTING.serverHost, kind: String, initial: 'localhost', listed: true },
  { key: SETTING.serverPort, kind: Number, initial: 31415, listed: false },
  { key: WRITE_SWITCH_SETTING, kind: Boolean, initial: true, listed: true },
  ...matrixRows,
  { key: SETTING.toolProviderModules, kind: String, initial: '', listed: true },
  { key: SETTING.legacyToolProviderModules, kind: String, initial: '', listed: false },
  { key: SETTING.enableNotifications, kind: Boolean, initial: true, listed: true },
  { key: SETTING.autoReconnectEnabled, kind: Boolean, initial: true, listed: true },
  {
    key: SETTING.heartbeatInterval,
    kind: Number,
    initial: 30,
    listed: true,
    range: { min: 5, max: 300, step: 5 },
  },
];

function choicesOf(row: Row): Record<string, string> | undefined {
  if (!row.options) return undefined;
  // The permission levels share one set of labels; other choices are labelled per setting.
  const prefix = row.options === LEVELS ? 'level' : row.key;
  return Object.fromEntries(
    row.options.map(option => [option, `${MODULE_ID}.settings.${prefix}.${option}`])
  );
}

/**
 * Register the core settings and those of the areas. A key taken twice stops
 * the registration before anything is registered, with the key named.
 */
export function registerSettings(
  onChange: SettingChange,
  areaRows: readonly SettingRow[] = []
): void {
  const rows = [...ROWS, ...areaRows];
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.key)) throw new Error(`The setting "${row.key}" is registered twice`);
    seen.add(row.key);
  }
  for (const row of rows) {
    const config: FoundrySettingConfig = {
      name: `${MODULE_ID}.settings.${row.key}.name`,
      hint: `${MODULE_ID}.settings.${row.key}.hint`,
      scope: row.scope ?? 'world',
      config: row.listed,
      type: row.kind,
      default: row.initial,
      onChange: value => onChange(row.key, value),
    };
    const choices = choicesOf(row);
    if (choices) config.choices = choices;
    if (row.range) config.range = row.range;
    game.settings.register(MODULE_ID, row.key, config);
  }
}
