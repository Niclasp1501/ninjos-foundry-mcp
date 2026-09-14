/**
 * The record a roll request keeps on its chat message, and the
 * checks the Gamemaster's client makes before it counts a roll as done.
 *
 * The request lives in `flags["ninjos-foundry-mcp"].rollRequest` of the chat
 * message the Gamemaster's client created. Players cannot change that message,
 * so the formula, the target and the state are read from there and never from
 * the button a browser shows. A roll answers a request with its own chat
 * message carrying `flags["ninjos-foundry-mcp"].rollResult`; Foundry's server
 * stamps that message with its real author, which is what the check trusts.
 */

export const ROLL_REQUEST_FLAG = 'rollRequest';
export const ROLL_RESULT_FLAG = 'rollResult';

export interface RollRequestRecord {
  version: 1;
  requestId: string;
  status: 'open' | 'completed';
  rollType: string;
  rollTarget: string;
  label: string;
  formula: string;
  isPublic: boolean;
  flavor: string;
  actorId: string | null;
  actorName: string | null;
  targetUserId: string | null;
  targetUserName: string | null;
  requestedBy: string;
  requestedAt: string;
  rolledBy?: string;
  rolledByName?: string;
  rolledAt?: string;
  resultMessageId?: string;
  total?: number | null;
}

export interface RollResultRecord {
  requestId: string;
  requestMessageId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const text = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

/** The request record of a message's flags of this module, or null when it has none or a damaged one. */
export function readRollRequest(moduleFlags: unknown): RollRequestRecord | null {
  if (!isRecord(moduleFlags)) return null;
  const raw = moduleFlags[ROLL_REQUEST_FLAG];
  if (!isRecord(raw)) return null;
  const requestId = text(raw['requestId']);
  const formula = text(raw['formula']);
  if (!requestId || !formula || typeof raw['isPublic'] !== 'boolean') return null;
  if (raw['status'] !== 'open' && raw['status'] !== 'completed') return null;
  return raw as unknown as RollRequestRecord;
}

export function readRollResult(moduleFlags: unknown): RollResultRecord | null {
  if (!isRecord(moduleFlags)) return null;
  const raw = moduleFlags[ROLL_RESULT_FLAG];
  if (!isRecord(raw)) return null;
  const requestId = text(raw['requestId']);
  const requestMessageId = text(raw['requestMessageId']);
  return requestId && requestMessageId ? { requestId, requestMessageId } : null;
}

/** Formulas compare without spaces and case, since Foundry writes "1d20 + 3" for "1d20+3". */
export function sameFormula(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const plain = (value: string) => value.replace(/\s+/g, '').toLowerCase();
  return plain(a) === plain(b);
}

/** A request id that is unique enough for one world's chat log. */
export function newRequestId(random: () => number = Math.random): string {
  let id = '';
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 16; i += 1) id += alphabet[Math.floor(random() * alphabet.length)] ?? 'x';
  return `roll-${id}`;
}

export type RollCheck =
  | { ok: true }
  | {
      ok: false;
      reason: 'completed' | 'notAllowed' | 'formula' | 'visibility' | 'noRoll';
      detail?: string;
    };

/**
 * Whether a roll result may complete a request. `author` is the user Foundry
 * stored as the author of the result message, never a name the result claims.
 */
export function checkRollResult(
  request: RollRequestRecord,
  result: {
    author: { id: string; isGM: boolean } | null;
    formula: unknown;
    whispered: boolean;
  }
): RollCheck {
  if (request.status === 'completed') return { ok: false, reason: 'completed' };
  const author = result.author;
  if (!author || !(author.isGM || author.id === request.targetUserId))
    return { ok: false, reason: 'notAllowed' };
  if (typeof result.formula !== 'string') return { ok: false, reason: 'noRoll' };
  if (!sameFormula(result.formula, request.formula))
    return { ok: false, reason: 'formula', detail: result.formula };
  if (!request.isPublic && !result.whispered) return { ok: false, reason: 'visibility' };
  return { ok: true };
}
