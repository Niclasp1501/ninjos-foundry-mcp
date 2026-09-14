/**
 * Foundry types as the tokens-dice area uses them. A global script: no
 * import, no export; every name carries the package id.
 * Globals such as Roll, ChatMessage and CONFIG.statusEffects are read from
 * globalThis with the interfaces below, not declared as globals here.
 */

interface FoundryTokensDiceToken extends FoundryDocument {
  name?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  rotation?: number;
  alpha?: number;
  hidden?: boolean;
  disposition?: number;
  elevation?: number;
  lockRotation?: boolean;
  actorId?: string | null;
  actorLink?: boolean;
  texture?: { src?: string | null; scaleX?: number };
  /** The world actor of a linked token, the token's own actor of an unlinked one. */
  readonly actor?: FoundryTokensDiceActor | null;
}

interface FoundryTokensDiceScene extends FoundryDocument {
  name?: string;
  active?: boolean;
  tokens?: FoundryCollection<FoundryTokensDiceToken>;
}

interface FoundryTokensDiceEffect extends FoundryDocument {
  name?: string;
}

interface FoundryTokensDiceActor extends FoundryDocument {
  name?: string;
  type?: string;
  img?: string | null;
  ownership?: Record<string, number>;
  effects?: FoundryCollection<FoundryTokensDiceEffect>;
  /** Foundry's own way to set a status condition, which systems hook into. */
  toggleStatusEffect?(statusId: string, options?: { active?: boolean }): Promise<unknown>;
  getRollData?(): unknown;
}

interface FoundryTokensDiceMessage extends FoundryDocument {
  flags?: Record<string, unknown>;
  /** The author as Foundry's server stored it: a User in Foundry, an id in stored data. */
  author?: unknown;
  /** The author before Foundry 12. */
  user?: unknown;
  whisper?: string[];
  rolls?: Array<{ formula?: string; total?: number }>;
  timestamp?: number;
}

interface FoundryTokensDiceRoll {
  formula: string;
  total?: number;
  evaluate(options?: Record<string, unknown>): Promise<unknown>;
}

interface FoundryTokensDiceRollClass {
  new (formula: string, data?: Record<string, unknown>): FoundryTokensDiceRoll;
  validate?(formula: string): boolean;
}

interface FoundryTokensDiceMessageClass {
  create(data: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}
