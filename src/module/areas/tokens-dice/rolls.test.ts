/**
 * request-player-rolls in the module: formulas from the adapter or only
 * "custom" without one, the target, offline players, visibility and what is
 * stored in the chat message.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SystemAdapter } from '../../../common/game-systems.js';
import { moduleSystemAdapters } from '../../game-systems.js';
import { failure, openWorld, type World } from './world.test.js';

let world: World | null = null;
let removeAdapter: (() => void) | null = null;
afterEach(() => {
  world?.harness.close();
  world = null;
  removeAdapter?.();
  removeAdapter = null;
});
const open = (options: Parameters<typeof openWorld>[0] = {}) => (world = openWorld(options));

const base = { targetPlayer: 'Player One', isPublic: false, userConfirmedVisibility: true };
const messages = (w: World) => w.foundry.collection('ChatMessage').contents;

describe('request-player-rolls without an adapter', () => {
  it('posts a private custom roll with the modifier, whispered to the player and the Gamemasters', async () => {
    const w = open();
    const answer = (await w.harness.query('request-player-rolls', {
      ...base,
      rollType: 'custom',
      rollTarget: '1d100',
      rollModifier: '5',
      flavor: 'Trap <b>door</b>',
    })) as Record<string, unknown>;
    expect(answer).toMatchObject({
      success: true,
      message: 'Roll request sent to Player One. Private roll button created in chat.',
      formula: '1d100+5',
      label: 'Custom roll',
      isPublic: false,
      targetPlayer: { id: 'p1', name: 'Player One' },
      character: { id: 'actorA', name: 'Aria' },
      whisperedTo: ['Player One', 'Gamemaster'],
      gameSystem: 'testsys',
    });
    const [message] = messages(w);
    expect(message?.['whisper']).toEqual(['p1', 'gm']);
    expect(message?.['author']).toBe('gm');
    expect(message?.['content']).toContain('Trap &lt;b&gt;door&lt;/b&gt;');
    expect(
      (message?.['flags'] as Record<string, Record<string, unknown>>)['ninjos-foundry-mcp']?.[
        'rollRequest'
      ]
    ).toMatchObject({
      status: 'open',
      formula: '1d100+5',
      targetUserId: 'p1',
      actorId: 'actorA',
    });
  });

  it('refuses any other roll type and names the system, posting nothing', async () => {
    const w = open();
    const refused = await failure(
      w.harness.query('request-player-rolls', { ...base, rollType: 'ability', rollTarget: 'dex' })
    );
    expect(refused.code).toBe('SYSTEM_NOT_SUPPORTED');
    expect(refused.message).toContain(
      'The roll type "ability" is not supported for the game system "testsys"'
    );
    expect(refused.message).toContain('Use rollType "custom"');
    expect(messages(w)).toEqual([]);
  });

  it('refuses a formula Foundry does not accept and an unsettled visibility', async () => {
    const w = open();
    expect(
      await failure(
        w.harness.query('request-player-rolls', {
          ...base,
          rollType: 'custom',
          rollTarget: 'lots!',
        })
      )
    ).toMatchObject({
      code: 'INVALID_FORMULA',
    });
    const unsettled = await failure(
      w.harness.query('request-player-rolls', {
        rollType: 'custom',
        rollTarget: '1d6',
        targetPlayer: 'Clara',
        userConfirmedVisibility: true,
      })
    );
    expect(unsettled.message).toContain('You must specify whether the roll should be PUBLIC');
    expect(messages(w)).toEqual([]);
  });

  it('refuses an offline player and posts nothing', async () => {
    const w = open();
    const refused = await failure(
      w.harness.query('request-player-rolls', {
        ...base,
        targetPlayer: 'Borin',
        rollType: 'custom',
        rollTarget: '1d6',
      })
    );
    expect(refused.code).toBe('PLAYER_OFFLINE');
    expect(messages(w)).toEqual([]);
  });

  it('needs the write switch', async () => {
    const w = open({ settings: { 'ninjos-foundry-mcp.allowWriteOperations': false } });
    expect(
      await failure(
        w.harness.query('request-player-rolls', { ...base, rollType: 'custom', rollTarget: '1d6' })
      )
    ).toMatchObject({
      code: 'WRITE_DISABLED',
    });
  });

  it('whispers a request for a character nobody owns to the Gamemasters only', async () => {
    const w = open();
    const answer = await w.harness.query('request-player-rolls', {
      ...base,
      targetPlayer: 'goblin',
      rollType: 'custom',
      rollTarget: '1d6',
    });
    expect(answer).toMatchObject({
      targetPlayer: null,
      character: { id: 'actorG' },
      whisperedTo: ['Gamemaster'],
    });
    expect((answer as { notes: string[] }).notes[0]).toContain('only a Gamemaster can roll');
  });
});

describe('request-player-rolls with an adapter', () => {
  const adapter: SystemAdapter = {
    id: 'testsys',
    title: 'Test System',
    rolls: {
      types: [
        { id: 'ability', description: 'An ability check' },
        { id: 'custom', description: 'A formula' },
      ],
      plan: (request, actor) => {
        const system = (actor?.['system'] ?? {}) as { abilities?: Record<string, number> };
        const bonus = system.abilities?.[request.rollTarget ?? ''] ?? 0;
        const formula =
          request.rollType === 'custom' ? (request.rollTarget ?? '') : `1d20+${bonus}`;
        return {
          formula: `${formula}${request.rollModifier ?? ''}`,
          label: `${request.rollTarget} check`,
        };
      },
    },
  };

  it('builds the formula from the character values the adapter reads', async () => {
    removeAdapter = moduleSystemAdapters.register(adapter, 'test');
    const w = open();
    const answer = await w.harness.query('request-player-rolls', {
      ...base,
      isPublic: true,
      rollType: 'ability',
      rollTarget: 'dex',
      rollModifier: '+1',
    });
    expect(answer).toMatchObject({
      formula: '1d20+3+1',
      label: 'dex check',
      isPublic: true,
      message: 'Roll request sent to Player One. Public roll button created in chat.',
    });
    expect(messages(w)[0]?.['whisper']).toEqual([]);
  });

  it('refuses a roll type the adapter does not offer, with the offered ones', async () => {
    removeAdapter = moduleSystemAdapters.register(adapter, 'test');
    const w = open();
    const refused = await failure(
      w.harness.query('request-player-rolls', { ...base, rollType: 'attack', rollTarget: 'sword' })
    );
    expect(refused).toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(refused.message).toContain('Roll types: ability, custom.');
  });
});
