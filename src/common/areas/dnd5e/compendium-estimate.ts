/**
 * What the D&D 5e adapter answers for search-compendium beyond the
 * creature filters, moved here from the separate adapter the compendiums area had.
 * Only what an index entry tells; the creature index answers the rest.
 */
import type { AdapterDocument, CreatureFilterSpec } from '../../game-systems.js';
import { CREATURE_TYPE_KEYS, SIZE_KEYS, crValue, read } from './rules.js';

/** The older name of hasSpells in the search-compendium schema. */
export const SEARCH_FILTERS: readonly CreatureFilterSpec[] = [
  { name: 'spellcaster', kind: 'boolean', field: 'hasSpells' },
];

export function estimateEntry(
  entry: AdapterDocument,
  filters: Readonly<Record<string, unknown>>
): number | null {
  const cr = crValue(read(entry, 'system.details.cr'));
  const wanted = filters['challengeRating'];
  if (typeof wanted === 'number' && cr !== null && cr !== wanted) return null;
  const type = filters['creatureType'];
  if (typeof type === 'string' && CREATURE_TYPE_KEYS.includes(type)) {
    const stored = read(entry, 'system.details.type');
    const value =
      typeof stored === 'object' && stored ? (stored as Record<string, unknown>)['value'] : stored;
    if (typeof value === 'string' && value && value !== type) return null;
  }
  const size = filters['size'];
  if (typeof size === 'string' && SIZE_KEYS[size]) {
    const stored = read(entry, 'system.traits.size');
    if (typeof stored === 'string' && stored && stored !== SIZE_KEYS[size]) return null;
  }
  return 1;
}
