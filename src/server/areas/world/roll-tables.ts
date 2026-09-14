/**
 * list-roll-tables, create-roll-table, delete-roll-table.
 */
import { readOnlyTool, writingTool, type ToolDefinition } from '../../tools/types.js';
import { askModule, isRecord, listIn, param, schema, str, unknownShape } from './shared.js';

export function formatRollTables(answer: unknown): string {
  const list = listIn(answer, 'tables');
  if (!list) return unknownShape(answer);
  if (!list.length) return 'No roll tables in this world.';
  return list
    .filter(isRecord)
    .map(table => {
      const count = typeof table['resultCount'] === 'number' ? table['resultCount'] : 0;
      const formula = str(table['formula']) || 'no formula';
      return `${str(table['name'])} (${formula}, ${count} entries, id ${str(table['id'])})`;
    })
    .join('\n');
}

export function formatCreatedTable(answer: unknown): string {
  if (!isRecord(answer) || typeof answer['id'] !== 'string') return unknownShape(answer);
  // `entries` from this generation, `resultCount` from the previous module.
  const count = typeof answer['entries'] === 'number' ? answer['entries'] : answer['resultCount'];
  const lines = [
    `Roll table "${str(answer['name'])}" created (${str(answer['formula'])}, ${typeof count === 'number' ? count : 'unknown'} entries)`,
    `Id: ${answer['id']}`,
  ];
  const folder = str(answer['folderPath']);
  if (folder) lines.push(`Folder: ${folder}`);
  const created = Array.isArray(answer['foldersCreated'])
    ? answer['foldersCreated'].map(String)
    : [];
  if (created.length) lines.push(`Folders created: ${created.join(', ')}`);
  const warnings = Array.isArray(answer['warnings']) ? answer['warnings'].map(String) : [];
  for (const warning of warnings) lines.push(`Warning: ${warning}`);
  return lines.join('\n');
}

export const listRollTablesTool: ToolDefinition = {
  name: 'list-roll-tables',
  title: 'List roll tables',
  group: 'rolltables',
  description: 'List the roll tables in the world with their formula and number of results.',
  inputSchema: schema({}),
  annotations: readOnlyTool('List roll tables'),
  handler: async (_args, context) =>
    formatRollTables(await askModule(context, 'listRollTables', {}, 'list roll tables')),
};

export const createRollTableTool: ToolDefinition = {
  name: 'create-roll-table',
  title: 'Create a roll table',
  group: 'rolltables',
  description:
    'Create a roll table from a list of text results. Ranges are assigned consecutively when omitted (first entry ' +
    '1, second 2, and so on) and the dice formula is derived from the highest range, so a six-entry table becomes ' +
    '1d6 by itself. Overlapping ranges are refused; gaps, and numbers the formula can roll without an entry, are ' +
    'reported as warnings.',
  inputSchema: schema(
    {
      name: param('string', 'Name of the new table'),
      description: param('string', 'Optional description shown with the table'),
      formula: param(
        'string',
        'Dice formula such as "1d6"; derived from the highest range when left out'
      ),
      folderPath: param(
        'string',
        'Folder for the table; nested levels separated by "/" are created'
      ),
      results: param('array', 'The entries in order', {
        items: schema(
          {
            text: param('string', 'Text of the entry'),
            range: param('array', 'Optional [from, to], two whole numbers', {
              items: { type: 'number' },
            }),
            weight: param('number', 'Optional weight, a whole number, 1 when left out'),
          },
          ['text']
        ),
      }),
    },
    ['name', 'results']
  ),
  annotations: writingTool('Create a roll table', { destructive: false, idempotent: false }),
  handler: async (args, context) => {
    const data: Record<string, unknown> = { name: args['name'], results: args['results'] };
    for (const key of ['description', 'formula', 'folderPath']) {
      if (args[key] !== undefined) data[key] = args[key];
    }
    return formatCreatedTable(
      await askModule(context, 'createRollTable', data, 'create roll table')
    );
  },
};

export const deleteRollTableTool: ToolDefinition = {
  name: 'delete-roll-table',
  title: 'Delete a roll table',
  group: 'rolltables',
  description:
    'Delete a roll table by its id. Requires the roll table permission to be set to full.',
  inputSchema: schema({ tableId: param('string', 'Id of the table to delete') }, ['tableId']),
  annotations: writingTool('Delete a roll table', { destructive: true, idempotent: true }),
  handler: async (args, context) => {
    const answer = await askModule(
      context,
      'deleteRollTable',
      { tableId: args['tableId'] },
      'delete roll table'
    );
    const name = isRecord(answer) ? str(answer['name']) : '';
    return name ? `Roll table "${name}" deleted.` : unknownShape(answer);
  },
};
