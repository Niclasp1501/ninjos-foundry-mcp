/**
 * What the handlers of the dnd5e area share in the module: the system check, the
 * world's rules version, the language table of the running dnd5e, the one
 * name rule for duplicates, and refusals that name their cause.
 */
import type { SystemInfo } from '../../../common/game-systems.js';
import type { LanguageTable } from '../../../common/areas/dnd5e/npc-data.js';
import {
  FALLBACK_LANGUAGE_KEYS,
  isRecord,
  rulesFromSetting,
  sameName,
  type AbilityKey,
  type Data,
  type RulesVersion,
} from '../../../common/areas/dnd5e/rules.js';
import { QueryError } from '../../dispatcher.js';
import { requireGameSystem } from '../../game-systems.js';
import { requireWorld } from '../../world-ready.js';
import { describeDocuments, inputOf } from '../actors/common.js';

/**
 * The call data without the defaults a server filled only because an older
 * module needs them (`serverDefaults`, e.g. sourceRules): here the world's
 * rules version decides those.
 */
export function callData(data: unknown): Data {
  const input: Data = { ...inputOf(data) };
  const filled = input['serverDefaults'];
  if (Array.isArray(filled))
    for (const key of filled) if (typeof key === 'string') delete input[key];
  delete input['serverDefaults'];
  return input;
}

export { inputOf };

export const actorsOf = () => game.actors as unknown as FoundryCollection<FoundryActorsActor>;

/** World ready and dnd5e active; the answer carries the system and its version. */
export function requireDnd5e(tool: string): SystemInfo {
  requireWorld();
  return requireGameSystem('dnd5e', tool);
}

/** The dnd5e setting "rulesVersion" of this world, or null when it cannot be read. */
export function worldRules(): RulesVersion | null {
  try {
    return rulesFromSetting(game.settings.get('dnd5e', 'rulesVersion'));
  } catch {
    return null;
  }
}

/** Every language key of CONFIG.DND5E.languages with its label, children included. */
export function languageTable(): LanguageTable {
  const config = (globalThis as { CONFIG?: unknown }).CONFIG;
  const languages =
    isRecord(config) && isRecord(config['DND5E']) ? config['DND5E']['languages'] : undefined;
  if (!isRecord(languages)) return { keys: FALLBACK_LANGUAGE_KEYS, byLabel: {} };
  const keys: string[] = [];
  const byLabel: Record<string, string> = {};
  const localize = (label: string) => {
    try {
      return game.i18n.localize(label);
    } catch {
      return label;
    }
  };
  const walk = (node: Data) => {
    for (const [key, value] of Object.entries(node)) {
      const label =
        typeof value === 'string'
          ? value
          : isRecord(value) && typeof value['label'] === 'string'
            ? value['label']
            : '';
      const children = isRecord(value) && isRecord(value['children']) ? value['children'] : null;
      // A group with children (standard, exotic) is a heading, unless it is a language itself (primordial).
      if (!children || (isRecord(value) && value['selectable'] !== false)) {
        keys.push(key);
        if (label) byLabel[localize(label).toLowerCase()] = key;
      }
      if (children) walk(children);
    }
  };
  walk(languages);
  return { keys: keys.length ? keys : FALLBACK_LANGUAGE_KEYS, byLabel };
}

export function invalid(what: string, problems: readonly string[]): QueryError {
  return new QueryError(
    'INVALID_ARGUMENT',
    `${what}: ${problems.join('; ')}. Nothing was changed.`
  );
}

/** An item of the actor with this name, trimmed and ignoring case: the one duplicate rule of this package. */
export function itemNamed(actor: FoundryActorsActor, name: string): FoundryActorsItem | undefined {
  return actor.items.find(item => sameName(item.name, name));
}

export function duplicateItem(
  actor: FoundryActorsActor,
  name: string,
  existing: FoundryActorsItem
): QueryError {
  return new QueryError(
    'ALREADY_EXISTS',
    `Actor "${actor.name}" (id ${actor.id}) already has an item named "${existing.name}" (id ${existing.id}, type ${existing.type}); ` +
      `names are compared ignoring case. Nothing was added. Choose another name for "${name}", or change the existing item.`
  );
}

/** Actors the NPC builder may change. */
export function requireBuildableActor(actor: FoundryActorsActor, tool: string): void {
  if (actor.type === 'npc' || actor.type === 'character') return;
  throw new QueryError(
    'WRONG_ACTOR_TYPE',
    `${tool} works on dnd5e actors of type "npc" or "character"; "${actor.name}" (id ${actor.id}) is a "${actor.type}". Nothing was changed.`
  );
}

export function abilityScores(actor: FoundryActorsActor): Partial<Record<AbilityKey, number>> {
  const system = actor.toObject()['system'];
  const abilities = isRecord(system) && isRecord(system['abilities']) ? system['abilities'] : {};
  const out: Partial<Record<AbilityKey, number>> = {};
  for (const [key, entry] of Object.entries(abilities)) {
    if (isRecord(entry) && typeof entry['value'] === 'number')
      out[key as AbilityKey] = entry['value'];
  }
  return out;
}

export function sameNamedActors(name: string): FoundryActorsActor[] {
  return actorsOf().filter(actor => sameName(actor.name, name));
}

export { describeDocuments };

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
