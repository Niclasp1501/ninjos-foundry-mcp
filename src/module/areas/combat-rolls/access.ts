/**
 * What the queries of the combat-rolls area declare to the dispatcher.
 *
 * Combat encounters are a core kind without a level:
 * creating and changing need the switch,
 * deleting an encounter is refused by the dispatcher with the core sentence.
 * end-combat without deleteEncounter stops the encounter and keeps it.
 *
 * Posting a roll to the chat declares the core kind ChatMessages.
 */
import type { Access, DocumentKind, WriteAction } from '../../../common/permissions.js';
import type { HandlerContext } from '../../dispatcher.js';

/** The kind combat changes are declared and logged under. */
export const COMBAT_LOG_KIND: DocumentKind = 'Combats';

export const CHAT_POST: Access = { kind: 'write', document: 'ChatMessages', action: 'create' };

export const READ_ONLY: Access = { kind: 'read' };

export function combatAccess(action: WriteAction): Access {
  return { kind: 'write', document: COMBAT_LOG_KIND, action };
}

/** The refusal a dry run reports instead of failing, or null. */
export function accessProblemOf(
  context: HandlerContext,
  build: () => Access | readonly Access[]
): string | null {
  try {
    return context.accessProblem(build());
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** A changing combat query: read for a dry run, otherwise the combat access plus the chat when posting. */
export function writeRule(action: WriteAction, data: unknown): readonly Access[] {
  const args = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
  if (args['dryRun'] === true) return [READ_ONLY];
  return args['toChat'] === true ? [combatAccess(action), CHAT_POST] : [combatAccess(action)];
}
