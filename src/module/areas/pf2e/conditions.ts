/**
 * pf2e-manage-conditions in the module: list, set, raise, lower, remove or
 * toggle a pf2e condition on an actor, frightened 2 included.
 *
 * pf2e keeps a condition as an item on the actor, not as an active effect, so
 * toggle-token-condition cannot read it back. The writing goes through
 * pf2e's own increaseCondition and decreaseCondition, which apply the rules
 * of the system (linked conditions, the maximum of dying); a value is set on
 * the condition item itself. Every change is read back from a fresh lookup.
 */
import { smallEnough } from '../../../common/change-log.js';
import {
  CONDITION_ACTIONS,
  CONDITION_SLUGS,
  activeConditions,
  conditionSlug,
  isValued,
  plannedTarget,
  reached,
  type ActiveCondition,
  type ConditionAction,
  type ConditionTarget,
} from '../../../common/areas/pf2e/conditions.js';
import { QueryError, type QueryHandler } from '../../dispatcher.js';
import { requireGameSystem } from '../../game-systems.js';
import { defineAnnouncements } from '../../notify.js';
import { requireWorld } from '../../world-ready.js';
import { findActor, type ActorMatch } from '../actors/lookup.js';

export const TOOL = 'pf2e-manage-conditions';

const notes = defineAnnouncements('pf2e', {
  conditionNotApplied: {
    level: 'warn',
    en: 'Condition on {actor} not as requested: {condition} should be {wanted}, it is {actual}.',
  },
});

type Args = Record<string, unknown>;
const invalid = (message: string) => new QueryError('INVALID_ARGUMENT', message);

function positiveInteger(args: Args, key: string): number | undefined {
  const raw = args[key];
  if (raw === undefined || raw === null || raw === '') return undefined;
  const value = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1)
    throw invalid(`${key} must be a whole number of at least 1, got ${JSON.stringify(raw)}.`);
  return value;
}

function actionOf(args: Args): ConditionAction {
  const action = String(args['action'] ?? '')
    .trim()
    .toLowerCase();
  if (!(CONDITION_ACTIONS as readonly string[]).includes(action))
    throw invalid(
      `action must be one of ${CONDITION_ACTIONS.join(', ')}, got "${String(args['action'] ?? '')}".`
    );
  return action as ConditionAction;
}

const describe = (state: ConditionTarget | ActiveCondition | null): string => {
  if (!state || ('present' in state && !state.present)) return 'absent';
  return state.value === null ? 'present' : String(state.value);
};

function pf2eActor(match: ActorMatch): FoundryPf2eActor {
  return match.actor as unknown as FoundryPf2eActor;
}

/** The one condition of a slug; pf2e can hold a granted and an own copy, then the highest counts. */
function currentOf(
  actor: FoundryPf2eActor,
  slug: string
): { current: ActiveCondition | null; all: ActiveCondition[] } {
  const all = activeConditions(actor.toObject() as Args).filter(
    condition => condition.slug === slug
  );
  const current = [...all].sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0] ?? null;
  return { current, all };
}

export const manageConditions: QueryHandler = {
  access: data => {
    const action = String((data as Args | null)?.['action'] ?? '').toLowerCase();
    return action === 'list'
      ? { kind: 'read' }
      : { kind: 'write', document: 'Actors', action: 'update' };
  },
  run: async (data, context) => {
    requireWorld();
    requireGameSystem('pf2e', TOOL);
    const args = (typeof data === 'object' && data !== null ? data : {}) as Args;
    const identifier = String(args['actorIdentifier'] ?? '').trim();
    if (!identifier)
      throw invalid('actorIdentifier is required: an actor id, its exact name or a token id.');
    const action = actionOf(args);
    const match = findActor(identifier);
    const actor = pf2eActor(match);
    const head = {
      actor: { id: actor.id, name: actor.name, type: actor.type },
      via: match.via,
      ...(match.token ? { token: match.token } : {}),
    };

    if (action === 'list') {
      const list = activeConditions(actor.toObject() as Args);
      return { success: true, ...head, action, conditions: list, count: list.length };
    }

    const rawCondition = String(args['condition'] ?? '').trim();
    if (!rawCondition)
      throw invalid(`condition is required for action "${action}", e.g. "frightened".`);
    const slug = conditionSlug(rawCondition);
    if (!slug)
      throw new QueryError(
        'CONDITION_NOT_FOUND',
        `"${rawCondition}" is not a Pathfinder 2e condition. Conditions: ${CONDITION_SLUGS.join(', ')}.`
      );
    if (slug === 'persistent-damage')
      throw invalid(
        'persistent-damage needs a damage formula and type, which pf2e asks for in a dialog. Apply it on the sheet in Foundry.'
      );
    const value = positiveInteger(args, 'value');
    const amount = positiveInteger(args, 'amount');
    const ignored: string[] = [];
    if (value !== undefined && (action !== 'set' || !isValued(slug))) ignored.push('value');
    if (amount !== undefined && action !== 'increase' && action !== 'decrease')
      ignored.push('amount');
    if (amount !== undefined && !isValued(slug) && !ignored.includes('amount'))
      ignored.push('amount');

    const { current, all } = currentOf(actor, slug);
    const target = plannedTarget(
      {
        action,
        slug,
        ...(value !== undefined ? { value } : {}),
        ...(amount !== undefined ? { amount } : {}),
      },
      current
    );
    const result = {
      success: true,
      ...head,
      action,
      condition: slug,
      valued: isValued(slug),
      before: describe(current),
      ...(ignored.length ? { ignoredParameters: ignored } : {}),
      ...(all.length > 1
        ? { notes: [`The actor has ${all.length} "${slug}" conditions; the highest value counts.`] }
        : {}),
    };
    if (reached(target, current) && all.length <= 1)
      return {
        ...result,
        after: describe(current),
        changed: false,
        message: `${slug} on ${actor.name} is already ${describe(target)}; nothing changed.`,
      };

    const granted = all.find(condition => condition.grantedBy);
    if (!target.present && granted)
      throw new QueryError(
        'CONDITION_GRANTED',
        `${slug} on ${actor.name} is granted by another condition or item (id ${granted.grantedBy}); pf2e removes it with its source. Nothing was changed.`
      );
    if (match.token && !match.token.linked)
      context.requireAccess(
        { kind: 'write', document: 'Scenes', action: 'update' },
        `The actor was found through the unlinked token ${match.token.id}, whose copy lives in the scene "${match.token.sceneName}".`
      );
    if (
      typeof actor.increaseCondition !== 'function' ||
      typeof actor.decreaseCondition !== 'function'
    )
      throw new QueryError(
        'FOUNDRY_API',
        `The actor "${actor.name}" has no increaseCondition or decreaseCondition; it does not look like a pf2e actor. Nothing was changed.`
      );

    const before = smallEnough({ conditions: activeConditions(actor.toObject() as Args) });
    try {
      if (!target.present) {
        await actor.decreaseCondition(slug, { forceRemove: true });
      } else if (!current) {
        await actor.increaseCondition(slug, target.value === null ? {} : { value: target.value });
      }
      const now = currentOf(pf2eActor(findActor(identifier)), slug).current;
      if (target.present && target.value !== null && now && now.value !== target.value) {
        const item = pf2eActor(findActor(identifier)).items.get(now.id);
        await item?.update({ 'system.value.value': target.value });
      }
    } catch (error) {
      throw new QueryError(
        'CONDITION_FAILED',
        `pf2e refused to change ${slug} on ${actor.name}: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const fresh = pf2eActor(findActor(identifier));
    const after = currentOf(fresh, slug).current;
    if (!reached(target, after)) {
      notes.announce('conditionNotApplied', {
        actor: actor.name,
        condition: slug,
        wanted: describe(target),
        actual: describe(after),
      });
      throw new QueryError(
        'NOT_APPLIED',
        `${slug} on ${actor.name} should be ${describe(target)} after "${action}", but it is ${describe(after)}.`
      );
    }
    context.recordChange({
      query: 'pf2eManageConditions',
      tool: TOOL,
      document: 'Actors',
      action: 'update',
      targets: [{ id: actor.id, uuid: actor.uuid, name: actor.name, documentName: 'Actor' }],
      summary: `${action} ${slug} on ${actor.name}: ${describe(current)} to ${describe(after)}.`,
      before,
      after: smallEnough({ conditions: activeConditions(fresh.toObject() as Args) }),
    });
    return {
      ...result,
      after: describe(after),
      changed: true,
      message: `${slug} on ${actor.name}: ${describe(current)} to ${describe(after)}.`,
    };
  },
};
