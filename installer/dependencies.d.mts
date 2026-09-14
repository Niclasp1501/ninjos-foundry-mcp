/** Types for dependencies.mjs, so the tests under src/ can import it. */
export declare function productionPackagesFromLock(
  lock: unknown
): { location: string; optional: boolean }[];

export declare function productionPackages(project: string): string[];
