/**
 * The world the tests of the tokens-dice area share: a Gamemaster and three players,
 * actors with and without owners, an active scene and a second one.
 *
 * A test file on purpose: files ending in .test.ts are in no build, and this
 * one pulls in the harness with the server side.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { FakeFoundry, type FakeFoundryOptions } from '../../../testing/fake-foundry.js';
import {
  assignCharacter,
  withTokensDice,
  type TokensDiceFake,
  type TokensDiceFakeOptions,
} from './testing.js';

export interface WorldOptions extends TokensDiceFakeOptions {
  settings?: Record<string, unknown>;
  activeScene?: boolean;
  translations?: Record<string, string>;
  gmActive?: boolean;
  foundry?: Partial<FakeFoundryOptions>;
}

export interface World {
  harness: AreaHarness;
  foundry: FakeFoundry;
  fake: TokensDiceFake;
}

export function openWorld(options: WorldOptions = {}): World {
  const foundry = new FakeFoundry({
    users: [
      { id: 'gm', name: 'Gamemaster', isGM: true, active: options.gmActive ?? true },
      { id: 'p1', name: 'Player One', active: true },
      { id: 'p2', name: 'Bert', active: false },
      { id: 'p3', name: 'Clara', active: true },
    ],
    user: 'gm',
    system: { id: 'testsys', version: '1.0' },
    settings: options.settings ?? {},
    translations: options.translations ?? {},
    ...options.foundry,
  });
  const fake = withTokensDice(foundry, options);
  foundry.seed('Actor', {
    _id: 'actorA',
    name: 'Aria',
    type: 'character',
    ownership: { default: 0, p1: 3 },
    system: { abilities: { dex: 3 } },
    effects: [{ _id: 'bless', name: 'Bless', statuses: [] }],
  });
  foundry.seed('Actor', { _id: 'actorB', name: 'Borin', type: 'character', ownership: { p2: 3 } });
  foundry.seed('Actor', { _id: 'actorG', name: 'Goblin', type: 'npc', ownership: { default: 0 } });
  assignCharacter(foundry, 'p1', 'actorA');
  foundry.seed('Scene', {
    _id: 'scene1',
    name: 'Hafen',
    active: options.activeScene ?? true,
    tokens: [
      {
        _id: 'tok1',
        name: 'Aria',
        x: 100,
        y: 100,
        width: 1,
        height: 1,
        actorId: 'actorA',
        actorLink: true,
        disposition: 1,
        texture: { src: 'aria.webp', scaleX: 0.8 },
      },
      {
        _id: 'tok2',
        name: 'Goblin',
        x: 0,
        y: 0,
        actorId: 'actorG',
        actorLink: false,
        disposition: -1,
      },
      { _id: 'tok3', name: 'Crate', x: 5, y: 5 },
    ],
  });
  foundry.seed('Scene', {
    _id: 'scene2',
    name: 'Keller',
    active: false,
    tokens: [{ _id: 'tokX', name: 'Rat', x: 1, y: 1 }],
  });
  const harness = createAreaHarness({ foundry });
  return { harness, foundry, fake };
}

/** The error a query failed with, as code and message. */
export async function failure(
  promise: Promise<unknown>
): Promise<{ code: string; message: string }> {
  try {
    await promise;
  } catch (error) {
    const moduleCode = (error as { moduleCode?: unknown }).moduleCode;
    return {
      code: typeof moduleCode === 'string' ? moduleCode : 'NONE',
      message: (error as Error).message,
    };
  }
  throw new Error('The query did not fail');
}

describe('the shared test world of the tokens-dice area', () => {
  let world: World | null = null;
  afterEach(() => {
    world?.harness.close();
    world = null;
  });

  it('gives an unlinked token its own actor and a linked one the world actor', () => {
    world = openWorld();
    const tokens = world.foundry.collection('Scene').get('scene1')?.getEmbeddedCollection('Token');
    const linked = tokens?.get('tok1')?.['actor'];
    const unlinked = tokens?.get('tok2')?.['actor'];
    expect(linked).toBe(world.foundry.collection('Actor').get('actorA'));
    expect(unlinked).not.toBe(world.foundry.collection('Actor').get('actorG'));
    expect(tokens?.get('tok2')?.['actor']).toBe(unlinked);
    expect(tokens?.get('tok3')?.['actor']).toBeNull();
  });
});
