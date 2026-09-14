/**
 * This server against a module of the previous generation: the fake module
 * answers with the shapes that module sends and knows neither
 * getCharacterEntity nor changeActorOwnership.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ModuleArea } from '../../../module/areas.js';
import { fakeAdapter } from '../../../module/areas/actors/testing.js';
import { scenesArea } from '../../../module/areas/scenes/index.js';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { FakeFoundry } from '../../../testing/fake-foundry.js';
import { serverSystemAdapters, systemDetector } from '../../game-systems.js';
import { actorsArea } from './index.js';

let harness: AreaHarness | null = null;
let remove: (() => void) | null = null;
afterEach(() => {
  harness?.close();
  harness = null;
  remove?.();
  remove = null;
  systemDetector.invalidate();
});

type Answer = (data: Record<string, unknown>) => unknown;

function open(seen: Array<{ name: string; data: Record<string, unknown> }>) {
  const answers: Record<string, Answer> = {
    getCharacterInfo: () => ({
      id: 'a1',
      name: 'Aragorn',
      type: 'character',
      img: 'a.webp',
      system: { hp: 9, might: 2 },
      items: [{ id: 's1', name: 'Sword', type: 'weapon', system: { equipped: true } }],
      effects: [{ id: 'e1', name: 'Blessed', disabled: false }],
    }),
    findActor: data => (data['identifier'] === 'Joanna' ? { id: 'joanna', name: 'Joanna' } : null),
    findPlayers: () => [{ id: 'mary', name: 'Mary' }],
    getConnectedPlayers: () => [
      { id: 'john', name: 'John' },
      { id: 'mary', name: 'Mary' },
    ],
    setActorOwnership: () => ({ success: true, message: 'Ownership set' }),
    deleteActors: () => ({ error: 'Access denied', success: false }),
  };
  const oldModule: ModuleArea = {
    id: 'actors',
    queries: Object.entries(answers).map(([name, answer]) => ({
      names: name,
      handler: {
        access: { kind: 'read' },
        run: (data: unknown) => {
          const input = (data ?? {}) as Record<string, unknown>;
          seen.push({ name, data: input });
          return answer(input);
        },
      },
    })),
  };
  remove = serverSystemAdapters.register(fakeAdapter, 'actors-test');
  systemDetector.invalidate();
  return (harness = createAreaHarness({
    foundry: new FakeFoundry({ system: { id: 'fakesys', version: '1.0' } }),
    moduleAreas: [scenesArea, oldModule],
    serverAreas: [actorsArea],
  }));
}

const text = (result: { content: Array<{ type: string; text?: string }> }) =>
  result.content[0]?.text ?? '';

describe('actor tools with a previous module', () => {
  it('get-character reads the values with the adapter on the server', async () => {
    const h = open([]);
    const answer = JSON.parse(text(await h.call('get-character', { identifier: 'Aragorn' })));
    expect(answer).toMatchObject({ id: 'a1', basicInfo: { hp: 9 }, stats: { might: 2 } });
    expect(answer.items).toEqual([{ id: 's1', name: 'Sword', type: 'weapon', equipped: true }]);
    expect(answer.notes[0]).toMatch(/previous generation/);
  });

  it('get-character-entity searches the character info itself', async () => {
    const h = open([]);
    const answer = JSON.parse(
      text(
        await h.call('get-character-entity', {
          characterIdentifier: 'Aragorn',
          entityIdentifier: 'sword',
        })
      )
    );
    expect(answer).toMatchObject({ kind: 'item', id: 's1' });
  });

  it('assigns through the old queries, without partial player matches', async () => {
    const seen: Array<{ name: string; data: Record<string, unknown> }> = [];
    const h = open(seen);
    const out = text(
      await h.call('assign-actor-ownership', {
        actorIdentifier: 'Joanna',
        playerIdentifier: 'Mary',
        permissionLevel: 'OBSERVER',
      })
    );
    expect(out).toBe(
      '1 ownership assignments completed\n- Ownership set\nNote: The connected Foundry module is of the previous generation.'
    );
    expect(seen.find(call => call.name === 'findPlayers')?.data['allowPartialMatch']).toBe(false);
    expect(seen.find(call => call.name === 'setActorOwnership')?.data).toEqual({
      actorId: 'joanna',
      userId: 'mary',
      permission: 2,
    });
  });

  it('asks for confirmation before a bulk change and for removal', async () => {
    const seen: Array<{ name: string; data: Record<string, unknown> }> = [];
    const h = open(seen);
    expect(
      text(
        await h.call('assign-actor-ownership', {
          actorIdentifier: 'Joanna',
          playerIdentifier: 'party',
          permissionLevel: 'LIMITED',
        })
      )
    ).toMatch(/Bulk operation detected: 1 actors × 2 players/);
    expect(
      text(
        await h.call('remove-actor-ownership', {
          actorIdentifier: 'Joanna',
          playerIdentifier: 'Mary',
        })
      )
    ).toMatch(/set confirmRemoval to true/);
    expect(seen.some(call => call.name === 'setActorOwnership')).toBe(false);
    const removed = text(
      await h.call('remove-actor-ownership', {
        actorIdentifier: 'Joanna',
        playerIdentifier: 'Mary',
        confirmRemoval: true,
      })
    );
    expect(removed).toMatch(/removing writes NONE instead of deleting the entry/);
    expect(seen.find(call => call.name === 'setActorOwnership')?.data['permission']).toBe(0);
  });

  it('turns "Access denied" as a normal value into a tool error', async () => {
    const h = open([]);
    const result = await h.call('manage-actors', { action: 'delete', ids: ['x'] });
    expect(result).toEqual({
      content: [{ type: 'text', text: 'Error: Failed to delete actors: Access denied' }],
      isError: true,
    });
  });
});
