/**
 * What the handlers of the world-files-decks area share: arguments, Foundry access, the log.
 *
 * Argument helpers come from the chat-tables-macros area, lookups from the world area (imported, not
 * changed). World time, pause, notifications, files and settings have no
 * document kind; their changes are logged under the labels the core has for
 * changes without a document.
 */
import type { ChangeInput, ChangeWithoutDocument } from '../../../common/change-log.js';
import { PathError } from '../../../common/areas/world-files-decks/paths.js';
import { QueryError, type HandlerContext } from '../../dispatcher.js';
import {
  messageOf,
  optionalBoolean,
  optionalChoice,
  optionalInteger,
  optionalText,
  requiredText,
  resolveUsers,
} from '../chat-tables-macros/lookup.js';
import { byIdOrExactName, idOf, inputOf, isRecord, notFoundById, textOf } from '../world/lookup.js';

export {
  byIdOrExactName,
  idOf,
  inputOf,
  isRecord,
  messageOf,
  notFoundById,
  optionalBoolean,
  optionalChoice,
  optionalInteger,
  optionalText,
  requiredText,
  resolveUsers,
  textOf,
};

export function worldGame(): FoundryWorldFilesDecksGame {
  return game as unknown as FoundryWorldFilesDecksGame;
}

export function invalid(message: string): QueryError {
  return new QueryError('INVALID_ARGUMENT', message);
}

/** Run a path rule; its error becomes INVALID_ARGUMENT with the same text. */
export function checked<T>(rule: () => T): T {
  try {
    return rule();
  } catch (error) {
    if (error instanceof PathError) throw invalid(error.message);
    throw error;
  }
}

/** Labels for changes without a document kind; the core knows them. */
export type WorldChangeLabel = ChangeWithoutDocument;

export function recordWorldChange(
  context: HandlerContext,
  label: WorldChangeLabel,
  change: Omit<ChangeInput, 'document'>
): void {
  context.recordChange({ ...change, document: label });
}

/** A Foundry user permission such as FILES_UPLOAD, checked when Foundry offers the check. */
export function requireUserPermission(permission: string, doing: string): void {
  const user = game.user as FoundryWorldFilesDecksUser | null;
  if (user && typeof user.can === 'function' && !user.can(permission)) {
    throw new QueryError(
      'PERMISSION_DENIED',
      `The Foundry user "${user.name}" lacks the Foundry permission ${permission}, so ${doing} is not possible.`
    );
  }
}

export function listOfTexts(input: Record<string, unknown>, key: string): string[] | undefined {
  const raw = input[key];
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw) || raw.some(item => typeof item !== 'string' || !item.trim()))
    throw invalid(`${key} must be a list of texts that are not empty`);
  return raw.map(item => (item as string).trim());
}
