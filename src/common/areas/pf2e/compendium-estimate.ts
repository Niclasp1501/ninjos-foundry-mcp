/**
 * The name estimate of the pf2e adapter for search-compendium and
 * list-creatures-by-criteria without the creature index, moved here from the
 * separate adapter the compendiums area had. Only what an index entry tells.
 */
import type { AdapterDocument } from '../../game-systems.js';
import { SIZE_KEYS, num, read, text, texts } from './rules.js';

export function estimateEntry(
  entry: AdapterDocument,
  given: Readonly<Record<string, unknown>>
): number | null {
  const level = num(read(entry, 'system.details.level.value'));
  const wanted = given['level'];
  if (typeof wanted === 'number' && level !== null && level !== wanted) return null;
  const rarity = given['rarity'];
  const stored = text(read(entry, 'system.traits.rarity'));
  if (typeof rarity === 'string' && stored && stored !== rarity.toLowerCase()) return null;
  const traits = given['traits'];
  const have = texts(read(entry, 'system.traits.value')).map(trait => trait.toLowerCase());
  if (
    Array.isArray(traits) &&
    have.length &&
    !traits.every(trait => typeof trait === 'string' && have.includes(trait.toLowerCase()))
  )
    return null;
  const size = given['size'];
  const storedSize = text(read(entry, 'system.traits.size.value'));
  if (typeof size === 'string' && storedSize && SIZE_KEYS[size] && storedSize !== SIZE_KEYS[size])
    return null;
  return 1;
}
