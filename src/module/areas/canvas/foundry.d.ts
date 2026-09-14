/**
 * Foundry types as the canvas area uses them. A global script: no
 * import, no export; every name carries the package id.
 * The globals `canvas` and `CONFIG.Canvas` are read from globalThis with the
 * interfaces below, never declared, because the scenes area reads `canvas` too.
 */

/** A wall, light, sound, region, tile or drawing: an embedded document of a scene. */
interface FoundryCanvasElement extends FoundryDocument {
  [field: string]: unknown;
}

interface FoundryCanvasToken extends FoundryDocument {
  name?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  hidden?: boolean;
  disposition?: number;
  actorId?: string | null;
}

/** Foundry 12 and later: `scene.grid` is a grid object with measuring; stored data has only the numbers. */
interface FoundryCanvasGrid {
  type?: number;
  size?: number;
  distance?: number;
  units?: string;
  measurePath?(
    waypoints: Array<{ x: number; y: number }>,
    options?: Record<string, unknown>
  ): { distance?: number; spaces?: number; cost?: number };
}

interface FoundryCanvasScene extends FoundryDocument {
  name?: string;
  active?: boolean;
  width?: number;
  height?: number;
  padding?: number;
  grid?: FoundryCanvasGrid | null;
  /** Computed by Foundry for a prepared scene: the whole canvas including padding. */
  dimensions?: { width?: number; height?: number } | null;
  tokens?: FoundryCollection<FoundryCanvasToken>;
}

interface FoundryCanvasBoard {
  ready?: boolean;
  scene?: { id: string } | null;
  stage?: { pivot?: { x: number; y: number }; scale?: { x: number; y: number } } | null;
  animatePan?(view: {
    x?: number;
    y?: number;
    scale?: number;
    duration?: number;
  }): Promise<unknown>;
  ping?(origin: { x: number; y: number }, options?: Record<string, unknown>): Promise<unknown>;
}

interface FoundryCanvasPolygonBackend {
  testCollision?(
    origin: { x: number; y: number },
    destination: { x: number; y: number },
    config: Record<string, unknown>
  ): unknown;
}

interface FoundryCanvasConfig {
  Canvas?: { polygonBackends?: Record<string, FoundryCanvasPolygonBackend | undefined> };
}
