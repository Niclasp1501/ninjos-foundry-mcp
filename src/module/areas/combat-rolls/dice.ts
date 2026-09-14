/**
 * Free rolls and system rolls, evaluated on the Gamemaster's
 * client in Foundry, and the roll message both of them and the initiative
 * roll post when asked to.
 *
 * - A roll never waits for manual dice entry (`allowInteractive: false`).
 * - Nothing reaches the chat unless `toChat` is true. The roll mode then
 *   defaults to gmroll, so a tool call does not roll in front of the players
 *   by accident. The message is created with explicit recipients instead of
 *   `roll.toMessage`, whose default would follow the user's own roll mode,
 *   and is read back: recipients that differ are an error.
 * - A system roll asks the adapter of the game system for the formula.
 * Without an adapter that answers rolls it is
 *   SYSTEM_NOT_SUPPORTED; a free formula goes through roll-dice.
 */
import {
  isRollMode,
  recipientsFor,
  ROLL_MODES,
  sameRecipients,
  summarizeRoll,
  type RollMode,
  type RollRecipients,
} from '../../../common/areas/combat-rolls/rules.js';
import { MODULE_ID } from '../../../common/constants.js';
import type { RollRequest } from '../../../common/game-systems.js';
import { QueryError, type QueryHandler } from '../../dispatcher.js';
import { activeGameSystem, requireSystemQuestions } from '../../game-systems.js';
import { adapterData } from '../../prepared-data.js';
import { requireWorld } from '../../world-ready.js';
import { findActor } from '../actors/lookup.js';
import { gamemasterIds } from '../tokens-dice/rolls.js';
import {
  argsOf,
  fail,
  finiteNumber,
  idOf,
  isRecord,
  messageOf,
  operation,
  optionalBoolean,
  optionalText,
  requiredText,
} from '../tokens-dice/support.js';
import { CHAT_POST, READ_ONLY } from './access.js';
import { chatTexts } from './texts.js';

type Roll = FoundryCombatRollsRoll;

export function rollClassOf(): FoundryCombatRollsRollClass {
  const candidate = (globalThis as { Roll?: unknown }).Roll;
  if (typeof candidate !== 'function') fail('FOUNDRY_API', "Foundry's Roll class is not available");
  return candidate as FoundryCombatRollsRollClass;
}

export function checkFormula(RollClass: FoundryCombatRollsRollClass, formula: string): void {
  if (!formula.trim() || (typeof RollClass.validate === 'function' && !RollClass.validate(formula)))
    fail('INVALID_FORMULA', `Foundry does not accept the roll formula "${formula}".`);
}

export async function evaluateRoll(roll: Roll, what: string): Promise<void> {
  try {
    await roll.evaluate({ allowInteractive: false });
  } catch (error) {
    fail('ROLL_FAILED', `${what} could not be evaluated: ${messageOf(error)}`);
  }
  if (!finiteNumber(roll.total))
    fail('ROLL_FAILED', `${what} gave no numeric total (formula "${roll.formula}").`);
}

export function rollDataOf(
  actor: FoundryCombatRollsActor | null | undefined
): Record<string, unknown> {
  try {
    const data = actor?.getRollData?.();
    return isRecord(data) ? data : {};
  } catch {
    return {};
  }
}

/** The roll mode of the arguments; gmroll when absent. */
export function rollModeOf(args: Record<string, unknown>): RollMode {
  const value = args['rollMode'];
  if (value === undefined || value === null) return 'gmroll';
  if (!isRollMode(value))
    fail(
      'INVALID_ARGUMENT',
      `rollMode must be one of ${ROLL_MODES.join(', ')}, got "${String(value)}".`
    );
  return value;
}

function recipientText(recipients: RollRecipients): string {
  if (!recipients.whisper.length) return recipients.blind ? 'everyone, blind' : 'everyone';
  const names = recipients.whisper.map(id => game.users?.get(id)?.name ?? id);
  return `${names.join(', ')}${recipients.blind ? ', blind' : ''}`;
}

export interface PostedRoll {
  messageId: string;
  rollMode: RollMode;
  visibleTo: string;
}

/** Post a finished roll with explicit recipients and read back who sees it. */
export async function postRoll(
  roll: Roll,
  options: { flavor: string; mode: RollMode; speaker: Record<string, unknown> }
): Promise<PostedRoll> {
  const user = game.user as FoundryUser;
  const wanted = recipientsFor(options.mode, user.id, gamemasterIds());
  const MessageClass = (globalThis as { ChatMessage?: unknown }).ChatMessage as
    FoundryCombatRollsDocumentClass | undefined;
  if (typeof MessageClass?.create !== 'function')
    fail('FOUNDRY_API', "Foundry's ChatMessage document class is not available");
  const created = await MessageClass.create({
    author: user.id,
    flavor: options.flavor,
    speaker: options.speaker,
    rolls: [roll],
    whisper: wanted.whisper,
    blind: wanted.blind,
    flags: { [MODULE_ID]: { createdByMcp: true } },
  });
  const id = idOf(Array.isArray(created) ? created[0] : created);
  const stored = id ? (game.messages.get(id) as FoundryCombatRollsMessage | undefined) : undefined;
  if (!stored) fail('NOT_CREATED', 'The roll message does not read back from the chat log.');
  const kept: RollRecipients = {
    whisper: (stored.whisper ?? []).map(idOf).filter((entry): entry is string => !!entry),
    blind: stored.blind === true,
  };
  if (!sameRecipients(wanted, kept))
    fail(
      'NOT_APPLIED',
      `The roll message [${stored.id}] was stored visible to ${recipientText(kept)} instead of ${recipientText(wanted)}. ` +
        'It stays in the chat, because deleting chat messages is refused.'
    );
  if (!(stored.rolls ?? []).length)
    fail('NOT_APPLIED', `The roll message [${stored.id}] was stored without its roll.`);
  return { messageId: stored.id, rollMode: options.mode, visibleTo: recipientText(kept) };
}

function chatRule(data: unknown) {
  return isRecord(data) && data['toChat'] === true ? CHAT_POST : READ_ONLY;
}

function chatNotes(args: Record<string, unknown>, toChat: boolean): string[] {
  return !toChat && args['rollMode'] !== undefined
    ? ['rollMode was ignored: without toChat nothing is posted.']
    : [];
}

export const rollDice: QueryHandler = {
  access: chatRule,
  run: raw =>
    operation('roll dice', async () => {
      requireWorld();
      const args = argsOf(raw);
      const formula = requiredText(args, 'formula');
      const flavor = optionalText(args, 'flavor')?.trim() ?? '';
      const toChat = optionalBoolean(args, 'toChat') === true;
      const mode = rollModeOf(args);
      const actorText = optionalText(args, 'actorId')?.trim();
      const actor = actorText
        ? (findActor(actorText).actor as unknown as FoundryCombatRollsActor)
        : null;
      const notes = chatNotes(args, toChat);
      if (!actor && formula.includes('@'))
        notes.push(
          'The formula uses @ references but no actorId was given; Foundry counts them as 0.'
        );

      const RollClass = rollClassOf();
      checkFormula(RollClass, formula);
      const roll = new RollClass(formula, rollDataOf(actor));
      await evaluateRoll(roll, `The formula "${formula}"`);
      const user = game.user as FoundryUser;
      const chat = toChat
        ? await postRoll(roll, {
            flavor,
            mode,
            speaker: actor ? { actor: actor.id, alias: actor.name ?? '' } : { alias: user.name },
          })
        : null;
      return {
        success: true,
        ...summarizeRoll(roll),
        requestedFormula: formula,
        actor: actor ? { id: actor.id, name: actor.name ?? '' } : null,
        chat,
        ...(notes.length ? { notes } : {}),
      };
    }),
};

export const rollActorCheck: QueryHandler = {
  access: chatRule,
  run: raw =>
    operation('roll actor check', async () => {
      requireWorld();
      const args = argsOf(raw);
      const rollType = requiredText(args, 'rollType');
      const rollTarget = optionalText(args, 'rollTarget')?.trim();
      const rollModifier = optionalText(args, 'rollModifier')?.trim();
      const flavor = optionalText(args, 'flavor')?.trim();
      const toChat = optionalBoolean(args, 'toChat') === true;
      const mode = rollModeOf(args);
      const system = activeGameSystem();

      let rolls;
      try {
        rolls = requireSystemQuestions('rolls', `Rolling "${rollType}" for an actor`);
      } catch (error) {
        if (error instanceof QueryError && error.code === 'SYSTEM_NOT_SUPPORTED')
          throw new QueryError(
            error.code,
            `${error.message} roll-dice rolls a free formula in any system.`
          );
        throw error;
      }
      const offered = rolls.types.find(type => type.id === rollType);
      if (!offered) {
        const list = rolls.types
          .map(
            type =>
              `${type.id} (${type.description}${type.targets?.length ? `; targets: ${type.targets.join(', ')}` : ''})`
          )
          .join('; ');
        fail(
          'INVALID_ARGUMENT',
          `The roll type "${rollType}" is not offered for the game system "${system.rawId}". Roll types: ${list}.`
        );
      }

      const match = findActor(requiredText(args, 'actorId'));
      const actor = match.actor as unknown as FoundryCombatRollsActor;
      const rollData = rollDataOf(actor);
      const request: RollRequest = {
        rollType,
        ...(rollTarget ? { rollTarget } : {}),
        ...(rollModifier ? { rollModifier } : {}),
      };
      let plan;
      try {
        plan = rolls.plan(request, { ...adapterData(actor), rollData });
      } catch (error) {
        if (error instanceof QueryError) throw error;
        return fail(
          'INVALID_ARGUMENT',
          `The adapter "${system.title}" could not build the roll: ${messageOf(error)}`
        );
      }

      const RollClass = rollClassOf();
      checkFormula(RollClass, plan.formula);
      const roll = new RollClass(plan.formula, rollData);
      await evaluateRoll(roll, `The ${rollType} roll of "${actor.name ?? actor.id}"`);
      const chat = toChat
        ? await postRoll(roll, {
            flavor:
              flavor ||
              chatTexts.text('checkFlavor', { actor: actor.name ?? '', label: plan.label }),
            mode,
            speaker: { actor: actor.id, alias: actor.name ?? '' },
          })
        : null;
      const notes = chatNotes(args, toChat);
      return {
        success: true,
        actor: {
          id: actor.id,
          name: actor.name ?? '',
          ...(match.token ? { viaToken: match.token } : {}),
        },
        gameSystem: system.rawId,
        adapter: system.title,
        rollType,
        rollTarget: rollTarget ?? null,
        label: plan.label,
        ...summarizeRoll(roll),
        chat,
        ...(notes.length ? { notes } : {}),
      };
    }),
};
