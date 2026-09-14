/**
 * listChangeHistory and getConfirmationMode: reading the change log and the
 * preview mode. Both only read; the log lives in the Gamemaster's browser.
 */
import type { ChangeEntry, ChangeLog } from '../../../common/change-log.js';
import { kindsOf, reversibility } from '../../../common/areas/preview-undo/rules.js';
import { changeLog as moduleChangeLog } from '../../core-services.js';
import { QueryError, type HandlerContext, type QueryHandler } from '../../dispatcher.js';
import { readSetting } from '../../settings.js';

/** Module setting of the preview mode. Off by default, so nothing changes until a Gamemaster chooses it. */
export const CONFIRM_SETTING = 'confirmDestructiveTools';

export function logOf(context: HandlerContext): ChangeLog {
  return context.changeLog ?? moduleChangeLog;
}

export function argsOf(data: unknown): Record<string, unknown> {
  return typeof data === 'object' && data !== null && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {};
}

export function optionalText(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string')
    throw new QueryError('INVALID_ARGUMENT', `${key} must be a string`);
  return value;
}

export function optionalCount(
  args: Record<string, unknown>,
  key: string,
  max: number
): number | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max)
    throw new QueryError('INVALID_ARGUMENT', `${key} must be a whole number from 1 to ${max}`);
  return value;
}

/** One entry as the model reads it: who, when, which tool, which documents, and whether undo works. */
export function describeEntry(entry: ChangeEntry): Record<string, unknown> {
  const state = reversibility(entry);
  return {
    id: entry.id,
    ...(entry.callId ? { callId: entry.callId } : {}),
    at: entry.at,
    ...(entry.user ? { user: entry.user } : {}),
    tool: entry.tool ?? null,
    query: entry.query,
    action: entry.action,
    kinds: kindsOf(entry),
    targets: entry.targets,
    summary: entry.summary,
    reversible: state.reversible,
    ...(state.reason && !entry.undoneAt ? { notReversibleBecause: state.reason } : {}),
    ...(entry.undoneAt ? { undoneAt: entry.undoneAt } : {}),
    ...(entry.restores ? { undoes: entry.restores.changeId } : {}),
  };
}

export const listChangeHistory: QueryHandler = {
  access: { kind: 'read' },
  run: (data, context) => {
    const args = argsOf(data);
    const limit = optionalCount(args, 'limit', 200) ?? 20;
    const callId = optionalText(args, 'callId');
    const tool = optionalText(args, 'tool');
    const kind = optionalText(args, 'document');
    const matching = logOf(context)
      .list()
      .filter(
        entry =>
          (!callId || entry.callId === callId) &&
          (!tool || entry.tool === tool || entry.query === tool) &&
          (!kind || kindsOf(entry).includes(kind))
      );
    return {
      total: matching.length,
      shown: Math.min(limit, matching.length),
      entries: matching.slice(0, limit).map(describeEntry),
      note:
        'The log lives in the browser of the Gamemaster who holds the bridge, keeps the latest 200 changes and ' +
        'starts empty when that browser reloads the world.',
    };
  },
};

export const getConfirmationMode: QueryHandler = {
  access: { kind: 'read' },
  run: () => {
    const user = game.user;
    return {
      enabled: readSetting(CONFIRM_SETTING) === true,
      ...(user ? { userId: user.id, userName: user.name } : {}),
    };
  },
};
