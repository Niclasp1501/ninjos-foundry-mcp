/**
 * Foundry types the maps area needs beyond the core declarations.
 *
 * A global script without import or export.
 * `foundry` and `FilePicker` are reached through a cast, so no other package
 * that declares them differently can break the type check.
 */

/** Foundry's FilePicker, the static part used to store an image. */
interface FoundryMapsFilePicker {
  upload(
    source: string,
    path: string,
    file: File,
    body?: Record<string, unknown>,
    options?: { notify?: boolean }
  ): Promise<unknown>;
  createDirectory(
    source: string,
    target: string,
    options?: Record<string, unknown>
  ): Promise<unknown>;
  browse(source: string, target: string, options?: Record<string, unknown>): Promise<unknown>;
}

/** The parts of the global `foundry` this package reads. */
interface FoundryMapsNamespace {
  applications?: { apps?: { FilePicker?: { implementation?: FoundryMapsFilePicker } } };
}

/** A user with Foundry's permission check. */
interface FoundryMapsUser extends FoundryUser {
  can?(permission: string): boolean;
}

/** A scene as the map generator sets it up. */
interface FoundryMapsScene extends FoundryDocument {
  name: string;
  active?: boolean;
  width?: number;
  height?: number;
  folder?: unknown;
  grid?: {
    type?: number;
    size?: number;
    distance?: number;
    units?: string;
    color?: string;
    alpha?: number;
  };
  tokenVision?: boolean;
  fog?: { exploration?: boolean };
}
