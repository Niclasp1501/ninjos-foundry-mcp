/**
 * Card stacks: list-card-stacks, get-card-stack, create-card-deck, shuffle-card-stack,
 * draw-cards, deal-cards, pass-cards, reset-card-stack, delete-card-stack.
 */
import { readOnlyTool, writingTool, type ToolDefinition } from '../../tools/types.js';
import { ask, isRecord, listOf, param, pick, schema, str, unknownShape } from './shared.js';

const CHAT = param('boolean', "Post Foundry's chat message about the move (default false)");
const HOW = param('string', 'Which cards: top (default), bottom or random', {
  enum: ['top', 'bottom', 'random'],
});
const STACK = (what: string) => param('string', `${what}: id or exact name of the card stack`);

function stackLine(stack: unknown): string {
  if (!isRecord(stack)) return 'unknown stack';
  const drawn = Number(stack['drawn']) > 0 ? `, ${String(stack['drawn'])} drawn` : '';
  return `[${str(stack['id'])}] ${str(stack['name'])} (${str(stack['type'])}, ${String(stack['cards'])} cards, ${String(stack['available'])} available${drawn})`;
}

function cardLine(card: unknown): string {
  if (!isRecord(card)) return 'unknown card';
  const notes = [
    ...(str(card['suit']) ? [str(card['suit'])] : []),
    ...(typeof card['value'] === 'number' ? [`value ${card['value']}`] : []),
    ...(card['drawn'] === true ? ['drawn'] : []),
    ...(isRecord(card['origin'])
      ? [`from ${str(card['origin']['name'], str(card['origin']['id']))}`]
      : []),
  ];
  return `[${str(card['id'])}] ${str(card['name'])}${notes.length ? ` (${notes.join(', ')})` : ''}`;
}

export const listCardStacksTool: ToolDefinition = {
  name: 'list-card-stacks',
  title: 'List card stacks',
  group: 'cards',
  description: 'List the card decks, hands and piles of the world with their card counts.',
  inputSchema: schema({
    type: param('string', 'Only this type', { enum: ['deck', 'hand', 'pile'] }),
  }),
  annotations: readOnlyTool('List card stacks'),
  handler: async (args, context) => {
    const answer = await ask(context, 'listCardStacks', pick(args, ['type']), 'list card stacks');
    if (!isRecord(answer) || !Array.isArray(answer['stacks'])) return unknownShape(answer);
    return answer['stacks'].length
      ? answer['stacks'].map(stackLine).join('\n')
      : 'No card stacks match.';
  },
};

export const getCardStackTool: ToolDefinition = {
  name: 'get-card-stack',
  title: 'Read a card stack',
  group: 'cards',
  description:
    'Read one card stack with its cards in order: name, suit, value, drawn, text, image and origin.',
  inputSchema: schema(
    {
      stackId: STACK('The stack'),
      includeDrawn: param('boolean', 'Include drawn cards of a deck (default true)'),
    },
    ['stackId']
  ),
  annotations: readOnlyTool('Read a card stack'),
  handler: async (args, context) => {
    const answer = await ask(
      context,
      'getCardStack',
      pick(args, ['stackId', 'includeDrawn']),
      'read card stack'
    );
    if (!isRecord(answer) || !Array.isArray(answer['list'])) return unknownShape(answer);
    return [stackLine(answer), ...answer['list'].map(card => `  ${cardLine(card)}`)].join('\n');
  },
};

export const createCardDeckTool: ToolDefinition = {
  name: 'create-card-deck',
  title: 'Create a card deck',
  group: 'cards',
  description:
    'Create a card deck from a list of cards (or an empty hand or pile to deal into). Each card has a name and ' +
    'optionally text, image, suit and value. Read back with the cards in the given order.',
  inputSchema: schema(
    {
      name: param('string', 'Name of the stack'),
      type: param('string', 'deck (default), hand or pile', { enum: ['deck', 'hand', 'pile'] }),
      cards: param('array', 'The cards, at most 1000; a deck needs at least one', {
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            text: { type: 'string' },
            img: { type: 'string' },
            suit: { type: 'string' },
            value: { type: 'number' },
          },
          required: ['name'],
        },
      }),
      description: param('string', 'Description of the stack'),
      img: param('string', 'Image of the stack'),
      backImg: param('string', 'Back image for every card'),
      folderPath: param(
        'string',
        'Folder for the stack; nested levels separated by "/" are created'
      ),
    },
    ['name']
  ),
  annotations: writingTool('Create a card deck', { destructive: false, idempotent: false }),
  handler: async (args, context) => {
    const answer = await ask(
      context,
      'createCardStack',
      pick(args, ['name', 'type', 'cards', 'description', 'img', 'backImg', 'folderPath']),
      'create card deck'
    );
    if (!isRecord(answer) || typeof answer['id'] !== 'string') return unknownShape(answer);
    const lines = [`Created and read back: ${stackLine(answer)}.`];
    const folders = listOf(answer['foldersCreated']).map(String);
    if (folders.length) lines.push(`Folders created: ${folders.join(', ')}`);
    return lines.join('\n');
  },
};

export const shuffleCardStackTool: ToolDefinition = {
  name: 'shuffle-card-stack',
  title: 'Shuffle a card stack',
  group: 'cards',
  description: 'Shuffle the cards of a stack through Foundry. Needs the write switch.',
  inputSchema: schema({ stackId: STACK('The stack'), chatNotification: CHAT }, ['stackId']),
  annotations: writingTool('Shuffle a card stack', { destructive: false, idempotent: false }),
  handler: async (args, context) => {
    const answer = await ask(
      context,
      'shuffleCardStack',
      pick(args, ['stackId', 'chatNotification']),
      'shuffle card stack'
    );
    if (!isRecord(answer) || typeof answer['id'] !== 'string') return unknownShape(answer);
    return `Shuffled ${stackLine(answer)}${answer['orderChanged'] === true ? '' : '; the order happens to be the same'}.`;
  },
};

export const drawCardsTool: ToolDefinition = {
  name: 'draw-cards',
  title: 'Draw cards',
  group: 'cards',
  description:
    'Draw cards from one stack (usually a deck) into another (usually a hand or pile). Refused before anything ' +
    'moves when too few cards are left. Every card is looked up afterwards. Needs the write switch.',
  inputSchema: schema(
    {
      from: STACK('Draw from'),
      to: STACK('Draw into'),
      number: param('integer', 'How many cards, default 1'),
      how: HOW,
      chatNotification: CHAT,
    },
    ['from', 'to']
  ),
  annotations: writingTool('Draw cards', { destructive: false, idempotent: false }),
  handler: async (args, context) => {
    const answer = await ask(
      context,
      'drawCards',
      pick(args, ['from', 'to', 'number', 'how', 'chatNotification']),
      'draw cards'
    );
    if (!isRecord(answer) || !Array.isArray(answer['cards'])) return unknownShape(answer);
    return [
      `Drew ${answer['cards'].length} card(s):`,
      ...answer['cards'].map(card => `  ${cardLine(card)}`),
      `From: ${stackLine(answer['from'])}`,
      `Into: ${stackLine(answer['to'])}`,
    ].join('\n');
  },
};

export const dealCardsTool: ToolDefinition = {
  name: 'deal-cards',
  title: 'Deal cards',
  group: 'cards',
  description:
    'Deal the same number of cards from one stack to each of several hands or piles. Refused before anything ' +
    'moves when too few cards are left. Needs the write switch.',
  inputSchema: schema(
    {
      from: STACK('Deal from'),
      to: param('array', 'The stacks to deal to: ids or exact names', {
        items: { type: 'string' },
        minItems: 1,
      }),
      number: param('integer', 'Cards per stack, default 1'),
      how: HOW,
      chatNotification: CHAT,
    },
    ['from', 'to']
  ),
  annotations: writingTool('Deal cards', { destructive: false, idempotent: false }),
  handler: async (args, context) => {
    const answer = await ask(
      context,
      'dealCards',
      pick(args, ['from', 'to', 'number', 'how', 'chatNotification']),
      'deal cards'
    );
    if (!isRecord(answer) || !Array.isArray(answer['dealt'])) return unknownShape(answer);
    const lines = [`Dealt from ${stackLine(answer['from'])}:`];
    for (const target of answer['dealt'].filter(isRecord)) {
      lines.push(
        `${stackLine(target)} received:`,
        ...listOf(target['received']).map(card => `  ${cardLine(card)}`)
      );
    }
    return lines.join('\n');
  },
};

export const passCardsTool: ToolDefinition = {
  name: 'pass-cards',
  title: 'Pass cards',
  group: 'cards',
  description:
    'Pass chosen cards from one stack to another, such as from a hand to a pile. Cards are named by id or by exact ' +
    'name within the source stack. Needs the write switch.',
  inputSchema: schema(
    {
      from: STACK('Pass from'),
      to: STACK('Pass to'),
      cardIds: param('array', 'Ids or exact names of the cards', {
        items: { type: 'string' },
        minItems: 1,
      }),
      chatNotification: CHAT,
    },
    ['from', 'to', 'cardIds']
  ),
  annotations: writingTool('Pass cards', { destructive: false, idempotent: false }),
  handler: async (args, context) => {
    const answer = await ask(
      context,
      'passCards',
      pick(args, ['from', 'to', 'cardIds', 'chatNotification']),
      'pass cards'
    );
    if (!isRecord(answer) || !Array.isArray(answer['cards'])) return unknownShape(answer);
    return [
      `Passed ${answer['cards'].length} card(s):`,
      ...answer['cards'].map(card => `  ${cardLine(card)}`),
      `From: ${stackLine(answer['from'])}`,
      `To: ${stackLine(answer['to'])}`,
    ].join('\n');
  },
};

export const resetCardStackTool: ToolDefinition = {
  name: 'reset-card-stack',
  title: 'Reset a card stack',
  group: 'cards',
  description:
    'Reset a stack through Foundry: a deck takes back every card it gave out, from all hands and piles; a hand or ' +
    'pile returns its cards to their decks. Needs the write switch.',
  inputSchema: schema({ stackId: STACK('The stack'), chatNotification: CHAT }, ['stackId']),
  annotations: writingTool('Reset a card stack', { destructive: true, idempotent: true }),
  handler: async (args, context) => {
    const answer = await ask(
      context,
      'resetCardStack',
      pick(args, ['stackId', 'chatNotification']),
      'reset card stack'
    );
    if (!isRecord(answer) || typeof answer['id'] !== 'string') return unknownShape(answer);
    return `Reset and read back: ${stackLine(answer)}.`;
  },
};

export const deleteCardStackTool: ToolDefinition = {
  name: 'delete-card-stack',
  title: 'Delete a card stack',
  group: 'cards',
  description:
    'Delete a card stack by id. Card stacks have no level of their own in the permission settings yet, so ' +
    'deleting is refused until they get one.',
  inputSchema: schema({ stackId: param('string', 'Id of the stack') }, ['stackId']),
  annotations: writingTool('Delete a card stack', { destructive: true, idempotent: true }),
  handler: async (args, context) => {
    const answer = await ask(
      context,
      'deleteCardStack',
      pick(args, ['stackId']),
      'delete card stack'
    );
    if (!isRecord(answer) || answer['deleted'] !== true) return unknownShape(answer);
    return `Deleted the card stack "${str(answer['name'])}" (id ${str(answer['id'])}).`;
  },
};
