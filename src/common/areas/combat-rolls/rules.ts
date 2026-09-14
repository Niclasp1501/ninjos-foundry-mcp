/**
 * Area combat-rolls: the rules that need no Foundry.
 *
 * - who sees a roll message for each roll mode
 * - the order of combatants in the tracker
 * - whether a combatant counts as a non player character
 * - which combatants an initiative roll takes
 * - what a finished roll looks like as plain data
 *
 * Written from Foundry's public API (CONST.DICE_ROLL_MODES, Combat turn
 * order, Combatant#isNPC); kept here so the tests run without Foundry.
 */

/** Foundry's roll modes, as the API names them. */
export const ROLL_MODES = ['publicroll', 'gmroll', 'blindroll', 'selfroll'] as const;
export type RollMode = (typeof ROLL_MODES)[number];

export function isRollMode(value: unknown): value is RollMode {
  return typeof value === 'string' && (ROLL_MODES as readonly string[]).includes(value);
}

export interface RollRecipients {
  /** User ids the message is whispered to; empty means everyone sees it. */
  whisper: string[];
  /** Whether the result is hidden from the roller and from players. */
  blind: boolean;
}

/**
 * Recipients of a roll message for a roll mode.
 * gmroll: every Gamemaster and the roller. blindroll: every Gamemaster, hidden.
 * selfroll: the roller alone. publicroll: everyone.
 */
export function recipientsFor(
  mode: RollMode,
  rollerId: string,
  gamemasterIds: readonly string[]
): RollRecipients {
  const distinct = (ids: readonly string[]) => [...new Set(ids.filter(id => id))];
  if (mode === 'gmroll') return { whisper: distinct([...gamemasterIds, rollerId]), blind: false };
  if (mode === 'blindroll') return { whisper: distinct(gamemasterIds), blind: true };
  if (mode === 'selfroll') return { whisper: distinct([rollerId]), blind: false };
  return { whisper: [], blind: false };
}

/** Whether two recipient sets mean the same visibility. */
export function sameRecipients(wanted: RollRecipients, stored: RollRecipients): boolean {
  if (wanted.blind !== stored.blind) return false;
  const a = new Set(wanted.whisper);
  const b = new Set(stored.whisper);
  return a.size === b.size && [...a].every(id => b.has(id));
}

export interface TurnOrderEntry {
  id: string;
  name: string;
  initiative: number | null;
}

/** Highest initiative first, combatants without one last, then by name, then by id. */
export function compareTurnOrder(a: TurnOrderEntry, b: TurnOrderEntry): number {
  const left = a.initiative ?? Number.NEGATIVE_INFINITY;
  const right = b.initiative ?? Number.NEGATIVE_INFINITY;
  if (left !== right) return right > left ? 1 : -1;
  if (a.name !== b.name) return a.name > b.name ? 1 : -1;
  if (a.id === b.id) return 0;
  return a.id > b.id ? 1 : -1;
}

const OWNER = 3;

/**
 * A combatant is a non player character when no player owns its actor:
 * neither an explicit OWNER entry for a user who is not a Gamemaster, nor
 * OWNER as the default level. A combatant without actor counts as one.
 */
export function isNonPlayerCharacter(
  ownership: Readonly<Record<string, unknown>> | null | undefined,
  users: ReadonlyArray<{ id: string; isGM: boolean }>
): boolean {
  if (!ownership) return true;
  const players = users.filter(user => !user.isGM);
  if (!players.length) return true;
  if (ownership['default'] === OWNER) return false;
  return !players.some(user => ownership[user.id] === OWNER);
}

export interface InitiativeCandidate extends TurnOrderEntry {
  isNPC: boolean;
}

export interface InitiativeSelection {
  selected: InitiativeCandidate[];
  skipped: Array<{ id: string; name: string; reason: string }>;
}

export class CombatRuleError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'CombatRuleError';
  }
}

/**
 * Which combatants an initiative roll takes.
 * With ids: exactly those, each must exist, each at most once.
 * Otherwise `scope` all or npcs; `onlyMissing` leaves out those that have one,
 * and every left out combatant is named with the reason.
 */
export function selectForInitiative(
  candidates: readonly InitiativeCandidate[],
  choice: { ids?: readonly string[]; scope: 'all' | 'npcs'; onlyMissing: boolean }
): InitiativeSelection {
  if (choice.ids) {
    const seen = new Set<string>();
    const selected: InitiativeCandidate[] = [];
    const missing: string[] = [];
    for (const id of choice.ids) {
      if (seen.has(id))
        throw new CombatRuleError('INVALID_ARGUMENT', `Combatant "${id}" is listed twice.`);
      seen.add(id);
      const found = candidates.find(candidate => candidate.id === id);
      if (found) selected.push(found);
      else missing.push(id);
    }
    if (missing.length) {
      const known = candidates.map(c => `"${c.name}" [${c.id}]`).join(', ') || 'none';
      throw new CombatRuleError(
        'COMBATANT_NOT_FOUND',
        `Not in this encounter: ${missing.map(id => `"${id}"`).join(', ')}. Nothing was rolled. Combatants: ${known}.`
      );
    }
    return { selected, skipped: [] };
  }
  const selected: InitiativeCandidate[] = [];
  const skipped: InitiativeSelection['skipped'] = [];
  for (const candidate of candidates) {
    if (choice.scope === 'npcs' && !candidate.isNPC) {
      skipped.push({ id: candidate.id, name: candidate.name, reason: 'player character' });
    } else if (choice.onlyMissing && candidate.initiative !== null) {
      skipped.push({
        id: candidate.id,
        name: candidate.name,
        reason: `has initiative ${candidate.initiative}`,
      });
    } else {
      selected.push(candidate);
    }
  }
  return { selected, skipped };
}

export interface DieResult {
  result: number;
  active: boolean;
}

export interface DieSummary {
  expression: string;
  faces: number | null;
  number: number | null;
  total: number | null;
  results: DieResult[];
}

export interface RollSummary {
  formula: string;
  total: number | null;
  result: string | null;
  dice: DieSummary[];
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A finished Foundry roll as plain data: formula, total, and every die with its single results. */
export function summarizeRoll(roll: unknown): RollSummary {
  const data = record(roll) ?? {};
  const dice = Array.isArray(data['dice']) ? data['dice'] : [];
  return {
    formula: typeof data['formula'] === 'string' ? data['formula'] : '',
    total: numberOrNull(data['total']),
    result: typeof data['result'] === 'string' ? data['result'] : null,
    dice: dice.map(die => {
      const term = record(die) ?? {};
      const results = Array.isArray(term['results']) ? term['results'] : [];
      const expression =
        typeof term['expression'] === 'string'
          ? term['expression']
          : typeof term['formula'] === 'string'
            ? term['formula']
            : '';
      return {
        expression,
        faces: numberOrNull(term['faces']),
        number: numberOrNull(term['number']),
        total: numberOrNull(term['total']),
        results: results.map(entry => {
          const single = record(entry) ?? {};
          return {
            result: numberOrNull(single['result']) ?? 0,
            active: single['active'] !== false && single['discarded'] !== true,
          };
        }),
      };
    }),
  };
}
