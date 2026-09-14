/**
 * Card stacks: list, read, create, shuffle, draw, deal, pass, reset, delete.
 *
 * - Every move goes through Foundry's own methods (`shuffle`, `draw`, `deal`,
 *   `pass`, `recall`), so the rules of the core, the system and modules apply.
 * - Before a move the needed cards are counted; after it every moved card is
 *   looked up: gone or drawn in the source, present and not drawn in the
 *   target. A count that does not match is an error with both numbers.
 * - Chat messages about moves are off unless asked for.
 * - Stacks are found by id or exact name; two with the same name are an error.
 *   Deleting takes the id only.
 * - Rights: the core kind `Cards`. It has no level yet, so creating and moving
 *   need the write switch and deleting is refused until it gets one.
 */
import { smallEnough } from '../../../common/change-log.js';
import type { Access } from '../../../common/permissions.js';
import { QueryError, type HandlerContext, type QueryHandler } from '../../dispatcher.js';
import { ensureFolderPath, folderCreationFlags, folderPathOf } from '../../folders.js';
import { requireWorld } from '../../world-ready.js';
import { documentClass } from '../chat-tables-macros/lookup.js';
import {
  byIdOrExactName,
  idOf,
  inputOf,
  invalid,
  isRecord,
  listOfTexts,
  messageOf,
  notFoundById,
  optionalBoolean,
  optionalChoice,
  optionalInteger,
  optionalText,
  requiredText,
  textOf,
} from './common.js';

export const CARDS_CREATE: Access = { kind: 'write', document: 'Cards', action: 'create' };
export const CARDS_UPDATE: Access = { kind: 'write', document: 'Cards', action: 'update' };
export const CARDS_DELETE: Access = { kind: 'write', document: 'Cards', action: 'delete' };

export const STACK_TYPES = ['deck', 'hand', 'pile'] as const;
export const DRAW_MODES = ['top', 'bottom', 'random'] as const;
export const MAX_CARDS = 1000;

type Stack = FoundryWorldFilesDecksStack;
type Card = FoundryWorldFilesDecksCard;

const stacks = () => game.cards as unknown as FoundryCollection<Stack>;

export function findStack(ref: string, parameter: string): Stack {
  const stack = byIdOrExactName<Stack>(game.cards, ref, 'card stack');
  if (!stack)
    throw new QueryError(
      'NOT_FOUND',
      `${parameter}: card stack "${ref}" not found by id or exact name. list-card-stacks shows every stack with its id.`
    );
  return stack;
}

function cardsOf(stack: Stack): Card[] {
  return [...stack.cards.values()].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
}

/** The cards that can still leave a stack: in a deck only those not drawn. */
function available(stack: Stack): Card[] {
  return cardsOf(stack).filter(card => stack.type !== 'deck' || card.drawn !== true);
}

function isAvailableIn(stack: Stack, id: string): boolean {
  const card = stack.cards.get(id);
  return !!card && (stack.type !== 'deck' || card.drawn !== true);
}

function summary(stack: Stack) {
  const all = cardsOf(stack);
  const folderId = idOf(stack.folder);
  return {
    id: stack.id,
    name: stack.name ?? '',
    type: stack.type ?? 'unknown',
    cards: all.length,
    available: available(stack).length,
    drawn: stack.type === 'deck' ? all.filter(card => card.drawn === true).length : 0,
    folder: folderId ? folderPathOf(folderId).path || null : null,
  };
}

type CardFace = { name?: string; text?: string; img?: string };

/**
 * The saved data of a card. Foundry shows a card that lies face down under a
 * label like "Unbekannt (<stack>)" in `name`; the source keeps what the card
 * is (seen in a real world). Tools read names, faces, suit and
 * value from here, because the Gamemaster may see every card.
 */
function sourceOf(card: Card): Record<string, unknown> {
  if (isRecord(card._source)) return card._source;
  try {
    return card.toObject();
  } catch {
    return {};
  }
}

function sourceName(card: Card): string {
  const name = sourceOf(card)['name'];
  return typeof name === 'string' ? name : (card.name ?? '');
}

function facesOf(source: Record<string, unknown>, card: Card): CardFace[] {
  const faces = Array.isArray(source['faces']) ? source['faces'] : card.faces;
  return Array.isArray(faces) ? (faces.filter(isRecord) as CardFace[]) : [];
}

function cardRow(card: Card) {
  const source = sourceOf(card);
  const faces = facesOf(source, card);
  const faceIndex =
    typeof source['face'] === 'number'
      ? source['face']
      : typeof card.face === 'number'
        ? card.face
        : null;
  const face = faceIndex === null ? undefined : faces[faceIndex];
  const name = sourceName(card);
  const shown = card.name ?? '';
  const originId = idOf(card.origin);
  return {
    id: card.id,
    name,
    ...(shown && shown !== name ? { shownAs: shown } : {}),
    suit: textOf(source['suit']) || card.suit || null,
    value:
      typeof source['value'] === 'number'
        ? source['value']
        : typeof card.value === 'number'
          ? card.value
          : null,
    drawn: card.drawn === true,
    faceUp: faceIndex !== null,
    faceDown: faceIndex === null,
    text: face?.text || faces[0]?.text || null,
    img: face?.img || faces[0]?.img || null,
    origin: originId ? { id: originId, name: stacks().get(originId)?.name ?? null } : null,
  };
}

/** What differs between the cards as stored and as sent, in their stored order. */
function cardMismatches(
  stored: readonly Card[],
  sent: ReadonlyArray<Record<string, unknown>>
): string[] {
  const problems: string[] = [];
  if (stored.length !== sent.length)
    problems.push(`${stored.length} cards instead of ${sent.length}`);
  stored.slice(0, sent.length).forEach((card, index) => {
    const source = sourceOf(card);
    const wanted = sent[index] as Record<string, unknown>;
    const label = `card ${index + 1} ("${textOf(wanted['name'])}")`;
    const compare = (field: string, actual: unknown, expected: unknown) => {
      if (actual !== expected)
        problems.push(
          `${label} has ${field} ${JSON.stringify(actual)} instead of ${JSON.stringify(expected)}`
        );
    };
    compare('name', sourceName(card), wanted['name']);
    compare('suit', textOf(source['suit']), textOf(wanted['suit']));
    compare(
      'value',
      typeof source['value'] === 'number' ? source['value'] : null,
      typeof wanted['value'] === 'number' ? wanted['value'] : null
    );
    const wantedFace = (wanted['faces'] as CardFace[] | undefined)?.[0]?.name ?? '';
    compare('face name', facesOf(source, card)[0]?.name ?? '', wantedFace);
  });
  return problems;
}

export const listCardStacks: QueryHandler = {
  access: { kind: 'read' },
  run: data => {
    requireWorld();
    const type = optionalChoice(inputOf(data), 'type', STACK_TYPES);
    return {
      stacks: stacks()
        .filter(stack => !type || stack.type === type)
        .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
        .map(summary),
    };
  },
};

export const getCardStack: QueryHandler = {
  access: { kind: 'read' },
  run: data => {
    requireWorld();
    const input = inputOf(data);
    const stack = findStack(requiredText(input, 'stackId'), 'stackId');
    const includeDrawn = optionalBoolean(input, 'includeDrawn') !== false;
    const cards = includeDrawn ? cardsOf(stack) : available(stack);
    return { ...summary(stack), description: stack.description ?? '', list: cards.map(cardRow) };
  },
};

interface CardInput {
  name: string;
  text?: string;
  img?: string;
  suit?: string;
  value?: number;
}

function cardInputs(raw: unknown): CardInput[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw invalid('cards must be a list');
  if (raw.length > MAX_CARDS)
    throw invalid(`cards holds ${raw.length} entries; at most ${MAX_CARDS}`);
  return raw.map((entry, index) => {
    if (!isRecord(entry)) throw invalid(`cards[${index}] must be an object with a name`);
    const name = textOf(entry['name']);
    if (!name) throw invalid(`cards[${index}].name is required`);
    const card: CardInput = { name };
    for (const key of ['text', 'img', 'suit'] as const) {
      const value = entry[key];
      if (value === undefined || value === null) continue;
      if (typeof value !== 'string') throw invalid(`cards[${index}].${key} must be a text`);
      if (value.trim()) card[key] = value.trim();
    }
    const value = entry['value'];
    if (value !== undefined && value !== null) {
      if (typeof value !== 'number' || !Number.isFinite(value))
        throw invalid(`cards[${index}].value must be a number`);
      card.value = value;
    }
    return card;
  });
}

export const createCardStack: QueryHandler = {
  access: CARDS_CREATE,
  run: async (data, context) => {
    requireWorld();
    const input = inputOf(data);
    const name = requiredText(input, 'name');
    const type = optionalChoice(input, 'type', STACK_TYPES) ?? 'deck';
    const cards = cardInputs(input['cards']);
    if (type === 'deck' && !cards.length) throw invalid('A deck needs at least one card in cards');
    const description = optionalText(input, 'description');
    const img = optionalText(input, 'img')?.trim();
    const backImg = optionalText(input, 'backImg')?.trim();
    const StackClass = documentClass('Cards');

    const folder = await ensureFolderPath(textOf(input['folderPath']), {
      type: 'Cards',
      context,
      query: 'createCardStack',
      tool: 'create-card-deck',
    });
    const source: Record<string, unknown> = {
      name,
      type,
      folder: folder.id,
      flags: { 'ninjos-foundry-mcp': folderCreationFlags() },
      cards: cards.map((card, index) => ({
        name: card.name,
        type: 'base',
        ...(card.suit ? { suit: card.suit } : {}),
        ...(card.value !== undefined ? { value: card.value } : {}),
        faces: [{ name: card.name, text: card.text ?? '', img: card.img ?? '' }],
        ...(backImg ? { back: { img: backImg } } : {}),
        drawn: false,
        sort: (index + 1) * 100,
      })),
    };
    if (description !== undefined) source['description'] = description;
    if (img) source['img'] = img;

    let made: unknown;
    try {
      made = await StackClass.create(source);
    } catch (error) {
      throw new QueryError(
        'CREATE_FAILED',
        `Foundry refused the card stack "${name}": ${messageOf(error)}`
      );
    }
    const id = idOf(made);
    const stored = id ? stacks().get(id) : undefined;
    if (!stored)
      throw new QueryError(
        'NOT_APPLIED',
        `Foundry did not report the card stack "${name}", and none is there when read back.`
      );
    // Compared with the saved data: Foundry names a face-down card "Unknown (<stack>)".
    const storedCards = cardsOf(stored);
    const problems = cardMismatches(storedCards, source['cards'] as Array<Record<string, unknown>>);
    if (stored.type !== type || problems.length) {
      throw new QueryError(
        'NOT_APPLIED',
        `The card stack "${name}" (id ${stored.id}) was created, but reads back as a ${String(stored.type)} with ` +
          `${storedCards.length} cards instead of a ${type} with ${cards.length} in the given order` +
          (problems.length ? `: ${problems.slice(0, 5).join('; ')}` : '') +
          '.'
      );
    }
    context.recordChange({
      query: 'createCardStack',
      tool: 'create-card-deck',
      document: 'Cards',
      action: 'create',
      targets: [{ id: stored.id, uuid: stored.uuid, name }],
      summary: `Created the ${type} "${name}" with ${cards.length} cards.`,
      after: smallEnough(stored.toObject()),
    });
    return { ...summary(stored), foldersCreated: folder.created.map(entry => entry.path) };
  },
};

function drawMode(how: (typeof DRAW_MODES)[number]): number {
  const modes = (globalThis as { CONST?: { CARD_DRAW_MODES?: Record<string, number> } }).CONST
    ?.CARD_DRAW_MODES;
  const value = modes?.[how.toUpperCase()];
  if (typeof value !== 'number')
    throw new QueryError(
      'NOT_AVAILABLE',
      `Foundry's CONST.CARD_DRAW_MODES has no mode ${how.toUpperCase()}`
    );
  return value;
}

function method<K extends 'shuffle' | 'deal' | 'draw' | 'pass'>(
  stack: Stack,
  name: K
): NonNullable<Stack[K]> {
  const fn = stack[name];
  if (typeof fn !== 'function')
    throw new QueryError('NOT_AVAILABLE', `Foundry's Cards#${name} is not available`);
  return fn.bind(stack) as NonNullable<Stack[K]>;
}

function moveOptions(input: Record<string, unknown>) {
  return { chatNotification: optionalBoolean(input, 'chatNotification') === true };
}

function refused(stack: Stack, error: unknown, doing: string): QueryError {
  return new QueryError(
    'MOVE_FAILED',
    `Foundry refused to ${doing} for "${stack.name}" (id ${stack.id}): ${messageOf(error)}`
  );
}

/** The cards that left `from`, and whether each arrived in one of the targets. */
function verifyMove(from: Stack, beforeIds: readonly string[], targets: readonly Stack[]) {
  const moved = beforeIds.filter(id => !isAvailableIn(from, id));
  const lost = moved.filter(id => !targets.some(target => isAvailableIn(target, id)));
  return { moved, lost };
}

function recordMove(
  context: HandlerContext,
  query: string,
  tool: string,
  stacksTouched: Stack[],
  summaryText: string,
  before: unknown
): void {
  context.recordChange({
    query,
    tool,
    document: 'Cards',
    action: 'update',
    targets: stacksTouched.map(stack => ({
      id: stack.id,
      uuid: stack.uuid,
      name: stack.name ?? '',
    })),
    summary: summaryText,
    before: smallEnough(before),
    after: smallEnough(stacksTouched.map(stack => stack.toObject())),
  });
}

export const shuffleCardStack: QueryHandler = {
  access: CARDS_UPDATE,
  run: async (data, context) => {
    requireWorld();
    const input = inputOf(data);
    const stack = findStack(requiredText(input, 'stackId'), 'stackId');
    const before = cardsOf(stack).map(card => card.id);
    const snapshot = [stack.toObject()];
    try {
      await method(stack, 'shuffle')(moveOptions(input));
    } catch (error) {
      throw refused(stack, error, 'shuffle');
    }
    const after = cardsOf(stack).map(card => card.id);
    if (after.length !== before.length || after.some(id => !before.includes(id))) {
      throw new QueryError(
        'NOT_APPLIED',
        `After shuffling, "${stack.name}" holds ${after.length} cards instead of the same ${before.length}.`
      );
    }
    const orderChanged = after.some((id, index) => id !== before[index]);
    recordMove(
      context,
      'shuffleCardStack',
      'shuffle-card-stack',
      [stack],
      `Shuffled "${stack.name}".`,
      snapshot
    );
    return { ...summary(stack), orderChanged };
  },
};

function numberOf(input: Record<string, unknown>): number {
  return optionalInteger(input, 'number', 1, MAX_CARDS) ?? 1;
}

function needAvailable(from: Stack, needed: number): void {
  const count = available(from).length;
  if (count < needed)
    throw new QueryError(
      'NOT_ENOUGH_CARDS',
      `"${from.name}" (id ${from.id}) has ${count} card(s) left to hand out; ${needed} are needed. Nothing was moved.`
    );
}

export const drawCards: QueryHandler = {
  access: CARDS_UPDATE,
  run: async (data, context) => {
    requireWorld();
    const input = inputOf(data);
    const from = findStack(requiredText(input, 'from'), 'from');
    const to = findStack(requiredText(input, 'to'), 'to');
    if (from.id === to.id) throw invalid('from and to are the same card stack');
    const number = numberOf(input);
    const how = optionalChoice(input, 'how', DRAW_MODES) ?? 'top';
    needAvailable(from, number);
    const mode = drawMode(how);
    const beforeIds = available(from).map(card => card.id);
    const snapshot = [from.toObject(), to.toObject()];
    try {
      await method(to, 'draw')(from, number, { how: mode, ...moveOptions(input) });
    } catch (error) {
      throw refused(to, error, `draw ${number} card(s) from "${from.name}"`);
    }
    const { moved, lost } = verifyMove(from, beforeIds, [to]);
    if (moved.length !== number || lost.length) {
      throw new QueryError(
        'NOT_APPLIED',
        `Drawing ${number} card(s) from "${from.name}" into "${to.name}" moved ${moved.length}` +
          (lost.length ? `, and ${lost.length} are not in "${to.name}" when read back` : '') +
          '.'
      );
    }
    recordMove(
      context,
      'drawCards',
      'draw-cards',
      [from, to],
      `Drew ${number} card(s) from "${from.name}" into "${to.name}".`,
      snapshot
    );
    return {
      from: summary(from),
      to: summary(to),
      cards: moved.map(id => cardRow(to.cards.get(id) as Card)),
    };
  },
};

export const dealCards: QueryHandler = {
  access: CARDS_UPDATE,
  run: async (data, context) => {
    requireWorld();
    const input = inputOf(data);
    const from = findStack(requiredText(input, 'from'), 'from');
    const refs = listOfTexts(input, 'to');
    if (!refs?.length) throw invalid('to must name at least one card stack');
    const targets = refs.map((ref, index) => findStack(ref, `to[${index}]`));
    const ids = targets.map(target => target.id);
    if (new Set(ids).size !== ids.length) throw invalid('to names the same card stack twice');
    if (ids.includes(from.id)) throw invalid('to must not contain the stack dealt from');
    const number = numberOf(input);
    const how = optionalChoice(input, 'how', DRAW_MODES) ?? 'top';
    needAvailable(from, number * targets.length);
    const mode = drawMode(how);
    const beforeIds = available(from).map(card => card.id);
    const beforeTargets = targets.map(target => new Set(available(target).map(card => card.id)));
    const snapshot = [from.toObject(), ...targets.map(target => target.toObject())];
    try {
      await method(from, 'deal')(targets, number, { how: mode, ...moveOptions(input) });
    } catch (error) {
      throw refused(from, error, `deal ${number} card(s) to ${targets.length} stack(s)`);
    }
    const { moved, lost } = verifyMove(from, beforeIds, targets);
    const perTarget = targets.map((target, index) =>
      moved.filter(id => isAvailableIn(target, id) && !beforeTargets[index]?.has(id))
    );
    const wrong = targets.filter((_, index) => perTarget[index]?.length !== number);
    if (moved.length !== number * targets.length || lost.length || wrong.length) {
      throw new QueryError(
        'NOT_APPLIED',
        `Dealing ${number} card(s) to each of ${targets.length} stack(s) moved ${moved.length} from "${from.name}"` +
          (lost.length ? `, ${lost.length} arrived nowhere` : '') +
          (wrong.length
            ? `, and ${wrong.map(t => `"${t.name}"`).join(', ')} did not get exactly ${number}`
            : '') +
          '.'
      );
    }
    recordMove(
      context,
      'dealCards',
      'deal-cards',
      [from, ...targets],
      `Dealt ${number} card(s) from "${from.name}" to ${targets.map(t => `"${t.name}"`).join(', ')}.`,
      snapshot
    );
    return {
      from: summary(from),
      dealt: targets.map((target, index) => ({
        ...summary(target),
        received: (perTarget[index] ?? []).map(id => cardRow(target.cards.get(id) as Card)),
      })),
    };
  },
};

export const passCards: QueryHandler = {
  access: CARDS_UPDATE,
  run: async (data, context) => {
    requireWorld();
    const input = inputOf(data);
    const from = findStack(requiredText(input, 'from'), 'from');
    const to = findStack(requiredText(input, 'to'), 'to');
    if (from.id === to.id) throw invalid('from and to are the same card stack');
    const refs = listOfTexts(input, 'cardIds');
    if (!refs?.length) throw invalid('cardIds must name at least one card');
    const ids = refs.map(ref => {
      if (isAvailableIn(from, ref)) return ref;
      const named = available(from).filter(card => sourceName(card) === ref);
      if (named.length === 1) return (named[0] as Card).id;
      if (named.length > 1)
        throw new QueryError(
          'AMBIGUOUS',
          `${named.length} cards in "${from.name}" are named "${ref}": ${named.map(c => c.id).join(', ')}. Pass the id.`
        );
      throw new QueryError(
        'NOT_FOUND',
        `No card "${ref}" can leave "${from.name}" (id ${from.id}): not there by id or exact name, or already drawn. Nothing was moved.`
      );
    });
    if (new Set(ids).size !== ids.length) throw invalid('cardIds names the same card twice');
    const snapshot = [from.toObject(), to.toObject()];
    try {
      await method(from, 'pass')(to, ids, moveOptions(input));
    } catch (error) {
      throw refused(from, error, `pass ${ids.length} card(s) to "${to.name}"`);
    }
    const { moved, lost } = verifyMove(from, ids, [to]);
    if (moved.length !== ids.length || lost.length) {
      throw new QueryError(
        'NOT_APPLIED',
        `Passing ${ids.length} card(s) from "${from.name}" to "${to.name}" moved ${moved.length}` +
          (lost.length ? `, and ${lost.length} are not in "${to.name}" when read back` : '') +
          '.'
      );
    }
    recordMove(
      context,
      'passCards',
      'pass-cards',
      [from, to],
      `Passed ${ids.length} card(s) from "${from.name}" to "${to.name}".`,
      snapshot
    );
    return {
      from: summary(from),
      to: summary(to),
      cards: ids.map(id => cardRow(to.cards.get(id) as Card)),
    };
  },
};

export const resetCardStack: QueryHandler = {
  access: CARDS_UPDATE,
  run: async (data, context) => {
    requireWorld();
    const input = inputOf(data);
    const stack = findStack(requiredText(input, 'stackId'), 'stackId');
    const touched =
      stack.type === 'deck'
        ? stacks().filter(
            other =>
              other.id === stack.id || cardsOf(other).some(card => idOf(card.origin) === stack.id)
          )
        : [
            stack,
            ...stacks().filter(other =>
              cardsOf(stack).some(card => idOf(card.origin) === other.id)
            ),
          ];
    const snapshot = touched.map(entry => entry.toObject());
    const recall = typeof stack.recall === 'function' ? stack.recall : stack.reset;
    if (typeof recall !== 'function')
      throw new QueryError('NOT_AVAILABLE', "Foundry's Cards#recall is not available");
    try {
      await recall.call(stack, moveOptions(input));
    } catch (error) {
      throw refused(stack, error, 'reset');
    }
    if (stack.type === 'deck') {
      const stillDrawn = cardsOf(stack).filter(card => card.drawn === true).length;
      const elsewhere = stacks()
        .filter(other => other.id !== stack.id)
        .reduce(
          (sum, other) =>
            sum + cardsOf(other).filter(card => idOf(card.origin) === stack.id).length,
          0
        );
      if (stillDrawn || elsewhere)
        throw new QueryError(
          'NOT_APPLIED',
          `After resetting the deck "${stack.name}", ${stillDrawn} card(s) are still marked drawn and ${elsewhere} are still in other stacks.`
        );
    } else if (stack.cards.size) {
      throw new QueryError(
        'NOT_APPLIED',
        `After resetting "${stack.name}", it still holds ${stack.cards.size} card(s).`
      );
    }
    recordMove(
      context,
      'resetCardStack',
      'reset-card-stack',
      touched,
      `Reset "${stack.name}".`,
      snapshot
    );
    return summary(stack);
  },
};

export const deleteCardStack: QueryHandler = {
  access: CARDS_DELETE,
  run: async (data, context) => {
    requireWorld();
    const id = requiredText(inputOf(data), 'stackId');
    const stack = stacks().get(id);
    if (!stack) throw notFoundById(game.cards, id, 'Card stack');
    const before = stack.toObject();
    try {
      await stack.delete();
    } catch (error) {
      throw new QueryError(
        'DELETE_FAILED',
        `Foundry refused to delete "${stack.name}" (id ${id}): ${messageOf(error)}`
      );
    }
    if (stacks().get(id))
      throw new QueryError(
        'NOT_APPLIED',
        `The card stack "${stack.name}" (id ${id}) is still there after deleting.`
      );
    context.recordChange({
      query: 'deleteCardStack',
      tool: 'delete-card-stack',
      document: 'Cards',
      action: 'delete',
      targets: [{ id, uuid: stack.uuid, name: stack.name ?? '' }],
      summary: `Deleted the card stack "${stack.name}".`,
      before: smallEnough(before),
    });
    return { id, name: stack.name ?? '', deleted: true };
  },
};
