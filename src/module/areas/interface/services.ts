/**
 * What the windows of the interface area call, and who provides it.
 *
 * The windows only show and ask. What happens behind them belongs to other
 * packages: the creature index and the compendium release list to the compendiums area
 * (compendiums), the map service to the maps area. Those packages hand their
 * service over once, at init:
 *
 *   import { provideInterfaceService } from '../interface/services.js';
 *   provideInterfaceService('creatureIndex', { rebuild: () => index.rebuild() });
 *
 * A window whose service is missing says so and disables its controls. It
 * never pretends: a button that silently does nothing was one of the
 * faults of the previous generation.
 */

/** A failure a window can explain. Anything else is shown with its message. */
export class InterfaceServiceError extends Error {
  constructor(
    /** BRIDGE_MISSING: the action needs the MCP server and the bridge is down. */
    readonly code: 'BRIDGE_MISSING' | 'FAILED',
    message: string
  ) {
    super(message);
    this.name = 'InterfaceServiceError';
  }
}

export interface CreatureIndexResult {
  /** Creatures in the new index. */
  creatures: number;
  /** Actor compendiums read for it. */
  packs: number;
  /** Creatures that could not be read and are missing from the index. */
  failed?: number;
  /** Why the built index could not be stored, or null. */
  storeProblem?: string | null;
}

export interface CreatureIndexService {
  /** Build the index again. Resolves when it is done; rejects with the cause. */
  rebuild(): Promise<CreatureIndexResult>;
}

/**
 * The stored format of `writableCompendiums` is the business of
 * the compendiums area; the window only deals in entries: full compendium ids ("world.archive")
 * or package names ("my-module"), which stand for every compendium of that
 * package. An empty list means every compendium that is not locked.
 */
export interface CompendiumReleaseService {
  /** The entries as stored now. */
  read(): readonly string[];
  /**
   * Why the stored value could not be read, or null. A damaged list releases
   * nothing, so the window must not show it as "allow all".
   */
  problem?(): string | null;
  /** Store exactly these entries. The window reads them back before it reports success. */
  write(entries: readonly string[]): Promise<void>;
}

export interface InterfaceServices {
  creatureIndex: CreatureIndexService;
  compendiumRelease: CompendiumReleaseService;
}

const services: Partial<InterfaceServices> = {};

/** Hand a service to the windows. A second call replaces the first; the last provider wins. */
export function provideInterfaceService<K extends keyof InterfaceServices>(
  name: K,
  service: InterfaceServices[K]
): void {
  services[name] = service;
}

/** The provided service, or undefined when its package is not there yet. */
export function interfaceService<K extends keyof InterfaceServices>(
  name: K
): InterfaceServices[K] | undefined {
  return services[name];
}

/** For tests: forget every provided service. */
export function clearInterfaceServices(): void {
  for (const name of Object.keys(services) as (keyof InterfaceServices)[]) delete services[name];
}
