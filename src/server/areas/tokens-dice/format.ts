/**
 * The answers of both module generations as the model reads
 * them. The previous module answered move and toggle with a mirror of the
 * input, and delete-tokens with `deletedTokens` and `failedTokens` where the
 * previous server read `tokenIds` and `errors`; every form below takes both.
 */
import { isRecord, nestedTokenDetails } from '../../../common/areas/tokens-dice/tokens.js';

type Answer = Record<string, unknown>;

export function record(answer: unknown, what: string): Answer {
  if (!isRecord(answer)) {
    throw new Error(
      `The module answered ${what} in a shape this server does not know: ${JSON.stringify(answer ?? null)}`
    );
  }
  return answer;
}

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** Scene, notes and warnings travel through every answer unchanged when the module sends them. */
function extras(answer: Answer): Answer {
  const out: Answer = {};
  for (const key of ['scene', 'warnings', 'notes'])
    if (answer[key] !== undefined) out[key] = answer[key];
  return out;
}

export function formatMove(answer: unknown): Answer {
  const a = record(answer, 'move-token');
  return {
    success: true,
    tokenId: a['tokenId'] ?? null,
    tokenName: a['tokenName'] ?? null,
    newPosition: a['newPosition'] ?? null,
    ...(a['previousPosition'] !== undefined ? { previousPosition: a['previousPosition'] } : {}),
    animated: a['animated'] === true,
    ...extras(a),
  };
}

export function formatUpdate(answer: unknown): Answer {
  const a = record(answer, 'update-token');
  return {
    success: true,
    tokenId: a['tokenId'] ?? null,
    tokenName: a['tokenName'] ?? null,
    updated: true,
    updatedProperties: a['updatedProperties'] ?? null,
    ...(a['appliedUpdates'] !== undefined ? { appliedUpdates: a['appliedUpdates'] } : {}),
    ...extras(a),
  };
}

interface Entry {
  id: string;
  name?: string;
  reason?: string;
}

function entries(list: unknown, reasonField: boolean): Entry[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((item): Entry[] => {
    if (typeof item === 'string') {
      if (!reasonField) return [{ id: item }];
      const at = item.indexOf(':');
      return at > 0
        ? [{ id: item.slice(0, at).trim(), reason: item.slice(at + 1).trim() }]
        : [{ id: item }];
    }
    if (!isRecord(item)) return [];
    const id = text(item['id']) ?? text(item['tokenId']);
    if (!id) return [];
    const entry: Entry = { id };
    const name = text(item['name']);
    if (name !== null) entry.name = name;
    const reason = text(item['reason']) ?? text(item['error']);
    if (reason !== null) entry.reason = reason;
    return [entry];
  });
}

export function formatDelete(answer: unknown): Answer {
  const a = record(answer, 'delete-tokens');
  const deleted = entries(a['deletedTokens'] ?? a['tokenIds'], false);
  const failed = entries(a['failedTokens'] ?? a['errors'], true);
  const count = typeof a['deletedCount'] === 'number' ? a['deletedCount'] : deleted.length;
  if (count === 0) {
    const reasons = failed.map(entry => `${entry.id}${entry.reason ? ` (${entry.reason})` : ''}`);
    throw new Error(
      `Failed to delete tokens: no token was deleted${reasons.length ? `: ${reasons.join('; ')}` : ''}`
    );
  }
  return {
    success: true,
    deletedCount: count,
    deletedTokens: deleted,
    failedTokens: failed,
    ...(failed.length
      ? { note: `${failed.length} token(s) could not be deleted; see failedTokens.` }
      : {}),
    ...extras(a),
  };
}

export function formatDetails(answer: unknown): Answer {
  const a = record(answer, 'get-token-details');
  // An answer that is already nested (a later module generation) stays as it is.
  if (isRecord(a['position'])) return a;
  return nestedTokenDetails(a);
}

export function formatToggle(answer: unknown): Answer {
  const a = record(answer, 'toggle-token-condition');
  const active = typeof a['isActive'] === 'boolean' ? a['isActive'] : a['active'];
  if (typeof active !== 'boolean') {
    throw new Error(
      `The module did not say whether the condition is now set: ${JSON.stringify(a)}`
    );
  }
  return {
    success: true,
    tokenId: a['tokenId'] ?? null,
    tokenName: a['tokenName'] ?? null,
    conditionId: a['conditionId'] ?? null,
    conditionName: a['conditionName'] ?? null,
    isActive: active,
    ...(typeof a['changed'] === 'boolean' ? { changed: a['changed'] } : {}),
    ...(a['effectTarget'] !== undefined ? { effectTarget: a['effectTarget'] } : {}),
    ...(a['level'] !== undefined ? { level: a['level'] } : {}),
    ...(a['previousLevel'] !== undefined ? { previousLevel: a['previousLevel'] } : {}),
    ...(typeof a['message'] === 'string' ? { message: a['message'] } : {}),
    ...extras(a),
  };
}

export function formatConditions(answer: unknown): Answer {
  const a = record(answer, 'get-available-conditions');
  if (!Array.isArray(a['conditions'])) {
    throw new Error(`The module sent no list of conditions: ${JSON.stringify(a)}`);
  }
  return {
    success: true,
    gameSystem: a['gameSystem'] ?? null,
    ...(a['adapter'] !== undefined ? { adapter: a['adapter'] } : {}),
    conditions: a['conditions'],
    ...extras(a),
  };
}

export function formatRollRequest(answer: unknown): string {
  const a = record(answer, 'request-player-rolls');
  const lines = [`Roll request sent successfully! ${text(a['message']) ?? ''}`.trim()];
  if (typeof a['label'] === 'string') lines.push(`Roll: ${a['label']}`);
  if (typeof a['formula'] === 'string') lines.push(`Formula: ${a['formula']}`);
  if (Array.isArray(a['whisperedTo']))
    lines.push(`Whispered to: ${a['whisperedTo'].map(String).join(', ')}`);
  if (typeof a['messageId'] === 'string') lines.push(`Chat message: ${a['messageId']}`);
  if (Array.isArray(a['notes'])) for (const note of a['notes']) lines.push(`Note: ${String(note)}`);
  return lines.join('\n');
}
