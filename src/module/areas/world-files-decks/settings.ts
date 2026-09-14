/**
 * Settings: read registered world and client settings, write listed world settings.
 *
 * The rules are in common/areas/world-files-decks/settings-rules.ts. Reading
 * never shows the settings of this module or a value whose key looks like a
 * secret. Writing checks the list of writable world settings, which is empty
 * until Ninjo fills it; the mechanism is complete and tested with a list of
 * its own (settings.test.ts).
 */
import {
  isOwnNamespace,
  isSecretKey,
  READABLE_SCOPES,
  settingValueForListing,
  settingValueProblem,
  settingWriteRefusal,
  WRITABLE_WORLD_SETTINGS,
} from '../../../common/areas/world-files-decks/settings-rules.js';
import { MODULE_ID } from '../../../common/constants.js';
import { WRITE_SWITCH_ONLY } from '../../../common/permissions.js';
import { QueryError, type QueryHandler } from '../../dispatcher.js';
import { requireWorld } from '../../world-ready.js';
import {
  inputOf,
  invalid,
  listOfTexts,
  messageOf,
  optionalBoolean,
  optionalChoice,
  optionalInteger,
  optionalText,
  recordWorldChange,
  requiredText,
  worldGame,
} from './common.js';

type Config = FoundryWorldFilesDecksSettingConfig;

function registry(): ReadonlyMap<string, Config> {
  const map = worldGame().settings.settings;
  if (!map || typeof map.entries !== 'function')
    throw new QueryError(
      'NOT_AVAILABLE',
      "Foundry's list of registered settings (game.settings.settings) is not available"
    );
  return map;
}

function split(id: string, config: Config): { namespace: string; key: string } {
  const dot = id.indexOf('.');
  return {
    namespace: config.namespace ?? id.slice(0, dot),
    key: config.key ?? id.slice(dot + 1),
  };
}

function typeName(config: Config): string {
  const type = config.type;
  if (typeof type === 'function') return (type as { name?: string }).name || 'custom';
  return type === undefined ? 'unknown' : typeof type;
}

function localized(text: unknown): string | null {
  if (typeof text !== 'string' || !text) return null;
  try {
    return game.i18n.localize(text);
  } catch {
    return text;
  }
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export const listSettings: QueryHandler = {
  access: { kind: 'read' },
  run: data => {
    requireWorld();
    const input = inputOf(data);
    const namespaces = listOfTexts(input, 'namespaces') ?? ['core'];
    if (!namespaces.length) throw invalid('namespaces must name at least one module id, or "core"');
    const own = namespaces.filter(isOwnNamespace);
    if (own.length)
      throw new QueryError(
        'PERMISSION_DENIED',
        `The settings of ${MODULE_ID} are not listed here; get-permissions shows the write switch and the matrix.`
      );
    const scope = optionalChoice(input, 'scope', ['world', 'client', 'all'] as const) ?? 'all';
    const part = optionalText(input, 'keyContains')?.trim().toLowerCase();
    const includeValues = optionalBoolean(input, 'includeValues') !== false;
    const limit = optionalInteger(input, 'limit', 1, 500) ?? 200;

    const entries = [...registry().entries()].map(([id, config]) => ({
      id,
      config,
      ...split(id, config),
    }));
    const known = new Set(entries.map(entry => entry.namespace));
    const unknown = namespaces.filter(namespace => !known.has(namespace));
    if (unknown.length)
      throw new QueryError(
        'NOT_FOUND',
        `No registered settings for ${unknown.map(n => `"${n}"`).join(', ')}. Namespaces with settings: ` +
          [...known]
            .filter(n => !isOwnNamespace(n))
            .sort()
            .join(', ')
      );

    let otherScopes = 0;
    const rows: Array<Record<string, unknown>> = [];
    let matching = 0;
    for (const entry of entries.sort((a, b) => a.id.localeCompare(b.id))) {
      if (!namespaces.includes(entry.namespace)) continue;
      const entryScope = entry.config.scope ?? 'client';
      if (!READABLE_SCOPES.has(entryScope)) {
        otherScopes += 1;
        continue;
      }
      if (scope !== 'all' && entryScope !== scope) continue;
      if (part && !entry.key.toLowerCase().includes(part)) continue;
      matching += 1;
      if (rows.length >= limit) continue;
      const secret = isSecretKey(entry.key);
      const row: Record<string, unknown> = {
        id: entry.id,
        namespace: entry.namespace,
        key: entry.key,
        name: localized(entry.config.name),
        scope: entryScope,
        type: typeName(entry.config),
        listedInSettings: entry.config.config === true,
        writable: settingWriteRefusal(entry.id, entryScope, WRITABLE_WORLD_SETTINGS) === null,
      };
      if (entry.config.choices) row['choices'] = Object.keys(entry.config.choices);
      if (entry.config.range) row['range'] = entry.config.range;
      if (secret) {
        row['hidden'] = 'The key looks like a secret; its value is not shown.';
      } else if (includeValues) {
        try {
          const shown = settingValueForListing(game.settings.get(entry.namespace, entry.key));
          row['value'] = shown.value;
          if (shown.truncated) row['valueTruncated'] = true;
        } catch (error) {
          row['valueError'] = messageOf(error);
        }
      }
      rows.push(row);
    }
    return {
      namespaces,
      scope,
      settings: rows,
      total: matching,
      truncated: matching > rows.length,
      otherScopesSkipped: otherScopes,
      writableList: [...WRITABLE_WORLD_SETTINGS],
    };
  },
};

/** The handler with a list of writable settings; the area uses the empty list of the package. */
export function makeSetWorldSetting(allowlist: readonly string[]): QueryHandler {
  return {
    access: data => (inputOf(data)['dryRun'] === true ? { kind: 'read' } : WRITE_SWITCH_ONLY),
    run: async (data, context) => {
      requireWorld();
      const input = inputOf(data);
      const namespace = requiredText(input, 'namespace');
      const key = requiredText(input, 'key');
      const id = `${namespace}.${key}`;
      if (!('value' in input) || input['value'] === undefined) throw invalid('value is required');
      const value = input['value'];
      const dryRun = optionalBoolean(input, 'dryRun') === true;

      if (isOwnNamespace(namespace)) {
        const refusal = settingWriteRefusal(id, 'world', allowlist);
        throw new QueryError('PERMISSION_DENIED', refusal?.reason ?? 'refused');
      }
      const config = registry().get(id);
      if (!config) throw new QueryError('NOT_FOUND', `"${id}" is not a registered setting.`);
      const refusal = settingWriteRefusal(id, config.scope ?? 'client', allowlist);
      if (refusal)
        throw new QueryError('PERMISSION_DENIED', `Nothing was changed. ${refusal.reason}`);
      const problem = settingValueProblem(value, config);
      if (problem) throw invalid(`"${id}": ${problem} Nothing was changed.`);

      const before = game.settings.get(namespace, key);
      if (same(before, value)) return { id, value, changed: false, dryRun };
      if (dryRun) return { id, before, value, changed: false, wouldChange: true, dryRun };
      try {
        await game.settings.set(namespace, key, value);
      } catch (error) {
        throw new QueryError('SET_FAILED', `Foundry refused to set "${id}": ${messageOf(error)}`);
      }
      const after = game.settings.get(namespace, key);
      if (!same(after, value))
        throw new QueryError(
          'NOT_APPLIED',
          `"${id}" reads back as ${JSON.stringify(after)} after setting ${JSON.stringify(value)}.`
        );
      recordWorldChange(context, 'Settings', {
        query: 'setWorldSetting',
        tool: 'set-world-setting',
        action: 'update',
        targets: [{ name: id }],
        summary: `Changed the world setting ${id} from ${JSON.stringify(before)} to ${JSON.stringify(after)}.`,
        before: { [id]: before },
        after: { [id]: after },
      });
      return { id, before, value: after, changed: true, dryRun };
    },
  };
}

export const setWorldSetting = makeSetWorldSetting(WRITABLE_WORLD_SETTINGS);
