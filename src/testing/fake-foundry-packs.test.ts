import { afterEach, describe, expect, it } from 'vitest';
import { FakeFoundry } from './fake-foundry.js';

let foundry: FakeFoundry | null = null;
afterEach(() => {
  foundry?.uninstall();
  foundry = null;
});

describe('levels in the fake', () => {
  it('gives scenes an embedded Level collection from Foundry 14 on', async () => {
    foundry = new FakeFoundry().install();
    const scene = foundry.seed('Scene', {
      name: 'Keep',
      levels: [{ _id: 'level1', name: 'Ground' }],
    });
    expect(scene.getEmbeddedCollection('Level').get('level1')?.['name']).toBe('Ground');
    await scene.createEmbeddedDocuments('Level', [{ name: 'Tower' }]);
    expect(scene.getEmbeddedCollection('Level').size).toBe(2);
  });

  it('has no levels for Foundry 13 or when switched off', () => {
    foundry = new FakeFoundry({ version: '13.351' });
    const scene = foundry.seed('Scene', { name: 'Keep' });
    expect(() => scene.getEmbeddedCollection('Level')).toThrow(/no embedded collection Level/);
    const off = new FakeFoundry({ levels: false }).seed('Scene', { name: 'Keep' });
    expect(() => off.getEmbeddedCollection('Level')).toThrow();
  });
});

describe('packs in the fake', () => {
  it('lists compendiums with an index, documents and a lock', async () => {
    foundry = new FakeFoundry({
      packs: [
        {
          id: 'monsters.core',
          documentName: 'Actor',
          label: 'Monsters',
          documents: [{ _id: 'a1', name: 'Ogre', type: 'npc', system: { cr: 2 } }],
        },
      ],
    }).install();
    const pack = foundry.packs.get('monsters.core');
    expect(pack?.metadata).toMatchObject({
      packageName: 'monsters',
      label: 'Monsters',
      type: 'Actor',
    });
    expect(pack?.locked).toBe(true);
    expect([...(await pack!.getIndex({ fields: ['system.cr'] })).values()]).toEqual([
      { _id: 'a1', name: 'Ogre', type: 'npc', 'system.cr': 2 },
    ]);
    const ogre = await pack!.getDocument('a1');
    expect(ogre?.['uuid']).toBe('Compendium.monsters.core.Actor.a1');
    await pack!.configure({ locked: false });
    expect(pack!.locked).toBe(false);
    expect(() => foundry!.addPack({ id: 'monsters.core', documentName: 'Actor' })).toThrow(
      /exists/
    );
  });
});
