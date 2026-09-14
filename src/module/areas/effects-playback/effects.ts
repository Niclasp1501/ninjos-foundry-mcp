/**
 * manage-effects: create, change or delete an active effect on an actor or on
 * an item that actor carries.
 *
 * System neutral: the effect is a plain Foundry document and its fields go to
 * Foundry unchanged. What this adds over the previous generation: the switch
 * and the actor level are checked (delete needs "full"), every error is a
 * real error, and every write is read back. Fields Foundry dropped or stored
 * differently are listed as warnings instead of passing as success unseen.
 */
import type { Access } from '../../../common/permissions.js';
import type { QueryHandler } from '../../dispatcher.js';
import { requireWorld } from '../../world-ready.js';
import { smallEnough } from '../journals/common.js';
import {
  argsOf,
  differences,
  invalid,
  isRecord,
  notApplied,
  notFound,
  pickOne,
  refuseUnknown,
  suggestions,
  typeOf,
} from './lookup.js';

const ACTIONS = ['create', 'update', 'delete'] as const;
const PARENT_TYPES = ['actor', 'item'] as const;
const KNOWN = [
  'action',
  'actorIdentifier',
  'parentType',
  'parentItemIdentifier',
  'effectId',
  'effectData',
];

type EffectAction = (typeof ACTIONS)[number];
type Parent = FoundryEffectsPlaybackActor | FoundryEffectsPlaybackItem;

interface EffectRequest {
  action: EffectAction;
  actorIdentifier: string;
  parentType: (typeof PARENT_TYPES)[number];
  parentItemIdentifier: string | null;
  effectId: string | null;
  effectData: Record<string, unknown> | null;
}

const blank = (value: unknown) => typeof value !== 'string' || value.trim() === '';

/** Effects belong to actors: the actor level decides, delete needs "full". */
export function effectAccess(data: unknown): Access {
  const action = isRecord(data) ? data['action'] : undefined;
  return {
    kind: 'write',
    document: 'Actors',
    action: action === 'create' || action === 'delete' ? action : 'update',
  };
}

/** Every rule of the call at once, so a model fixes all problems in one retry. */
export function readEffectRequest(data: unknown): EffectRequest {
  const args = argsOf(data);
  const problems = refuseUnknown(args, KNOWN);
  const action = args['action'];
  const parentType = args['parentType'];

  if (!ACTIONS.includes(action as EffectAction)) {
    problems.push(`action must be one of ${ACTIONS.join(', ')}`);
  }
  if (blank(args['actorIdentifier'])) {
    problems.push('actorIdentifier is required and must not be empty');
  }
  if (!PARENT_TYPES.includes(parentType as 'actor')) {
    problems.push(`parentType must be one of ${PARENT_TYPES.join(', ')}`);
  }
  if (parentType === 'item' && blank(args['parentItemIdentifier'])) {
    problems.push('parentItemIdentifier is required when parentType is "item"');
  }
  if (parentType === 'actor' && args['parentItemIdentifier'] !== undefined) {
    problems.push('parentItemIdentifier is only supported when parentType is "item"');
  }

  const effectId = args['effectId'];
  const effectData = args['effectData'];
  if (effectId !== undefined && typeof effectId !== 'string') {
    problems.push(`effectId must be a string, got ${typeOf(effectId)}`);
  }
  if (effectData !== undefined && !isRecord(effectData)) {
    problems.push(`effectData must be an object, got ${typeOf(effectData)}`);
  }
  const fields = isRecord(effectData) ? effectData : null;

  if (action === 'create') {
    if (effectId !== undefined) problems.push('effectId is not supported for create');
    if (!fields) problems.push('effectData is required for create');
    else {
      if (blank(fields['name'])) {
        problems.push('effectData.name is required for create and must be a non-empty string');
      }
      if (fields['_id'] !== undefined || fields['id'] !== undefined) {
        problems.push(
          'effectData must not carry _id or id for create; Foundry assigns the id of a new effect'
        );
      }
    }
  }
  if ((action === 'update' || action === 'delete') && blank(effectId)) {
    problems.push(`effectId is required for ${action}`);
  }
  if (action === 'update') {
    const changes = fields ? Object.keys(fields).filter(key => key !== '_id' && key !== 'id') : [];
    if (changes.length === 0) {
      problems.push(
        'effectData is required for update and must contain at least one field besides its id'
      );
    }
    for (const key of ['_id', 'id']) {
      if (fields && fields[key] !== undefined && fields[key] !== effectId) {
        problems.push(`effectData.${key} must match effectId when provided`);
      }
    }
    if (fields && 'name' in fields && blank(fields['name'])) {
      problems.push('effectData.name must be a non-empty string when provided');
    }
  }
  if (action === 'delete' && effectData !== undefined) {
    problems.push('effectData is not supported for delete');
  }

  if (problems.length) invalid(`Invalid arguments: ${problems.join('; ')}`);

  return {
    action: action as EffectAction,
    actorIdentifier: (args['actorIdentifier'] as string).trim(),
    parentType: parentType as 'actor' | 'item',
    parentItemIdentifier:
      parentType === 'item' ? (args['parentItemIdentifier'] as string).trim() : null,
    effectId: typeof effectId === 'string' ? effectId.trim() : null,
    effectData: fields,
  };
}

/**
 * A world actor by id or name, or any actor by uuid. The uuid also reaches the
 * actor of an unlinked token, which no name lookup in the world can find.
 */
export function findActor(identifier: string): FoundryEffectsPlaybackActor {
  const actors = game.actors.contents as FoundryEffectsPlaybackActor[];
  const byId = actors.find(actor => actor.id === identifier);
  if (byId) return byId;
  if (identifier.includes('.')) {
    const document = resolveUuid(identifier);
    if (document?.documentName === 'Actor') return document as FoundryEffectsPlaybackActor;
  }
  const actor = pickOne(actors, identifier, 'actor', 'write');
  if (!actor) {
    notFound(
      `Actor not found: "${identifier}". ${suggestions(actors, identifier, 'actor')} ` +
        'The actor of an unlinked token is reached by its uuid.'
    );
  }
  return actor;
}

function resolveUuid(uuid: string): FoundryDocument | null {
  if (typeof fromUuidSync !== 'function') return null;
  try {
    return fromUuidSync(uuid);
  } catch {
    return null;
  }
}

function findItem(
  actor: FoundryEffectsPlaybackActor,
  identifier: string
): FoundryEffectsPlaybackItem {
  const items = actor.items.contents;
  const item = pickOne(items, identifier, 'item', 'write');
  if (!item) {
    notFound(
      `Item not found on actor "${actor.name}": "${identifier}". ${suggestions(items, identifier, 'item')}`
    );
  }
  return item;
}

function findEffect(
  actor: FoundryEffectsPlaybackActor,
  item: FoundryEffectsPlaybackItem | null,
  effectId: string
): FoundryEffectsPlaybackEffect {
  const parent: Parent = item ?? actor;
  const effect = parent.effects.get(effectId);
  if (effect) return effect;

  let message = item
    ? `ActiveEffect ${effectId} not found on item "${item.name}" on actor "${actor.name}"`
    : `ActiveEffect ${effectId} not found on actor "${actor.name}"`;
  if (!item) {
    const carrier = actor.items.find(entry => entry.effects.has(effectId));
    if (carrier) {
      message +=
        `. It lies on the item "${carrier.name}" (id ${carrier.id}); pass parentType "item" and ` +
        'parentItemIdentifier to change it there, where Foundry keeps it';
    }
  } else if (actor.effects.has(effectId)) {
    message += '. It lies on the actor itself; pass parentType "actor"';
  }
  const ids = parent.effects.map(entry => `"${entry.name}" (id ${entry.id})`);
  notFound(`${message}. Effects there: ${ids.length ? ids.join(', ') : 'none'}.`);
}

/**
 * The parent as it is now, so a read back never looks at a stale object. A
 * token actor is read through its uuid: `game.actors` holds the base actor
 * with the same id, which does not carry the token's effects.
 */
function freshParent(
  actor: FoundryEffectsPlaybackActor,
  item: FoundryEffectsPlaybackItem | null
): Parent | null {
  const current = (actor.parent ? resolveUuid(actor.uuid) : game.actors.get(actor.id)) as
    FoundryEffectsPlaybackActor | null | undefined;
  if (!current) return null;
  return item ? (current.items.get(item.id) ?? null) : current;
}

function warningsFor(sent: Record<string, unknown>, stored: Record<string, unknown>): string[] {
  const differing = differences(sent, stored);
  return differing.length
    ? [
        `Foundry dropped or stored these fields differently: ${differing.join('; ')}. Unknown fields are ` +
          'discarded by Foundry, and some values are converted (for example numbers to text in changes).',
      ]
    : [];
}

export const manageEffects: QueryHandler = {
  access: effectAccess,
  run: async (data, context) => {
    requireWorld();
    const request = readEffectRequest(data);

    const actor = findActor(request.actorIdentifier);
    const item =
      request.parentType === 'item'
        ? findItem(actor, request.parentItemIdentifier as string)
        : null;
    const parent: Parent = item ?? actor;
    const carrier = item
      ? { scope: 'item', parentItemId: item.id, parentItemName: item.name }
      : { scope: 'actor' };
    const where = item ? `item "${item.name}" of actor "${actor.name}"` : `actor "${actor.name}"`;
    const base = {
      success: true,
      entityType: 'effect',
      actorId: actor.id,
      actorName: actor.name,
      ...carrier,
    };
    const log = { query: 'manageEffects', tool: 'manage-effects', document: 'Actors' } as const;

    if (request.action === 'create') {
      const fields = request.effectData as Record<string, unknown>;
      const created = await parent.createEmbeddedDocuments('ActiveEffect', [fields]);
      const id = created[0]?.id;
      if (!id) notApplied(`Foundry did not return the created ActiveEffect on ${where}`);
      const effect = freshParent(actor, item)?.effects.get(id);
      if (!effect) notApplied(`The new ActiveEffect ${id} does not read back on ${where}`);
      const stored = effect.toObject();
      context.recordChange({
        ...log,
        action: 'create',
        targets: [{ id, uuid: effect.uuid, name: effect.name }],
        summary: `Created the effect "${effect.name}" on ${where}.`,
      });
      const warnings = warningsFor(fields, stored);
      return {
        ...base,
        action: 'create',
        effect: stored,
        ...(warnings.length ? { warnings } : {}),
      };
    }

    const effectId = request.effectId as string;
    const effect = findEffect(actor, item, effectId);
    const before = effect.toObject();

    if (request.action === 'update') {
      const changes = { ...(request.effectData as Record<string, unknown>) };
      delete changes['_id'];
      delete changes['id'];
      await parent.updateEmbeddedDocuments('ActiveEffect', [{ _id: effectId, ...changes }]);
      const after = freshParent(actor, item)?.effects.get(effectId);
      if (!after) notApplied(`ActiveEffect ${effectId} is gone from ${where} after the update`);
      const stored = after.toObject();
      context.recordChange({
        ...log,
        action: 'update',
        targets: [{ id: effectId, uuid: after.uuid, name: after.name }],
        summary: `Changed the effect "${after.name}" on ${where}: ${Object.keys(changes).join(', ')}.`,
        before: smallEnough(before),
        after: smallEnough(stored),
      });
      const warnings = warningsFor(changes, stored);
      return {
        ...base,
        action: 'update',
        effect: stored,
        ...(warnings.length ? { warnings } : {}),
      };
    }

    await parent.deleteEmbeddedDocuments('ActiveEffect', [effectId]);
    if (freshParent(actor, item)?.effects.has(effectId)) {
      notApplied(`ActiveEffect ${effectId} still exists on ${where} after deleting it`);
    }
    context.recordChange({
      ...log,
      action: 'delete',
      targets: [{ id: effectId, uuid: effect.uuid, name: effect.name }],
      summary: `Deleted the effect "${effect.name}" from ${where}.`,
      before: smallEnough(before),
    });
    return {
      ...base,
      action: 'delete',
      effectId,
      effectName: effect.name || 'Unknown Effect',
    };
  },
};
