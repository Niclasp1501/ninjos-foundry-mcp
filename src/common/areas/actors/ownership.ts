/**
 * Ownership levels and the fixed phrases of the ownership tools, shared by
 * server and module of the actors area.
 */

/** Foundry's document ownership levels as the tools name them. */
export const OWNERSHIP_LEVELS = { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 } as const;

export type OwnershipLevelName = keyof typeof OWNERSHIP_LEVELS;

/** The name of a stored level; -1 is Foundry's "inherit" of folders. */
export function levelName(level: number): string {
  if (level === -1) return 'INHERIT';
  const found = (Object.entries(OWNERSHIP_LEVELS) as Array<[OwnershipLevelName, number]>).find(
    ([, value]) => value === level
  );
  return found ? found[0] : String(level);
}

/** The number of a level given as name (any case) or as number 0 to 3; null when neither. */
export function levelNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 3)
    return value;
  if (typeof value !== 'string') return null;
  const upper = value.trim().toUpperCase();
  return upper in OWNERSHIP_LEVELS ? OWNERSHIP_LEVELS[upper as OwnershipLevelName] : null;
}

/** Lower case, trimmed, inner whitespace collapsed: how the fixed phrases are compared. */
export function phrase(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** actorIdentifier: the actors of friendly tokens in the active scene that no player owns. */
export const FRIENDLY_NPCS = 'all friendly npcs';
/** actorIdentifier: every actor a player owns. */
export const PARTY_CHARACTERS = 'party characters';
/** playerIdentifier: every connected player. */
export const PARTY = 'party';
/** actorIdentifier of list-actor-ownership: every actor. */
export const ALL_ACTORS = 'all';
