/**
 * The name estimate of the DSA5 adapter for search-compendium and
 * list-creatures-by-criteria without the creature index, moved here from the
 * separate adapter the compendiums area had. Only what an index entry tells.
 */
import type { AdapterDocument } from '../../game-systems.js';
import { read, text } from './rules.js';

export function estimateEntry(
  entry: AdapterDocument,
  filters: Readonly<Record<string, unknown>>
): number | null {
  const wanted = filters['species'];
  const species =
    text(read(entry, 'system.details.species.value')) ||
    text(read(entry, 'system.creatureClass.value'));
  if (typeof wanted === 'string' && species && species.toLowerCase() !== wanted.toLowerCase())
    return null;
  return 1;
}
