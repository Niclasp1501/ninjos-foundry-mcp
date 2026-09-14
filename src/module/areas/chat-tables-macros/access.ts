/**
 * What the queries of the chat-tables-macros area declare to the dispatcher.
 *
 * Chat messages are a core kind without a level: sending and changing need the switch, deleting is
 * refused by the dispatcher with the core sentence. This package
 * declares the kind directly; the fallback for a core without it is gone.
 *
 * Running macros sits behind a world setting of this package, off by default.
 * The access rule reads it, so the refusal still comes from the dispatcher,
 * before any handler runs. The switch is always asked first.
 */
import {
  WRITE_SWITCH_ONLY,
  writeSwitchOn,
  type Access,
  type DocumentKind,
  type WriteAction,
} from '../../../common/permissions.js';
import { QueryError } from '../../dispatcher.js';
import { readSetting } from '../../settings.js';

/** The kind chat changes are declared and logged under. */
export const CHAT_LOG_KIND: DocumentKind = 'ChatMessages';

/** The switch and nothing else, for macro runs that post no chat message. */
export const SWITCH_ONLY: Access = WRITE_SWITCH_ONLY;

export function chatAccess(action: WriteAction): Access {
  return { kind: 'write', document: CHAT_LOG_KIND, action };
}

export const MACRO_EXECUTION_SETTING = 'macroExecution';
export const MACRO_EXECUTION_LEVELS = ['off', 'chat', 'all'] as const;
export type MacroExecutionLevel = (typeof MACRO_EXECUTION_LEVELS)[number];

/** The stored level. Unset, unregistered or damaged counts as off: a broken value never grants more. */
export function macroExecutionLevel(): MacroExecutionLevel {
  const raw = readSetting(MACRO_EXECUTION_SETTING);
  return raw === 'chat' || raw === 'all' ? raw : 'off';
}

/** Whether a macro of this type may run now, as text for listings. */
export function macroRunnable(type: string): boolean {
  if (!writeSwitchOn(readSetting)) return false;
  const level = macroExecutionLevel();
  return level === 'all'
    ? type === 'chat' || type === 'script'
    : level === 'chat' && type === 'chat';
}

/** The accesses for running one macro, or the refusal. */
export function macroExecutionAccess(type: string, name: string): Access[] {
  if (!writeSwitchOn(readSetting)) return [SWITCH_ONLY];
  if (type !== 'chat' && type !== 'script') {
    throw new QueryError(
      'INVALID_ARGUMENT',
      `Macro "${name}" has the type "${type}"; only chat and script macros can be run.`
    );
  }
  const level = macroExecutionLevel();
  const setting = `setting "${MACRO_EXECUTION_SETTING}" of Ninjo's Foundry MCP`;
  if (level === 'off') {
    throw new QueryError(
      'PERMISSION_DENIED',
      `Running macros is not permitted. The ${setting} is "off", which is the default. A Gamemaster can set it ` +
        'to "chat" (chat macros only) or "all" (script macros too).'
    );
  }
  if (type === 'script' && level !== 'all') {
    throw new QueryError(
      'PERMISSION_DENIED',
      `Macro "${name}" is a script macro, and running script macros is not permitted. The ${setting} is ` +
        '"chat"; only "all" allows script macros, because a script can do anything a Gamemaster can.'
    );
  }
  return [type === 'chat' ? chatAccess('create') : SWITCH_ONLY];
}
