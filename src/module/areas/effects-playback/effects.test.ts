import { afterEach, describe, expect, it } from 'vitest';
import { MODULE_ID } from '../../../common/constants.js';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { FakeFoundry, type FakeFoundryOptions } from '../../../testing/fake-foundry.js';
import { withTokenActors } from './testing.js';

let harness: AreaHarness | null = null;
afterEach(() => {
  harness?.close();
  harness = null;
});

function world(options: FakeFoundryOptions = {}) {
  const h = (harness = createAreaHarness({ foundry: withTokenActors(new FakeFoundry(options)) }));
  const hero = h.foundry.seed('Actor', {
    _id: 'hero',
    name: 'Hero',
    effects: [{ _id: 'bless', name: 'Bless' }],
    items: [{ _id: 'sword', name: 'Sword', effects: [{ _id: 'glow', name: 'Glow' }] }],
  });
  return { h, hero };
}

/** One call of manageEffects: what to do, where, and the rest. */
const request = (what: string, where: string, rest: Record<string, unknown> = {}) => ({
  action: what,
  actorIdentifier: 'hero',
  parentType: where,
  ...rest,
});

const run = (h: AreaHarness, data: Record<string, unknown>) =>
  h.query('manageEffects', data) as Promise<Record<string, any>>;

const effects = (document: unknown, embedded = 'ActiveEffect') =>
  (
    document as { getEmbeddedCollection(name: string): Map<string, Record<string, any>> }
  ).getEmbeddedCollection(embedded);

describe('manageEffects', () => {
  it('creates an effect on the actor, reads it back and logs it', async () => {
    const { h, hero } = world();
    const haste = { name: 'Haste', changes: [{ key: 'system.speed', mode: 2, value: '10' }] };
    const answer = await run(
      h,
      request('create', 'actor', { actorIdentifier: 'Hero', effectData: haste })
    );
    expect(answer).toMatchObject({ success: true, entityType: 'effect', scope: 'actor' });
    expect(answer['effect'].name).toBe('Haste');
    expect(answer).not.toHaveProperty('warnings');
    expect(effects(hero).has(answer['effect']._id)).toBe(true);
    expect(h.changeLog.list()[0]).toMatchObject({ document: 'Actors', tool: 'manage-effects' });
  });

  it('creates on an item found by its name in any case', async () => {
    const { h, hero } = world();
    const flame = { parentItemIdentifier: 'sword', effectData: { name: 'Flame' } };
    const answer = await run(h, request('create', 'item', flame));
    expect(answer).toMatchObject({ scope: 'item', parentItemId: 'sword', parentItemName: 'Sword' });
    expect(effects(effects(hero, 'Item').get('sword')).size).toBe(2);
  });

  it('never changes an item effect through parentType actor, and says where it is', async () => {
    const { h } = world();
    const disable = request('update', 'actor', {
      effectId: 'glow',
      effectData: { disabled: true },
    });
    await expect(run(h, disable)).rejects.toThrow(
      /ActiveEffect glow not found on actor "Hero"\. It lies on the item "Sword" \(id sword\)/
    );
    expect(h.foundry.operations).toEqual([]);
  });

  it('updates an item effect and reports fields Foundry stored differently', async () => {
    const { h, hero } = world();
    const sword = effects(hero, 'Item').get('sword') as Record<string, any>;
    sword['updateEmbeddedDocuments'] = async (
      _name: string,
      updates: Array<Record<string, any>>
    ) => {
      await effects(sword)
        .get('glow')
        ?.['update']({ ...updates[0], duration: { rounds: '3' } });
      return [];
    };
    const longer = { _id: 'glow', duration: { rounds: 3 } };
    const answer = await run(
      h,
      request('update', 'item', {
        parentItemIdentifier: 'Sword',
        effectId: 'glow',
        effectData: longer,
      })
    );
    expect(answer['warnings'][0]).toMatch(/duration\.rounds \(sent 3, stored "3"\)/);
    expect(h.changeLog.list()[0]).toMatchObject({ before: { name: 'Glow' } });
  });

  it('checks every argument rule at once before touching the world', async () => {
    const { h } = world();
    const wrong = request('update', 'actor', {
      actorIdentifier: ' ',
      parentItemIdentifier: 'Sword',
      effectData: { id: 'other' },
      extra: 1,
    });
    await expect(run(h, wrong)).rejects.toThrow(
      'Invalid arguments: extra is not a known parameter; actorIdentifier is required and must not be ' +
        'empty; parentItemIdentifier is only supported when parentType is "item"; effectId is required ' +
        'for update; effectData is required for update and must contain at least one field besides its ' +
        'id; effectData.id must match effectId when provided'
    );
  });

  it('deletes only with the full actor level', async () => {
    const bless = request('delete', 'actor', { effectId: 'bless' });
    const refused = world();
    await expect(run(refused.h, bless)).rejects.toMatchObject({ moduleCode: 'PERMISSION_DENIED' });
    refused.h.close();

    const { h, hero } = world({ settings: { [`${MODULE_ID}.permActors`]: 'full' } });
    await expect(run(h, bless)).resolves.toMatchObject({ effectId: 'bless', effectName: 'Bless' });
    expect(effects(hero).has('bless')).toBe(false);
    expect(h.changeLog.list()[0]).toMatchObject({ action: 'delete', undoable: true });
  });

  it('is held by the switch', async () => {
    const { h } = world({ settings: { [`${MODULE_ID}.allowWriteOperations`]: false } });
    await expect(
      run(h, request('create', 'actor', { effectData: { name: 'X' } }))
    ).rejects.toMatchObject({
      moduleCode: 'WRITE_DISABLED',
    });
  });

  it('refuses two actors with the same name and a part of a name', async () => {
    const { h } = world();
    h.foundry.seed('Actor', { _id: 'hero2', name: 'hero' });
    const named = (who: string) =>
      request('create', 'actor', { actorIdentifier: who, effectData: { name: 'X' } });
    await expect(run(h, named('HERO'))).rejects.toMatchObject({ moduleCode: 'AMBIGUOUS' });
    await expect(run(h, named('Her'))).rejects.toThrow(
      /Actor not found: "Her"\. Names containing it .*"Hero" \(id hero\)/
    );
  });

  it('reaches the actor of an unlinked token by uuid and reads back from that actor', async () => {
    const { h, hero } = world();
    const scene = h.foundry.seed('Scene', { _id: 'cave', name: 'Cave' });
    const token = h.foundry.seed('Token', { _id: 'goblin1', name: 'Goblin' }, scene);
    // The synthetic actor has the id of its base actor, like in Foundry.
    const synthetic = h.foundry.seed('Actor', { _id: 'hero', name: 'Hero', effects: [] }, token);
    const poisoned = request('create', 'actor', {
      actorIdentifier: 'Scene.cave.Token.goblin1.Actor.hero',
      effectData: { name: 'Poisoned' },
    });
    const answer = await run(h, poisoned);
    expect(effects(synthetic).has(answer['effect']._id)).toBe(true);
    expect(effects(hero).has(answer['effect']._id)).toBe(false);
  });
});
