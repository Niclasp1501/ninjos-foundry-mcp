/**
 * The game system adapters on the server side, and the detected system.
 *
 * Areas register adapters through `adapters` in their ServerArea;
 * installServerAreas puts them here. The system is asked from the module
 * once and kept until a module connects or leaves (backend.ts invalidates).
 */
import {
  SystemAdapterRegistry,
  type QuestionArea,
  type SystemAdapter,
  type SystemAnswer,
  type SystemInfo,
} from '../common/game-systems.js';
import { SystemDetector, type DetectedSystem } from '../common/system-detection.js';
import type { ToolContext } from './tools/types.js';

export const serverSystemAdapters = new SystemAdapterRegistry();
export const systemDetector = new SystemDetector();

export interface ActiveServerSystem extends SystemInfo {
  detection: DetectedSystem;
}

export interface GameSystemSources {
  registry?: SystemAdapterRegistry;
  detector?: SystemDetector;
}

/** The system of the connected world. When the module cannot answer, it is "unknown" with the reason in `detection.problem`. */
export async function activeGameSystem(
  context: Pick<ToolContext, 'query'>,
  sources: GameSystemSources = {}
): Promise<ActiveServerSystem> {
  const registry = sources.registry ?? serverSystemAdapters;
  const detection = await (sources.detector ?? systemDetector).detect(() =>
    context.query('getWorldInfo', {})
  );
  const info = registry.describe(
    detection.source === 'module' ? detection.rawId : null,
    detection.version
  );
  return { ...info, detection };
}

export async function systemAnswer<K extends QuestionArea>(
  context: Pick<ToolContext, 'query'>,
  area: K,
  sources: GameSystemSources = {}
): Promise<SystemAnswer<K>> {
  const system = await activeGameSystem(context, sources);
  return (sources.registry ?? serverSystemAdapters).answer(system, area);
}

/** The adapter's answers only; otherwise an error naming the system (and why it is unknown, if it is). */
export async function requireSystemQuestions<K extends QuestionArea>(
  context: Pick<ToolContext, 'query'>,
  area: K,
  what: string,
  sources: GameSystemSources = {}
): Promise<NonNullable<SystemAdapter[K]>> {
  const system = await activeGameSystem(context, sources);
  if (system.detection.problem) {
    throw new Error(
      `${what} needs to know the game system, and it could not be detected: ${system.detection.problem}`
    );
  }
  return (sources.registry ?? serverSystemAdapters).require(system, area, what);
}
