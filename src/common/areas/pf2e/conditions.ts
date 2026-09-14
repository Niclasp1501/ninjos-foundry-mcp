/**
 * Conditions of pf2e as the adapter and the tool pf2e-manage-conditions see
 * them. In pf2e a condition is an item of type "condition" on the actor, with
 * its slug and, for valued conditions such as frightened 2, a number under
 * system.value.value. It is not an active effect. Everything here is plain
 * data; the module does the writing through the actor's own methods.
 */
import type { ActorCall } from '../../game-systems.js';
import { at, isRecord, num, text, type Data } from './rules.js';

/** Condition slugs of pf2e (src/module/item/condition/values.ts). */
export const CONDITION_SLUGS = [
  'blinded',
  'broken',
  'clumsy',
  'concealed',
  'confused',
  'controlled',
  'cursebound',
  'dazzled',
  'deafened',
  'doomed',
  'drained',
  'dying',
  'encumbered',
  'enfeebled',
  'fascinated',
  'fatigued',
  'fleeing',
  'friendly',
  'frightened',
  'grabbed',
  'helpful',
  'hidden',
  'hostile',
  'immobilized',
  'indifferent',
  'invisible',
  'malevolence',
  'observed',
  'off-guard',
  'paralyzed',
  'persistent-damage',
  'petrified',
  'prone',
  'quickened',
  'restrained',
  'sickened',
  'slowed',
  'stunned',
  'stupefied',
  'unconscious',
  'undetected',
  'unfriendly',
  'unnoticed',
  'wounded',
] as const;

/** Conditions with a value in the rules (Player Core, "Conditions"; cursebound and malevolence from later books). */
export const VALUED_CONDITIONS = [
  'clumsy',
  'cursebound',
  'doomed',
  'drained',
  'dying',
  'enfeebled',
  'frightened',
  'malevolence',
  'sickened',
  'slowed',
  'stunned',
  'stupefied',
  'wounded',
] as const;

const ALIASES: Record<string, string> = { 'flat-footed': 'off-guard', flatfooted: 'off-guard' };

export interface ActiveCondition {
  id: string;
  slug: string;
  name: string;
  value: number | null;
  /** Granted by another condition or item; pf2e removes it with its source. */
  grantedBy: string | null;
}

export function isValued(slug: string): boolean {
  return (VALUED_CONDITIONS as readonly string[]).includes(slug);
}

/** The slug for a slug, an alias or a name ("Off-Guard", "flat footed"); null when unknown. */
export function conditionSlug(identifier: string): string | null {
  const folded = identifier.trim().toLowerCase().replace(/\s+/g, '-');
  if ((CONDITION_SLUGS as readonly string[]).includes(folded)) return folded;
  return ALIASES[folded] ?? null;
}

/** The conditions on an actor, from `actor.toObject().items`. */
export function activeConditions(actor: Data): ActiveCondition[] {
  const items = Array.isArray(actor['items']) ? actor['items'].filter(isRecord) : [];
  return items
    .filter(item => item['type'] === 'condition')
    .map(item => {
      const parent = at(item, 'system.references.parent');
      return {
        id: text(item['_id']) || text(item['id']),
        slug:
          text(at(item, 'system.slug')) ||
          conditionSlug(text(item['name'])) ||
          text(item['name']).toLowerCase(),
        name: text(item['name']),
        value:
          at(item, 'system.value.isValued') === false ? null : num(at(item, 'system.value.value')),
        grantedBy: isRecord(parent) ? text(parent['id']) || null : null,
      };
    });
}

export type ConditionAction = 'list' | 'set' | 'increase' | 'decrease' | 'remove' | 'toggle';
export const CONDITION_ACTIONS: readonly ConditionAction[] = [
  'list',
  'set',
  'increase',
  'decrease',
  'remove',
  'toggle',
];

export interface ConditionRequest {
  action: ConditionAction;
  slug: string;
  value?: number;
  amount?: number;
}

/** What the change must end in: a value, present without value, or absent. */
export type ConditionTarget = { present: false } | { present: true; value: number | null };

/**
 * The state a request ends in, from the current one. Values follow the rules:
 * a valued condition is at least 1, and decreasing to 0 removes it.
 */
export function plannedTarget(
  request: ConditionRequest,
  current: ActiveCondition | null
): ConditionTarget {
  const valued = isValued(request.slug);
  const now = current ? (current.value ?? (valued ? 1 : null)) : null;
  switch (request.action) {
    case 'set':
      if (!valued) return { present: true, value: null };
      return { present: true, value: request.value ?? 1 };
    case 'increase':
      if (!valued) return { present: true, value: null };
      return { present: true, value: (now ?? 0) + (request.amount ?? 1) };
    case 'decrease': {
      if (!current) return { present: false };
      if (!valued) return { present: false };
      const next = (now ?? 1) - (request.amount ?? 1);
      return next > 0 ? { present: true, value: next } : { present: false };
    }
    case 'remove':
      return { present: false };
    case 'toggle':
      return current ? { present: false } : { present: true, value: valued ? 1 : null };
    default:
      return current ? { present: true, value: current.value } : { present: false };
  }
}

/** Whether a condition on the actor is the target state. */
export function reached(target: ConditionTarget, current: ActiveCondition | null): boolean {
  if (!target.present) return current === null;
  if (!current) return false;
  return target.value === null || current.value === target.value;
}

/**
 * The calls on a pf2e actor that bring a condition to `level`, for
 * toggle-token-condition. The same methods pf2e-manage-conditions uses: pf2e's
 * increaseCondition and decreaseCondition apply its rules; only a value pf2e
 * did not take is written to the condition item directly. Empty when the
 * actor is there already.
 */
export function conditionLevelPlan(identifier: string, level: number, actor: Data): ActorCall[] {
  const slug = conditionSlug(identifier) ?? identifier;
  const all = activeConditions(actor).filter(condition => condition.slug === slug);
  if (level <= 0)
    return all.length ? [{ method: 'decreaseCondition', args: [slug, { forceRemove: true }] }] : [];
  const current = all.find(condition => !condition.grantedBy) ?? all[0] ?? null;
  if (!current) return [{ method: 'increaseCondition', args: [slug, { value: level }] }];
  if (current.value === level) return [];
  return [
    {
      method: 'updateEmbeddedDocuments',
      args: ['Item', [{ _id: current.id, 'system.value.value': level }]],
    },
  ];
}
