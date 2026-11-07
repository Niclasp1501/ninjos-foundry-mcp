/**
 * Macros: list, create, run, delete.
 *
 * Decisions:
 * - Running is off by default, behind the world setting `macroExecution`
 *   ("off", "chat", "all"). A chat macro only writes to the chat; a script
 *   macro can do anything a Gamemaster can and needs "all".
 * - A script macro is run here, with the arguments Foundry gives it (speaker,
 *   actor, token, character, scope), not through `Macro#execute`. Foundry
 *   catches the error of a script and only shows a notification, so the model
 *   would hear "done" for a script that failed.
 * - A chat macro goes through the chat log (`ui.chat.processMessage`), which
 *   is what `Macro#execute` does for it, awaited so its error arrives too.
 * - The Gamemaster sees a notification whenever the AI runs a macro.
 * - Deleting needs the level "create, change and delete" for macros (setting
 *   `permMacros`), off by default. A macro on somebody's hotbar is only
 *   deleted with `confirmHotbar`; without it the answer names every hotbar and
 *   nothing is deleted, so the model has to ask first. Foundry keeps the id in
 *   the hotbar, so the slot shows empty, and undo-change, which recreates the
 *   macro with its id, puts it back into the same slots.
 * - Macros in compendiums are not deleted here: delete-compendium-entries
 *   does that, under the levels for compendiums and for macros.
 */
import { smallEnough } from '../../../common/change-log.js';
import { MODULE_ID } from '../../../common/constants.js';
import type { Access } from '../../../common/permissions.js';
import { QueryError, type QueryHandler } from '../../dispatcher.js';
import { ensureFolderPath, folderPathOf } from '../../folders.js';
import { requireWorld } from '../../world-ready.js';
import { macroExecutionAccess, macroExecutionLevel, macroRunnable, SWITCH_ONLY } from './access.js';
import { captureCreatedMessages } from './capture.js';
import { messages, whisperIdsOf } from './chat.js';
import {
  documentClass,
  findMacro,
  findMacroIfAny,
  idOf,
  inputOf,
  isRecord,
  messageOf,
  optionalBoolean,
  optionalChoice,
  optionalText,
  requiredText,
  textOf,
  userLabel,
} from './lookup.js';
import { hotbarText, hotbarUses } from './hotbar.js';
import { resolveSpeaker } from './speaker.js';

const macros = () => game.macros as FoundryCollection<FoundryChatTablesMacro>;

export const MACRO_TYPES = ['chat', 'script'] as const;

function typeOf(macro: FoundryChatTablesMacro): string {
  return typeof macro.type === 'string' ? macro.type : 'unknown';
}

function commandOf(macro: FoundryChatTablesMacro): string {
  return typeof macro.command === 'string' ? macro.command : '';
}

export const listMacros: QueryHandler = {
  access: { kind: 'read' },
  run: data => {
    requireWorld();
    const input = inputOf(data);
    const type = optionalChoice(input, 'type', MACRO_TYPES);
    const part = optionalText(input, 'nameContains')?.trim().toLowerCase();
    const includeCommand = optionalBoolean(input, 'includeCommand') === true;
    const list = macros()
      .filter(
        macro =>
          (!type || typeOf(macro) === type) && (!part || macro.name.toLowerCase().includes(part))
      )
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      executionSetting: macroExecutionLevel(),
      macros: list.map(macro => {
        const command = commandOf(macro);
        const folderId = idOf(macro.folder);
        const authorId = idOf(macro.author);
        return {
          id: macro.id,
          name: macro.name,
          type: typeOf(macro),
          folder: folderId ? folderPathOf(folderId).path || null : null,
          author: authorId ? userLabel(authorId) : null,
          commandLines: command ? command.split('\n').length : 0,
          runnable: macroRunnable(typeOf(macro)),
          ...(includeCommand ? { command } : {}),
        };
      }),
    };
  },
};

export const createMacro: QueryHandler = {
  access: { kind: 'write', document: 'Macros', action: 'create' },
  run: async (data, context) => {
    requireWorld();
    const input = inputOf(data);
    const name = requiredText(input, 'name');
    const type = optionalChoice(input, 'type', MACRO_TYPES);
    if (!type) throw new QueryError('INVALID_ARGUMENT', 'type is required: "chat" or "script"');
    const command = optionalText(input, 'command');
    if (!command?.trim())
      throw new QueryError('INVALID_ARGUMENT', 'command is required and must not be empty');
    const img = optionalText(input, 'img')?.trim();
    const MacroClass = documentClass('Macro');

    const folder = await ensureFolderPath(textOf(input['folderPath']), {
      type: 'Macro',
      context,
      query: 'createMacro',
      tool: 'create-macro',
    });
    const createdPaths = folder.created.map(entry => entry.path);
    const createdNote = createdPaths.length
      ? ` Folders created before the failure: ${createdPaths.join(', ')}.`
      : '';

    const source: Record<string, unknown> = {
      name,
      type,
      command,
      scope: 'global',
      folder: folder.id,
      flags: { [MODULE_ID]: { createdByMcp: true } },
    };
    if (img) source['img'] = img;

    let made: unknown;
    try {
      made = await MacroClass.create(source);
    } catch (error) {
      throw new QueryError(
        'CREATE_FAILED',
        `Foundry refused the macro "${name}": ${messageOf(error)}.${createdNote}`
      );
    }
    const id = idOf(made);
    const stored = id ? macros().get(id) : undefined;
    if (!stored) {
      throw new QueryError(
        'NOT_APPLIED',
        `Foundry did not report a new macro "${name}", and none is in the world when read back.${createdNote}`
      );
    }
    const problems: string[] = [];
    if (stored.name !== name) problems.push(`the name is "${stored.name}"`);
    if (typeOf(stored) !== type) problems.push(`the type is "${typeOf(stored)}"`);
    if (commandOf(stored) !== command) problems.push('the command differs');
    if (problems.length) {
      throw new QueryError(
        'NOT_APPLIED',
        `Macro "${name}" (id ${stored.id}) was created, but read back ${problems.join(', ')}.`
      );
    }

    context.recordChange({
      query: 'createMacro',
      tool: 'create-macro',
      document: 'Macros',
      action: 'create',
      targets: [{ id: stored.id, uuid: stored.uuid, name }],
      summary: `Created the ${type} macro "${name}".`,
      after: smallEnough(stored.toObject()),
    });

    const warnings: string[] = [];
    if (type === 'script') {
      warnings.push(
        'This is a script macro: it can do anything a Gamemaster can. The AI can only run it when the setting ' +
          '"macroExecution" is "all".'
      );
    }
    return {
      id: stored.id,
      name,
      type,
      folderId: folder.id,
      folderPath: folder.path || null,
      foldersCreated: createdPaths,
      runnable: macroRunnable(type),
      warnings,
    };
  },
};

const OWN_PARAMETERS = new Set(['speaker', 'actor', 'token', 'character', 'scope']);

type AsyncFunctionConstructor = new (
  ...parameters: string[]
) => (...values: unknown[]) => Promise<unknown>;

async function runScript(
  macro: FoundryChatTablesMacro,
  command: string,
  values: { speaker: unknown; actor: unknown; token: unknown; scope: Record<string, unknown> }
): Promise<unknown> {
  const names = Object.keys(values.scope);
  const bad = names.filter(name => !/^[A-Za-z_$][\w$]*$/.test(name) || OWN_PARAMETERS.has(name));
  if (bad.length) {
    throw new QueryError(
      'INVALID_ARGUMENT',
      `args may only use names that work as variables and not speaker, actor, token, character or scope: ${bad.join(', ')}. Nothing ran.`
    );
  }
  const AsyncFunction = Object.getPrototypeOf(async () => undefined)
    .constructor as AsyncFunctionConstructor;
  let fn: (...values: unknown[]) => Promise<unknown>;
  try {
    fn = new AsyncFunction(
      'speaker',
      'actor',
      'token',
      'character',
      'scope',
      ...names,
      `{\n${command}\n}`
    );
  } catch (error) {
    throw new QueryError(
      'MACRO_FAILED',
      `Script macro "${macro.name}" (id ${macro.id}) could not be read: ${messageOf(error)}. Nothing ran.`
    );
  }
  const character = (game.user as { character?: unknown } | null)?.character ?? null;
  return fn.call(
    macro,
    values.speaker,
    values.actor,
    values.token,
    character,
    values.scope,
    ...names.map(name => values.scope[name])
  );
}

const RETURN_MAX_CHARS = 20_000;

function describeReturn(value: unknown): {
  returned: unknown;
  returnedType: string;
  returnedTruncated?: true;
} {
  if (value === undefined) return { returned: null, returnedType: 'undefined' };
  if (
    isRecord(value) &&
    typeof value['documentName'] === 'string' &&
    typeof value['id'] === 'string'
  ) {
    return {
      returned: {
        documentName: value['documentName'],
        id: value['id'],
        uuid: typeof value['uuid'] === 'string' ? value['uuid'] : null,
        name: typeof value['name'] === 'string' ? value['name'] : null,
      },
      returnedType: 'document',
    };
  }
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    return { returned: String(value), returnedType: `${typeof value} (not JSON)` };
  }
  if (json === undefined) return { returned: String(value), returnedType: typeof value };
  const type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
  if (json.length > RETURN_MAX_CHARS)
    return {
      returned: json.slice(0, RETURN_MAX_CHARS),
      returnedType: type,
      returnedTruncated: true,
    };
  return { returned: JSON.parse(json) as unknown, returnedType: type };
}

export const executeMacro: QueryHandler = {
  access: data => {
    const macro = findMacroIfAny(textOf(inputOf(data)['macroId']));
    // Not found: only the switch here, so the handler can name what is missing.
    return macro ? macroExecutionAccess(typeOf(macro), macro.name) : [SWITCH_ONLY];
  },
  run: async (data, context) => {
    requireWorld();
    const input = inputOf(data);
    const macro = findMacro(requiredText(input, 'macroId'));
    const type = typeOf(macro);
    context.requireAccess(macroExecutionAccess(type, macro.name));
    const command = commandOf(macro);
    if (!command.trim())
      throw new QueryError(
        'INVALID_ARGUMENT',
        `Macro "${macro.name}" (id ${macro.id}) has no command; nothing ran.`
      );

    const rawArgs = input['args'];
    if (rawArgs !== undefined && rawArgs !== null && !isRecord(rawArgs))
      throw new QueryError('INVALID_ARGUMENT', 'args must be an object of named values');
    const scope = isRecord(rawArgs) ? rawArgs : {};
    const resolved = resolveSpeaker(input);
    const user = game.user as FoundryUser;
    const speaker = resolved?.speaker ?? {
      scene: null,
      actor: null,
      token: null,
      alias: user.name,
    };

    ui.notifications?.info(
      game.i18n.format(
        `${MODULE_ID}.chat-tables-macros.notify.${type === 'script' ? 'scriptMacroRun' : 'chatMacroRun'}`,
        { name: macro.name }
      )
    );

    const capture = captureCreatedMessages();
    let value: unknown;
    try {
      if (type === 'chat') {
        const chat = (
          ui as unknown as {
            chat?: {
              processMessage?: (
                message: string,
                options?: Record<string, unknown>
              ) => Promise<unknown>;
            };
          }
        ).chat;
        const process = chat?.processMessage;
        if (typeof process !== 'function') {
          throw new QueryError(
            'NO_FOUNDRY',
            "Foundry's chat log (ui.chat) is not available, so the chat macro cannot be run. Nothing ran."
          );
        }
        value = await process.call(chat, command, { speaker });
      } else {
        value = await runScript(macro, command, {
          speaker,
          actor: resolved?.actor ?? null,
          token: resolved?.token ?? null,
          scope,
        });
      }
    } catch (error) {
      capture.stop();
      if (error instanceof QueryError) throw error;
      const posted = capture.ids.filter(id => messages().get(id));
      throw new QueryError(
        'MACRO_FAILED',
        `Macro "${macro.name}" (id ${macro.id}, ${type}) failed: ${messageOf(error)}. ` +
          (type === 'script' ? 'Whatever the script did before the error stays in effect. ' : '') +
          (posted.length
            ? `Chat messages it posted: ${posted.join(', ')}.`
            : 'It posted no chat message.')
      );
    }
    capture.stop();

    const warnings: string[] = [];
    const posted = capture.ids.filter(id => messages().get(id));
    if (capture.ids.length > posted.length)
      warnings.push(
        `${capture.ids.length - posted.length} chat message(s) it created are gone again.`
      );
    if (type === 'chat' && !posted.length)
      warnings.push('The chat macro ran, but no chat message is in the chat when read back.');

    context.recordChange({
      query: 'executeMacro',
      tool: 'execute-macro',
      document: 'Macros',
      action: 'other',
      targets: [{ id: macro.id, uuid: macro.uuid, name: macro.name }],
      summary:
        `Ran the ${type} macro "${macro.name}"` +
        (posted.length ? `, which posted ${posted.length} chat message(s)` : '') +
        '. What a macro does is not recorded, so it cannot be undone.',
    });

    return {
      id: macro.id,
      name: macro.name,
      type,
      ...describeReturn(type === 'chat' ? undefined : value),
      messages: posted.map(id => {
        const whisper = whisperIdsOf(messages().get(id) as FoundryChatTablesMessage);
        return { id, whisperTo: whisper.map(userLabel) };
      }),
      warnings,
    };
  },
};

const DELETE_ACCESS: Access = { kind: 'write', document: 'Macros', action: 'delete' };

interface MacroPackEntry {
  packId: string;
  packLabel: string;
  id: string;
  name: string;
}

interface LooseMacroPack {
  collection: string;
  documentName: string;
  title?: string;
  metadata?: { label?: unknown };
  getIndex?: () => Promise<unknown>;
}

/** The entries of a compendium index, a Foundry Collection or a plain list. */
function indexEntries(index: unknown): unknown[] {
  if (index instanceof Map) return [...index.values()];
  if (Array.isArray(index)) return index;
  const values = (index as { values?: unknown } | null)?.values;
  if (typeof values === 'function') return [...(values.call(index) as Iterable<unknown>)];
  return [];
}

/** Entries of macro compendiums whose id or exact name is `ref`. Never throws. */
async function compendiumMacros(ref: string): Promise<MacroPackEntry[]> {
  const packs = (game as unknown as { packs?: { values?: () => Iterable<unknown> } }).packs;
  if (!packs || typeof packs.values !== 'function') return [];
  const found: MacroPackEntry[] = [];
  for (const raw of packs.values()) {
    const pack = raw as LooseMacroPack;
    if (pack.documentName !== 'Macro' || typeof pack.getIndex !== 'function') continue;
    let entries: unknown[];
    try {
      entries = indexEntries(await pack.getIndex());
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!isRecord(entry)) continue;
      const id = textOf(entry['_id']);
      const name = textOf(entry['name']);
      if (id !== ref && name !== ref) continue;
      const label = textOf(pack.metadata?.label) || pack.title || pack.collection;
      found.push({ packId: pack.collection, packLabel: label, id, name });
    }
  }
  return found;
}

function compendiumRefusal(ref: string, entries: readonly MacroPackEntry[]): QueryError {
  const where = entries.length
    ? ` It is in ${entries
        .map(entry => `the compendium "${entry.packLabel}" (${entry.packId}, entry id ${entry.id})`)
        .join(' and ')}.`
    : '';
  return new QueryError(
    'IN_COMPENDIUM',
    `"${ref}" is no macro of the world.${where} delete-macro only deletes world macros. A macro in a compendium ` +
      'is deleted with delete-compendium-entries, which needs the level "create, change and delete" for ' +
      'compendiums and for macros and a compendium on the release list. Ask the Gamemaster before deleting ' +
      'it there, because undo-change does not restore compendium entries. Nothing was deleted.'
  );
}

export const deleteMacro: QueryHandler = {
  access: data => (isRecord(data) && data['dryRun'] === true ? { kind: 'read' } : DELETE_ACCESS),
  run: async (data, context) => {
    requireWorld();
    const input = inputOf(data);
    const ref = requiredText(input, 'macroId').trim();
    const dryRun = optionalBoolean(input, 'dryRun') === true;
    const confirmHotbar = optionalBoolean(input, 'confirmHotbar') === true;

    if (ref.startsWith('Compendium.')) throw compendiumRefusal(ref, []);
    let macro = findMacroIfAny(ref);
    if (!macro) {
      const inPacks = await compendiumMacros(ref);
      if (inPacks.length) throw compendiumRefusal(ref, inPacks);
      macro = findMacro(ref);
    }

    const type = typeOf(macro);
    const authorId = idOf(macro.author);
    const base = {
      id: macro.id,
      uuid: macro.uuid,
      name: macro.name,
      type,
      author: authorId ? userLabel(authorId) : null,
      authorIsPlayer: authorId ? game.users?.get(authorId)?.isGM === false : false,
      hotbars: hotbarUses(macro.id),
    };
    const { hotbars } = base;

    if (dryRun) {
      const problem = context.accessProblem(DELETE_ACCESS);
      return {
        ...base,
        dryRun: true,
        allowed: problem === null,
        refused: problem ? [problem] : [],
        needsConfirmation: hotbars.length > 0,
      };
    }

    if (hotbars.length && !confirmHotbar) {
      return {
        ...base,
        deleted: false,
        needsConfirmation: true,
        question:
          `Macro "${macro.name}" (id ${macro.id}) is on the hotbar of ${hotbarText(hotbars)}. ` +
          'Ask the Gamemaster whether it may go, then call delete-macro again with confirmHotbar true. ' +
          'Nothing was deleted.',
      };
    }

    const before = smallEnough(macro.toObject());
    try {
      await macro.delete();
    } catch (error) {
      throw new QueryError(
        'DELETE_FAILED',
        `Foundry refused to delete the macro "${macro.name}" (id ${macro.id}): ${messageOf(error)}.`
      );
    }
    if (macros().get(macro.id)) {
      throw new QueryError(
        'NOT_APPLIED',
        `Macro "${macro.name}" (id ${macro.id}) was deleted, but it is still in the world when read back.`
      );
    }

    context.recordChange({
      query: 'deleteMacro',
      tool: 'delete-macro',
      document: 'Macros',
      action: 'delete',
      targets: [{ id: macro.id, uuid: macro.uuid, name: macro.name }],
      summary:
        `Deleted the ${type} macro "${macro.name}"` +
        (hotbars.length ? `, which was on the hotbar of ${hotbarText(hotbars)}` : '') +
        '.',
      before,
    });

    const warnings: string[] = [];
    if (hotbars.length)
      warnings.push(
        `The hotbar slots of ${hotbarText(hotbars)} now show empty. undo-change recreates the macro with its id, ` +
          'which puts it back into those slots.'
      );
    if (before === undefined)
      warnings.push('The macro was too large to record, so undo-change cannot recreate it.');
    return { ...base, deleted: true, warnings };
  },
};
