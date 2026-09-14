/**
 * Foundry types as the scene-image area uses them. A global script: no
 * import, no export, every name carries the area id, so no two areas
 * declare one name differently. Globals such as `canvas`, `Image` and `PIXI` are
 * not declared; the code reads them from globalThis with these interfaces,
 * because the canvas area reads `canvas` too.
 */

/** Scene#grid: in Foundry 13 and 14 a grid object with helpers, in stored data plain fields. */
interface FoundrySceneImageGrid {
  type?: number;
  size?: number;
  distance?: number;
  units?: string;
  color?: string;
  /** Offset of the cell containing a canvas point: i is the row, j the column, counted from the canvas origin. */
  getOffset?(point: { x: number; y: number }): { i: number; j: number };
}

interface FoundrySceneImageScene extends FoundryDocument {
  name: string;
  active?: boolean;
  width: number;
  height: number;
  padding?: number;
  backgroundColor?: string | null;
  grid?: FoundrySceneImageGrid;
  /** Foundry's computed layout; absent in stored data. */
  dimensions?: {
    sceneX?: number;
    sceneY?: number;
    sceneWidth?: number;
    sceneHeight?: number;
    size?: number;
  };
  tokens?: FoundryCollection<FoundrySceneImageToken>;
}

interface FoundrySceneImageToken extends FoundryDocument {
  x: number;
  y: number;
  width?: number;
  height?: number;
  elevation?: number;
  rotation?: number;
  hidden?: boolean;
  disposition?: number;
  actorId?: string | null;
}

/** What the renderer gives back: a canvas element in the browser. */
interface FoundrySceneImagePixels {
  width: number;
  height: number;
}

interface FoundrySceneImageTexture {
  destroy?(destroyBase?: boolean): void;
}

interface FoundrySceneImageRenderer {
  generateTexture?(
    target: unknown,
    options: { region?: unknown; resolution?: number }
  ): FoundrySceneImageTexture;
  extract?: {
    canvas(target: unknown, frame?: unknown): FoundrySceneImagePixels;
  };
}

interface FoundrySceneImageCanvas {
  ready?: boolean;
  scene?: { id: string } | null;
  /** Background, tiles, drawings and token art, in canvas coordinates, without lighting and fog. */
  primary?: unknown;
  stage?: unknown;
  app?: { renderer?: FoundrySceneImageRenderer };
  tokens?: { controlled?: unknown[] };
}
