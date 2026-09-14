/**
 * The roll button in the chat, on every client.
 *
 * The card is drawn from the request record in the message's flags each time
 * the message renders, in the language of the client that looks at it. Who may
 * press it and which formula is rolled come from that record, never from the
 * button a browser shows, which a player can edit.
 *
 * Completion without trusting a player: a roll answers with its own chat
 * message that points at the request. Foundry's server stamps that message
 * with its real author. One Gamemaster client (Foundry's active Gamemaster)
 * checks author, formula and visibility and only then marks the request done.
 * No socket message is read at all, so no client can claim a roll it did not
 * make. Rolls made while no Gamemaster was online are confirmed when one
 * arrives (`confirmOpenRollResults` at ready).
 */
import { MODULE_ID } from '../../../common/constants.js';
import {
  checkRollResult,
  readRollRequest,
  readRollResult,
  ROLL_REQUEST_FLAG,
  ROLL_RESULT_FLAG,
  type RollRequestRecord,
} from '../../../common/areas/tokens-dice/roll-request.js';
import { escapeHtml, icon } from '../interface/html.js';
import {
  chatMessageClass,
  gamemasterIds,
  moduleFlagsOf,
  rollClass,
  targetLine,
  visibilityLine,
} from './rolls.js';
import { idOf, messageOf } from './support.js';
import { notifyRoll, rollText } from './texts.js';

/** The part of a DOM element the card uses; a real HTMLElement and the test tree both fit. */
export interface CardElement {
  innerHTML: string;
  textContent: string | null;
  querySelector(selector: string): CardElement | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  hasAttribute(name: string): boolean;
  addEventListener(type: string, listener: (event: { preventDefault?(): void }) => void): void;
}

function messages(): FoundryTokensDiceMessage[] {
  return (game.messages?.contents ?? []) as FoundryTokensDiceMessage[];
}

function authorOf(message: FoundryTokensDiceMessage): FoundryUser | null {
  const id = idOf(message.author) ?? idOf(message.user);
  return id ? (game.users?.get(id) ?? null) : null;
}

/** The first roll made for a request, in the order of the chat, as far as this client can see it. */
function resultsFor(record: RollRequestRecord): FoundryTokensDiceMessage[] {
  return messages()
    .filter(message => readRollResult(moduleFlagsOf(message))?.requestId === record.requestId)
    .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
}

function mayRoll(record: RollRequestRecord): boolean {
  const user = game.user;
  return !!user && (user.isGM || user.id === record.targetUserId);
}

/** Foundry's active Gamemaster confirms; without that notion, the online Gamemaster with the lowest id. */
export function isConfirmingGamemaster(): boolean {
  const me = game.user;
  if (!me?.isGM) return false;
  const users = game.users as unknown as { activeGM?: { id: string } | null } | undefined;
  if (users && 'activeGM' in users && users.activeGM !== undefined)
    return users.activeGM?.id === me.id;
  const online = gamemasterIds(true).sort();
  return online.length === 0 || online[0] === me.id;
}

function time(iso: string | undefined): string {
  const date = iso ? new Date(iso) : new Date();
  const lang = (game.i18n as { lang?: unknown }).lang;
  try {
    return date.toLocaleString(typeof lang === 'string' && lang ? lang : undefined);
  } catch {
    return date.toISOString();
  }
}

const paragraph = (text: string, extra = '') => `<p${extra}>${escapeHtml(text)}</p>`;

export function cardHtml(record: RollRequestRecord): string {
  const parts = [
    `<p class="ninjos-mcp-roll-title"><strong>${escapeHtml(rollText('roll.card.title', { label: record.label }))}</strong></p>`,
    paragraph(targetLine(record)),
    ...(record.flavor ? [paragraph(rollText('roll.card.context', { flavor: record.flavor }))] : []),
    paragraph(visibilityLine(record)),
  ];
  const status = ' class="ninjos-mcp-roll-status" role="status"';
  if (record.status === 'completed') {
    parts.push(
      paragraph(
        rollText('roll.card.completed', {
          name: record.rolledByName ?? '',
          time: time(record.rolledAt),
        }),
        status
      )
    );
    if (typeof record.total === 'number')
      parts.push(paragraph(rollText('roll.card.result', { total: record.total }), status));
    return parts.join('');
  }
  const first = resultsFor(record)[0];
  if (first) {
    parts.push(
      paragraph(rollText('roll.card.waiting', { name: authorOf(first)?.name ?? '' }), status)
    );
    return parts.join('');
  }
  const only = record.targetUserName
    ? rollText('roll.card.onlyTarget', { player: record.targetUserName })
    : rollText('roll.card.onlyGm');
  const allowed = mayRoll(record);
  if (!allowed && !record.isPublic) {
    parts.push(paragraph(only, status));
    return parts.join('');
  }
  const title = rollText('roll.card.button', { label: record.label });
  const locked = allowed ? '' : ` disabled aria-disabled="true" title="${escapeHtml(only)}"`;
  parts.push(
    `<button type="button" class="ninjos-mcp-roll-button" data-mcp-roll-button="${escapeHtml(record.requestId)}"${locked}>` +
      `${icon('fa-dice-d20')} ${escapeHtml(title)}</button>`
  );
  if (!allowed) parts.push(paragraph(only, status));
  return parts.join('');
}

/** Hook `renderChatMessageHTML`: draw the card of a roll request into the rendered message. */
export function renderRollCard(message: FoundryTokensDiceMessage, html: unknown): void {
  const record = readRollRequest(moduleFlagsOf(message));
  if (!record || typeof html !== 'object' || html === null) return;
  const root = html as CardElement;
  if (typeof root.querySelector !== 'function') return;
  const box = root.querySelector('[data-mcp-roll-request]');
  if (!box) return;
  box.innerHTML = cardHtml(record);
  const button = box.querySelector('[data-mcp-roll-button]');
  if (!button || button.hasAttribute('disabled')) return;
  button.addEventListener('click', event => {
    event.preventDefault?.();
    void rollFromRequest(message.id, button);
  });
}

const inFlight = new Set<string>();

function showBusy(button: CardElement | null, text: string): void {
  if (!button) return;
  button.setAttribute('disabled', '');
  button.setAttribute('aria-busy', 'true');
  button.textContent = text;
}

function showReady(button: CardElement | null, record: RollRequestRecord): void {
  if (!button) return;
  button.removeAttribute('disabled');
  button.removeAttribute('aria-busy');
  button.innerHTML = `${icon('fa-dice-d20')} ${escapeHtml(rollText('roll.card.button', { label: record.label }))}`;
}

export type RollOutcome = 'rolled' | 'refused' | 'failed' | 'busy' | 'closed';

/** The click: check again, roll the stored formula, post the result with a pointer to the request. */
export async function rollFromRequest(
  messageId: string,
  button: CardElement | null = null
): Promise<RollOutcome> {
  const message = game.messages.get(messageId) as FoundryTokensDiceMessage | undefined;
  const record = message ? readRollRequest(moduleFlagsOf(message)) : null;
  if (!message || !record || record.status !== 'open') return 'closed';
  if (inFlight.has(record.requestId)) return 'busy';
  const user = game.user;
  if (!user || !mayRoll(record)) {
    notifyRoll('notAllowed');
    return 'refused';
  }
  if (resultsFor(record).length) {
    notifyRoll('alreadyRolled');
    showBusy(button, rollText('roll.card.rolling'));
    return 'refused';
  }

  inFlight.add(record.requestId);
  showBusy(button, rollText('roll.card.rolling'));
  try {
    const RollClass = rollClass();
    const roll = new RollClass(record.formula);
    await roll.evaluate();
    const whisper = record.isPublic
      ? []
      : [...new Set([...(record.targetUserId ? [record.targetUserId] : []), ...gamemasterIds()])];
    const byGamemaster = user.isGM && user.id !== record.targetUserId;
    await chatMessageClass().create({
      author: user.id,
      speaker: record.actorId
        ? { actor: record.actorId, alias: record.actorName ?? '' }
        : { alias: user.name },
      flavor: byGamemaster
        ? rollText('roll.resultFlavorGm', { label: record.label })
        : record.label,
      whisper,
      rolls: [roll],
      flags: {
        [MODULE_ID]: {
          [ROLL_RESULT_FLAG]: { requestId: record.requestId, requestMessageId: message.id },
        },
      },
    });
  } catch (error) {
    notifyRoll('rollFailed', { reason: messageOf(error) });
    showReady(button, record);
    return 'failed';
  } finally {
    inFlight.delete(record.requestId);
  }
  if (!user.isGM && gamemasterIds(true).length === 0) notifyRoll('noGamemaster');
  return 'rolled';
}

export type ConfirmOutcome = 'confirmed' | 'ignored' | 'refused' | 'duplicate' | 'failed';

/**
 * Hook `createChatMessage` on the confirming Gamemaster's client: a roll result
 * completes its request only when Foundry's stored author may roll it, the
 * formula is the stored one and a private request was answered privately.
 */
export async function confirmRollResult(
  message: FoundryTokensDiceMessage
): Promise<ConfirmOutcome> {
  const result = readRollResult(moduleFlagsOf(message));
  if (!result || !isConfirmingGamemaster()) return 'ignored';
  const request = game.messages.get(result.requestMessageId) as
    FoundryTokensDiceMessage | undefined;
  const record = request ? readRollRequest(moduleFlagsOf(request)) : null;
  if (!request || !record || record.requestId !== result.requestId) return 'ignored';
  if (record.status === 'completed' && record.resultMessageId === message.id) return 'ignored';

  const author = authorOf(message);
  const name = author?.name ?? idOf(message.author) ?? idOf(message.user) ?? '?';
  const roll = (message.rolls ?? [])[0];
  const check = checkRollResult(record, {
    author: author ? { id: author.id, isGM: author.isGM } : null,
    formula: roll?.formula,
    whispered: (message.whisper ?? []).length > 0,
  });
  if (!check.ok) {
    const data = { name, label: record.label };
    if (check.reason === 'completed') notifyRoll('duplicateRoll', data);
    else if (check.reason === 'notAllowed') notifyRoll('foreignRoll', data);
    else if (check.reason === 'visibility') notifyRoll('visibilityMismatch', data);
    else
      notifyRoll('formulaMismatch', {
        ...data,
        used: String(roll?.formula ?? ''),
        expected: record.formula,
      });
    return check.reason === 'completed' ? 'duplicate' : 'refused';
  }

  const completed: RollRequestRecord = {
    ...record,
    status: 'completed',
    rolledBy: author?.id ?? '',
    rolledByName: author?.name ?? '',
    rolledAt: new Date(message.timestamp ?? Date.now()).toISOString(),
    resultMessageId: message.id,
    total: typeof roll?.total === 'number' ? roll.total : null,
  };
  try {
    await request.update({ [`flags.${MODULE_ID}.${ROLL_REQUEST_FLAG}`]: completed });
  } catch (error) {
    notifyRoll('completeFailed', { label: record.label, reason: messageOf(error) });
    return 'failed';
  }
  const stored = readRollRequest(moduleFlagsOf(game.messages.get(request.id)));
  if (stored?.status !== 'completed' || stored.resultMessageId !== message.id) {
    notifyRoll('completeFailed', {
      label: record.label,
      reason: 'the chat message did not keep the new state',
    });
    return 'failed';
  }
  return 'confirmed';
}

/**
 * At ready, on the confirming Gamemaster: rolls made while no Gamemaster was
 * online. Only requests open at this moment are looked at, so an old duplicate
 * does not warn again after every reload.
 */
export async function confirmOpenRollResults(): Promise<ConfirmOutcome[]> {
  if (!isConfirmingGamemaster()) return [];
  const open = new Set(
    messages()
      .map(message => readRollRequest(moduleFlagsOf(message)))
      .filter((record): record is RollRequestRecord => record?.status === 'open')
      .map(record => record.requestId)
  );
  const pending = messages()
    .filter(message => {
      const result = readRollResult(moduleFlagsOf(message));
      return !!result && open.has(result.requestId);
    })
    .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  const outcomes: ConfirmOutcome[] = [];
  for (const message of pending) outcomes.push(await confirmRollResult(message));
  return outcomes;
}

const installed = new WeakSet<object>();

/** Hooks of the card, once per Foundry session. */
export function installRollHooks(): void {
  if (typeof Hooks === 'undefined' || installed.has(Hooks)) return;
  installed.add(Hooks);
  Hooks.on('renderChatMessageHTML', (message: FoundryTokensDiceMessage, html: unknown) =>
    renderRollCard(message, html)
  );
  Hooks.on('createChatMessage', (message: FoundryTokensDiceMessage) => {
    confirmRollResult(message).catch(error =>
      console.error('ninjos-foundry-mcp | confirming a roll failed', error)
    );
  });
}
