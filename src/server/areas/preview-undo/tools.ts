/**
 * list-changes and undo-change: the change log for the model.
 *
 * Both names are new; the previous generation had no such tools. They name verb and
 * subject like the other tools. Redo is no tool of its own: every undo is an
 * entry in the log, and undoing that entry redoes.
 */
import { isData } from '../../../common/areas/preview-undo/rules.js';
import { messageOf, moduleTooOld } from '../../tools/results.js';
import {
  readOnlyTool,
  writingTool,
  type ToolContext,
  type ToolDefinition,
} from '../../tools/types.js';

/** An object schema from `name: [type, description]` pairs. */
const params = (fields: Record<string, [string, string]>) => ({
  type: 'object',
  properties: Object.fromEntries(
    Object.entries(fields).map(([name, [type, description]]) => [name, { type, description }])
  ),
});

const rows = (value: unknown) => (Array.isArray(value) ? value.filter(isData) : []);
const words = (value: unknown) => (Array.isArray(value) ? value.map(String) : []);

/** Ask the module; a module without the query is older than this server. */
function asker(query: string, operation: string) {
  return (context: ToolContext, data: unknown) =>
    context.query(query, data).catch((error: unknown) => {
      throw (
        moduleTooOld(query, error, operation) ??
        new Error(`Failed to ${operation}: ${messageOf(error)}`)
      );
    });
}

function targetText(target: unknown): string {
  if (!isData(target)) return '?';
  const label = typeof target['name'] === 'string' ? `"${target['name']}" ` : '';
  const where =
    target['uuid'] ??
    (target['documentName']
      ? `${String(target['documentName'])} ${String(target['id'])}`
      : target['id']);
  return `${label}(${String(where ?? '?')})`;
}

function stateText(entry: Record<string, unknown>): string {
  if (entry['undoneAt']) return `undone at ${String(entry['undoneAt'])}`;
  if (entry['reversible'] === true) return 'reversible';
  return `not reversible: ${String(entry['notReversibleBecause'] ?? 'unknown')}`;
}

export function formatHistory(answer: unknown): string {
  if (!isData(answer) || !Array.isArray(answer['entries']))
    return `The module answered in an unknown shape: ${JSON.stringify(answer)}`;
  const note = typeof answer['note'] === 'string' ? answer['note'] : '';
  const entries = rows(answer['entries']);
  if (entries.length === 0) return `No change matches. ${note}`.trim();
  const out = [`${entries.length} of ${String(answer['total'])} matching changes, newest first:`];
  for (const entry of entries) {
    const who = isData(entry['user']) ? ` by ${String(entry['user']['name'])}` : '';
    const undid = entry['undoes'] ? `; this entry undid ${String(entry['undoes'])}` : '';
    out.push(
      `- ${String(entry['id'])} at ${String(entry['at'])}${who}, call ${String(entry['callId'] ?? '(none)')}`,
      `  ${String(entry['tool'] ?? entry['query'])}: ${String(entry['action'])} ${words(entry['kinds']).join(', ')}; ` +
        (Array.isArray(entry['targets']) ? entry['targets'].map(targetText).join(', ') : ''),
      `  ${String(entry['summary'])}`,
      `  ${stateText(entry)}${undid}`
    );
  }
  if (note) out.push(note);
  return out.join('\n');
}

function dryRunText(answer: Record<string, unknown>): string {
  const out = [
    `Dry run: the undo would ${answer['wouldUndo'] === true ? 'run' : 'be refused'}. Nothing was changed.`,
  ];
  if (typeof answer['permission'] === 'string') out.push(`Permission: ${answer['permission']}`);
  for (const refusal of words(answer['refusals'])) out.push(`Refused: ${refusal}`);
  for (const change of rows(answer['changes'])) {
    out.push(
      `- ${String(change['changeId'])} (${String(change['tool'])}): ${String(change['summary'])}`
    );
    for (const item of rows(change['targets'])) {
      const fields = words(item['fields']);
      out.push(
        `  ${String(item['operation'])} ${targetText(item['target'])}${fields.length ? `, fields ${fields.join(', ')}` : ''}`,
        ...words(item['conflicts']).map(conflict => `  conflict: ${conflict}`)
      );
    }
  }
  return out.join('\n');
}

export function formatUndo(answer: unknown): string {
  if (!isData(answer)) return `The module answered in an unknown shape: ${JSON.stringify(answer)}`;
  if (answer['dryRun'] === true) return dryRunText(answer);
  const done = rows(answer['undone']);
  const out = [`Undid ${done.length} change(s), newest first, each read back:`];
  for (const outcome of done) {
    const recorded = outcome['restoredBy']
      ? ` Recorded as ${String(outcome['restoredBy'])}; undo that entry to redo.`
      : ' Nothing had to be written.';
    out.push(`- ${String(outcome['changeId'])}: ${String(outcome['summary'])}${recorded}`);
    for (const item of rows(outcome['targets'])) {
      const fields = words(item['fields']);
      const note = typeof item['note'] === 'string' ? ` (${item['note']})` : '';
      out.push(
        `  ${String(item['operation'])} ${targetText(item['target'])}${fields.length ? `, fields ${fields.join(', ')}` : ''}${note}`
      );
    }
  }
  return out.join('\n');
}

const listHistory = asker('listChangeHistory', 'list the changes');
const undoChanges = asker('undoChanges', 'undo the changes');

export const listChangesTool: ToolDefinition = {
  name: 'list-changes',
  title: 'List recent changes',
  description:
    'List the changes the AI made to the world, newest first, from the change log of this session: when, by which ' +
    'Gamemaster, which tool, which documents, and whether each can be undone (and why not). Every entry has an id and ' +
    'the id of its tool call for undo-change. The log keeps the latest 200 changes and starts empty when the ' +
    'Gamemaster reloads the world.',
  group: 'history',
  inputSchema: params({
    limit: ['integer', 'How many entries, 1 to 200; default 20'],
    callId: ['string', 'Only the changes of this tool call'],
    tool: ['string', 'Only changes of this tool (or query) name'],
    document: [
      'string',
      'Only changes of this kind, e.g. "Journals", "Scenes", "Actors", "Items", "ChatMessages"',
    ],
  }),
  annotations: readOnlyTool('List recent changes'),
  handler: async (args, context) => formatHistory(await listHistory(context, args)),
};

export const undoChangeTool: ToolDefinition = {
  name: 'undo-change',
  title: 'Undo changes',
  description:
    'Undo changes from the change log: one change (changeId), the changes of one tool call (callId, optionally only ' +
    'the last count of them), or without either the latest tool call that is not undone yet. Updates get their ' +
    'recorded fields back, created documents are removed (only if unchanged since), deleted documents are recreated ' +
    'with their old id. Refused as a whole, with the cause, when a change cannot be undone (chat messages, ' +
    'notifications, world time, pause, files, settings), when the permission level for the original change is ' +
    'missing, or when the documents changed since (force: true restores fields anyway, never removes). Every undo is ' +
    'itself logged; undo that entry to redo. Use dryRun first.',
  group: 'history',
  inputSchema: params({
    changeId: ['string', 'Id of one change from list-changes'],
    callId: ['string', 'Id of a tool call from list-changes; undoes its changes newest first'],
    count: ['integer', 'With callId or alone: only the last this many changes, 1 to 50'],
    force: [
      'boolean',
      'Restore changed fields even when the document changed since the entry; default false',
    ],
    dryRun: ['boolean', 'Only check and show what would be undone; nothing is written'],
  }),
  annotations: writingTool('Undo changes', { destructive: true, idempotent: false }),
  handler: async (args, context) => formatUndo(await undoChanges(context, args)),
};
