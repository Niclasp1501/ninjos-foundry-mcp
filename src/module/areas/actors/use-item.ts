/**
 * useItem: start the use of an item and come back without waiting for it.
 *
 * The use itself may open a dialog for the Gamemaster. Waiting for it would
 * hold the bridge until its time limit. So the handler waits a
 * short moment only, to catch a use that fails at once, and then reports
 * honestly what it knows:
 * - `completed`: the call finished within the moment
 * - `initiated`: still running, most likely a dialog is open
 * - a failure within the moment is a tool error with its cause; a later one
 *   is shown to the Gamemaster in Foundry, because nobody else could see it
 *
 * Targets are resolved before anything happens. A target that cannot be
 * found stops the call: an item used on the wrong target spends resources.
 * Before, missing targets were skipped and the old selection stayed active.
 */
import { GENERIC_ITEM_USE_METHODS, type ItemUsePlan } from '../../../common/game-systems.js';
import { MODULE_ID } from '../../../common/constants.js';
import { QueryError, type QueryHandler } from '../../dispatcher.js';
import { systemAnswer } from '../../game-systems.js';
import { requireWorld } from '../../world-ready.js';
import {
  actors,
  documentClass,
  idOf,
  inputOf,
  invalid,
  isRecord,
  messageOf,
  quoteList,
  requireActiveScene,
  textOf,
} from './common.js';
import { findActor, findItemOnActor, itemNotFound, type ActorMatch } from './lookup.js';

/** How long a use may take before it counts as still running. */
export const USE_SETTLE_MS = 300;

function tokenIdOf(target: unknown): string | null {
  if (!isRecord(target) && typeof target !== 'object') return null;
  const record = target as { id?: unknown; document?: { id?: unknown } };
  if (typeof record.document?.id === 'string') return record.document.id;
  return typeof record.id === 'string' ? record.id : null;
}

function currentTargets(user: FoundryActorsUser): string[] | null {
  const targets = user.targets;
  if (!targets || typeof (targets as Iterable<unknown>)[Symbol.iterator] !== 'function')
    return null;
  return [...(targets as Iterable<unknown>)].map(tokenIdOf).filter((id): id is string => !!id);
}

function resolveTargets(
  wanted: string[],
  match: ActorMatch
): { scene: FoundryActorsScene; tokens: FoundryActorsToken[] } {
  const scene = requireActiveScene('Choosing targets');
  const all = scene.tokens.contents;
  const problems: string[] = [];
  const found = new Map<string, FoundryActorsToken>();
  const list = (tokens: FoundryActorsToken[]) =>
    tokens.map(t => `"${t.name ?? ''}" (${t.id})`).join(', ');

  for (const target of wanted) {
    const lower = target.toLowerCase();
    let candidates: FoundryActorsToken[];
    if (lower === 'self') {
      candidates = match.token
        ? all.filter(token => token.id === match.token?.id)
        : all.filter(token => token.actorId === match.actor.id);
      if (!candidates.length) {
        problems.push(
          `"self": actor "${match.actor.name}" has no token in the active scene "${scene.name}".`
        );
        continue;
      }
    } else {
      const byId = all.find(token => token.id === target);
      candidates = byId ? [byId] : all.filter(token => (token.name ?? '').toLowerCase() === lower);
      if (!candidates.length) {
        const actorIds = new Set(
          actors()
            .filter(actor => (actor.name ?? '').toLowerCase() === lower)
            .map(actor => actor.id)
        );
        candidates = all.filter(token => token.actorId && actorIds.has(token.actorId));
      }
      if (!candidates.length) {
        problems.push(
          `"${target}": no token in the active scene "${scene.name}" has this id, token name or actor name.`
        );
        continue;
      }
    }
    if (candidates.length > 1) {
      problems.push(
        `"${target}" matches ${candidates.length} tokens: ${list(candidates)}; pass the token id.`
      );
      continue;
    }
    const token = candidates[0] as FoundryActorsToken;
    found.set(token.id, token);
  }
  if (problems.length) {
    throw new QueryError(
      'TARGET_NOT_FOUND',
      `Nothing was used. ${problems.join(' ')} Tokens in the scene: ${all.length ? list(all.slice(0, 20)) : 'none'}.`
    );
  }
  return { scene, tokens: [...found.values()] };
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
}

type Outcome =
  | { state: 'resolved'; value: unknown }
  | { state: 'rejected'; error: unknown }
  | { state: 'pending' };

export const useItem: QueryHandler = {
  access: { kind: 'write', document: 'Actors', action: 'update' },
  run: async (data, context) => {
    requireWorld();
    const input = inputOf(data);
    const options = isRecord(input['options']) ? input['options'] : {};
    const actorIdentifier = textOf(input['actorIdentifier']);
    const itemIdentifier = textOf(input['itemIdentifier']);
    if (!actorIdentifier) throw invalid('actorIdentifier is required.');
    if (!itemIdentifier) throw invalid('itemIdentifier is required.');
    const consume = (options['consume'] ?? input['consume']) !== false;
    const levelRaw = options['spellLevel'] ?? input['spellLevel'];
    const spellLevel =
      typeof levelRaw === 'number' && Number.isFinite(levelRaw) ? levelRaw : undefined;

    const match = findActor(actorIdentifier);
    const actor = match.actor;
    const item = findItemOnActor(actor, itemIdentifier);
    if (!item) throw itemNotFound(actor, itemIdentifier);

    const user = game.user as FoundryActorsUser;
    const wantedTargets = Array.isArray(input['targets'])
      ? (input['targets'] as unknown[]).map(textOf).filter(Boolean)
      : [];
    let targets: FoundryActorsToken[] = [];
    let targetsVerified: boolean | null = null;
    if (wantedTargets.length) {
      targets = resolveTargets(wantedTargets, match).tokens;
      if (typeof user.updateTokenTargets !== 'function') {
        throw new QueryError(
          'NOT_AVAILABLE',
          'Targets cannot be set in this Foundry (the user has no updateTokenTargets). Nothing was used. Leave targets out to let the Gamemaster choose.'
        );
      }
      await user.updateTokenTargets(targets.map(token => token.id));
      const now = currentTargets(user);
      targetsVerified =
        now === null
          ? null
          : targets.every(token => now.includes(token.id)) && now.length === targets.length;
    }
    const keptTargets = wantedTargets.length ? null : currentTargets(user);

    const plan = systemAnswer('itemUse');
    const request = { consume, ...(spellLevel !== undefined ? { spellLevel } : {}) };
    let planned: ItemUsePlan | null = null;
    try {
      planned = plan.questions.plan(item.toObject(), request);
    } catch (error) {
      throw new QueryError(
        'USE_FAILED',
        `The adapter "${plan.system.title}" could not plan the use: ${messageOf(error)}. Nothing was used.`
      );
    }
    const callable = item as unknown as Record<string, unknown>;
    let method: string | null = null;
    let source: 'adapter' | 'generic' | 'chat';
    let callArgs: readonly unknown[] = [{}];
    if (planned) {
      if (typeof callable[planned.method] !== 'function') {
        throw new QueryError(
          'NOT_AVAILABLE',
          `The adapter "${plan.system.title}" uses the method "${planned.method}", which item "${item.name}" does not have. Nothing was used.`
        );
      }
      method = planned.method;
      // A plan may give every argument, e.g. dnd5e's second argument that skips the dialog.
      callArgs = planned.args ?? [planned.options];
      source = 'adapter';
    } else {
      method = GENERIC_ITEM_USE_METHODS.find(name => typeof callable[name] === 'function') ?? null;
      source = method ? 'generic' : 'chat';
    }

    let outcome: Outcome;
    let messageId: string | null = null;
    if (method) {
      const running = Promise.resolve().then(() =>
        (callable[method as string] as (...args: unknown[]) => unknown).call(item, ...callArgs)
      );
      outcome = await Promise.race<Outcome>([
        running.then(
          value => ({ state: 'resolved', value }),
          error => ({ state: 'rejected', error })
        ),
        new Promise<Outcome>(resolve =>
          setTimeout(() => resolve({ state: 'pending' }), USE_SETTLE_MS)
        ),
      ]);
      if (outcome.state === 'pending') {
        running.catch(error =>
          ui.notifications?.error(
            game.i18n.format(`${MODULE_ID}.actors.useFailedLate`, {
              item: item.name,
              actor: actor.name,
              error: messageOf(error),
            })
          )
        );
      }
      if (outcome.state === 'rejected') {
        throw new QueryError(
          'USE_FAILED',
          `Using "${item.name}" of "${actor.name}" failed: ${messageOf(outcome.error)}`
        );
      }
    } else {
      const text = game.i18n.format(`${MODULE_ID}.actors.usesItem`, {
        actor: actor.name,
        item: item.name,
      });
      const made = await documentClass('ChatMessage').create({
        content: `<p>${escapeHtml(text)}</p>`,
        speaker: { actor: actor.id, alias: actor.name },
      });
      messageId = idOf(made);
      if (!messageId || !game.messages.get(messageId)) {
        throw new QueryError(
          'NOT_APPLIED',
          `The chat message for "${item.name}" is not in the chat when read back.`
        );
      }
      outcome = { state: 'resolved', value: made };
    }

    context.recordChange({
      query: 'useItem',
      tool: 'use-item',
      document: 'Actors',
      action: 'other',
      targets: [
        { id: actor.id, uuid: actor.uuid, name: actor.name, documentName: 'Actor' },
        { id: item.id, name: item.name, documentName: 'Item' },
      ],
      summary: `Used "${item.name}" of actor "${actor.name}" (${source}${method ? ` ${method}` : ' chat message'}).`,
    });

    const pending = outcome.state === 'pending';
    const emptyResult =
      outcome.state === 'resolved' &&
      (outcome.value === null || outcome.value === undefined || outcome.value === false);
    const notVerified = ['whether resources, uses or spell slots were consumed'];
    if (pending) notVerified.push('whether the use was confirmed or cancelled');
    const lines = [
      pending
        ? `The use of "${item.name}" was started and is still running; most likely a dialog is open for the Gamemaster in Foundry. The result appears in the chat.`
        : source === 'chat'
          ? `No method to use "${item.name}" exists without an adapter for the game system "${plan.system.rawId}"; a plain chat message was posted instead.`
          : emptyResult
            ? `The use of "${item.name}" finished without a result; in many systems that means it was cancelled or produced no chat card.`
            : `The use of "${item.name}" finished.`,
      wantedTargets.length
        ? `Targets set: ${targets.map(token => token.name ?? token.id).join(', ')}${targetsVerified === false ? ' (reading them back showed a different selection)' : ''}.`
        : keptTargets && keptTargets.length
          ? `No targets given; the Gamemaster's current targets stay: ${quoteList(keptTargets)}.`
          : 'No targets given and none selected.',
      `Not checked: ${notVerified.join('; ')}.`,
    ];

    return {
      success: true,
      status: pending ? 'initiated' : 'completed',
      requiresGMInteraction: pending,
      actorId: actor.id,
      actorName: actor.name,
      itemId: item.id,
      itemName: item.name,
      method: method ?? 'ChatMessage.create',
      planFrom: source,
      consume,
      spellLevel: spellLevel ?? null,
      targets: targets.map(token => ({ id: token.id, name: token.name ?? '' })),
      targetsVerified,
      keptTargets,
      chatMessageId: messageId,
      verified: { called: true, finished: !pending, emptyResult },
      notVerified,
      message: lines.join(' '),
    };
  },
};
