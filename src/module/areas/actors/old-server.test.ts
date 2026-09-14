/**
 * The module of this generation asked the way a server of the previous
 * generation asks.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { openActorsWorld, type ActorsWorld } from './testing.js';

let world: ActorsWorld | null = null;
afterEach(() => {
  world?.close();
  world = null;
});

describe('queries of a previous server', () => {
  it('getCharacterInfo with characterName carries the raw system data', async () => {
    const w = (world = openActorsWorld());
    const answer = (await w.harness.query('getCharacterInfo', {
      characterName: 'Aragorn',
    })) as Record<string, any>;
    expect(answer['system']).toEqual({ hp: 20, might: 4 });
    expect(answer['items'][0]).toMatchObject({ id: 'sword', system: { equipped: true } });
  });

  it('listActors is a bare list filtered by type', async () => {
    const w = (world = openActorsWorld());
    const list = (await w.harness.query('listActors', { type: 'npc' })) as unknown[];
    expect(list).toHaveLength(3);
  });

  it('createActorFromCompendium takes customNames and answers with the fields the old server reads', async () => {
    const w = (world = openActorsWorld());
    const answer = (await w.harness.query('createActorFromCompendium', {
      packId: 'bestiary.monsters',
      itemId: 'gobEntry',
      customNames: ['Grub', 'Grub 2'],
      quantity: 2,
      addToScene: false,
    })) as Record<string, any>;
    expect(answer).toMatchObject({
      success: true,
      totalCreated: 2,
      totalRequested: 2,
      tokensPlaced: 0,
      errors: [],
    });
    expect(answer['actors'].map((actor: any) => actor.name)).toEqual(['Grub', 'Grub 2']);
  });

  it('findActor and findPlayers never match part of a name', async () => {
    const w = (world = openActorsWorld());
    expect(await w.harness.query('findActor', { identifier: 'Arag' })).toBeNull();
    expect(await w.harness.query('findActor', { identifier: 'joanna' })).toEqual({
      id: 'joanna',
      name: 'Joanna',
    });
    expect(
      await w.harness.query('findPlayers', { identifier: 'Jo', allowPartialMatch: true })
    ).toEqual([]);
    expect(await w.harness.query('getConnectedPlayers', {})).toEqual([
      { id: 'john', name: 'John' },
      { id: 'mary', name: 'Mary' },
    ]);
  });

  it('setActorOwnership keeps the meaning of 0 for the old server', async () => {
    const w = (world = openActorsWorld());
    expect(
      await w.harness.query('setActorOwnership', {
        actorId: 'aragorn',
        userId: 'mary',
        permission: 0,
      })
    ).toMatchObject({
      success: true,
    });
    expect(w.foundry.collection('Actor').get('aragorn')?.['ownership']).toEqual({
      default: 1,
      john: 3,
      mary: 0,
    });
    await expect(
      w.harness.query('setActorOwnership', { actorId: 'aragorn', userId: 'gm', permission: 3 })
    ).rejects.toThrow(/is a Gamemaster/);
  });

  it('useItem reads consume from options', async () => {
    const w = (world = openActorsWorld({ methods: { Fireball: { use: () => 'card' } } }));
    await w.harness.query('useItem', {
      actorIdentifier: 'Aragorn',
      itemIdentifier: 'Fireball',
      options: { consume: false, spellLevel: 5, skipDialog: true },
    });
    expect(w.calls[0]?.options).toEqual({ consume: false, level: 5 });
  });
});
