/**
 * Request-player-rolls on the Gamemaster's client connected to
 * the bridge. It resolves the target, asks the adapter of the game system for
 * the formula, and posts a chat message whose flags hold the request. The
 * button and the confirmation live in roll-card.ts.
 *
 * Nothing reaches the chat when the visibility is not settled, the target is
 * ambiguous or offline, the roll type is unknown to the system, or Foundry
 * rejects the formula. Without an adapter only "custom" with an explicit
 * formula works, and the refusal says so; there is no silent d20.
 */
import { MODULE_ID } from '../../../common/constants.js';
import {
  newRequestId,
  readRollRequest,
  ROLL_REQUEST_FLAG,
  type RollRequestRecord,
} from '../../../common/areas/tokens-dice/roll-request.js';
import {
  resolveRollTarget,
  RollTargetError,
  type RollActor,
  type RollTarget,
  type RollUser,
} from '../../../common/areas/tokens-dice/roll-target.js';
import type { AdapterDocument } from '../../../common/game-systems.js';
import type { Access } from '../../../common/permissions.js';
import type { QueryHandler } from '../../dispatcher.js';
import { systemAnswer } from '../../game-systems.js';
import { adapterData } from '../../prepared-data.js';
import { requireWorld } from '../../world-ready.js';
import { escapeHtml } from '../interface/html.js';
import { argsOf, fail, idOf, isRecord, operation, optionalText, requiredText } from './support.js';
import { rollText } from './texts.js';

/**
 * Posting a chat message is a change the switch must allow. Chat messages are
 * a core kind without a level; this package declares
 * that kind instead of the extension access it borrowed before. The refusal
 * with the switch off is the same sentence.
 */
export const ROLL_REQUEST_ACCESS: Access = {
  kind: 'write',
  document: 'ChatMessages',
  action: 'create',
};

const OWNER_LEVEL = 3;

export function rollUsers(): RollUser[] {
  return (game.users?.contents ?? []).map(user => ({
    id: user.id,
    name: user.name,
    isGM: user.isGM === true,
    active: user.active === true,
    characterId: idOf((user as unknown as { character?: unknown }).character),
  }));
}

export function rollActors(): RollActor[] {
  return (game.actors.contents as FoundryTokensDiceActor[]).map(actor => ({
    id: actor.id,
    name: actor.name ?? '',
    ownerIds: Object.entries(actor.ownership ?? {})
      .filter(([user, level]) => user !== 'default' && level === OWNER_LEVEL)
      .map(([user]) => user),
  }));
}

export function gamemasterIds(activeOnly = false): string[] {
  return (game.users?.contents ?? [])
    .filter(user => user.isGM && (!activeOnly || user.active))
    .map(user => user.id);
}

export function rollClass(): FoundryTokensDiceRollClass {
  const candidate = (globalThis as { Roll?: unknown }).Roll;
  if (typeof candidate !== 'function') fail('FOUNDRY_API', "Foundry's Roll class is not available");
  return candidate as FoundryTokensDiceRollClass;
}

export function chatMessageClass(): FoundryTokensDiceMessageClass {
  const candidate = (globalThis as { ChatMessage?: unknown }).ChatMessage;
  const create = (candidate as { create?: unknown } | undefined)?.create;
  if (typeof create !== 'function')
    fail('FOUNDRY_API', "Foundry's ChatMessage document class is not available");
  return candidate as FoundryTokensDiceMessageClass;
}

export function moduleFlagsOf(message: unknown): unknown {
  if (!isRecord(message) && typeof message !== 'object') return undefined;
  const flags = (message as { flags?: unknown } | null)?.flags;
  return isRecord(flags) ? flags[MODULE_ID] : undefined;
}

/** The actor as plain data for the adapter, with Foundry's derived roll data next to it. */
function actorForAdapter(actor: FoundryTokensDiceActor): AdapterDocument {
  let rollData: unknown = null;
  try {
    const raw = actor.getRollData?.();
    rollData = raw === undefined ? null : JSON.parse(JSON.stringify(raw));
  } catch {
    rollData = null;
  }
  return { ...adapterData(actor), rollData };
}

function targetLine(record: RollRequestRecord): string {
  if (!record.targetUserName)
    return rollText('roll.card.targetGmOnly', { character: record.actorName ?? '' });
  return record.actorName
    ? rollText('roll.card.targetWithCharacter', {
        player: record.targetUserName,
        character: record.actorName,
      })
    : rollText('roll.card.target', { player: record.targetUserName });
}

export function visibilityLine(record: RollRequestRecord): string {
  if (record.isPublic) return rollText('roll.card.public');
  return record.targetUserName
    ? rollText('roll.card.private', { player: record.targetUserName })
    : rollText('roll.card.privateGm');
}

/** What the stored message shows where the module is not active; the card replaces it. */
export function fallbackContent(record: RollRequestRecord): string {
  const lines = [
    `<p><strong>${escapeHtml(rollText('roll.card.title', { label: record.label }))}</strong></p>`,
    `<p>${escapeHtml(targetLine(record))}</p>`,
    ...(record.flavor
      ? [`<p>${escapeHtml(rollText('roll.card.context', { flavor: record.flavor }))}</p>`]
      : []),
    `<p>${escapeHtml(visibilityLine(record))}</p>`,
  ];
  return `<div class="ninjos-mcp-roll" data-mcp-roll-request="${escapeHtml(record.requestId)}">${lines.join('')}</div>`;
}

export { targetLine };

function resolveTarget(text: string): RollTarget {
  try {
    return resolveRollTarget(text, rollUsers(), rollActors());
  } catch (error) {
    if (error instanceof RollTargetError) fail(error.code, error.message);
    throw error;
  }
}

export const requestPlayerRolls: QueryHandler = {
  access: ROLL_REQUEST_ACCESS,
  run: (raw, context) =>
    operation('request player rolls', async () => {
      requireWorld();
      const args = argsOf(raw);
      const rollType = requiredText(args, 'rollType');
      const rollTarget = optionalText(args, 'rollTarget')?.trim() ?? '';
      const targetText = requiredText(args, 'targetPlayer');
      const isPublic = args['isPublic'];
      if (typeof isPublic !== 'boolean') {
        fail(
          'INVALID_ARGUMENT',
          'You must specify whether the roll should be PUBLIC (visible to all players) or PRIVATE (visible only to ' +
            'target player and GM). Check if the user already specified this in their request, or ask them to clarify.'
        );
      }
      if (args['userConfirmedVisibility'] !== true) {
        fail(
          'INVALID_ARGUMENT',
          'userConfirmedVisibility must be true: confirm that the user chose public or private for this roll.'
        );
      }
      const rollModifier = optionalText(args, 'rollModifier')?.trim() ?? '';
      const flavor = optionalText(args, 'flavor')?.trim() ?? '';

      const target = resolveTarget(targetText);
      const actor = target.actor
        ? ((game.actors.get(target.actor.id) as FoundryTokensDiceActor | undefined) ?? null)
        : null;

      const answer = systemAnswer('rolls');
      const types = answer.questions.types.map(type => type.id);
      if (answer.fromAdapter && !types.includes(rollType)) {
        fail(
          'INVALID_ARGUMENT',
          `The roll type "${rollType}" is not offered for the game system "${answer.system.rawId}". Roll types: ${types.join(', ')}.`
        );
      }
      // Without an adapter the generic plan refuses every type but "custom" and names the system.
      const plan = answer.questions.plan(
        { rollType, rollTarget, rollModifier },
        actor ? actorForAdapter(actor) : null
      );
      const formula = plan.formula.trim();
      const RollClass = rollClass();
      if (!formula || (typeof RollClass.validate === 'function' && !RollClass.validate(formula))) {
        fail(
          'INVALID_FORMULA',
          `Foundry does not accept the roll formula "${formula}". Nothing was posted to the chat.`
        );
      }
      const label = rollType === 'custom' ? rollText('roll.customLabel') : plan.label || rollType;

      const user = game.user as FoundryUser;
      const record: RollRequestRecord = {
        version: 1,
        requestId: newRequestId(),
        status: 'open',
        rollType,
        rollTarget,
        label,
        formula,
        isPublic,
        flavor,
        actorId: target.actor?.id ?? null,
        actorName: target.actor?.name ?? null,
        targetUserId: target.user?.id ?? null,
        targetUserName: target.user?.name ?? null,
        requestedBy: user.id,
        requestedAt: new Date().toISOString(),
      };
      const whisper = isPublic
        ? []
        : [...new Set([...(target.user ? [target.user.id] : []), ...gamemasterIds()])];

      const created = await chatMessageClass().create({
        author: user.id,
        content: fallbackContent(record),
        speaker: actor ? { actor: actor.id, alias: actor.name ?? '' } : { alias: user.name },
        whisper,
        flags: { [MODULE_ID]: { [ROLL_REQUEST_FLAG]: record } },
      });
      const createdId = idOf(Array.isArray(created) ? created[0] : created);
      const stored = createdId
        ? (game.messages.get(createdId) as FoundryTokensDiceMessage | undefined)
        : undefined;
      if (!stored || readRollRequest(moduleFlagsOf(stored))?.requestId !== record.requestId) {
        fail(
          'NOT_CREATED',
          'The chat message of the roll request does not read back from the chat log'
        );
      }
      if (!isPublic && !(stored.whisper ?? []).length) {
        // A private request that Foundry would show to everyone must not stay in the chat.
        await stored.delete();
        fail(
          'NOT_APPLIED',
          'Foundry stored the private roll request without whisper recipients, so it was removed again'
        );
      }

      const recipients = whisper
        .map(id => game.users?.get(id)?.name)
        .filter((name): name is string => typeof name === 'string');
      const who = target.user?.name ?? target.actor?.name ?? targetText;
      // Chat messages can be logged; a posted request is a change others see at the table.
      context.recordChange({
        query: 'request-player-rolls',
        tool: 'request-player-rolls',
        document: 'ChatMessages',
        action: 'create',
        targets: [{ id: stored.id, name: label, documentName: 'ChatMessage' }],
        summary: `Posted a ${isPublic ? 'public' : 'private'} roll request "${label}" (${formula}) for ${who}.`,
      });
      return {
        success: true,
        message: `Roll request sent to ${who}. ${isPublic ? 'Public' : 'Private'} roll button created in chat.`,
        messageId: stored.id,
        requestId: record.requestId,
        rollType,
        label,
        formula,
        isPublic,
        targetPlayer: target.user ? { id: target.user.id, name: target.user.name } : null,
        character: target.actor ? { id: target.actor.id, name: target.actor.name } : null,
        ...(isPublic ? {} : { whisperedTo: recipients }),
        gameSystem: answer.system.rawId,
        ...(target.notes.length ? { notes: target.notes } : {}),
      };
    }),
};
