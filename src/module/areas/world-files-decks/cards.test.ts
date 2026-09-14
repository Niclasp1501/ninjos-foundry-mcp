import { afterEach, describe, expect, it } from 'vitest';
import { MODULE_ID } from '../../../common/constants.js';
import type { FakeDocument, FakeFoundry } from '../../../testing/fake-foundry.js';
import { openWorldFiles, type WorldFilesSetup } from './testing.js';

let setup: WorldFilesSetup | null = null;
afterEach(() => {
  setup?.harness.close();
  setup = null;
});

function seedTable(foundry: FakeFoundry): void {
  foundry.seed('Cards', {
    _id: 'deck',
    name: 'Deck',
    type: 'deck',
    cards: ['Ace', 'Two', 'Three', 'Four', 'Five'].map((name, index) => ({
      _id: `c${index + 1}`,
      name,
      sort: (index + 1) * 100,
      drawn: false,
    })),
  });
  foundry.seed('Cards', { _id: 'h1', name: 'Alice hand', type: 'hand' });
  foundry.seed('Cards', { _id: 'h2', name: 'Bob hand', type: 'hand' });
  foundry.seed('Cards', { _id: 'pile', name: 'Discard', type: 'pile' });
}

const cardsIn = (foundry: FakeFoundry, id: string) =>
  (foundry.collection('Cards').get(id) as FakeDocument & { cards: Map<string, FakeDocument> })
    .cards;

describe('reading', () => {
  it('lists stacks and reads one with its cards in order', async () => {
    setup = openWorldFiles();
    seedTable(setup.foundry);
    const list = (await setup.harness.query('listCardStacks', { type: 'hand' })) as {
      stacks: unknown[];
    };
    expect(list.stacks).toHaveLength(2);
    const deck = (await setup.harness.query('getCardStack', { stackId: 'Deck' })) as Record<
      string,
      unknown
    >;
    expect(deck).toMatchObject({ id: 'deck', type: 'deck', cards: 5, available: 5, drawn: 0 });
    expect((deck['list'] as Array<Record<string, unknown>>).map(card => card['name'])).toEqual([
      'Ace',
      'Two',
      'Three',
      'Four',
      'Five',
    ]);
  });
});

describe('createCardStack', () => {
  it('creates a deck from a list, reads it back and logs it', async () => {
    setup = openWorldFiles();
    const answer = await setup.harness.query('createCardStack', {
      name: 'Tarot',
      folderPath: 'Games',
      cards: [
        { name: 'Fool', text: 'Beginnings', img: 'cards/fool.webp', value: 0 },
        { name: 'Magician', suit: 'major' },
      ],
    });
    expect(answer).toMatchObject({
      name: 'Tarot',
      type: 'deck',
      cards: 2,
      folder: 'Games',
      foldersCreated: ['Games'],
    });
    expect(
      setup.harness.changeLog
        .list()
        .some(entry => entry.document === 'Cards' && entry.action === 'create')
    ).toBe(true);
    await expect(setup.harness.query('createCardStack', { name: 'Empty' })).rejects.toMatchObject({
      moduleCode: 'INVALID_ARGUMENT',
    });
    expect(
      await setup.harness.query('createCardStack', { name: 'Hand', type: 'hand' })
    ).toMatchObject({ cards: 0 });
  });
});

describe('face-down cards, named "Unbekannt" by Foundry', () => {
  it('creates a deck and compares its cards with the source data, not the shown names', async () => {
    setup = openWorldFiles({}, { faceDownLabel: true });
    const answer = (await setup.harness.query('createCardStack', {
      name: 'Tarot',
      cards: [
        { name: 'Fool', suit: 'major', value: 0, text: 'Beginnings' },
        { name: 'Magician', suit: 'major', value: 1 },
      ],
    })) as Record<string, unknown>;
    expect(answer).toMatchObject({ name: 'Tarot', type: 'deck', cards: 2 });
    const shown = cardsIn(setup.foundry, String(answer['id']));
    // The fake reproduces Foundry: the shown name is not the card's name.
    expect([...shown.values()].map(card => card['name'])).toEqual([
      'Unbekannt (Tarot)',
      'Unbekannt (Tarot)',
    ]);
  });

  it('shows the real names to the Gamemaster in draw-cards and get-card-stack, marked face down', async () => {
    setup = openWorldFiles({}, { faceDownLabel: true });
    const { foundry, harness } = setup;
    seedTable(foundry);
    const drawn = await harness.query('drawCards', { from: 'Deck', to: 'h1' });
    expect(drawn).toMatchObject({
      cards: [
        { id: 'c1', name: 'Ace', faceUp: false, faceDown: true, shownAs: 'Unbekannt (Alice hand)' },
      ],
    });
    const deck = (await harness.query('getCardStack', { stackId: 'deck' })) as Record<
      string,
      unknown
    >;
    const list = deck['list'] as Array<Record<string, unknown>>;
    expect(list.map(card => card['name'])).toEqual(['Ace', 'Two', 'Three', 'Four', 'Five']);
    expect(list[1]).toMatchObject({ faceDown: true, shownAs: 'Unbekannt (Deck)' });
    const passed = await harness.query('passCards', { from: 'h1', to: 'pile', cardIds: ['Ace'] });
    expect(passed).toMatchObject({ cards: [{ id: 'c1', name: 'Ace' }] });
  });
});

describe('moves', () => {
  it('deals to hands, then a hand draws from the bottom, then passes by name', async () => {
    setup = openWorldFiles();
    const { foundry, harness } = setup;
    seedTable(foundry);
    const dealt = (await harness.query('dealCards', {
      from: 'deck',
      to: ['h1', 'Bob hand'],
      number: 2,
    })) as Record<string, unknown>;
    expect(dealt).toMatchObject({
      from: { available: 1, drawn: 4 },
      dealt: [
        {
          id: 'h1',
          cards: 2,
          received: [{ name: 'Ace', origin: { id: 'deck', name: 'Deck' } }, { name: 'Two' }],
        },
        { id: 'h2', cards: 2, received: [{ name: 'Three' }, { name: 'Four' }] },
      ],
    });
    const drawn = await harness.query('drawCards', { from: 'Deck', to: 'h1', how: 'bottom' });
    expect(drawn).toMatchObject({ cards: [{ id: 'c5', name: 'Five' }], from: { available: 0 } });
    const passed = await harness.query('passCards', { from: 'h1', to: 'pile', cardIds: ['Two'] });
    expect(passed).toMatchObject({ cards: [{ id: 'c2' }], from: { cards: 2 }, to: { cards: 1 } });
    expect(cardsIn(foundry, 'h1').has('c2')).toBe(false);
    expect(harness.changeLog.list()[0]).toMatchObject({
      document: 'Cards',
      action: 'update',
      undoable: true,
    });
  });

  it('refuses before anything moves when too few cards are left, or a card is unknown', async () => {
    setup = openWorldFiles();
    seedTable(setup.foundry);
    await expect(
      setup.harness.query('dealCards', { from: 'deck', to: ['h1', 'h2'], number: 3 })
    ).rejects.toMatchObject({
      moduleCode: 'NOT_ENOUGH_CARDS',
    });
    await expect(
      setup.harness.query('passCards', { from: 'h1', to: 'pile', cardIds: ['Ace'] })
    ).rejects.toMatchObject({
      moduleCode: 'NOT_FOUND',
    });
    await expect(
      setup.harness.query('drawCards', { from: 'deck', to: 'deck' })
    ).rejects.toMatchObject({
      moduleCode: 'INVALID_ARGUMENT',
    });
    expect(setup.foundry.operations).toEqual([]);
  });

  it('reports a move Foundry did not make', async () => {
    setup = openWorldFiles();
    seedTable(setup.foundry);
    Object.defineProperty(setup.foundry.collection('Cards').get('deck'), 'deal', {
      value: async () => undefined,
    });
    await expect(
      setup.harness.query('dealCards', { from: 'deck', to: ['h1'] })
    ).rejects.toMatchObject({
      moduleCode: 'NOT_APPLIED',
    });
  });

  it('shuffles and keeps every card', async () => {
    setup = openWorldFiles();
    seedTable(setup.foundry);
    expect(await setup.harness.query('shuffleCardStack', { stackId: 'deck' })).toMatchObject({
      cards: 5,
      orderChanged: true,
    });
  });

  it('resets a deck from every hand, and a hand back to its deck', async () => {
    setup = openWorldFiles();
    const { foundry, harness } = setup;
    seedTable(foundry);
    await harness.query('dealCards', { from: 'deck', to: ['h1', 'h2'], number: 2 });
    expect(await harness.query('resetCardStack', { stackId: 'h2' })).toMatchObject({ cards: 0 });
    expect(await harness.query('getCardStack', { stackId: 'deck' })).toMatchObject({
      available: 3,
    });
    expect(await harness.query('resetCardStack', { stackId: 'deck' })).toMatchObject({
      available: 5,
      drawn: 0,
    });
    expect(cardsIn(foundry, 'h1').size).toBe(0);
  });

  it('needs the write switch', async () => {
    setup = openWorldFiles({ settings: { [`${MODULE_ID}.allowWriteOperations`]: false } });
    seedTable(setup.foundry);
    await expect(
      setup.harness.query('shuffleCardStack', { stackId: 'deck' })
    ).rejects.toMatchObject({
      moduleCode: 'WRITE_DISABLED',
    });
  });
});

describe('deleteCardStack', () => {
  it('is refused while card stacks have no level of their own', async () => {
    setup = openWorldFiles();
    seedTable(setup.foundry);
    await expect(setup.harness.query('deleteCardStack', { stackId: 'pile' })).rejects.toMatchObject(
      {
        moduleCode: 'PERMISSION_DENIED',
        message: expect.stringContaining('Deleting card stacks is not permitted'),
      }
    );
    expect(setup.foundry.collection('Cards').has('pile')).toBe(true);
  });
});
