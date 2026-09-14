/**
 * The game system adapters on the module side.
 *
 * Areas register adapters through `adapters` in their ModuleArea; main.ts
 * installs them at init. The active system is read from Foundry on every
 * call, so a world change never leaves a stale answer.
 * Refusals are QueryErrors, so their code reaches the server.
 */
import {
  SystemAdapterRegistry,
  type QuestionArea,
  type SystemAdapter,
  type SystemAnswer,
  type SystemInfo,
} from '../common/game-systems.js';
import { systemIdFrom } from '../common/system-detection.js';
import { QueryError } from './dispatcher.js';

export const moduleSystemAdapters = new SystemAdapterRegistry({
  fail: (code, message) => {
    throw new QueryError(code, message);
  },
});

/** The system of the loaded world, with its adapter, read fresh. */
export function activeGameSystem(
  registry: SystemAdapterRegistry = moduleSystemAdapters
): SystemInfo {
  const system = game.system as unknown;
  const version =
    typeof system === 'object' &&
    system !== null &&
    typeof (system as { version?: unknown }).version === 'string'
      ? (system as { version: string }).version
      : null;
  return registry.describe(systemIdFrom(system), version);
}

/** The adapter's answers for an area, completed by the generic fallbacks. */
export function systemAnswer<K extends QuestionArea>(area: K): SystemAnswer<K> {
  return moduleSystemAdapters.answer(activeGameSystem(), area);
}

/** The adapter's answers only; otherwise QueryError SYSTEM_NOT_SUPPORTED naming the system. */
export function requireSystemQuestions<K extends QuestionArea>(
  area: K,
  what: string
): NonNullable<SystemAdapter[K]> {
  return moduleSystemAdapters.require(activeGameSystem(), area, what);
}

/** For a tool of one system: QueryError WRONG_SYSTEM in any other world. */
export function requireGameSystem(adapterId: string, what: string): SystemInfo {
  const system = activeGameSystem();
  moduleSystemAdapters.requireSystem(system, adapterId, what);
  return system;
}
