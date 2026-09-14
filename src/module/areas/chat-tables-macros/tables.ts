/**
 * Roll tables: read one with its entries, draw from it, return drawn entries,
 * change settings and entries.
 *
 * Listing, creating and deleting tables belong to the world area.
 *
 * Decisions:
 * - Drawing follows the table's own "replacement" setting, as Foundry's draw
 *   does. `mode: "roll"` rolls without ever marking an entry as drawn.
 * - Foundry's RollTable#draw and #roll are not called, because they hang with
 *   Dice So Nice and no canvas; see DRAW_LIMITS.
 * - Nothing goes to the chat unless asked for (`chat`), and a message that is
 *   visible to more users than asked for is an error.
 * - A draw without replacement that asks for more entries than are left is
 *   refused before the first roll, never drawn in part.
 * - Changes to entries are checked as a whole before anything is written:
 *   overlapping ranges are refused, gaps and formula mismatches are warnings,
 *   with the same rules as creating a table in the world area.
 */
import { smallEnough } from '../../../common/change-log.js';
import type { Access } from '../../../common/permissions.js';
import { QueryError, type QueryHandler } from '../../dispatcher.js';
import { folderPathOf } from '../../folders.js';
import { requireWorld } from '../../world-ready.js';
import { PlanError, planRollTable } from '../world/ranges.js';
import { CHAT_LOG_KIND, chatAccess } from './access.js';
import { captureCreatedMessages } from './capture.js';
import { audienceText, messages, whisperIdsOf } from './chat.js';
import {
  findTable,
  findTableIfAny,
  idOf,
  inputOf,
  isRecord,
  messageOf,
  optionalBoolean,
  optionalChoice,
  optionalInteger,
  optionalText,
  plainText,
  requiredText,
  textOf,
} from './lookup.js';

const tables = () => game.tables as FoundryCollection<FoundryChatTablesTable>;

export const DRAW_MODES = ['draw', 'roll'] as const;
export const CHAT_MODES = ['none', 'public', 'gm', 'self', 'blind'] as const;
type ChatMode = (typeof CHAT_MODES)[number];

const ROLL_MODE: Record<Exclude<ChatMode, 'none'>, string> = {
  public: 'publicroll',
  gm: 'gmroll',
  self: 'selfroll',
  blind: 'blindroll',
};

function rangeOf(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [from, to] = value as unknown[];
  return typeof from === 'number' && typeof to === 'number' ? [from, to] : null;
}

export function resultText(result: FoundryChatTablesResult): string {
  return plainText(result.description) || plainText(result.text) || (result.name ?? '');
}

export function summarizeResult(result: FoundryChatTablesResult) {
  return {
    id: result.id,
    type: typeof result.type === 'string' ? result.type : 'text',
    text: resultText(result),
    range: rangeOf(result.range),
    weight: typeof result.weight === 'number' ? result.weight : 1,
    drawn: result.drawn === true,
    documentUuid:
      typeof result.documentUuid === 'string' && result.documentUuid ? result.documentUuid : null,
  };
}

function summarizeTable(table: FoundryChatTablesTable) {
  const results = [...table.results.contents]
    .sort((a, b) => (rangeOf(a.range)?.[0] ?? 0) - (rangeOf(b.range)?.[0] ?? 0))
    .map(summarizeResult);
  const folderId = idOf(table.folder);
  return {
    id: table.id,
    name: table.name,
    description: plainText(table.description) || null,
    formula: typeof table.formula === 'string' ? table.formula : '',
    replacement: table.replacement !== false,
    displayRoll: table.displayRoll !== false,
    folder: folderId ? folderPathOf(folderId).path || null : null,
    entries: results.length,
    available: results.filter(result => !result.drawn).length,
    results,
  };
}

export const getRollTable: QueryHandler = {
  access: { kind: 'read' },
  run: data => {
    requireWorld();
    return summarizeTable(findTable(requiredText(inputOf(data), 'tableId')));
  },
};

function totalOf(roll: unknown): number | null {
  return isRecord(roll) && typeof roll['total'] === 'number' ? roll['total'] : null;
}

function formulaOf(roll: unknown): string | null {
  return isRecord(roll) && typeof roll['formula'] === 'string' ? roll['formula'] : null;
}

interface DrawRecord {
  total: number | null;
  formula: string;
  results: Array<ReturnType<typeof summarizeResult>>;
}

function describeDraws(draws: readonly DrawRecord[]): string {
  return draws
    .map(
      (draw, index) =>
        `${index + 1}. ${draw.total ?? '?'}: ${draw.results.map(result => result.text || result.id).join(' + ') || 'no entry'}`
    )
    .join('; ');
}

/** Whether a posted message is visible to no more users than the chat mode allows. */
function visibilityMatches(
  message: FoundryChatTablesMessage,
  chat: Exclude<ChatMode, 'none'>
): boolean {
  if (chat === 'public') return true;
  const whisper = whisperIdsOf(message);
  if (!whisper.length) return false;
  if (chat === 'self') return whisper.every(id => id === game.user?.id);
  return whisper.every(id => game.users?.get(id)?.isGM === true);
}

/**
 * Seen in a real world: Foundry's RollTable#roll and #draw
 * never finished with Dice So Nice active and no canvas drawn, and the bridge
 * gave up after 30 seconds without a cause. The draw is therefore built from
 * the parts Foundry offers (Roll#evaluate without interactive fulfilment,
 * RollTable#getResultsForRoll, marking by an update, toMessage only when
 * asked), and every wait of one call shares a budget below the bridge's.
 */
export const DRAW_LIMITS = { totalMs: 20_000, rerolls: 10, depth: 5 };

const WAIT_HINT =
  'A module that animates or fulfils dice, such as Dice So Nice, can keep a roll or a chat message from finishing, above all without a drawn canvas.';

class DrawTimeout extends Error {}

function withDeadline<T>(work: Promise<T>, deadline: number, what: string): Promise<T> {
  const left = deadline - Date.now();
  if (left <= 0) return Promise.reject(new DrawTimeout(what));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DrawTimeout(what)), left);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

interface TableRoll {
  total?: unknown;
  formula?: unknown;
  evaluate(options?: Record<string, unknown>): Promise<unknown>;
}
type TableRollClass = new (formula: string) => TableRoll;

function rollClass(): TableRollClass {
  const candidate = (globalThis as { Roll?: unknown }).Roll;
  if (typeof candidate !== 'function')
    throw new QueryError('NO_FOUNDRY', "Foundry's Roll class is not available");
  return candidate as TableRollClass;
}

/** The entries a total lands on, by Foundry's own rule where it offers it. */
function resultsFor(table: FoundryChatTablesTable, total: number): FoundryChatTablesResult[] {
  if (typeof table.getResultsForRoll === 'function')
    return [...table.getResultsForRoll.call(table, total)];
  return table.results.filter(entry => {
    const range = rangeOf(entry.range);
    return entry.drawn !== true && !!range && total >= range[0] && total <= range[1];
  });
}

function innerTable(entry: FoundryChatTablesResult): FoundryChatTablesTable | null {
  const uuid = typeof entry.documentUuid === 'string' ? entry.documentUuid : '';
  const id = /^RollTable\.([^.]+)$/.exec(uuid)?.[1];
  return id ? (tables().get(id) ?? null) : null;
}

/**
 * One roll on a table. A table without replacement rolls again when the total
 * lands on drawn entries only, as Foundry does. Entries that point to another
 * table are rolled there, without marking its entries.
 */
async function rollOnTable(
  table: FoundryChatTablesTable,
  RollClass: TableRollClass,
  deadline: number,
  depth: number,
  warnings: string[]
): Promise<{ roll: TableRoll; results: FoundryChatTablesResult[] }> {
  const formula =
    typeof table.formula === 'string' && table.formula.trim()
      ? table.formula
      : `1d${Math.max(table.results.size, 1)}`;
  for (let attempt = 0; ; attempt += 1) {
    const roll = new RollClass(formula);
    await withDeadline(
      roll.evaluate({ allowInteractive: false }),
      deadline,
      `rolling ${formula} for the roll table "${table.name}"`
    );
    const total = totalOf(roll);
    const found = total === null ? [] : resultsFor(table, total);
    const left = table.results.some(entry => entry.drawn !== true);
    if (!found.length && table.replacement === false && left && attempt < DRAW_LIMITS.rerolls)
      continue;
    const results: FoundryChatTablesResult[] = [];
    for (const entry of found) {
      const inner = depth < DRAW_LIMITS.depth ? innerTable(entry) : null;
      if (!inner || inner.id === table.id) {
        results.push(entry);
        continue;
      }
      const nested = await rollOnTable(inner, RollClass, deadline, depth + 1, warnings);
      warnings.push(
        `The entry ${entry.id} points to the roll table "${inner.name}" (id ${inner.id}); it was rolled there without marking its entries.`
      );
      results.push(...nested.results);
    }
    return { roll, results };
  }
}

function drawFailure(
  error: unknown,
  state: {
    index: number;
    count: number;
    label: string;
    markDrawn: boolean;
    marked: number;
    draws: readonly DrawRecord[];
  }
): QueryError {
  if (error instanceof QueryError) return error;
  const markedText = state.markDrawn
    ? state.marked
      ? ` ${state.marked} entries are marked as drawn and stay marked.`
      : ' Nothing was marked as drawn.'
    : '';
  const done = state.draws.length ? ` Results so far: ${describeDraws(state.draws)}.` : '';
  const which = `Draw ${state.index + 1} of ${state.count} from the ${state.label}`;
  if (error instanceof DrawTimeout) {
    return new QueryError(
      'TIMEOUT',
      `${which} stopped: Foundry did not finish ${error.message} within ${DRAW_LIMITS.totalMs / 1000} seconds. ` +
        `${WAIT_HINT}${markedText}${done}`
    );
  }
  return new QueryError('DRAW_FAILED', `${which} failed: ${messageOf(error)}.${markedText}${done}`);
}

function drawAccess(data: unknown): Access[] {
  const input = inputOf(data);
  const mode = optionalChoice(input, 'mode', DRAW_MODES) ?? 'draw';
  const chat = optionalChoice(input, 'chat', CHAT_MODES) ?? 'none';
  const table = findTableIfAny(textOf(input['tableId']));
  const accesses: Access[] = [];
  if (mode === 'draw' && table?.replacement === false)
    accesses.push({ kind: 'write', document: 'RollTables', action: 'update' });
  if (chat !== 'none') accesses.push(chatAccess('create'));
  return accesses.length ? accesses : [{ kind: 'read' }];
}

export const drawRollTable: QueryHandler = {
  access: drawAccess,
  run: async (data, context) => {
    requireWorld();
    const input = inputOf(data);
    const table = findTable(requiredText(input, 'tableId'));
    const count = optionalInteger(input, 'count', 1, 100) ?? 1;
    const mode = optionalChoice(input, 'mode', DRAW_MODES) ?? 'draw';
    const chat = optionalChoice(input, 'chat', CHAT_MODES) ?? 'none';
    const markDrawn = mode === 'draw' && table.replacement === false;
    const label = `roll table "${table.name}" (id ${table.id})`;

    const drawnBefore = new Map(
      table.results.contents.map(result => [result.id, result.drawn === true])
    );
    const available = [...drawnBefore.values()].filter(drawn => !drawn).length;
    if (!table.results.size) throw new QueryError('EMPTY_TABLE', `The ${label} has no entries.`);
    if (!available) {
      throw new QueryError(
        'NO_RESULTS_LEFT',
        `Every entry of the ${label} is drawn. Nothing was rolled. reset-roll-table returns them to the table.`
      );
    }
    if (markDrawn && count > available) {
      throw new QueryError(
        'NO_RESULTS_LEFT',
        `The ${label} draws without replacement and has ${available} of ${table.results.size} entries left, ` +
          `fewer than the ${count} draws asked for. Nothing was rolled. Draw at most ${available}, or return the ` +
          'drawn entries with reset-roll-table first.'
      );
    }

    const toMessage = table.toMessage;
    if (chat !== 'none' && typeof toMessage !== 'function')
      throw new QueryError('NO_FOUNDRY', "Foundry's RollTable#toMessage is not available");
    const RollClass = rollClass();

    const beforeObject = markDrawn ? smallEnough(table.toObject()) : undefined;
    const tableFormula = typeof table.formula === 'string' ? table.formula : '';
    const rollMode = chat === 'none' ? undefined : ROLL_MODE[chat];
    const deadline = Date.now() + DRAW_LIMITS.totalMs;
    const capture = chat === 'none' ? null : captureCreatedMessages();
    const draws: DrawRecord[] = [];
    const warnings: string[] = [];
    let marked = 0;

    try {
      for (let index = 0; index < count; index += 1) {
        try {
          const outcome = await rollOnTable(table, RollClass, deadline, 0, warnings);
          const total = totalOf(outcome.roll);
          const results = outcome.results.map(summarizeResult);
          if (!results.length)
            warnings.push(`Draw ${index + 1} (${total ?? 'no total'}) matched no entry.`);
          draws.push({ total, formula: formulaOf(outcome.roll) ?? tableFormula, results });

          const own = outcome.results.filter(entry => table.results.get(entry.id));
          if (markDrawn && own.length) {
            await withDeadline(
              table.updateEmbeddedDocuments(
                'TableResult',
                own.map(entry => ({ _id: entry.id, drawn: true }))
              ),
              deadline,
              `marking the drawn entries of the ${label}`
            );
            marked += own.length;
          }
          if (rollMode && toMessage) {
            await withDeadline(
              Promise.resolve(
                toMessage.call(table, outcome.results, {
                  roll: outcome.roll,
                  messageOptions: { rollMode },
                })
              ),
              deadline,
              `posting the result of the ${label} to the chat`
            );
          }
        } catch (error) {
          if (marked) {
            context.recordChange({
              query: 'drawRollTable',
              tool: 'draw-roll-table',
              document: 'RollTables',
              action: 'update',
              targets: [{ id: table.id, uuid: table.uuid, name: table.name }],
              summary: `Marked ${marked} entries of roll table "${table.name}" as drawn before a draw failed.`,
              before: beforeObject,
              after: smallEnough(tables().get(table.id)?.toObject()),
            });
          }
          throw drawFailure(error, {
            index,
            count,
            label,
            markDrawn,
            marked,
            draws,
          });
        }
      }
    } finally {
      capture?.stop();
    }

    const fresh = tables().get(table.id);
    if (!fresh) {
      throw new QueryError(
        'NOT_APPLIED',
        `The ${label} is gone when read back. Results: ${describeDraws(draws)}.`
      );
    }
    const drawnIds = draws.flatMap(entry => entry.results.map(result => result.id));
    if (markDrawn) {
      const notMarked = drawnIds.filter(id => fresh.results.get(id)?.drawn !== true);
      if (notMarked.length) {
        throw new QueryError(
          'NOT_APPLIED',
          `The ${label} draws without replacement, but the entries ${notMarked.join(', ')} are not marked as ` +
            `drawn when read back, so they can come again. Results: ${describeDraws(draws)}.`
        );
      }
    } else {
      const changed = fresh.results.filter(
        result => (result.drawn === true) !== (drawnBefore.get(result.id) ?? false)
      );
      if (changed.length) {
        warnings.push(
          `The drawn state of ${changed.length} entries changed although this draw marks no entry: ` +
            `${changed.map(result => result.id).join(', ')}.`
        );
      }
    }

    let posted: string[] = [];
    if (capture && chat !== 'none') {
      posted = capture.ids.filter(id => messages().get(id));
      if (posted.length < count)
        warnings.push(`Foundry posted ${posted.length} of ${count} chat messages for these draws.`);
      const tooWide = posted
        .map(id => messages().get(id))
        .filter((message): message is FoundryChatTablesMessage => Boolean(message))
        .filter(message => !visibilityMatches(message, chat));
      if (tooWide.length) {
        throw new QueryError(
          'VISIBILITY_MISMATCH',
          `The draws happened, but ${tooWide.length} chat message(s) are visible to more users than "${chat}" ` +
            `allows: ${tooWide.map(message => `${message.id} (${audienceText(message)})`).join(', ')}. ` +
            `Results: ${describeDraws(draws)}.`
        );
      }
    }

    if (markDrawn) {
      context.recordChange({
        query: 'drawRollTable',
        tool: 'draw-roll-table',
        document: 'RollTables',
        action: 'update',
        targets: [{ id: table.id, uuid: table.uuid, name: table.name }],
        summary: `Drew ${count} time(s) from roll table "${table.name}" without replacement and marked ${drawnIds.length} entries as drawn.`,
        before: beforeObject,
        after: smallEnough(fresh.toObject()),
      });
    }
    if (posted.length) {
      context.recordChange({
        query: 'drawRollTable',
        tool: 'draw-roll-table',
        document: CHAT_LOG_KIND,
        action: 'create',
        targets: posted.map(id => ({ id })),
        summary: `Posted ${posted.length} result message(s) of roll table "${table.name}" to the chat (${chat}).`,
      });
    }

    return {
      tableId: table.id,
      tableName: table.name,
      formula: tableFormula,
      mode,
      replacement: table.replacement !== false,
      drawnMarked: markDrawn,
      chat,
      draws,
      entries: fresh.results.size,
      available: fresh.results.filter(result => result.drawn !== true).length,
      messages: posted,
      warnings,
    };
  },
};

export const resetRollTable: QueryHandler = {
  access: { kind: 'write', document: 'RollTables', action: 'update' },
  run: async (data, context) => {
    requireWorld();
    const table = findTable(requiredText(inputOf(data), 'tableId'));
    const drawn = table.results.filter(result => result.drawn === true);
    if (!drawn.length) {
      return {
        id: table.id,
        name: table.name,
        returned: 0,
        entries: table.results.size,
        changed: false,
      };
    }
    const reset = table.resetResults;
    if (typeof reset !== 'function')
      throw new QueryError('NO_FOUNDRY', "Foundry's RollTable#resetResults is not available");

    const before = smallEnough(table.toObject());
    try {
      await reset.call(table);
    } catch (error) {
      throw new QueryError(
        'RESET_FAILED',
        `Returning the drawn entries of roll table "${table.name}" failed: ${messageOf(error)}.`
      );
    }
    const fresh = tables().get(table.id);
    const still = fresh ? fresh.results.filter(result => result.drawn === true) : drawn;
    if (!fresh || still.length) {
      throw new QueryError(
        'NOT_APPLIED',
        `Roll table "${table.name}" (id ${table.id}) was reset, but ${still.length} entries are still drawn when read back.`
      );
    }
    context.recordChange({
      query: 'resetRollTable',
      tool: 'reset-roll-table',
      document: 'RollTables',
      action: 'update',
      targets: [{ id: table.id, uuid: table.uuid, name: table.name }],
      summary: `Returned ${drawn.length} drawn entries to roll table "${table.name}".`,
      before,
      after: smallEnough(fresh.toObject()),
    });
    return {
      id: table.id,
      name: table.name,
      returned: drawn.length,
      entries: fresh.results.size,
      changed: true,
    };
  },
};

interface ResultChange {
  id: string;
  text?: string;
  range?: [number, number];
  weight?: number;
  drawn?: boolean;
}

interface NewResult {
  text: string;
  range?: [number, number];
  weight: number;
}

function invalid(message: string): QueryError {
  return new QueryError('INVALID_ARGUMENT', message);
}

function parseText(value: unknown, at: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw invalid(`${at} must be a text that is not empty`);
  return text;
}

function parseRange(value: unknown, at: string): [number, number] {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !value.every(n => typeof n === 'number' && Number.isInteger(n))
  ) {
    throw invalid(
      `${at} must be exactly two whole numbers [from, to], got ${JSON.stringify(value)}`
    );
  }
  const [from, to] = value as [number, number];
  if (from > to) throw invalid(`${at} starts after it ends: [${from}, ${to}]`);
  return [from, to];
}

function parseWeight(value: unknown, at: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1)
    throw invalid(`${at} must be a whole number of at least 1, got ${JSON.stringify(value)}`);
  return value;
}

function parseChanges(raw: unknown, table: FoundryChatTablesTable): ResultChange[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw))
    throw invalid('results must be a list of entry changes, each with the id of an entry');
  const seen = new Set<string>();
  return raw.map((item, index) => {
    const at = `results[${index}]`;
    if (!isRecord(item)) throw invalid(`${at} must be an object with the id of an entry`);
    const id = textOf(item['id']);
    if (!id) throw invalid(`${at}.id is required`);
    if (!table.results.get(id)) {
      throw new QueryError(
        'NOT_FOUND',
        `${at}.id "${id}" is not an entry of roll table "${table.name}". get-roll-table lists the entries with ` +
          'their ids. Nothing was changed.'
      );
    }
    if (seen.has(id)) throw invalid(`${at}.id "${id}" appears twice`);
    seen.add(id);
    const change: ResultChange = { id };
    if (item['text'] !== undefined) change.text = parseText(item['text'], `${at}.text`);
    if (item['range'] !== undefined) change.range = parseRange(item['range'], `${at}.range`);
    if (item['weight'] !== undefined) change.weight = parseWeight(item['weight'], `${at}.weight`);
    if (item['drawn'] !== undefined) {
      if (typeof item['drawn'] !== 'boolean') throw invalid(`${at}.drawn must be true or false`);
      change.drawn = item['drawn'];
    }
    if (Object.keys(change).length === 1)
      throw invalid(`${at} changes nothing; pass text, range, weight or drawn`);
    return change;
  });
}

function parseAdditions(raw: unknown): NewResult[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw))
    throw invalid('addResults must be a list of new entries, each with a text');
  return raw.map((item, index) => {
    const at = `addResults[${index}]`;
    if (!isRecord(item)) throw invalid(`${at} must be an object with a text`);
    const entry: NewResult = {
      text: parseText(item['text'], `${at}.text`),
      weight:
        item['weight'] === undefined || item['weight'] === null
          ? 1
          : parseWeight(item['weight'], `${at}.weight`),
    };
    if (item['range'] !== undefined && item['range'] !== null)
      entry.range = parseRange(item['range'], `${at}.range`);
    return entry;
  });
}

function parseRemovals(
  raw: unknown,
  table: FoundryChatTablesTable,
  changes: readonly ResultChange[]
): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || !raw.every(id => typeof id === 'string' && id.trim()))
    throw invalid('removeResults must be a list of entry ids');
  const ids = [...new Set((raw as string[]).map(id => id.trim()))];
  const unknown = ids.filter(id => !table.results.get(id));
  if (unknown.length) {
    throw new QueryError(
      'NOT_FOUND',
      `removeResults: ${unknown.map(id => `"${id}"`).join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not an entry ` +
        `of roll table "${table.name}". Entries are removed by id only. Nothing was changed.`
    );
  }
  const both = ids.filter(id => changes.some(change => change.id === id));
  if (both.length)
    throw invalid(`The entries ${both.join(', ')} are both changed and removed; pick one`);
  return ids;
}

function updateAccess(data: unknown): Access[] {
  const removals = inputOf(data)['removeResults'];
  const accesses: Access[] = [{ kind: 'write', document: 'RollTables', action: 'update' }];
  // Removing entries destroys them, so it needs the level that allows deleting.
  if (Array.isArray(removals) && removals.length)
    accesses.push({ kind: 'write', document: 'RollTables', action: 'delete' });
  return accesses;
}

export const updateRollTable: QueryHandler = {
  access: updateAccess,
  run: async (data, context) => {
    requireWorld();
    const input = inputOf(data);
    const table = findTable(requiredText(input, 'tableId'));

    const tableChanges: Record<string, unknown> = {};
    const name = optionalText(input, 'name');
    if (name !== undefined) {
      if (!name.trim()) throw invalid('name must not be empty');
      tableChanges['name'] = name.trim();
    }
    const description = optionalText(input, 'description');
    if (description !== undefined) tableChanges['description'] = description;
    const formula = optionalText(input, 'formula');
    if (formula !== undefined) {
      if (!formula.trim()) throw invalid('formula must not be empty, for example "1d6"');
      tableChanges['formula'] = formula.trim();
    }
    for (const key of ['replacement', 'displayRoll']) {
      const value = optionalBoolean(input, key);
      if (value !== undefined) tableChanges[key] = value;
    }

    const changes = parseChanges(input['results'], table);
    const additions = parseAdditions(input['addResults']);
    const removals = parseRemovals(input['removeResults'], table, changes);
    if (
      !Object.keys(tableChanges).length &&
      !changes.length &&
      !additions.length &&
      !removals.length
    ) {
      throw invalid(
        'Nothing to change: pass name, description, formula, replacement, displayRoll, results, addResults or removeResults'
      );
    }

    // The table as it would be afterwards, checked as a whole before the first write.
    const warnings: string[] = [];
    const kept = table.results.contents.filter(result => !removals.includes(result.id));
    const withoutRange = kept.filter(result => !rangeOf(result.range));
    const finalEntries = kept.flatMap(result => {
      const change = changes.find(entry => entry.id === result.id);
      const range = change?.range ?? rangeOf(result.range);
      if (!range) return [];
      return [
        {
          text: change?.text ?? (resultText(result) || `(entry ${result.id})`),
          range,
          weight: change?.weight ?? (typeof result.weight === 'number' ? result.weight : 1),
        },
      ];
    });
    let highest = Math.max(0, ...finalEntries.map(entry => entry.range[1]));
    const added = additions.map(entry => {
      const range: [number, number] = entry.range ?? [highest + 1, highest + 1];
      highest = Math.max(highest, range[1]);
      return { ...entry, range };
    });
    const rangesTouched =
      added.length > 0 ||
      removals.length > 0 ||
      formula !== undefined ||
      changes.some(change => change.range);
    if (rangesTouched) {
      if (withoutRange.length) {
        warnings.push(
          `The entries ${withoutRange.map(result => result.id).join(', ')} have no readable range, so the ranges were not checked.`
        );
      } else {
        try {
          const plan = planRollTable({
            results: [...finalEntries, ...added].map(entry => ({
              text: entry.text,
              range: entry.range,
              weight: entry.weight,
            })),
            formula:
              tableChanges['formula'] ?? (typeof table.formula === 'string' ? table.formula : ''),
          });
          warnings.push(...plan.warnings);
        } catch (error) {
          if (error instanceof PlanError)
            throw invalid(`After this change: ${error.message} Nothing was changed.`);
          throw error;
        }
      }
    }

    const before = smallEnough(table.toObject());
    const done: string[] = [];
    const step = async (what: string, work: () => Promise<unknown>) => {
      try {
        await work();
        done.push(what);
      } catch (error) {
        throw new QueryError(
          'UPDATE_FAILED',
          `Updating roll table "${table.name}" (id ${table.id}) failed at "${what}": ${messageOf(error)}. ` +
            (done.length ? `Already applied: ${done.join('; ')}.` : 'Nothing was changed.')
        );
      }
    };

    if (Object.keys(tableChanges).length)
      await step('table settings', () => table.update(tableChanges));
    if (changes.length) {
      await step(`change ${changes.length} entries`, () =>
        table.updateEmbeddedDocuments(
          'TableResult',
          changes.map(change => ({
            _id: change.id,
            // Foundry 13 and later keep the text in `description`, older versions in `text` (see the world area).
            ...(change.text !== undefined ? { description: change.text, text: change.text } : {}),
            ...(change.range ? { range: change.range } : {}),
            ...(change.weight !== undefined ? { weight: change.weight } : {}),
            ...(change.drawn !== undefined ? { drawn: change.drawn } : {}),
          }))
        )
      );
    }
    let createdIds: string[] = [];
    if (added.length) {
      const lastSort = Math.max(
        0,
        ...table.results.contents.map(result => (typeof result.sort === 'number' ? result.sort : 0))
      );
      await step(`add ${added.length} entries`, async () => {
        const made = await table.createEmbeddedDocuments(
          'TableResult',
          added.map((entry, index) => ({
            type: 'text',
            description: entry.text,
            text: entry.text,
            range: entry.range,
            weight: entry.weight,
            drawn: false,
            sort: lastSort + (index + 1) * 100,
          }))
        );
        createdIds = made.map(document => document.id);
      });
    }
    if (removals.length) {
      await step(`remove ${removals.length} entries`, () =>
        table.deleteEmbeddedDocuments('TableResult', removals)
      );
    }

    const fresh = tables().get(table.id);
    if (!fresh)
      throw new QueryError('NOT_APPLIED', `Roll table ${table.id} is gone when read back.`);
    const problems: string[] = [];
    const stored = fresh as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(tableChanges)) {
      if (stored[key] !== value)
        problems.push(`${key} is ${JSON.stringify(stored[key])}, not ${JSON.stringify(value)}`);
    }
    for (const change of changes) {
      const result = fresh.results.get(change.id);
      if (!result) {
        problems.push(`entry ${change.id} is missing`);
        continue;
      }
      if (
        change.text !== undefined &&
        result.description !== change.text &&
        result.text !== change.text
      )
        problems.push(`entry ${change.id} has the text ${JSON.stringify(resultText(result))}`);
      if (change.range && JSON.stringify(rangeOf(result.range)) !== JSON.stringify(change.range))
        problems.push(`entry ${change.id} has the range ${JSON.stringify(result.range)}`);
      if (change.weight !== undefined && result.weight !== change.weight)
        problems.push(`entry ${change.id} has the weight ${JSON.stringify(result.weight)}`);
      if (change.drawn !== undefined && (result.drawn === true) !== change.drawn)
        problems.push(`entry ${change.id} is ${result.drawn === true ? '' : 'not '}drawn`);
    }
    if (createdIds.length !== added.length)
      problems.push(`${createdIds.length} of ${added.length} new entries were reported`);
    for (const id of createdIds)
      if (!fresh.results.get(id)) problems.push(`new entry ${id} is missing`);
    for (const id of removals)
      if (fresh.results.get(id)) problems.push(`entry ${id} is still there`);
    if (problems.length) {
      throw new QueryError(
        'NOT_APPLIED',
        `Roll table "${fresh.name}" (id ${fresh.id}) was written, but reading it back shows: ${problems.join('; ')}. ` +
          `Applied steps: ${done.join('; ')}.`
      );
    }

    context.recordChange({
      query: 'updateRollTable',
      tool: 'update-roll-table',
      document: 'RollTables',
      action: 'update',
      targets: [{ id: fresh.id, uuid: fresh.uuid, name: fresh.name }],
      summary: `Updated roll table "${fresh.name}": ${done.join('; ')}.`,
      before,
      after: smallEnough(fresh.toObject()),
    });

    return {
      id: fresh.id,
      name: fresh.name,
      changedSettings: Object.keys(tableChanges),
      changedEntries: changes.map(change => change.id),
      addedEntries: createdIds,
      removedEntries: removals,
      formula: typeof fresh.formula === 'string' ? fresh.formula : '',
      replacement: fresh.replacement !== false,
      displayRoll: fresh.displayRoll !== false,
      entries: fresh.results.size,
      warnings,
    };
  },
};
