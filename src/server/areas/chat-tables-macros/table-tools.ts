/**
 * get-roll-table, draw-roll-table, reset-roll-table, update-roll-table.
 */
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
} from './shared.js';

function rangeText(range: unknown): string {
  const [from, to] = listOf(range);
  if (typeof from !== 'number' || typeof to !== 'number') return '?';
  return from === to ? String(from) : `${from}-${to}`;
}

export function formatRollTable(answer: unknown): string {
  if (!isRecord(answer) || typeof answer['id'] !== 'string') return unknownShape(answer);
  const lines = [
    `Roll table "${str(answer['name'])}" (id ${answer['id']}), formula ${str(answer['formula']) || 'none'}, ` +
      `${answer['replacement'] === false ? 'draws without replacement' : 'draws with replacement'}, ` +
      `${String(answer['available'])} of ${String(answer['entries'])} entries left.`,
  ];
  const folder = str(answer['folder']);
  if (folder) lines.push(`Folder: ${folder}`);
  const description = str(answer['description']);
  if (description) lines.push(`Description: ${description}`);
  for (const result of listOf(answer['results']).filter(isRecord)) {
    const document = str(result['documentUuid']);
    lines.push(
      `[${str(result['id'])}] ${rangeText(result['range'])} (weight ${String(result['weight'])}): ` +
        `${str(result['text']) || '(no text)'}${document ? ` -> ${document}` : ''}${result['drawn'] === true ? ' [drawn]' : ''}`
    );
  }
  return lines.join('\n');
}

export function formatDraw(answer: unknown): string {
  if (!isRecord(answer) || !Array.isArray(answer['draws'])) return unknownShape(answer);
  const draws = answer['draws'].filter(isRecord);
  const how =
    answer['mode'] === 'roll'
      ? 'rolled without marking entries'
      : answer['drawnMarked'] === true
        ? 'drawn without replacement, entries marked as drawn'
        : 'drawn with replacement';
  const lines = [
    `Roll table "${str(answer['tableName'])}" (id ${str(answer['tableId'])}), ${draws.length} time(s), ${how}:`,
  ];
  draws.forEach((draw, index) => {
    const results = listOf(draw['results'])
      .filter(isRecord)
      .map(result => `${str(result['text']) || '(no text)'} [${str(result['id'])}]`);
    lines.push(
      `${index + 1}. ${str(draw['formula'])} = ${typeof draw['total'] === 'number' ? draw['total'] : '?'}: ` +
        `${results.join(' + ') || 'no entry'}`
    );
  });
  lines.push(`Entries left: ${String(answer['available'])} of ${String(answer['entries'])}.`);
  const messages = listOf(answer['messages']).map(String);
  lines.push(
    answer['chat'] === 'none' || answer['chat'] === undefined
      ? 'Not posted to the chat.'
      : `Posted to the chat (${str(answer['chat'])}): ${messages.join(', ') || 'no message'}.`
  );
  lines.push(...warningLines(answer));
  return lines.join('\n');
}

export const getRollTableTool: ToolDefinition = {
  name: 'get-roll-table',
  title: 'Read a roll table',
  group: 'rolltables',
  description:
    'Read one roll table with its settings and every entry: id, range, weight, text and whether it is drawn. ' +
    'The entry ids are what update-roll-table needs.',
  inputSchema: schema({ tableId: param('string', 'Id or exact name of the table') }, ['tableId']),
  annotations: readOnlyTool('Read a roll table'),
  handler: async (args, context) =>
    formatRollTable(await ask(context, 'getRollTable', pick(args, ['tableId']), 'read roll table')),
};

export const drawRollTableTool: ToolDefinition = {
  name: 'draw-roll-table',
  title: 'Draw from a roll table',
  group: 'rolltables',
  description:
    'Roll on a roll table and return the entries. mode "draw" follows the table: a table without replacement ' +
    'marks drawn entries so they do not come again. mode "roll" never marks anything. Nothing goes to the chat ' +
    'unless chat is set.',
  inputSchema: schema(
    {
      tableId: param('string', 'Id or exact name of the table'),
      count: param('integer', 'How many draws, 1 to 100; default 1'),
      mode: param(
        'string',
        '"draw" (default) follows the table\'s replacement setting; "roll" marks nothing',
        {
          enum: ['draw', 'roll'],
        }
      ),
      chat: param(
        'string',
        'Post the result: "none" (default), "public", "gm" (Gamemasters only), "self", "blind" (Gamemasters only, hidden from the roller)',
        { enum: ['none', 'public', 'gm', 'self', 'blind'] }
      ),
    },
    ['tableId']
  ),
  annotations: writingTool('Draw from a roll table', { destructive: false, idempotent: false }),
  handler: async (args, context) =>
    formatDraw(
      await ask(
        context,
        'drawRollTable',
        pick(args, ['tableId', 'count', 'mode', 'chat']),
        'draw from roll table'
      )
    ),
};

export const resetRollTableTool: ToolDefinition = {
  name: 'reset-roll-table',
  title: 'Return drawn entries to a roll table',
  group: 'rolltables',
  description: 'Return every drawn entry of a roll table, so all entries can be drawn again.',
  inputSchema: schema({ tableId: param('string', 'Id or exact name of the table') }, ['tableId']),
  annotations: writingTool('Return drawn entries to a roll table', {
    destructive: true,
    idempotent: true,
  }),
  handler: async (args, context) => {
    const answer = await ask(
      context,
      'resetRollTable',
      pick(args, ['tableId']),
      'reset roll table'
    );
    if (!isRecord(answer) || typeof answer['id'] !== 'string') return unknownShape(answer);
    return answer['changed'] === true
      ? `Roll table "${str(answer['name'])}": ${String(answer['returned'])} drawn entries returned; all ${String(answer['entries'])} can be drawn again.`
      : `Roll table "${str(answer['name'])}": no entry was drawn, nothing changed.`;
  },
};

const ENTRY_TEXT = param('string', 'Text of the entry');
const ENTRY_RANGE = param('array', '[from, to], two whole numbers', { items: { type: 'integer' } });
const ENTRY_WEIGHT = param('integer', 'Weight, a whole number from 1');

export const updateRollTableTool: ToolDefinition = {
  name: 'update-roll-table',
  title: 'Change a roll table',
  group: 'rolltables',
  description:
    'Change the settings and entries of a roll table: name, description, formula, replacement (false means drawn ' +
    'entries do not come again), displayRoll, change entries by id, add entries, remove entries by id. The whole ' +
    'result is checked before anything is written: overlapping ranges are refused, gaps are warnings. Removing ' +
    'entries needs the roll table permission set to full. Entry ids come from get-roll-table.',
  inputSchema: schema(
    {
      tableId: param('string', 'Id or exact name of the table'),
      name: param('string', 'New name'),
      description: param('string', 'New description; an empty text removes it'),
      formula: param('string', 'New dice formula, e.g. "1d8"'),
      replacement: param(
        'boolean',
        'true: drawn entries stay in the table; false: they are marked and skipped'
      ),
      displayRoll: param('boolean', 'Show the roll in the chat message of a draw'),
      results: param('array', 'Changes to existing entries', {
        items: schema(
          {
            id: param('string', 'Id of the entry'),
            text: ENTRY_TEXT,
            range: ENTRY_RANGE,
            weight: ENTRY_WEIGHT,
            drawn: param('boolean', 'Mark as drawn or not'),
          },
          ['id']
        ),
      }),
      addResults: param('array', 'New entries; a missing range follows the highest one', {
        items: schema({ text: ENTRY_TEXT, range: ENTRY_RANGE, weight: ENTRY_WEIGHT }, ['text']),
      }),
      removeResults: param('array', 'Ids of entries to remove', { items: { type: 'string' } }),
    },
    ['tableId']
  ),
  annotations: writingTool('Change a roll table', { destructive: true, idempotent: false }),
  handler: async (args, context) => {
    const answer = await ask(
      context,
      'updateRollTable',
      pick(args, [
        'tableId',
        'name',
        'description',
        'formula',
        'replacement',
        'displayRoll',
        'results',
        'addResults',
        'removeResults',
      ]),
      'change roll table'
    );
    if (!isRecord(answer) || typeof answer['id'] !== 'string') return unknownShape(answer);
    const parts: string[] = [];
    const settings = listOf(answer['changedSettings']).map(String);
    if (settings.length) parts.push(`settings ${settings.join(', ')}`);
    const changed = listOf(answer['changedEntries']).map(String);
    if (changed.length) parts.push(`entries changed ${changed.join(', ')}`);
    const added = listOf(answer['addedEntries']).map(String);
    if (added.length) parts.push(`entries added ${added.join(', ')}`);
    const removed = listOf(answer['removedEntries']).map(String);
    if (removed.length) parts.push(`entries removed ${removed.join(', ')}`);
    return [
      `Roll table "${str(answer['name'])}" (id ${answer['id']}) changed: ${parts.join('; ')}.`,
      `Now: formula ${str(answer['formula']) || 'none'}, ${answer['replacement'] === false ? 'without' : 'with'} ` +
        `replacement, ${String(answer['entries'])} entries.`,
      ...warningLines(answer),
    ].join('\n');
  },
};
