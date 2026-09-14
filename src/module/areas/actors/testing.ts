/**
 * What the tests of the actors area need beyond the default fake: a stand-in game
 * system adapter (the D&D 5e adapter of the dnd5e area does not exist yet), items with
 * use methods, a Gamemaster who can target tokens, and a small world.
 */
import type { SystemAdapter } from '../../../common/game-systems.js';
import { serverSystemAdapters, systemDetector } from '../../../server/game-systems.js';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import {
  FakeFoundry,
  type FakeDocument,
  type FakeFoundryOptions,
} from '../../../testing/fake-foundry.js';
import { moduleSystemAdapters } from '../../game-systems.js';

type Data = Record<string, unknown>;
const sys = (data: Data): Data => (data['system'] as Data | undefined) ?? {};

/** A game system that answers every question the actors area asks, with made-up paths. */
export const fakeAdapter: SystemAdapter = {
  id: 'fakesys',
  title: 'Fake System',
  characters: {
    summary: actor => ({
      basicInfo: { hp: sys(actor)['hp'] ?? null },
      stats: { might: sys(actor)['might'] ?? 0 },
    }),
    itemFields: item => ({ equipped: sys(item)['equipped'] === true }),
    actions: actor =>
      ((actor['items'] as Data[] | undefined) ?? [])
        .filter(item => item['type'] === 'weapon')
        .map(item => ({ name: `Strike: ${String(item['name'])}`, itemId: item['_id'] })),
  },
  spells: {
    itemTypes: ['spell'],
    entries: actor => [
      {
        id: 'book',
        name: 'Spellbook',
        kind: 'prepared',
        spells: ((actor['items'] as Data[] | undefined) ?? [])
          .filter(item => item['type'] === 'spell')
          .map(item => ({
            id: String(item['_id']),
            name: String(item['name']),
            level: Number(sys(item)['level'] ?? 0),
          })),
      },
    ],
  },
  characterSearch: {
    itemTypes: { spells: ['spell'], equipment: ['weapon'], features: [], actions: [] },
    categories: {
      equipped: { description: 'worn or wielded', matches: item => sys(item)['equipped'] === true },
    },
    matchDetails: item => ({ level: sys(item)['level'] ?? null }),
  },
  itemUse: {
    plan: (item, request) =>
      item['type'] === 'spell'
        ? {
            method: 'use',
            options: { consume: request.consume, level: request.spellLevel ?? null },
            args: [
              { consume: request.consume, level: request.spellLevel ?? null },
              { dialog: false },
            ],
          }
        : null,
  },
  creatures: { indexVersion: 1, row: () => ({}), filters: [], copyableTypes: ['npc', 'character'] },
  actorData: {
    normalize: system => ({ ...system, normalized: true }),
    schemaNotes: () => 'Fake notes: might lives in system.might.',
  },
  worldItems: { enums: () => ({ weapon: { damage: ['fire', 'cold'] } }) },
};

/** Behaviour of `use`, `roll` and friends per item name; set before the world is seeded. */
export type ItemMethods = Record<string, Record<string, (options: unknown) => unknown>>;

export interface ActorsWorldOptions extends FakeFoundryOptions {
  adapter?: boolean;
  methods?: ItemMethods;
  /** Whether the scene "Battle" is active. Default true. */
  activeScene?: boolean;
}

export interface ActorsWorld {
  harness: AreaHarness;
  foundry: FakeFoundry;
  /** `rest` holds the arguments after the first, only when there are any. */
  calls: Array<{ item: string; method: string; options: unknown; rest?: unknown[] }>;
  close(): void;
}

export function openActorsWorld(options: ActorsWorldOptions = {}): ActorsWorld {
  const adapter = options.adapter ?? true;
  const methods = options.methods ?? {};
  const calls: ActorsWorld['calls'] = [];
  const foundry = new FakeFoundry({
    system: { id: adapter ? 'fakesys' : 'homebrew', version: '1.0' },
    users: [
      { id: 'gm', name: 'Gamemaster', isGM: true, active: true },
      { id: 'john', name: 'John', active: true },
      { id: 'mary', name: 'Mary', active: true },
      { id: 'olaf', name: 'Olaf', active: false },
    ],
    ...options,
  });
  foundry.defineDocumentType('Item', {
    collection: 'items',
    embedded: { ActiveEffect: 'effects' },
    extend: item => {
      for (const [method, run] of Object.entries(methods[String(item['name'])] ?? {})) {
        Object.defineProperty(item, method, {
          enumerable: false,
          value: (callOptions: unknown, ...rest: unknown[]) => {
            calls.push({
              item: String(item['name']),
              method,
              options: callOptions,
              ...(rest.length ? { rest } : {}),
            });
            return run(callOptions);
          },
        });
      }
    },
  });

  const removers: Array<() => void> = [];
  if (adapter) {
    removers.push(moduleSystemAdapters.register(fakeAdapter, 'actors-test'));
    removers.push(serverSystemAdapters.register(fakeAdapter, 'actors-test'));
  }
  systemDetector.invalidate();

  const harness = createAreaHarness({ foundry });
  // Targets come from the core fake since Only tokens of the shown or active scene.

  seedWorld(foundry, options.activeScene ?? true);
  return {
    harness,
    foundry,
    calls,
    close: () => {
      harness.close();
      for (const remove of removers) remove();
      systemDetector.invalidate();
    },
  };
}

function seedWorld(foundry: FakeFoundry, active: boolean): void {
  foundry.seed('Actor', {
    _id: 'aragorn',
    name: 'Aragorn',
    type: 'character',
    img: 'actors/aragorn.webp',
    ownership: { default: 1, john: 3 },
    system: { hp: 20, might: 4 },
    prototypeToken: { name: 'Aragorn', texture: { src: 'tokens/aragorn.webp' } },
    items: [
      {
        _id: 'sword',
        name: 'Sword',
        type: 'weapon',
        system: { equipped: true, description: { value: '<p>Sharp blade</p>' } },
      },
      {
        _id: 'fireball',
        name: 'Fireball',
        type: 'spell',
        system: { level: 3, save: { ability: 'dex', dc: 15 } },
      },
      { _id: 'potion', name: 'Potion', type: 'consumable', system: {} },
    ],
    effects: [{ _id: 'bless', name: 'Blessed', disabled: false }],
  });
  foundry.seed('Actor', {
    _id: 'joanna',
    name: 'Joanna',
    type: 'npc',
    ownership: { default: 0 },
    system: {},
  });
  foundry.seed('Actor', { _id: 'gob1', name: 'Goblin', type: 'npc', system: {} });
  foundry.seed('Actor', { _id: 'gob2', name: 'Goblin', type: 'npc', system: {} });
  foundry.seed('Scene', {
    _id: 'battle',
    name: 'Battle',
    active,
    width: 2000,
    height: 1000,
    padding: 0,
    grid: { size: 100 },
    tokens: [
      {
        _id: 'tokAragorn',
        name: 'Aragorn',
        actorId: 'aragorn',
        actorLink: true,
        disposition: 1,
        x: 0,
        y: 0,
      },
      {
        _id: 'tokJoanna',
        name: 'Joanna',
        actorId: 'joanna',
        actorLink: false,
        disposition: 1,
        x: 100,
        y: 0,
      },
      {
        _id: 'tokGoblin',
        name: 'Sneaky',
        actorId: 'gob1',
        actorLink: false,
        disposition: -1,
        x: 200,
        y: 0,
      },
    ],
  });
  foundry.addPack({
    id: 'bestiary.monsters',
    documentName: 'Actor',
    label: 'Bestiary',
    documents: [
      {
        _id: 'gobEntry',
        name: 'Goblin Boss',
        type: 'npc',
        img: 'monsters/goblin.webp',
        system: { hp: 21 },
        items: [{ _id: 'scim', name: 'Scimitar', type: 'weapon', system: {} }],
        prototypeToken: { name: 'Goblin Boss', texture: { src: 'https://example.com/goblin.png' } },
        ownership: { default: 3 },
        folder: 'packFolder',
      },
      { _id: 'cart', name: 'Cart', type: 'vehicle', system: {} },
    ],
  });
  foundry.addPack({ id: 'bestiary.gear', documentName: 'Item', label: 'Gear', documents: [] });
}

export function actorDoc(foundry: FakeFoundry, id: string): FakeDocument | undefined {
  return foundry.collection('Actor').get(id);
}
