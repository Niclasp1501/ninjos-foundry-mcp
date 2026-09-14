/**
 * Foundry types as the combat-rolls area uses them. A global script: no
 * import, no export; every name carries the package id.
 * Roll, ChatMessage and Combat are read from globalThis with these interfaces.
 */

interface FoundryCombatRollsActor extends FoundryDocument {
  type?: string;
  img?: string | null;
  ownership?: Record<string, number>;
  /** Foundry 13 and 14: whether any player owns the actor. */
  readonly hasPlayerOwner?: boolean;
  effects?: FoundryCollection<FoundryDocument & { statuses?: unknown }>;
  getRollData?(): unknown;
}

interface FoundryCombatRollsToken extends FoundryDocument {
  x?: number;
  y?: number;
  hidden?: boolean;
  actorId?: string | null;
  actorLink?: boolean;
  readonly actor?: FoundryCombatRollsActor | null;
}

interface FoundryCombatRollsCombatant extends FoundryDocument {
  img?: string | null;
  actorId?: string | null;
  tokenId?: string | null;
  sceneId?: string | null;
  initiative?: number | null;
  hidden?: boolean;
  defeated?: boolean;
  readonly isNPC?: boolean;
  /** The token's actor, or the world actor without token. */
  readonly actor?: FoundryCombatRollsActor | null;
  readonly token?: FoundryCombatRollsToken | null;
  /** A roll with the initiative formula of the game system, not yet evaluated. */
  getInitiativeRoll?(formula?: string): FoundryCombatRollsRoll;
}

interface FoundryCombatRollsCombat extends FoundryDocument {
  /** A Scene in Foundry, an id in stored data, null when unlinked. */
  scene?: unknown;
  active?: boolean;
  round?: number;
  turn?: number | null;
  combatants: FoundryCollection<FoundryCombatRollsCombatant>;
  /** The combatants in turn order. */
  readonly turns?: FoundryCombatRollsCombatant[];
  activate?(): Promise<unknown>;
  startCombat?(): Promise<unknown>;
  nextTurn?(): Promise<unknown>;
  previousTurn?(): Promise<unknown>;
  nextRound?(): Promise<unknown>;
  previousRound?(): Promise<unknown>;
}

interface FoundryCombatRollsRoll {
  formula: string;
  total?: number;
  result?: string;
  dice?: unknown[];
  evaluate(options?: Record<string, unknown>): Promise<unknown>;
}

interface FoundryCombatRollsRollClass {
  new (formula: string, data?: Record<string, unknown>): FoundryCombatRollsRoll;
  validate?(formula: string): boolean;
}

interface FoundryCombatRollsMessage extends FoundryDocument {
  whisper?: unknown[];
  blind?: boolean;
  rolls?: unknown[];
}

interface FoundryCombatRollsDocumentClass {
  create(data: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}
