/**
 * list-macros, create-macro, execute-macro, delete-macro.
 */
import { readOnlyTool, writingTool, type ToolDefinition } from '../../tools/types.js';
import {
  ask,
  isRecord,
  listOf,
  param,
  pick,
  schema,
  SPEAKER_PARAMETERS,
  str,
  unknownShape,
  warningLines,
} from './shared.js';

/** A script can wait on dialogs or long work; the module reports no progress meanwhile. */
export const EXECUTE_MACRO_TIMEOUT_MS = 120_000;

export function formatMacros(answer: unknown): string {
  if (!isRecord(answer) || !Array.isArray(answer['macros'])) return unknownShape(answer);
  const setting = `Running macros (setting macroExecution): ${str(answer['executionSetting'], 'unknown')}.`;
  const macros = answer['macros'].filter(isRecord);
  if (!macros.length) return `No macros match.\n${setting}`;
  const lines = [setting];
  for (const macro of macros) {
    const notes = [
      str(macro['type']),
      ...(str(macro['folder']) ? [`folder ${str(macro['folder'])}`] : []),
      ...(str(macro['author']) ? [`by ${str(macro['author'])}`] : []),
      `${String(macro['commandLines'])} lines`,
      macro['runnable'] === true ? 'can run now' : 'cannot run now',
    ];
    lines.push(`[${str(macro['id'])}] ${str(macro['name'])} (${notes.join(', ')})`);
    if (typeof macro['command'] === 'string')
      lines.push(`  ${macro['command'].replace(/\n/g, '\n  ')}`);
  }
  return lines.join('\n');
}

export function formatExecuted(answer: unknown): string {
  if (!isRecord(answer) || typeof answer['id'] !== 'string') return unknownShape(answer);
  const lines = [
    `Macro "${str(answer['name'])}" (id ${answer['id']}, ${str(answer['type'])}) ran.`,
  ];
  if (answer['type'] === 'script') {
    const returned = answer['returned'];
    lines.push(
      answer['returnedType'] === 'undefined'
        ? 'It returned nothing.'
        : `It returned (${str(answer['returnedType'])}${answer['returnedTruncated'] === true ? ', shortened' : ''}): ` +
            (typeof returned === 'string' ? returned : JSON.stringify(returned, null, 2))
    );
  }
  const messages = listOf(answer['messages'])
    .filter(isRecord)
    .map(message => {
      const whisper = listOf(message['whisperTo']).map(String);
      return `${str(message['id'])} (${whisper.length ? `whisper to ${whisper.join(', ')}` : 'everyone'})`;
    });
  lines.push(
    messages.length
      ? `Chat messages it posted: ${messages.join(', ')}.`
      : 'It posted no chat message.'
  );
  lines.push(...warningLines(answer));
  return lines.join('\n');
}

export const listMacrosTool: ToolDefinition = {
  name: 'list-macros',
  title: 'List macros',
  group: 'macros',
  description:
    'List the macros of the world with type (chat or script), folder, author and whether the AI may run them ' +
    'now. includeCommand shows the command text.',
  inputSchema: schema({
    type: param('string', 'Only this type', { enum: ['chat', 'script'] }),
    nameContains: param('string', 'Only macros whose name contains this text, any case'),
    includeCommand: param('boolean', 'Show the command of each macro'),
  }),
  annotations: readOnlyTool('List macros'),
  handler: async (args, context) =>
    formatMacros(
      await ask(
        context,
        'listMacros',
        pick(args, ['type', 'nameContains', 'includeCommand']),
        'list macros'
      )
    ),
};

export const createMacroTool: ToolDefinition = {
  name: 'create-macro',
  title: 'Create a macro',
  group: 'macros',
  description:
    'Create a macro. A chat macro holds chat text or a chat command such as /roll 1d20. A script macro holds ' +
    'JavaScript that can do anything a Gamemaster can once someone runs it. Creating runs nothing.',
  inputSchema: schema(
    {
      name: param('string', 'Name of the macro'),
      type: param('string', '"chat" or "script"', { enum: ['chat', 'script'] }),
      command: param('string', 'Chat text or JavaScript'),
      img: param('string', 'Optional icon path'),
      folderPath: param(
        'string',
        'Folder for the macro; nested levels separated by "/" are created'
      ),
    },
    ['name', 'type', 'command']
  ),
  annotations: writingTool('Create a macro', { destructive: false, idempotent: false }),
  handler: async (args, context) => {
    const answer = await ask(
      context,
      'createMacro',
      pick(args, ['name', 'type', 'command', 'img', 'folderPath']),
      'create macro'
    );
    if (!isRecord(answer) || typeof answer['id'] !== 'string') return unknownShape(answer);
    const lines = [
      `Macro "${str(answer['name'])}" (${str(answer['type'])}) created, id ${answer['id']}.`,
    ];
    const folder = str(answer['folderPath']);
    if (folder) lines.push(`Folder: ${folder}`);
    const created = listOf(answer['foldersCreated']).map(String);
    if (created.length) lines.push(`Folders created: ${created.join(', ')}`);
    lines.push(
      answer['runnable'] === true
        ? 'The AI may run it now.'
        : 'The AI may not run it with the current settings.'
    );
    lines.push(...warningLines(answer));
    return lines.join('\n');
  },
};

export const executeMacroTool: ToolDefinition = {
  name: 'execute-macro',
  title: 'Run a macro',
  group: 'macros',
  description:
    "Run a macro in the Gamemaster's browser and report its result or error. Off by default: the world setting " +
    '"macroExecution" must be "chat" for chat macros or "all" for script macros. A SCRIPT MACRO CAN DO ANYTHING a ' +
    'Gamemaster can, including deleting documents, and cannot be undone; read its command with list-macros first. ' +
    'A chat macro only posts to the chat.',
  inputSchema: schema(
    {
      macroId: param('string', 'Id or exact name of the macro'),
      ...SPEAKER_PARAMETERS,
      args: param('object', 'Named values a script macro receives as variables and as scope'),
    },
    ['macroId']
  ),
  annotations: {
    ...writingTool('Run a macro', { destructive: true, idempotent: false }),
    // A script can reach outside the world, e.g. fetch from the network.
    openWorldHint: true,
  },
  handler: async (args, context) =>
    formatExecuted(
      await ask(
        context,
        'executeMacro',
        pick(args, ['macroId', 'speakerActor', 'speakerToken', 'sceneId', 'alias', 'args']),
        'run macro',
        { timeoutMs: EXECUTE_MACRO_TIMEOUT_MS }
      )
    ),
};

function hotbarLines(answer: Record<string, unknown>): string[] {
  return listOf(answer['hotbars'])
    .filter(isRecord)
    .map(
      use =>
        `- ${str(use['user'])} (${use['gamemaster'] === true ? 'Gamemaster' : 'player'}), ` +
        `slot ${listOf(use['slots']).map(String).join(', ')}`
    );
}

export function formatDeletedMacro(answer: unknown): string {
  if (!isRecord(answer) || typeof answer['id'] !== 'string') return unknownShape(answer);
  const label = `Macro "${str(answer['name'])}" (id ${answer['id']}, ${str(answer['type'])})`;
  const author = str(answer['author']);
  const by = author
    ? `Created by ${author}${answer['authorIsPlayer'] === true ? ', a player' : ''}.`
    : '';
  const hotbars = hotbarLines(answer);
  if (answer['dryRun'] === true) {
    const lines = [
      answer['allowed'] === true
        ? `Dry run: ${label} could be deleted. Nothing was deleted.`
        : `Dry run: ${label} could not be deleted. Nothing was deleted.`,
      ...listOf(answer['refused']).map(reason => `Refused: ${String(reason)}`),
    ];
    if (by) lines.push(by);
    if (hotbars.length)
      lines.push(
        'It is on these hotbars, so the real call needs confirmHotbar true after asking the Gamemaster:',
        ...hotbars
      );
    else lines.push('It is on no hotbar.');
    return lines.join('\n');
  }
  if (answer['needsConfirmation'] === true && answer['deleted'] === false) {
    const lines = [`QUESTION FOR THE GAMEMASTER. ${label} was NOT deleted.`];
    if (by) lines.push(by);
    lines.push('It is on these hotbars:', ...hotbars);
    lines.push(
      'Ask the Gamemaster whether it may go. Only then call delete-macro again with confirmHotbar true.'
    );
    return lines.join('\n');
  }
  if (answer['deleted'] !== true) return unknownShape(answer);
  const lines = [`${label} deleted.`];
  if (by) lines.push(by);
  if (hotbars.length) lines.push('It was on these hotbars:', ...hotbars);
  lines.push('undo-change can recreate it with its id.');
  lines.push(...warningLines(answer));
  return lines.join('\n');
}

export const deleteMacroTool: ToolDefinition = {
  name: 'delete-macro',
  title: 'Delete a macro',
  group: 'macros',
  description:
    'Delete a macro of the world by id or exact name. Off by default: the permission level for macros ' +
    '(setting "permMacros") must be "create, change and delete". If the macro is on the hotbar of a player ' +
    'or a Gamemaster, nothing is deleted and the answer names every hotbar: ask the Gamemaster, then call again ' +
    'with confirmHotbar true. Macros in compendiums are not deleted here (use delete-compendium-entries). ' +
    'dryRun shows what would happen. undo-change can recreate a deleted macro with its id.',
  inputSchema: schema(
    {
      macroId: param('string', 'Id or exact name of the macro'),
      confirmHotbar: param(
        'boolean',
        "Delete even though the macro is on somebody's hotbar. Only after the Gamemaster agreed"
      ),
      dryRun: param('boolean', 'Only report what would happen, delete nothing'),
    },
    ['macroId']
  ),
  annotations: writingTool('Delete a macro', { destructive: true, idempotent: true }),
  handler: async (args, context) =>
    formatDeletedMacro(
      await ask(
        context,
        'deleteMacro',
        pick(args, ['macroId', 'confirmHotbar', 'dryRun']),
        'delete macro'
      )
    ),
};
