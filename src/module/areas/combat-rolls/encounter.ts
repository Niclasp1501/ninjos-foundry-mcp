/**
 * What every combat query shares. Finding the encounter and a
 * combatant, the turn order, the summaries every answer carries, the context
 * of the current turn, reading back and the change log.
 *
 * Which encounter: the one in `combatId`, otherwise the active one. Several
 * active encounters (one per scene is possible) resolve to the one on the
 * scene that is active for everyone; anything else is an error naming them.
 * Nothing is guessed from "the only encounter there is".
 */
import {
  compareTurnOrder,
  isNonPlayerCharacter,
} from '../../../common/areas/combat-rolls/rules.js';
import { smallEnough } from '../../../common/change-log.js';
import type { WriteAction } from '../../../common/permissions.js';
import type { HandlerContext } from '../../dispatcher.js';
import { systemAnswer } from '../../game-systems.js';
import { adapterData } from '../../prepared-data.js';
import {
  fail,
  finiteNumber,
  findToken,
  idOf,
  isRecord,
  messageOf,
  optionalText,
  type ChosenScene,
} from '../tokens-dice/support.js';
import { COMBAT_LOG_KIND } from './access.js';

export type Combat = FoundryCombatRollsCombat;
export type Combatant = FoundryCombatRollsCombatant;
export type Args = Record<string, unknown>;

export function allCombats(): Combat[] {
  return game.combats.contents as unknown as Combat[];
}

export function sceneOfCombat(combat: Combat): FoundryTokensDiceScene | null {
  const id = idOf(combat.scene);
  return id ? ((game.scenes.get(id) as FoundryTokensDiceScene | undefined) ?? null) : null;
}

function label(combat: Combat): string {
  const scene = sceneOfCombat(combat);
  const where = scene ? `on scene "${scene.name ?? ''}"` : 'without scene';
  return `[${combat.id}] ${where}, round ${combat.round ?? 0}${combat.active ? ', active' : ''}`;
}

export function encounterListing(): string {
  const all = allCombats();
  if (!all.length) return 'There is no combat encounter in this world; create-combat creates one.';
  return `Encounters: ${all.map(label).join('; ')}.`;
}

export function findCombat(args: Args): Combat {
  const wanted = optionalText(args, 'combatId')?.trim();
  if (wanted) {
    const combat = game.combats.get(wanted) as Combat | undefined;
    if (!combat)
      fail('COMBAT_NOT_FOUND', `Combat encounter "${wanted}" not found. ${encounterListing()}`);
    return combat;
  }
  const active = allCombats().filter(combat => combat.active === true);
  if (active.length === 1 && active[0]) return active[0];
  if (active.length > 1) {
    const shown = (game.scenes.contents as FoundryTokensDiceScene[]).find(s => s.active === true);
    const onShown = active.filter(combat => shown && idOf(combat.scene) === shown.id);
    if (onShown.length === 1 && onShown[0]) return onShown[0];
    fail(
      'AMBIGUOUS',
      `Several combat encounters are active: ${active.map(label).join('; ')}. Pass combatId.`
    );
  }
  return fail(
    'NO_ACTIVE_COMBAT',
    `No combat encounter is active; pass combatId. ${encounterListing()}`
  );
}

/** The encounter as stored now, after a write. */
export function reread(combat: Combat): Combat | undefined {
  return game.combats.get(combat.id) as Combat | undefined;
}

export function initiativeOf(combatant: Combatant): number | null {
  return finiteNumber(combatant.initiative) ? combatant.initiative : null;
}

export function nameOf(combatant: Combatant): string {
  return combatant.name || combatant.token?.name || combatant.actor?.name || combatant.id;
}

export function turnOrder(combat: Combat): Combatant[] {
  const all = combat.combatants.contents;
  const turns = combat.turns;
  if (Array.isArray(turns) && turns.length === all.length) return [...turns];
  return [...all].sort((a, b) =>
    compareTurnOrder(
      { id: a.id, name: nameOf(a), initiative: initiativeOf(a) },
      { id: b.id, name: nameOf(b), initiative: initiativeOf(b) }
    )
  );
}

export function isNPC(combatant: Combatant): boolean {
  if (typeof combatant.isNPC === 'boolean') return combatant.isNPC;
  const actor = combatant.actor;
  if (!actor) return true;
  if (typeof actor.hasPlayerOwner === 'boolean') return !actor.hasPlayerOwner;
  const users = (game.users?.contents ?? []).map(user => ({ id: user.id, isGM: user.isGM }));
  return isNonPlayerCharacter(actor.ownership, users);
}

export function currentCombatant(combat: Combat): Combatant | null {
  if (!(combat.round ?? 0) || typeof combat.turn !== 'number') return null;
  return turnOrder(combat)[combat.turn] ?? null;
}

export function combatantSummary(combatant: Combatant, order: number, currentId: string | null) {
  return {
    id: combatant.id,
    name: nameOf(combatant),
    order,
    initiative: initiativeOf(combatant),
    isCurrent: combatant.id === currentId,
    hidden: combatant.hidden === true,
    defeated: combatant.defeated === true,
    isNPC: isNPC(combatant),
    actorId: combatant.actorId ?? null,
    tokenId: combatant.tokenId ?? null,
    sceneId: combatant.sceneId ?? null,
  };
}

export function combatSummary(combat: Combat) {
  const scene = sceneOfCombat(combat);
  const current = currentCombatant(combat);
  return {
    id: combat.id,
    scene: scene ? { id: scene.id, name: scene.name ?? '' } : null,
    active: combat.active === true,
    started: (combat.round ?? 0) > 0,
    round: combat.round ?? 0,
    turn: typeof combat.turn === 'number' ? combat.turn : null,
    combatantCount: combat.combatants.size,
    currentCombatant: current ? { id: current.id, name: nameOf(current) } : null,
  };
}

export function orderSummary(combat: Combat) {
  const currentId = currentCombatant(combat)?.id ?? null;
  return turnOrder(combat).map((combatant, index) =>
    combatantSummary(combatant, index + 1, currentId)
  );
}

function statusesOf(actor: FoundryCombatRollsActor): string[] {
  const found = new Set<string>();
  for (const effect of actor.effects?.contents ?? []) {
    const statuses = effect.statuses;
    const list = statuses instanceof Set ? [...statuses] : Array.isArray(statuses) ? statuses : [];
    for (const status of list) if (typeof status === 'string') found.add(status);
  }
  return [...found];
}

/** Who acts now, what the adapter knows about the actor, and who comes next. Null before the start. */
export function turnContext(combat: Combat) {
  const current = currentCombatant(combat);
  if (!current) return null;
  const order = turnOrder(combat);
  const index = order.indexOf(current);
  const after = [...order.slice(index + 1), ...order.slice(0, index)];
  const upcoming = after.find(combatant => combatant.defeated !== true) ?? null;
  const notes: string[] = [];
  const actor = current.actor ?? null;
  let basicInfo: Record<string, unknown> = {};
  if (actor) {
    try {
      const answer = systemAnswer('characters');
      basicInfo = answer.questions.summary(adapterData(actor)).basicInfo;
      if (answer.fallbackFor.includes('summary'))
        notes.push(
          `No adapter for the game system "${answer.system.rawId}": the actor shows name, type and image only.`
        );
    } catch (error) {
      notes.push(`The game system adapter could not summarize the actor: ${messageOf(error)}`);
    }
  }
  const token = current.token ?? null;
  return {
    combatant: combatantSummary(current, index + 1, current.id),
    actor: actor
      ? {
          id: actor.id,
          name: actor.name ?? '',
          type: actor.type ?? null,
          basicInfo,
          statuses: statusesOf(actor),
        }
      : null,
    token: token
      ? {
          id: token.id,
          name: token.name ?? '',
          x: token.x ?? null,
          y: token.y ?? null,
          hidden: token.hidden === true,
        }
      : null,
    nextUp: upcoming ? { id: upcoming.id, name: nameOf(upcoming) } : null,
    ...(notes.length ? { notes } : {}),
  };
}

export function combatantListing(combat: Combat): string {
  const list = turnOrder(combat).map(c => `"${nameOf(c)}" [${c.id}]`);
  return list.length ? `Combatants: ${list.join(', ')}.` : 'The encounter has no combatants.';
}

function byToken(combat: Combat, tokenId: string): Combatant {
  const matches = combat.combatants.filter(combatant => combatant.tokenId === tokenId);
  if (matches.length > 1)
    fail(
      'AMBIGUOUS',
      `Token "${tokenId}" is in the encounter ${matches.length} times (${matches.map(c => c.id).join(', ')}). Pass combatantId.`
    );
  const found = matches[0];
  if (!found)
    fail('COMBATANT_NOT_FOUND', `No combatant of token "${tokenId}". ${combatantListing(combat)}`);
  return found;
}

/** One combatant from `combatantId` or `tokenId`, exactly one of both. */
export function findCombatant(combat: Combat, args: Args): Combatant {
  const id = optionalText(args, 'combatantId')?.trim();
  const tokenId = optionalText(args, 'tokenId')?.trim();
  if (id && tokenId) fail('INVALID_ARGUMENT', 'Pass combatantId or tokenId, not both.');
  if (tokenId) return byToken(combat, tokenId);
  if (!id) return fail('INVALID_ARGUMENT', 'combatantId or tokenId is required.');
  const found = combat.combatants.get(id);
  if (!found)
    fail(
      'COMBATANT_NOT_FOUND',
      `Combatant "${id}" is not in this encounter. ${combatantListing(combat)}`
    );
  return found;
}

/** Combatants from lists of combatant and token ids; any miss stops everything. */
export function findCombatants(combat: Combat, args: Args): Combatant[] {
  const ids = stringList(args, 'combatantIds') ?? [];
  const tokenIds = stringList(args, 'tokenIds') ?? [];
  if (!ids.length && !tokenIds.length)
    fail('INVALID_ARGUMENT', 'combatantIds or tokenIds must name at least one combatant.');
  const found = new Map<string, Combatant>();
  const missing: string[] = [];
  for (const id of ids) {
    const combatant = combat.combatants.get(id);
    if (combatant) found.set(combatant.id, combatant);
    else missing.push(`combatant "${id}"`);
  }
  for (const tokenId of tokenIds) {
    if (!combat.combatants.some(c => c.tokenId === tokenId)) missing.push(`token "${tokenId}"`);
    else {
      const combatant = byToken(combat, tokenId);
      found.set(combatant.id, combatant);
    }
  }
  if (missing.length)
    fail(
      'COMBATANT_NOT_FOUND',
      `Not in this encounter: ${missing.join(', ')}. Nothing was changed. ${combatantListing(combat)}`
    );
  return [...found.values()];
}

/** A list of texts that are not empty, or undefined when absent. */
export function stringList(args: Args, key: string): string[] | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string' || !entry.trim()))
    fail('INVALID_ARGUMENT', `${key} must be a list of ids`);
  return (value as string[]).map(entry => entry.trim());
}

/** Tokens by id on one scene, each once; the first miss stops, naming where the id lies. */
export function tokensOnScene(
  scene: FoundryTokensDiceScene,
  ids: readonly string[],
  by: ChosenScene['by']
): FoundryTokensDiceToken[] {
  const seen = new Set<string>();
  return ids.map(id => {
    if (seen.has(id)) fail('INVALID_ARGUMENT', `Token "${id}" is listed twice.`);
    seen.add(id);
    return findToken({ scene, by }, id);
  });
}

/**
 * After initiatives changed, keep the same combatant acting, as Foundry does
 * when it rolls initiative in a running encounter.
 */
export async function keepCurrentTurn(combat: Combat, currentId: string | null): Promise<void> {
  if (!currentId) return;
  const fresh = reread(combat);
  if (!fresh) return;
  const index = turnOrder(fresh).findIndex(combatant => combatant.id === currentId);
  if (index >= 0 && index !== fresh.turn) await fresh.update({ turn: index });
}

export function stateOf(combat: Combat | undefined): unknown {
  return combat ? smallEnough(combat.toObject()) : undefined;
}

export function recordCombat(
  context: HandlerContext,
  change: {
    query: string;
    tool: string;
    action: WriteAction;
    combat: Combat;
    summary: string;
    before?: unknown;
    withChat?: boolean;
  }
): void {
  const after = change.action === 'delete' ? undefined : stateOf(reread(change.combat));
  context.recordChange({
    query: change.query,
    tool: change.tool,
    document: change.withChat ? 'Multiple' : COMBAT_LOG_KIND,
    ...(change.withChat ? { documents: [COMBAT_LOG_KIND, 'ChatMessages' as const] } : {}),
    action: change.action,
    targets: [{ id: change.combat.id, uuid: change.combat.uuid, documentName: 'Combat' }],
    summary: change.summary,
    ...(change.before !== undefined ? { before: change.before } : {}),
    ...(after !== undefined ? { after } : {}),
  });
}

export { isRecord };
