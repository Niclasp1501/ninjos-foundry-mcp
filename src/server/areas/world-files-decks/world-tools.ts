/**
 * World time, pause, notifications, users and settings.
 */
import { readOnlyTool, writingTool, type ToolDefinition } from '../../tools/types.js';
import {
  ask,
  DRY_RUN,
  isRecord,
  listOf,
  param,
  pick,
  schema,
  str,
  unknownShape,
} from './shared.js';

function timeLine(value: unknown): string {
  if (!isRecord(value)) return 'unknown';
  const calendar = isRecord(value['calendar']) ? value['calendar'] : null;
  const parts = [`${String(value['worldTime'])} seconds`];
  if (calendar) {
    if (typeof calendar['formatted'] === 'string') parts.push(calendar['formatted']);
    if (typeof calendar['name'] === 'string') parts.push(`calendar "${calendar['name']}"`);
    if (typeof calendar['problem'] === 'string')
      parts.push(`calendar problem: ${calendar['problem']}`);
  }
  return parts.join(', ');
}

export function formatWorldTime(answer: unknown): string {
  if (!isRecord(answer) || typeof answer['worldTime'] !== 'number') return unknownShape(answer);
  const lines = [`World time: ${timeLine(answer)}.`];
  if (!isRecord(answer['calendar']))
    lines.push('No calendar is configured; the time is only seconds.');
  else if (isRecord(answer['calendar']['components']))
    lines.push(`Calendar parts: ${JSON.stringify(answer['calendar']['components'])}`);
  lines.push(answer['paused'] === true ? 'The game is paused.' : 'The game is running.');
  return lines.join('\n');
}

export const getWorldTimeTool: ToolDefinition = {
  name: 'get-world-time',
  title: 'Read the world time',
  group: 'world',
  description:
    "Read Foundry's world time in seconds, formatted by the world's calendar when one is configured, and whether the game is paused.",
  inputSchema: schema({}),
  annotations: readOnlyTool('Read the world time'),
  handler: async (_args, context) =>
    formatWorldTime(await ask(context, 'getWorldTime', {}, 'read the world time')),
};

export const advanceWorldTimeTool: ToolDefinition = {
  name: 'advance-world-time',
  title: 'Advance the world time',
  group: 'world',
  description:
    'Move the world time forward (or back with a negative number) by a number of seconds, through Foundry, so ' +
    'effects, calendars and modules react as at the table. 3600 is an hour and 86400 a day in the default ' +
    'calendar. The new time is read back. Needs the write switch.',
  inputSchema: schema(
    {
      seconds: param(
        'integer',
        'Seconds to add; negative moves back. At most ten years either way.'
      ),
      dryRun: DRY_RUN,
    },
    ['seconds']
  ),
  annotations: writingTool('Advance the world time', { destructive: false, idempotent: false }),
  handler: async (args, context) => {
    const answer = await ask(
      context,
      'advanceWorldTime',
      pick(args, ['seconds', 'dryRun']),
      'advance the world time'
    );
    if (!isRecord(answer) || !isRecord(answer['after'])) return unknownShape(answer);
    const head = answer['dryRun'] === true ? 'Dry run, nothing changed.' : 'World time advanced.';
    return [
      head,
      `Before: ${timeLine(answer['before'])}`,
      `After: ${timeLine(answer['after'])}`,
    ].join('\n');
  },
};

export const setGamePauseTool: ToolDefinition = {
  name: 'set-game-pause',
  title: 'Pause or resume the game',
  group: 'world',
  description:
    'Pause (paused: true) or resume (paused: false) the game for everyone. Needs the write switch.',
  inputSchema: schema({ paused: param('boolean', 'true pauses, false resumes') }, ['paused']),
  annotations: writingTool('Pause or resume the game', { destructive: false, idempotent: true }),
  handler: async (args, context) => {
    const answer = await ask(
      context,
      'setGamePause',
      pick(args, ['paused']),
      'pause or resume the game'
    );
    if (!isRecord(answer) || typeof answer['paused'] !== 'boolean') return unknownShape(answer);
    const state = answer['paused'] ? 'paused' : 'running';
    return answer['changed'] === true
      ? `The game is now ${state} for everyone.`
      : `The game was already ${state}; nothing changed.`;
  },
};

function names(value: unknown): string {
  return listOf(value)
    .filter(isRecord)
    .map(user => str(user['name']))
    .join(', ');
}

export const sendNotificationTool: ToolDefinition = {
  name: 'send-notification',
  title: 'Send a notification',
  group: 'users',
  description:
    'Show a short notification (plain text, at most 500 characters) in Foundry to everyone or to chosen users, ' +
    'with the Gamemaster named as sender. Users are matched by id or exact name. Users who are not logged in do ' +
    'not get it, and it is not stored. Needs the write switch.',
  inputSchema: schema(
    {
      message: param('string', 'The text to show'),
      level: param('string', 'How it looks: info (default), warn or error', {
        enum: ['info', 'warn', 'error'],
      }),
      users: param('array', 'Ids or exact names of the users; leave out for everyone', {
        items: { type: 'string' },
      }),
    },
    ['message']
  ),
  annotations: writingTool('Send a notification', { destructive: false, idempotent: false }),
  handler: async (args, context) => {
    const answer = await ask(
      context,
      'sendNotification',
      pick(args, ['message', 'level', 'users']),
      'send notification'
    );
    if (!isRecord(answer) || !Array.isArray(answer['sentTo'])) return unknownShape(answer);
    const lines = [`Notification (${str(answer['level'])}) sent.`];
    if (answer['shownHere'] === true) lines.push('Shown in the Gamemaster browser.');
    const sent = names(answer['sentTo']);
    if (sent) lines.push(`Sent to the logged in users: ${sent}.`);
    const offline = names(answer['notLoggedIn']);
    if (offline) lines.push(`Not logged in, so they do not get it: ${offline}.`);
    if (typeof answer['note'] === 'string') lines.push(answer['note']);
    return lines.join('\n');
  },
};

export const listUsersTool: ToolDefinition = {
  name: 'list-users',
  title: 'List users',
  group: 'users',
  description:
    'List the users of the world with role, whether they are logged in, their assigned character and the scene ' +
    'they are viewing. No passwords or access data.',
  inputSchema: schema({ onlyActive: param('boolean', 'Only users who are logged in now') }),
  annotations: readOnlyTool('List users'),
  handler: async (args, context) => {
    const answer = await ask(context, 'listUsers', pick(args, ['onlyActive']), 'list users');
    if (!isRecord(answer) || !Array.isArray(answer['users'])) return unknownShape(answer);
    const users = answer['users'].filter(isRecord);
    if (!users.length) return 'No users match.';
    return users
      .map(user => {
        const notes = [
          str(user['roleName']),
          user['active'] === true ? 'logged in' : 'not logged in',
          ...(user['isSelf'] === true ? ['this is the connected Gamemaster'] : []),
          ...(isRecord(user['character'])
            ? [`character ${str(user['character']['name'], '?')} (${str(user['character']['id'])})`]
            : []),
          ...(isRecord(user['viewedScene'])
            ? [
                `viewing ${str(user['viewedScene']['name'], '?')} (${str(user['viewedScene']['id'])})`,
              ]
            : []),
        ];
        return `[${str(user['id'])}] ${str(user['name'])}: ${notes.join(', ')}`;
      })
      .join('\n');
  },
};

export const listSettingsTool: ToolDefinition = {
  name: 'list-settings',
  title: 'List settings',
  group: 'world',
  description:
    'Read registered world and client settings of the core ("core") or of chosen modules and systems, with name, ' +
    'scope, type and value. Values whose key looks like a secret are hidden, and the settings of this MCP module ' +
    'are not listed (get-permissions shows them). Client settings are those of the Gamemaster browser.',
  inputSchema: schema({
    namespaces: param('array', 'Module, system or "core" ids; default ["core"]', {
      items: { type: 'string' },
    }),
    scope: param('string', 'world, client or all (default)', { enum: ['world', 'client', 'all'] }),
    keyContains: param('string', 'Only keys containing this text, any case'),
    includeValues: param('boolean', 'Include the current values (default true)'),
    limit: param('integer', 'At most this many settings, 1 to 500, default 200'),
  }),
  annotations: readOnlyTool('List settings'),
  handler: async (args, context) => {
    const answer = await ask(
      context,
      'listSettings',
      pick(args, ['namespaces', 'scope', 'keyContains', 'includeValues', 'limit']),
      'list settings'
    );
    if (!isRecord(answer) || !Array.isArray(answer['settings'])) return unknownShape(answer);
    const rows = answer['settings'].filter(isRecord);
    const lines = [`${rows.length} of ${String(answer['total'])} settings:`];
    for (const row of rows) {
      const value =
        typeof row['hidden'] === 'string'
          ? '(hidden, looks like a secret)'
          : 'valueError' in row
            ? `(could not be read: ${str(row['valueError'])})`
            : 'value' in row
              ? JSON.stringify(row['value']) +
                (row['valueTruncated'] === true ? ' (shortened)' : '')
              : '';
      const label = str(row['name']);
      lines.push(
        `${str(row['id'])} [${str(row['scope'])}, ${str(row['type'])}${row['writable'] === true ? ', writable' : ''}]` +
          (label ? ` "${label}"` : '') +
          (value ? `: ${value}` : '')
      );
    }
    if (answer['truncated'] === true)
      lines.push('More settings match; narrow with keyContains or raise limit.');
    if (Number(answer['otherScopesSkipped']) > 0)
      lines.push(
        `${String(answer['otherScopesSkipped'])} setting(s) of other scopes (such as user) are not listed.`
      );
    const writable = listOf(answer['writableList']).map(String);
    lines.push(
      writable.length
        ? `World settings the AI may change: ${writable.join(', ')}.`
        : 'No world setting may be changed by the AI yet; the list of writable settings is empty.'
    );
    return lines.join('\n');
  },
};

export const setWorldSettingTool: ToolDefinition = {
  name: 'set-world-setting',
  title: 'Change a world setting',
  group: 'world',
  description:
    'Change a world setting that is on the list of settings the AI may change (list-settings names the list; ' +
    'it is empty until the Gamemaster decides). Only text, number and true/false settings; the value is checked ' +
    'against choices and range and read back. Needs the write switch.',
  inputSchema: schema(
    {
      namespace: param('string', 'Module, system or "core"'),
      key: param('string', 'Key of the setting'),
      value: { description: 'The new value: text, number or true/false' },
      dryRun: DRY_RUN,
    },
    ['namespace', 'key', 'value']
  ),
  annotations: writingTool('Change a world setting', { destructive: true, idempotent: true }),
  handler: async (args, context) => {
    const answer = await ask(
      context,
      'setWorldSetting',
      pick(args, ['namespace', 'key', 'value', 'dryRun']),
      'change world setting'
    );
    if (!isRecord(answer) || typeof answer['id'] !== 'string') return unknownShape(answer);
    if (answer['wouldChange'] === true)
      return `Dry run: ${answer['id']} would change from ${JSON.stringify(answer['before'])} to ${JSON.stringify(answer['value'])}.`;
    if (answer['changed'] !== true)
      return `${answer['id']} already is ${JSON.stringify(answer['value'])}; nothing changed.`;
    return `${answer['id']} changed from ${JSON.stringify(answer['before'])} to ${JSON.stringify(answer['value'])}, read back.`;
  },
};
