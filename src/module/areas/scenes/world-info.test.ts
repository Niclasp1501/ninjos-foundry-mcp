/**
 * getWorldInfo answers in the raw form a server of either generation reads,
 * through the dispatcher with its
 * GM check.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { FakeFoundry, type FakeFoundryOptions } from '../../../testing/fake-foundry.js';

let harness: AreaHarness | null = null;
afterEach(() => {
  harness?.close();
  harness = null;
});

const world = (options: FakeFoundryOptions = {}) =>
  (harness = createAreaHarness({
    foundry: new FakeFoundry({
      world: { id: 'test-world', title: 'Test World' },
      system: { id: 'dnd5e', version: '5.1.0' },
      version: '14.350',
      users: [
        { id: 'gm', name: 'Gamemaster', isGM: true, active: true },
        { id: 'p1', name: 'Player One', active: true },
        { id: 'p2', name: 'Player Two', active: false },
      ],
      ...options,
    }),
  }));

describe('getWorldInfo', () => {
  it('answers in the raw form: system as a string, both versions, every user as a list', async () => {
    await expect(world().query('getWorldInfo')).resolves.toEqual({
      id: 'test-world',
      title: 'Test World',
      system: 'dnd5e',
      systemVersion: '5.1.0',
      foundryVersion: '14.350',
      users: [
        { id: 'gm', name: 'Gamemaster', active: true, isGM: true },
        { id: 'p1', name: 'Player One', active: true, isGM: false },
        { id: 'p2', name: 'Player Two', active: false, isGM: false },
      ],
    });
  });

  it('refuses while Foundry is still starting, and without a world', async () => {
    await expect(world({ ready: false }).query('getWorldInfo')).rejects.toMatchObject({
      moduleCode: 'NOT_READY',
    });
    harness?.close();
    await expect(world({ world: null }).query('getWorldInfo')).rejects.toMatchObject({
      moduleCode: 'NO_WORLD',
    });
  });

  it('answers a player with an error, never with a result', async () => {
    const h = world();
    h.foundry.setUser('Player One');
    await expect(h.query('getWorldInfo')).rejects.toMatchObject({ moduleCode: 'ACCESS_DENIED' });
  });
});
