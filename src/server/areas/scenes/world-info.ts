/**
 * get-world-info and the resource foundry://world/info.
 *
 * Formatting happens here, on the server, for modules of both generations:
 *
 * - The raw form every module sends: `system` as the id string,
 *   `systemVersion`, `foundryVersion`, `users` as a list of every user.
 * - The already formatted form (`system` and `foundry` as objects, `users`
 *   as counters with `activeUsers`), which a module of an early rewrite
 *   state sent, is recognised and kept.
 *
 * Every field is read in whichever of the two shapes it arrives, so a mixed
 * answer works too. An answer without world id and title is an error with
 * the answer in it, not something passed on as if it were world information.
 */
import type { ResourceDefinition } from '../../tools/resources.js';
import { legacyFailure } from '../../tools/results.js';
import { readOnlyTool, type ToolDefinition } from '../../tools/types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, fallback = 'unknown'): string {
  return typeof value === 'string' && value ? value : fallback;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

export interface WorldInfo {
  id: string;
  title: string;
  system: { id: string; version: string };
  foundry: { version: string };
  users: { total: number; active: number; gms: number; players: number };
  activeUsers: Array<{ id: string; name: string; isGM: boolean }>;
}

function preview(raw: unknown): string {
  let json: string;
  try {
    json = JSON.stringify(raw) ?? String(raw);
  } catch {
    json = String(raw);
  }
  return json.length > 300 ? `${json.slice(0, 300)}...` : json;
}

export function formatWorldInfo(raw: unknown): WorldInfo {
  const failure = legacyFailure(raw);
  if (failure !== null) throw new Error(failure);
  if (!isRecord(raw) || typeof raw['id'] !== 'string' || typeof raw['title'] !== 'string') {
    throw new Error(
      `The module answered getWorldInfo in a shape this server does not know (no world id and title): ${preview(raw)}`
    );
  }

  const system = raw['system'];
  const systemInfo = isRecord(system)
    ? { id: text(system['id']), version: text(system['version']) }
    : { id: text(system), version: text(raw['systemVersion']) };

  const foundry = raw['foundry'];
  const foundryVersion = isRecord(foundry) ? text(foundry['version']) : text(raw['foundryVersion']);

  const users = raw['users'];
  let counters: WorldInfo['users'];
  let activeUsers: WorldInfo['activeUsers'];
  if (Array.isArray(users)) {
    // Counted over every user of the world, logged in or not, as the previous server did.
    const list = users.filter(isRecord);
    counters = {
      total: list.length,
      active: list.filter(user => user['active'] === true).length,
      gms: list.filter(user => user['isGM'] === true).length,
      players: list.filter(user => user['isGM'] !== true).length,
    };
    activeUsers = list
      .filter(user => user['active'] === true)
      .map(user => ({
        id: text(user['id'], ''),
        name: text(user['name'], ''),
        isGM: user['isGM'] === true,
      }));
  } else {
    const given = isRecord(users) ? users : {};
    counters = {
      total: count(given['total']),
      active: count(given['active']),
      gms: count(given['gms']),
      players: count(given['players']),
    };
    const active = Array.isArray(raw['activeUsers']) ? raw['activeUsers'] : [];
    activeUsers = active.filter(isRecord).map(user => ({
      id: text(user['id'], ''),
      name: text(user['name'], ''),
      isGM: user['isGM'] === true,
    }));
  }

  return {
    id: raw['id'],
    title: raw['title'],
    system: systemInfo,
    foundry: { version: foundryVersion },
    users: counters,
    activeUsers,
  };
}

export const getWorldInfoTool: ToolDefinition = {
  name: 'get-world-info',
  title: 'World information',
  group: 'world',
  description:
    'Read the basics of the Foundry world that is open right now: its id and title, the game system and its ' +
    'version, the Foundry version, how many users exist, and who is logged in. Use it first to learn which ' +
    'world and system you are working with.',
  inputSchema: { type: 'object', properties: {} },
  annotations: readOnlyTool('World information'),
  handler: async (_args, context) =>
    formatWorldInfo(await context.query('getWorldInfo', {})) as unknown as Record<string, unknown>,
};

export const worldInfoResource: ResourceDefinition = {
  uri: 'foundry://world/info',
  name: 'world-info',
  title: 'World information',
  description: 'The open world, its game system, the Foundry version and who is logged in.',
  mimeType: 'application/json',
  read: async context => {
    const options = context.signal ? { signal: context.signal } : {};
    return JSON.stringify(
      formatWorldInfo(await context.query('getWorldInfo', {}, options)),
      null,
      2
    );
  },
};
