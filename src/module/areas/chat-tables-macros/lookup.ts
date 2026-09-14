/**
 * Reading arguments and finding documents for the chat-tables-macros area.
 *
 * The rule of the world area applies (its lookup.ts is reused): an id wins, then
 * the exact name, and two documents with that name are an error. Nothing that
 * writes is ever found by a part of a name.
 */
import { QueryError } from '../../dispatcher.js';
import { byIdOrExactName, idOf, inputOf, isRecord, textOf } from '../world/lookup.js';

export { byIdOrExactName, idOf, inputOf, isRecord, textOf };

export function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return typeof error === 'string' && error ? error : 'unknown error';
}

export function documentClass(documentName: string): {
  create(data: Record<string, unknown>): Promise<unknown>;
} {
  const found = (globalThis as Record<string, unknown>)[documentName];
  const create = (found as { create?: unknown } | undefined)?.create;
  if (typeof create !== 'function')
    throw new QueryError('NO_FOUNDRY', `Foundry's ${documentName} class is not available`);
  return found as { create(data: Record<string, unknown>): Promise<unknown> };
}

function invalid(message: string): QueryError {
  return new QueryError('INVALID_ARGUMENT', message);
}

export function requiredText(input: Record<string, unknown>, key: string): string {
  const value = textOf(input[key]);
  if (!value) throw invalid(`${key} is required and must be a text that is not empty`);
  return value;
}

export function optionalText(input: Record<string, unknown>, key: string): string | undefined {
  const raw = input[key];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string') throw invalid(`${key} must be a text, got ${JSON.stringify(raw)}`);
  return raw;
}

export function optionalBoolean(input: Record<string, unknown>, key: string): boolean | undefined {
  const raw = input[key];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'boolean')
    throw invalid(`${key} must be true or false, got ${JSON.stringify(raw)}`);
  return raw;
}

export function optionalInteger(
  input: Record<string, unknown>,
  key: string,
  min: number,
  max: number
): number | undefined {
  const raw = input[key];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < min || raw > max)
    throw invalid(
      `${key} must be a whole number from ${min} to ${max}, got ${JSON.stringify(raw)}`
    );
  return raw;
}

export function optionalChoice<T extends string>(
  input: Record<string, unknown>,
  key: string,
  options: readonly T[]
): T | undefined {
  const raw = input[key];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'string' && (options as readonly string[]).includes(raw)) return raw as T;
  throw invalid(
    `${key} must be one of ${options.map(option => `"${option}"`).join(', ')}, got ${JSON.stringify(raw)}`
  );
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

/** Stored HTML as readable text: tags dropped, line breaks kept, the common entities decoded. */
export function plainText(html: unknown): string {
  if (typeof html !== 'string') return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, entity => ENTITIES[entity] ?? entity)
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

function notFound(kind: string, ref: string, listTool: string): QueryError {
  return new QueryError(
    'NOT_FOUND',
    `${kind} "${ref}" not found by id or exact name. ${listTool} shows every ${kind.toLowerCase()} with its id; ` +
      'names are compared exactly, never in part.'
  );
}

export function findTable(ref: string): FoundryChatTablesTable {
  const table = byIdOrExactName<FoundryChatTablesTable>(game.tables, ref, 'roll table');
  if (!table) throw notFound('Roll table', ref, 'list-roll-tables');
  return table;
}

/** For access rules, which run before the world check: null instead of an error when nothing is found. */
export function findTableIfAny(ref: string): FoundryChatTablesTable | null {
  if (!ref || !(game.tables as unknown)) return null;
  return byIdOrExactName<FoundryChatTablesTable>(game.tables, ref, 'roll table');
}

export function findMacro(ref: string): FoundryChatTablesMacro {
  const macro = byIdOrExactName<FoundryChatTablesMacro>(game.macros, ref, 'macro');
  if (!macro) throw notFound('Macro', ref, 'list-macros');
  return macro;
}

export function findMacroIfAny(ref: string): FoundryChatTablesMacro | null {
  if (!ref || !(game.macros as unknown)) return null;
  return byIdOrExactName<FoundryChatTablesMacro>(game.macros, ref, 'macro');
}

export function findActor(ref: string): FoundryDocument {
  const actor = byIdOrExactName<FoundryDocument>(game.actors, ref, 'actor');
  if (!actor) throw notFound('Actor', ref, 'list-characters');
  return actor;
}

/** A user's name for messages, or a note that the id belongs to nobody. */
export function userLabel(id: string): string {
  return game.users?.get(id)?.name ?? `unknown user ${id}`;
}

/**
 * Users by id or exact name. Every identifier must match exactly one user;
 * otherwise nothing is returned and one error names every problem and every
 * user, so a whisper never reaches someone the model did not mean.
 */
export function resolveUsers(identifiers: readonly string[], parameter: string): FoundryUser[] {
  const users = game.users?.contents ?? [];
  const found = new Map<string, FoundryUser>();
  const unknown: string[] = [];
  const ambiguous: string[] = [];
  for (const raw of identifiers) {
    const identifier = raw.trim();
    const byId = users.find(user => user.id === identifier);
    if (byId) {
      found.set(byId.id, byId);
      continue;
    }
    const named = users.filter(user => user.name === identifier);
    const [only] = named;
    if (named.length === 1 && only) found.set(only.id, only);
    else if (named.length > 1)
      ambiguous.push(`"${identifier}" (ids ${named.map(user => user.id).join(', ')})`);
    else unknown.push(`"${identifier}"`);
  }
  if (unknown.length || ambiguous.length) {
    const problems: string[] = [];
    if (unknown.length) problems.push(`no user has the id or exact name ${unknown.join(', ')}`);
    if (ambiguous.length) problems.push(`several users share the name ${ambiguous.join('; ')}`);
    throw new QueryError(
      unknown.length ? 'NOT_FOUND' : 'AMBIGUOUS',
      `${parameter}: ${problems.join('; ')}. Users in this world: ` +
        `${users.map(user => `"${user.name}" (id ${user.id})`).join(', ')}. Names are compared exactly, never in part.`
    );
  }
  return [...found.values()];
}
