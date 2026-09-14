/**
 * The global `foundry` namespace, reached through a cast.
 *
 * The core type declarations do not declare `foundry`, and a package that
 * declared it globally would clash with the next package doing the same.
 */

export function foundryNamespace(): FoundryInterfaceNamespace | undefined {
  return (globalThis as unknown as { foundry?: FoundryInterfaceNamespace }).foundry;
}

/** foundry.applications.api, or undefined outside Foundry. */
export function foundryApi(): FoundryInterfaceApi | undefined {
  return foundryNamespace()?.applications?.api;
}
