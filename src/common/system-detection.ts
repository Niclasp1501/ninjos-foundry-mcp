/**
 * Which game system the world runs, as the server learns it from the module.
 *
 * The module reads `game.system` itself on every call and needs none of this.
 * The server asks the module for the world info (query `getWorldInfo`) and
 * keeps the answer, because it needs it for many calls and the answer only
 * changes with the world.
 *
 * Rules (those of the previous generation, with one of its faults fixed):
 * - The first successful answer is kept, also for a system without adapter.
 * - A failed question (no module yet) is not kept: this call counts as an
 *   unknown system with the reason, the next call asks again.
 * - The id comes as text or as an object with `id`; it is compared in lower
 *   case, and the raw id is kept.
 * - `invalidate()` forgets the answer. The backend calls it whenever a module
 *   connects or leaves, so a world change is noticed; the previous generation
 *   kept the old system until the server restarted.
 */

export interface DetectedSystem {
  /** Lower case system id, or "unknown" when detection failed. */
  id: string;
  /** As Foundry reported it, or "unknown". */
  rawId: string;
  version: string | null;
  foundryVersion: string | null;
  worldId: string | null;
  /** `module`: answered and kept. `unavailable`: not answered, not kept. */
  source: 'module' | 'unavailable';
  /** Why detection failed, for `unavailable`. */
  problem: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** The system id from `game.system`, a world info field, or null. */
export function systemIdFrom(raw: unknown): string | null {
  if (typeof raw === 'string') return text(raw);
  if (isRecord(raw)) return text(raw['id']);
  return null;
}

/**
 * Read a world info answer of either generation: `system` as text with
 * `systemVersion` and `foundryVersion` beside it, or `system` as an object.
 * Null when it names no system.
 */
export function detectedFromWorldInfo(info: unknown): DetectedSystem | null {
  if (!isRecord(info)) return null;
  const rawId = systemIdFrom(info['system']);
  if (!rawId) return null;
  const system = info['system'];
  const world = info['world'];
  return {
    id: rawId.toLowerCase(),
    rawId,
    version: text(info['systemVersion']) ?? (isRecord(system) ? text(system['version']) : null),
    foundryVersion:
      text(info['foundryVersion']) ??
      (isRecord(info['foundry']) ? text(info['foundry']['version']) : null),
    worldId:
      text(info['id']) ?? text(info['worldId']) ?? (isRecord(world) ? text(world['id']) : null),
    source: 'module',
    problem: null,
  };
}

function unavailable(problem: string): DetectedSystem {
  return {
    id: 'unknown',
    rawId: 'unknown',
    version: null,
    foundryVersion: null,
    worldId: null,
    source: 'unavailable',
    problem,
  };
}

export class SystemDetector {
  #cached: DetectedSystem | null = null;
  #pending: Promise<DetectedSystem> | null = null;
  #generation = 0;

  /** The kept answer, or null. */
  cached(): DetectedSystem | null {
    return this.#cached;
  }

  /** Forget the answer; the next call asks again. A question already under way is not kept either. */
  invalidate(): void {
    this.#cached = null;
    this.#pending = null;
    this.#generation += 1;
  }

  /** The kept answer, or ask with `fetchWorldInfo`. Concurrent calls share one question. */
  detect(fetchWorldInfo: () => Promise<unknown>): Promise<DetectedSystem> {
    if (this.#cached) return Promise.resolve(this.#cached);
    if (this.#pending) return this.#pending;
    const generation = this.#generation;
    const pending = (async () => {
      let info: unknown;
      try {
        info = await fetchWorldInfo();
      } catch (error) {
        return unavailable(
          `the world info could not be read: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      const detected = detectedFromWorldInfo(info);
      if (!detected) return unavailable('the world info names no game system');
      if (generation === this.#generation) this.#cached = detected;
      return detected;
    })();
    this.#pending = pending;
    void pending.finally(() => {
      if (this.#pending === pending) this.#pending = null;
    });
    return pending;
  }
}
