import { afterEach, describe, expect, it } from 'vitest';
import { FakeDocument, FakeFoundry } from './fake-foundry.js';

let foundry: FakeFoundry | null = null;
afterEach(() => {
  foundry?.uninstall();
  foundry = null;
});

describe('FakeFoundry actors, targets, document types and Hooks.off', () => {
  it('gives every actor getTokenDocument, also after a package redefines Actor', async () => {
    foundry = new FakeFoundry().install();
    foundry.defineDocumentType('Actor', { collection: 'actors', embedded: { Item: 'items' } });
    const actor = foundry.seed('Actor', {
      _id: 'hero',
      name: 'Hero',
      prototypeToken: { texture: { src: 'hero.webp' }, actorLink: true },
    });
    const token = (await (actor['getTokenDocument'] as (d: object) => Promise<FakeDocument>)({
      x: 100,
    })) as FakeDocument;
    expect(token.documentName).toBe('Token');
    expect(token.toObject()).toMatchObject({
      name: 'Hero',
      actorId: 'hero',
      actorLink: true,
      x: 100,
      texture: { src: 'hero.webp' },
    });
    // Unsaved, and the method is not part of the actor's data.
    expect(foundry.operations).toEqual([]);
    expect(Object.keys(actor.toObject())).not.toContain('getTokenDocument');
  });

  it('targets tokens of the active scene, or of canvas.scene, and leaves out unknown ids', () => {
    foundry = new FakeFoundry().install();
    const active = foundry.seed('Scene', {
      _id: 's1',
      active: true,
      tokens: [{ _id: 't1' }, { _id: 't2' }],
    });
    const viewed = foundry.seed('Scene', { _id: 's2', tokens: [{ _id: 't3' }] });
    const gm = foundry.users.get('gm');
    expect(gm?.targets).toEqual(new Set());

    gm?.updateTokenTargets?.(['t1', 'missing', 't2']);
    expect([...(gm?.targets ?? [])].map(target => [target.id, target.document.parent?.id])).toEqual(
      [
        ['t1', 's1'],
        ['t2', 's1'],
      ]
    );
    expect(active.id).toBe('s1');

    foundry.setGlobal('canvas', { scene: viewed });
    gm?.updateTokenTargets?.(['t1', 't3']);
    expect([...(gm?.targets ?? [])].map(target => target.id)).toEqual(['t3']);
    expect(Object.keys(gm ?? {})).toEqual(['id', 'name', 'isGM', 'active']);
  });

  it('offers game.documentTypes only when asked', () => {
    foundry = new FakeFoundry().install();
    expect(game.documentTypes).toBeUndefined();
    foundry.uninstall();
    foundry = new FakeFoundry({ documentSubtypes: { Actor: ['character', 'npc'] } }).install();
    expect(game.documentTypes).toEqual({ Actor: ['character', 'npc'] });
    foundry.setDocumentSubtypes({ Item: ['weapon'] });
    expect(game.documentTypes).toEqual({ Item: ['weapon'] });
  });

  it('removes a hook through the declared Hooks.off', () => {
    foundry = new FakeFoundry().install();
    const seen: number[] = [];
    const id = Hooks.on('someHook', () => void seen.push(1));
    Hooks.callAll('someHook');
    Hooks.off('someHook', id);
    Hooks.callAll('someHook');
    expect(seen).toEqual([1]);
  });
});
