/**
 * Foundry types the interface area needs beyond the core declarations.
 *
 * A global script without import or export.
 * Nothing here extends a core interface. `foundry`, `game.packs` and
 * `game.settings.registerMenu` are reached through a cast to these types, so
 * no other package that declares them differently can break the type check.
 */

/** Position of an ApplicationV2 window. */
interface FoundryInterfacePosition {
  width?: number | 'auto';
  height?: number | 'auto';
  left?: number;
  top?: number;
}

/** An ApplicationV2 instance, as far as the windows of this package use it. */
interface FoundryInterfaceApplication {
  readonly element: HTMLElement;
  readonly rendered: boolean;
  position: FoundryInterfacePosition;
  render(options?: boolean | Record<string, unknown>): Promise<unknown>;
  close(options?: Record<string, unknown>): Promise<unknown>;
  setPosition(position: FoundryInterfacePosition): unknown;
  _renderHTML(context: Record<string, unknown>, options: Record<string, unknown>): Promise<unknown>;
  _replaceHTML(result: unknown, content: HTMLElement, options: Record<string, unknown>): void;
  _onRender(context: Record<string, unknown>, options: Record<string, unknown>): unknown;
}

interface FoundryInterfaceApplicationClass {
  new (options?: Record<string, unknown>): FoundryInterfaceApplication;
}

interface FoundryInterfaceDialogClass {
  wait(config: Record<string, unknown>): Promise<unknown>;
}

/** foundry.applications.api */
interface FoundryInterfaceApi {
  ApplicationV2: FoundryInterfaceApplicationClass;
  DialogV2: FoundryInterfaceDialogClass;
}

/** The global `foundry`, the part this package reads. */
interface FoundryInterfaceNamespace {
  applications?: {
    api?: FoundryInterfaceApi;
    instances?: Map<string, FoundryInterfaceApplication>;
  };
}

interface FoundryInterfaceMenuConfig {
  name: string;
  label: string;
  hint: string;
  icon: string;
  type: FoundryInterfaceApplicationClass;
  restricted: boolean;
}

/** A compendium collection as the release window lists it. */
interface FoundryInterfacePack {
  collection: string;
  documentName?: string;
  locked?: boolean;
  title?: string;
  metadata?: {
    label?: string;
    type?: string;
    packageType?: string;
    packageName?: string;
  };
  index?: { size?: number };
}
