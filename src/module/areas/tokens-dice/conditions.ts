/**
 * Get-available-conditions and toggle-token-condition.
 *
 * The list is Foundry's own (`CONFIG.statusEffects`), with names translated.
 * How a condition is set comes from the adapter of the game system when it
 * brings its own effect data; otherwise Foundry's own
 * `toggleStatusEffect`, which systems hook into for their special rules; only
 * without both the generic effect of the core. No system id appears here.
 *
 * Without `active` the condition really toggles. A linked token carries the
 * condition on its actor, on every scene, so that needs the actor level too.
 *
 * A condition is read back through the adapter's `activeOn` when it
 * has one, because a system that keeps conditions as items (pf2e) cannot be
 * seen through effects. `level` sets a condition with levels (pf2e, dsa5)
 * through the calls of the adapter's `levelPlan`; 0 removes it.
 */
import type { ConditionInfo } from '../../../common/game-systems.js';
import type { AdapterDocument } from '../../../common/game-systems.js';
import { smallEnough } from '../../../common/change-log.js';
import type { QueryHandler } from '../../dispatcher.js';
import { systemAnswer } from '../../game-systems.js';
import { requireWorld } from '../../world-ready.js';
import { SCENE_CHANGE } from './tokens.js';
import {
  argsOf,
  chooseScene,
  fail,
  findToken,
  freshToken,
  isRecord,
  messageOf,
  operation,
  optionalBoolean,
  requiredText,
  sceneInfo,
  tokenLabel,
} from './support.js';

function translate(text: string): string {
  try {
    const translated = game.i18n.localize(text);
    return typeof translated === 'string' && translated ? translated : text;
  } catch {
    return text;
  }
}

/** Foundry's conditions of the loaded system, translated. `problem` when Foundry offers no list. */
export function availableConditions(): { conditions: ConditionInfo[]; problem: string | null } {
  const config = (globalThis as { CONFIG?: Record<string, unknown> }).CONFIG;
  const raw = config?.['statusEffects'];
  if (!Array.isArray(raw))
    return {
      conditions: [],
      problem: 'Foundry offers no list of conditions (CONFIG.statusEffects)',
    };
  const conditions: ConditionInfo[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry['id'] !== 'string' || !entry['id']) continue;
    const rawName =
      typeof entry['name'] === 'string' && entry['name']
        ? entry['name']
        : typeof entry['label'] === 'string' && entry['label']
          ? entry['label']
          : entry['id'];
    const name = translate(rawName);
    const img =
      typeof entry['img'] === 'string'
        ? entry['img']
        : typeof entry['icon'] === 'string'
          ? entry['icon']
          : null;
    conditions.push({
      ...entry,
      id: entry['id'],
      name,
      img,
      description: typeof entry['description'] === 'string' ? translate(entry['description']) : '',
      ...(name !== rawName ? { nameKey: rawName } : {}),
    });
  }
  return { conditions, problem: null };
}

/** A condition by exact id, else by name in any case. Several by name is an error. */
export function findCondition(
  conditions: readonly ConditionInfo[],
  identifier: string
): ConditionInfo {
  const byId = conditions.find(condition => condition.id === identifier);
  if (byId) return byId;
  const lower = identifier.toLowerCase();
  const byName = conditions.filter(
    condition =>
      condition.name.toLowerCase() === lower ||
      (typeof condition['nameKey'] === 'string' && condition['nameKey'].toLowerCase() === lower)
  );
  if (byName.length > 1) {
    fail(
      'AMBIGUOUS',
      `The condition "${identifier}" is ambiguous: ${byName.map(c => `"${c.name}" [${c.id}]`).join(', ')}. Pass the id.`
    );
  }
  if (byName[0]) return byName[0];
  const ids = conditions.map(condition => condition.id);
  fail(
    'CONDITION_NOT_FOUND',
    `Condition not found: "${identifier}". Condition ids of this game system: ${ids.length ? ids.join(', ') : 'none'}.`
  );
}

export const getAvailableConditions: QueryHandler = {
  access: { kind: 'read' },
  run: () =>
    operation('get available conditions', () => {
      requireWorld();
      const { conditions, problem } = availableConditions();
      const system = systemAnswer('conditions').system;
      return {
        success: true,
        gameSystem: system.rawId,
        adapter: system.adapter?.title ?? null,
        conditions: conditions.map(condition => ({
          id: condition.id,
          name: condition.name,
          icon: condition.img ?? null,
          description: condition.description ?? '',
        })),
        ...(problem || conditions.length === 0
          ? { notes: [problem ?? `The game system "${system.rawId}" offers no conditions.`] }
          : {}),
      };
    }),
};

/** `level`: a whole number from 0, or absent. */
function optionalLevel(args: Record<string, unknown>): number | undefined {
  const raw = args['level'];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0)
    fail(
      'INVALID_ARGUMENT',
      `level must be a whole number of 0 or more, got ${JSON.stringify(raw)}`
    );
  return raw;
}

interface ConditionState {
  set: boolean;
  level: number | null;
}

function describeState(state: ConditionState): string {
  if (!state.set) return 'not set';
  return state.level === null ? 'set' : `at level ${state.level}`;
}

/** How many times the adapter's level plan is asked: the calls, and one follow up. */
const LEVEL_ROUNDS = 2;

export const toggleTokenCondition: QueryHandler = {
  access: SCENE_CHANGE,
  run: (raw, context) =>
    operation('toggle token condition', async () => {
      requireWorld();
      const args = argsOf(raw);
      const tokenId = requiredText(args, 'tokenId');
      const conditionId = requiredText(args, 'conditionId');
      const active = optionalBoolean(args, 'active');
      const level = optionalLevel(args);
      if (level !== undefined && active !== undefined && active !== level > 0) {
        fail(
          'INVALID_ARGUMENT',
          `active ${active} and level ${level} contradict each other; give level alone, 0 removes the condition`
        );
      }
      const chosen = chooseScene(args);
      const token = findToken(chosen, tokenId);
      const actor = token.actor ?? null;
      if (!actor)
        fail(
          'TOKEN_HAS_NO_ACTOR',
          `Token ${tokenLabel(token)} has no associated actor, and conditions live on the actor`
        );

      const { conditions, problem } = availableConditions();
      if (problem) fail('FOUNDRY_API', problem);
      const condition = findCondition(conditions, conditionId);
      const answer = systemAnswer('conditions');
      const questions = answer.questions;
      const system = answer.system;
      const matches = questions.matchesEffect ?? (() => false);
      const matching = (holder: FoundryTokensDiceActor | null | undefined) =>
        (holder?.effects?.contents ?? []).filter(effect =>
          matches(effect.toObject() as AdapterDocument, condition)
        );
      const stateOf = (holder: FoundryTokensDiceActor | null | undefined): ConditionState => {
        if (!holder) return { set: false, level: null };
        if (!questions.activeOn) return { set: matching(holder).length > 0, level: null };
        const found = questions
          .activeOn(holder.toObject() as AdapterDocument)
          .filter(state => state.id === condition.id);
        const levels = found
          .map(state => state.level)
          .filter((value): value is number => typeof value === 'number');
        return { set: found.length > 0, level: levels.length ? Math.max(...levels) : null };
      };

      const levelPlan = questions.levelPlan;
      if (level !== undefined) {
        if (!system.adapter)
          fail(
            'SYSTEM_NOT_SUPPORTED',
            `Levels of conditions are not supported for the game system "${system.rawId}": it needs an adapter that knows them. Set or remove the condition with active instead.`
          );
        const levels = questions.levels?.(condition) ?? null;
        if (!levelPlan || !questions.activeOn)
          fail(
            'SYSTEM_NOT_SUPPORTED',
            `Levels of conditions are not supported by the adapter "${system.adapter.title}". Set or remove the condition with active instead.`
          );
        if (!levels)
          fail(
            'INVALID_ARGUMENT',
            `The condition "${condition.name}" has no levels in ${system.adapter.title}; set or remove it with active.`
          );
        if (levels.max !== null && level > levels.max)
          fail(
            'INVALID_ARGUMENT',
            `The condition "${condition.name}" goes up to level ${levels.max} in ${system.adapter.title}, not ${level}.`
          );
      }

      const linked = token.actorLink === true;
      const before = stateOf(actor);
      const desired = level !== undefined ? level > 0 : (active ?? !before.set);
      const reachedAlready =
        level !== undefined
          ? level === 0
            ? !before.set
            : before.set && before.level === level
          : before.set === desired;
      const base = {
        success: true,
        tokenId,
        tokenName: token.name ?? '',
        conditionId: condition.id,
        conditionName: condition.name,
        active: desired,
        isActive: desired,
        effectTarget: linked ? 'actor' : 'token',
        actorId: actor.id,
        actorName: actor.name ?? '',
        scene: sceneInfo(chosen),
      };
      if (reachedAlready) {
        return {
          ...base,
          ...(level !== undefined || before.level !== null ? { level: before.level } : {}),
          changed: false,
          message: `${condition.name} was already ${level !== undefined ? describeState(before) : desired ? 'set on' : 'absent from'} ${level !== undefined ? 'on ' : ''}${token.name ?? ''}; nothing changed.`,
        };
      }

      const scope = linked
        ? `The linked actor "${actor.name ?? ''}", so the condition shows on all of its tokens`
        : `Only this unlinked token ${tokenLabel(token)}`;
      if (linked) {
        context.requireAccess(
          { kind: 'write', document: 'Actors', action: 'update' },
          `The token ${tokenLabel(token)} is linked to the actor "${actor.name ?? ''}", so the condition changes that actor.`
        );
      }
      const beforeEffects = (actor.effects?.contents ?? []).map(effect => effect.toObject());
      let method: 'adapter' | 'foundry' | 'generic';
      if (level !== undefined && levelPlan) {
        method = 'adapter';
        for (let round = 0; round < LEVEL_ROUNDS; round += 1) {
          const current = round === 0 ? actor : (freshToken(chosen, tokenId)?.actor ?? actor);
          const calls = levelPlan(condition, level, current.toObject() as AdapterDocument);
          if (!calls.length) break;
          for (const call of calls) {
            const target = (current as unknown as Record<string, unknown>)[call.method];
            if (typeof target !== 'function')
              fail(
                'FOUNDRY_API',
                `The adapter "${system.title}" calls ${call.method} on the actor "${actor.name ?? ''}", which it does not have.` +
                  (round === 0 ? ' Nothing was changed.' : '')
              );
            try {
              await (target as (...callArgs: unknown[]) => unknown).apply(current, [...call.args]);
            } catch (error) {
              fail(
                'CONDITION_FAILED',
                `${system.title} refused to change ${condition.name} on ${tokenLabel(token)}: ${messageOf(error)}`
              );
            }
          }
        }
      } else {
        const ownData = answer.fromAdapter && !answer.fallbackFor.includes('effectData');
        if (!ownData && typeof actor.toggleStatusEffect === 'function') {
          method = 'foundry';
          await actor.toggleStatusEffect(condition.id, { active: desired });
        } else {
          method = ownData ? 'adapter' : 'generic';
          if (desired) {
            // The registry always fills effectData, with the generic effect when the adapter has none.
            const effect = questions.effectData?.(condition);
            if (!effect)
              fail('FOUNDRY_API', `No effect data for the condition "${condition.name}"`);
            await actor.createEmbeddedDocuments('ActiveEffect', [effect]);
          } else {
            // Only the effects of this condition; every other effect of the actor stays.
            await actor.deleteEmbeddedDocuments(
              'ActiveEffect',
              matching(actor).map(effect => effect.id)
            );
          }
        }
      }

      const after = freshToken(chosen, tokenId)?.actor ?? null;
      const now = stateOf(after);
      if (level !== undefined) {
        const done = level === 0 ? !now.set : now.set && now.level === level;
        if (!done)
          fail(
            'NOT_APPLIED',
            `${condition.name} should be ${level === 0 ? 'removed' : `at level ${level}`} on ${tokenLabel(token)}, but it is ${describeState(now)}`
          );
      } else if (now.set !== desired) {
        fail(
          'NOT_APPLIED',
          `${condition.name} is ${now.set ? 'still set on' : 'still missing on'} ${tokenLabel(token)} after ${desired ? 'setting' : 'removing'} it`
        );
      }
      const change =
        level !== undefined
          ? `Changed the condition "${condition.name}" on ${tokenLabel(token)} from ${describeState(before)} to ${describeState(now)}.`
          : `${desired ? 'Set' : 'Removed'} the condition "${condition.name}" ${desired ? 'on' : 'from'} ${tokenLabel(token)}.`;
      context.recordChange({
        query: 'toggle-token-condition',
        tool: 'toggle-token-condition',
        document: linked ? 'Actors' : 'Scenes',
        action: 'update',
        targets: [
          linked
            ? { id: actor.id, uuid: actor.uuid, name: actor.name ?? '', documentName: 'Actor' }
            : { id: token.id, uuid: token.uuid, name: token.name ?? '', documentName: 'Token' },
        ],
        summary: `${change} ${scope}.`,
        before: smallEnough({ effects: beforeEffects }),
        after: smallEnough({ effects: (after?.effects?.contents ?? []).map(e => e.toObject()) }),
      });
      const levelText = level !== undefined ? ` ${describeState(now)}` : '';
      return {
        ...base,
        ...(level !== undefined || now.level !== null || before.level !== null
          ? { level: now.level, previousLevel: before.level }
          : {}),
        changed: true,
        method,
        message:
          level !== undefined
            ? `${condition.name} on ${token.name ?? ''} is now${levelText}. ${scope}.`
            : `${desired ? 'Applied' : 'Removed'} ${condition.name} ${desired ? 'to' : 'from'} ${token.name ?? ''}. ${scope}.`,
      };
    }),
};
