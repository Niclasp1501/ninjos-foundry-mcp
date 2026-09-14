/**
 * The roll button in the chat: who sees and may press it, the roll on the
 * clicking client, and the confirmation by the Gamemaster's client that
 * trusts only Foundry's stored author, the stored formula and the visibility.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { settle } from '../../../testing/fake-dom.js';
import type { FakeDocument } from '../../../testing/fake-foundry.js';
import {
  confirmOpenRollResults,
  confirmRollResult,
  installRollHooks,
  rollFromRequest,
} from './roll-card.js';
import { openWorld, type World } from './world.test.js';

let world: World | null = null;
afterEach(() => {
  world?.harness.close();
  world = null;
});

async function request(
  options: Parameters<typeof openWorld>[0] = {},
  args: Record<string, unknown> = {}
) {
  const w = (world = openWorld(options));
  installRollHooks();
  const answer = (await w.harness.query('request-player-rolls', {
    rollType: 'custom',
    rollTarget: '1d20+2',
    targetPlayer: 'Player One',
    isPublic: true,
    userConfirmedVisibility: true,
    ...args,
  })) as { messageId: string };
  const message = w.foundry.collection('ChatMessage').get(answer.messageId) as FakeDocument;
  return { w, message };
}

const recordOf = (message: FakeDocument | undefined) =>
  (message?.['flags'] as Record<string, Record<string, Record<string, unknown>>>)[
    'ninjos-foundry-mcp'
  ]?.['rollRequest'];
const render = (w: World, message: FakeDocument) =>
  w.foundry.renderHook('renderChatMessageHTML', String(message['content']), message);
const results = (w: World) =>
  w.foundry
    .collection('ChatMessage')
    .contents.filter(m => JSON.stringify(m['flags'] ?? {}).includes('rollResult'));

describe('the card', () => {
  it('gives the target player an active button and other players a locked one', async () => {
    const { w, message } = await request();
    w.foundry.setUser('p1');
    const own = render(w, message).querySelector('[data-mcp-roll-button]');
    expect(own?.hasAttribute('disabled')).toBe(false);
    expect(own?.textContent).toContain('Roll: Custom roll');
    w.foundry.setUser('p3');
    const other = render(w, message).querySelector('[data-mcp-roll-button]');
    expect(other?.getAttribute('aria-disabled')).toBe('true');
    expect(other?.getAttribute('title')).toBe('Only Player One or a Gamemaster can roll.');
  });

  it('shows no button on a private request to anybody else', async () => {
    const { w, message } = await request({}, { isPublic: false });
    w.foundry.setUser('p3');
    const element = render(w, message);
    expect(element.querySelector('[data-mcp-roll-button]')).toBeNull();
    expect(element.textContent).toContain(
      'Private roll: only Player One and the Gamemasters see the result.'
    );
  });

  it('draws the texts in the language of the client', async () => {
    const { w, message } = await request({
      translations: { 'ninjos-foundry-mcp.tokens-dice.roll.card.title': 'Wurfanfrage: {label}' },
    });
    expect(render(w, message).textContent).toContain('Wurfanfrage: Custom roll');
  });
});

describe('rolling and confirming', () => {
  it('lets the player roll the stored formula and the Gamemaster confirm it', async () => {
    const { w, message } = await request({}, { isPublic: false });
    w.foundry.setUser('p1');
    const button = render(w, message).querySelector('[data-mcp-roll-button]');
    button?.click();
    await settle();
    expect(w.fake.rolls).toEqual(['1d20+2']);
    const [result] = results(w);
    expect(result).toMatchObject({ author: 'p1', whisper: ['p1', 'gm'], flavor: 'Custom roll' });
    expect(recordOf(message)?.['status']).toBe('open');
    expect(render(w, message).textContent).toContain('Rolled by Player One. A Gamemaster confirms');

    w.foundry.setUser('gm');
    expect(await confirmOpenRollResults()).toEqual(['confirmed']);
    expect(recordOf(message)).toMatchObject({
      status: 'completed',
      rolledBy: 'p1',
      rolledByName: 'Player One',
      total: 14,
    });
    const done = render(w, message);
    expect(done.querySelector('[data-mcp-roll-button]')).toBeNull();
    expect(done.textContent).toContain('Result: 14');
  });

  it('completes at once when the Gamemaster rolls, through the hook of the new message', async () => {
    const { w, message } = await request();
    expect(await rollFromRequest(message.id)).toBe('rolled');
    await settle();
    expect(recordOf(message)).toMatchObject({ status: 'completed', rolledBy: 'gm' });
    expect(results(w)[0]?.['flavor']).toBe('Custom roll (rolled by the Gamemaster)');
    expect(await rollFromRequest(message.id)).toBe('closed');
  });

  it('refuses the click of another player without rolling', async () => {
    const { w, message } = await request();
    w.foundry.setUser('p3');
    expect(await rollFromRequest(message.id)).toBe('refused');
    expect(w.fake.rolls).toEqual([]);
    expect(w.foundry.notifications).toContainEqual({
      level: 'warn',
      message: 'You may not make this roll.',
    });
  });

  it('never completes on a roll that someone else posted in the name of the player', async () => {
    const { w, message } = await request();
    w.foundry.setUser('p3');
    const ChatMessage = (
      globalThis as unknown as { ChatMessage: { create(d: unknown): Promise<unknown> } }
    ).ChatMessage;
    await ChatMessage.create({
      author: 'p1',
      rolls: [{ formula: '1d20+2', total: 20 }],
      flags: {
        'ninjos-foundry-mcp': {
          rollResult: { requestId: recordOf(message)?.['requestId'], requestMessageId: message.id },
        },
      },
    });
    w.foundry.setUser('gm');
    expect(await confirmOpenRollResults()).toEqual(['refused']);
    expect(recordOf(message)?.['status']).toBe('open');
    expect(w.foundry.notifications.at(-1)?.message).toBe(
      'Clara rolled for the request Custom roll without being allowed to. The request stays open.'
    );
  });

  it('refuses a roll with another formula and a private request answered in public', async () => {
    const { w, message } = await request({}, { isPublic: false });
    const requestId = recordOf(message)?.['requestId'];
    const flags = {
      'ninjos-foundry-mcp': { rollResult: { requestId, requestMessageId: message.id } },
    };
    w.foundry.setUser('p1');
    const ChatMessage = (
      globalThis as unknown as { ChatMessage: { create(d: unknown): Promise<FakeDocument> } }
    ).ChatMessage;
    const forged = await ChatMessage.create({
      whisper: ['gm'],
      rolls: [{ formula: '1d20+20', total: 40 }],
      flags,
    });
    const loud = await ChatMessage.create({
      whisper: [],
      rolls: [{ formula: '1d20 + 2', total: 9 }],
      flags,
    });
    w.foundry.setUser('gm');
    expect(await confirmRollResult(forged)).toBe('refused');
    expect(await confirmRollResult(loud)).toBe('refused');
    expect(w.foundry.notifications.map(n => n.message)).toEqual([
      'Player One rolled 1d20+20 instead of 1d20+2 for the request Custom roll. The request stays open.',
      'The roll of Player One for the private request Custom roll was not whispered. The request stays open.',
    ]);
  });

  it('counts the first of two rolls and warns about the second once', async () => {
    const { w, message } = await request({ gmActive: false });
    w.foundry.setUser('p1');
    expect(await rollFromRequest(message.id)).toBe('rolled');
    expect(w.foundry.notifications.at(-1)?.message).toContain('as soon as a Gamemaster is online');
    const ChatMessage = (
      globalThis as unknown as { ChatMessage: { create(d: unknown): Promise<unknown> } }
    ).ChatMessage;
    await ChatMessage.create({
      rolls: [{ formula: '1d20+2', total: 3 }],
      flags: {
        'ninjos-foundry-mcp': {
          rollResult: { requestId: recordOf(message)?.['requestId'], requestMessageId: message.id },
        },
      },
    });
    w.foundry.setUser('gm');
    expect(await confirmOpenRollResults()).toEqual(['confirmed', 'duplicate']);
    expect(recordOf(message)?.['total']).toBe(14);
    expect(await confirmOpenRollResults()).toEqual([]);
  });

  it('gives the button back when the roll fails', async () => {
    const { w, message } = await request();
    await message.update({ 'flags.ninjos-foundry-mcp.rollRequest.formula': '1d20+x!' });
    w.foundry.setUser('p1');
    const button = render(w, message).querySelector('[data-mcp-roll-button]');
    button?.click();
    await settle();
    expect(w.foundry.notifications.at(-1)).toEqual({
      level: 'error',
      message: 'The roll could not be made: Unable to parse the formula 1d20+x!',
    });
    expect(button?.hasAttribute('disabled')).toBe(false);
    expect(results(w)).toEqual([]);
  });
});
