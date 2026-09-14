/**
 * The tools of the actors area from the registry through the module handlers and
 * back, on a fake world with a stand-in game system adapter.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { MODULE_ID } from '../../../common/constants.js';
import { readToolDirectory } from '../../../testing/tool-directory.js';
import {
  actorDoc,
  openActorsWorld,
  type ActorsWorld,
  type ActorsWorldOptions,
} from '../../../module/areas/actors/testing.js';
import { actorsArea } from './index.js';

let world: ActorsWorld | null = null;
afterEach(() => {
  world?.close();
  world = null;
});

const open = (options: ActorsWorldOptions = {}) => (world = openActorsWorld(options));
const text = (result: { content: Array<{ type: string; text?: string }> }) =>
  result.content[0]?.text ?? '';
const json = (result: { content: Array<{ type: string; text?: string }> }) =>
  JSON.parse(text(result)) as Record<string, any>;
const full = { settings: { [`${MODULE_ID}.permActors`]: 'full' } };

/** Parameters this rewrite adds on purpose. */
const ADDED: Record<string, string[]> = { 'remove-actor-ownership': ['confirmBulkOperation'] };

describe('names and parameters', () => {
  it('match the tool directory of the previous generation', () => {
    const described = new Map<string, any>(
      readToolDirectory().map(tool => [tool.name, tool.inputSchema])
    );
    expect(actorsArea.tools?.length).toBe(12);
    for (const tool of actorsArea.tools ?? []) {
      const theirs = described.get(tool.name);
      expect(theirs, tool.name).toBeDefined();
      const own = tool.inputSchema as any;
      const extra = ADDED[tool.name] ?? [];
      expect(
        Object.keys(own.properties)
          .filter(key => !extra.includes(key))
          .sort(),
        tool.name
      ).toEqual(Object.keys(theirs.properties).sort());
      for (const [name, property] of Object.entries<any>(theirs.properties)) {
        expect(own.properties[name]?.type, `${tool.name}.${name}`).toBe(property.type);
        expect(own.properties[name]?.enum, `${tool.name}.${name}`).toEqual(property.enum);
        expect(own.properties[name]?.minItems, `${tool.name}.${name}`).toEqual(property.minItems);
      }
      expect(own.required ?? [], tool.name).toEqual(theirs.required ?? []);
    }
  });
});

describe('reading actors', () => {
  it('summarises through the adapter without raw system data', async () => {
    const w = open();
    const answer = json(await w.harness.call('get-character', { identifier: 'ARAGORN' }));
    expect(answer).toMatchObject({
      id: 'aragorn',
      via: 'name',
      basicInfo: { hp: 20 },
      stats: { might: 4 },
    });
    expect(answer['system']).toBeUndefined();
    expect(answer['items']).toContainEqual({
      id: 'sword',
      name: 'Sword',
      type: 'weapon',
      equipped: true,
    });
    expect(answer['spellcasting'][0].spells).toEqual([
      { id: 'fireball', name: 'Fireball', level: 3 },
    ]);
    expect(answer['notes']).toEqual([]);
  });

  it('says what a missing adapter means', async () => {
    const w = open({ adapter: false });
    const answer = json(await w.harness.call('get-character', { identifier: 'Aragorn' }));
    expect(answer['basicInfo']).toEqual({
      name: 'Aragorn',
      type: 'character',
      img: 'actors/aragorn.webp',
    });
    expect(answer['notes'].join(' ')).toMatch(/No adapter for the game system "homebrew"/);
  });

  it('finds by token id, refuses ambiguity and never guesses from part of a name', async () => {
    const w = open();
    expect(json(await w.harness.call('get-character', { identifier: 'tokAragorn' }))).toMatchObject(
      {
        id: 'aragorn',
        via: 'token',
      }
    );
    const twice = await w.harness.call('get-character', { identifier: 'Goblin' });
    expect(twice.isError).toBe(true);
    expect(text(twice)).toContain(
      '2 actors are named "Goblin": "Goblin" (id gob1), "Goblin" (id gob2)'
    );
    const part = await w.harness.call('get-character', { identifier: 'Arag' });
    expect(text(part)).toContain('Actors whose name contains it: "Aragorn" (id aragorn)');
  });

  it('gets one entity in full, keeping save data', async () => {
    const w = open();
    const spell = json(
      await w.harness.call('get-character-entity', {
        characterIdentifier: 'Aragorn',
        entityIdentifier: 'fireball',
      })
    );
    expect(spell).toMatchObject({
      kind: 'item',
      id: 'fireball',
      system: { level: 3, save: { ability: 'dex', dc: 15 } },
    });
    const effect = json(
      await w.harness.call('get-character-entity', {
        characterIdentifier: 'Aragorn',
        entityIdentifier: 'Blessed',
      })
    );
    expect(effect).toMatchObject({ kind: 'effect', id: 'bless', description: 'Blessed' });
    const missing = await w.harness.call('get-character-entity', {
      characterIdentifier: 'Aragorn',
      entityIdentifier: 'Shield',
    });
    expect(text(missing)).toMatch(
      /Entity "Shield" not found on character "Aragorn".*3 item\(s\) and 1 effect/
    );
  });

  it('lists characters and names the types when a filter finds none', async () => {
    const w = open();
    const all = json(await w.harness.call('list-characters'));
    expect(all['total']).toBe(4);
    const none = json(await w.harness.call('list-characters', { type: 'vehicle' }));
    expect(none['note']).toBe(
      'No actor has the type "vehicle" (compared exactly). Types in the world: "character", "npc".'
    );
  });

  it('searches items, and refuses a category the system does not have', async () => {
    const w = open({ adapter: false });
    const refused = await w.harness.call('search-character-items', {
      characterIdentifier: 'Aragorn',
      category: 'equipped',
    });
    expect(text(refused)).toMatch(/Without an adapter for this system there are no categories/);
    const found = json(
      await w.harness.call('search-character-items', {
        characterIdentifier: 'Aragorn',
        query: 'sharp',
      })
    );
    expect(found['matches']).toEqual([
      { id: 'sword', name: 'Sword', type: 'weapon', description: 'Sharp blade' },
    ]);
  });

  it('searches by the category of the adapter and reports an absent type', async () => {
    const w = open();
    const equipped = json(
      await w.harness.call('search-character-items', {
        characterIdentifier: 'Aragorn',
        category: 'Equipped',
      })
    );
    expect(equipped['matches'].map((match: any) => match.id)).toEqual(['sword']);
    const typed = json(
      await w.harness.call('search-character-items', {
        characterIdentifier: 'Aragorn',
        type: 'armor',
      })
    );
    expect(typed['notes'][0]).toMatch(/no item of type "armor"/);
  });

  it('reads a compendium entry in full', async () => {
    const w = open();
    const entry = json(
      await w.harness.call('get-compendium-entry-full', {
        packId: 'bestiary.monsters',
        entryId: 'gobEntry',
      })
    );
    expect(entry).toMatchObject({
      name: 'Goblin Boss',
      type: 'npc',
      pack: { id: 'bestiary.monsters', label: 'Bestiary' },
    });
    expect(entry['summary']).toEqual({
      name: 'Goblin Boss',
      type: 'npc',
      pack: 'Bestiary',
      items: ['Scimitar'],
      effects: [],
    });
    const missing = await w.harness.call('get-compendium-entry-full', {
      packId: 'bestiary.monsters',
      entryId: 'nope',
    });
    expect(text(missing)).toMatch(/Document nope not found in pack bestiary.monsters/);
  });
});

describe('create-actor-from-compendium', () => {
  it('creates numbered copies with a link to the entry and places tokens', async () => {
    const w = open();
    const answer = json(
      await w.harness.call('create-actor-from-compendium', {
        packId: 'bestiary.monsters',
        itemId: 'gobEntry',
        names: ['Snik'],
        quantity: 3,
        addToScene: true,
      })
    );
    expect(answer['actors'].map((actor: any) => actor.name)).toEqual(['Snik', 'Snik 2', 'Snik 3']);
    expect(answer).toMatchObject({
      totalCreated: 3,
      tokensPlaced: 3,
      scene: { name: 'Battle' },
      errors: [],
    });
    const copy = actorDoc(w.foundry, answer['actors'][0].id)?.toObject() as any;
    expect(copy._stats).toEqual({
      compendiumSource: 'Compendium.bestiary.monsters.Actor.gobEntry',
    });
    expect(copy.prototypeToken).toEqual({ name: 'Snik', texture: {} });
    expect(copy.ownership).toBeUndefined();
    expect(copy.items[0].name).toBe('Scimitar');
    const folder = w.foundry.collection('Folder').getName('Foundry MCP Creatures');
    expect(copy.folder).toBe(folder?.id);
  });

  it('refuses before writing: no active scene, a type the adapter does not copy, the switch', async () => {
    let w = open({ activeScene: false });
    const noScene = await w.harness.call('create-actor-from-compendium', {
      packId: 'bestiary.monsters',
      itemId: 'gobEntry',
      names: ['A'],
      addToScene: true,
    });
    expect(text(noScene)).toMatch(/addToScene needs an active scene/);
    const vehicle = await w.harness.call('create-actor-from-compendium', {
      packId: 'bestiary.monsters',
      itemId: 'cart',
      names: ['C'],
    });
    expect(text(vehicle)).toMatch(/type "vehicle", which the adapter "Fake System" does not copy/);
    expect(w.foundry.operations).toEqual([]);
    w.close();

    w = world = open({ settings: { [`${MODULE_ID}.allowWriteOperations`]: false } });
    const off = await w.harness.call('create-actor-from-compendium', {
      packId: 'bestiary.monsters',
      itemId: 'gobEntry',
      names: ['A'],
    });
    expect(text(off)).toMatch(/"Allow Write Operations" is off/);
  });

  it('keeps to the limit of the setting', async () => {
    const w = open({ settings: { [`${MODULE_ID}.maxActorsPerRequest`]: 2 } });
    const result = await w.harness.call('create-actor-from-compendium', {
      packId: 'bestiary.monsters',
      itemId: 'gobEntry',
      names: ['A', 'B', 'C'],
    });
    expect(text(result)).toMatch(/3 requested, at most 2 per request/);
  });
});

describe('manage-actors', () => {
  it('creates with a folder path and system data reshaped by the adapter', async () => {
    const w = open();
    const answer = json(
      await w.harness.call('manage-actors', {
        action: 'create',
        actors: [{ name: 'Guard', type: 'npc', system: { 'stats.hp': 5 } }],
        folder: 'NPCs/City',
      })
    );
    expect(answer).toMatchObject({ total: 1, folder: { path: 'NPCs/City' } });
    expect(answer['createdFolders'].map((folder: any) => folder.path)).toEqual([
      'NPCs',
      'NPCs/City',
    ]);
    expect((actorDoc(w.foundry, answer['created'][0].id) as any).system).toEqual({
      stats: { hp: 5 },
      normalized: true,
    });
  });

  it('refuses an unknown actor type with the valid ones', async () => {
    const w = open();
    w.foundry.setDocumentSubtypes({ Actor: ['base', 'npc', 'character'] });
    const result = await w.harness.call('manage-actors', {
      action: 'create',
      actors: [{ name: 'X', type: 'monster' }],
    });
    expect(text(result)).toMatch(
      /Unknown Actor type\(s\) "monster".*Valid types: "npc", "character"/
    );
  });

  it('checks every update target before the first write', async () => {
    const w = open();
    const result = await w.harness.call('manage-actors', {
      action: 'update',
      updates: [
        { id: 'aragorn', name: 'Strider' },
        { id: 'nobody', name: 'X' },
      ],
    });
    expect(result.isError).toBe(true);
    expect(w.foundry.operations).toEqual([]);
    const ok = json(
      await w.harness.call('manage-actors', {
        action: 'update',
        updates: [{ id: 'Aragorn', system: { might: 5 } }],
      })
    );
    expect(ok['updated'][0]).toMatchObject({ id: 'aragorn', mismatches: [] });
    expect((actorDoc(w.foundry, 'aragorn') as any).system).toMatchObject({
      might: 5,
      hp: 20,
      normalized: true,
    });
  });

  it('deletes only with the full level and names ids that do not exist', async () => {
    let w = open();
    const refused = await w.harness.call('manage-actors', { action: 'delete', ids: ['joanna'] });
    expect(text(refused)).toMatch(/Deleting actors is not permitted/);
    w.close();
    w = world = open(full);
    const answer = json(
      await w.harness.call('manage-actors', { action: 'delete', ids: ['joanna', 'Goblin'] })
    );
    expect(answer['deleted']).toEqual([{ id: 'joanna', name: 'Joanna', type: 'npc' }]);
    expect(answer['notFound'][0].reason).toMatch(
      /it is the name of "Goblin" \(id gob1\), "Goblin" \(id gob2\)/
    );
    expect(actorDoc(w.foundry, 'joanna')).toBeUndefined();
  });

  it('places tokens on distinct cells in the active scene and names what is unused', async () => {
    const w = open();
    const answer = json(
      await w.harness.call('manage-actors', {
        action: 'place',
        actorIds: ['aragorn', 'joanna', 'ghost'],
        placement: 'grid',
        folder: 'x',
      })
    );
    expect(answer).toMatchObject({
      tokensCreated: 2,
      notFound: ['ghost'],
      scene: { name: 'Battle' },
    });
    expect(answer['ignoredParameters']).toBe('Not used by action "place": folder.');
    const [a, b] = answer['tokens'];
    expect(`${a.x},${a.y}`).not.toBe(`${b.x},${b.y}`);
  });

  it('reads placed tokens back when Foundry throws after creating them (no canvas)', async () => {
    const w = open();
    let calls = 0;
    // The fake creates one token after the other; the throw after the second is Foundry's after the batch.
    w.foundry.hooks.on('createToken', () => {
      if (++calls === 2)
        throw new TypeError("Cannot read properties of null (reading 'clipboard')");
    });
    const answer = json(
      await w.harness.call('manage-actors', { action: 'place', actorIds: ['aragorn', 'joanna'] })
    );
    expect(answer).toMatchObject({ tokensCreated: 2 });
    expect(answer['warnings'][0]).toContain('all 2 token(s) are in the scene');
  });

  it('updates and deletes items on an actor', async () => {
    let w = open();
    const missing = await w.harness.call('manage-actors', {
      action: 'update-items',
      actorIdentifier: 'Aragorn',
      itemUpdates: [
        { id: 'sword', name: 'Anduril' },
        { id: 'axe', name: 'X' },
      ],
    });
    expect(text(missing)).toMatch(
      /Item id\(s\) "axe" not found on actor "Aragorn".*Nothing was changed/
    );
    const renamed = json(
      await w.harness.call('manage-actors', {
        action: 'update-items',
        actorIdentifier: 'Aragorn',
        itemUpdates: [{ id: 'sword', name: 'Anduril' }],
      })
    );
    expect(renamed['updated']).toEqual([{ id: 'sword', name: 'Anduril', mismatches: [] }]);
    const refused = await w.harness.call('manage-actors', {
      action: 'delete-items',
      actorIdentifier: 'Aragorn',
      itemIds: ['potion'],
    });
    expect(text(refused)).toMatch(/Deleting actors is not permitted/);
    w.close();
    w = world = open(full);
    const deleted = json(
      await w.harness.call('manage-actors', {
        action: 'delete-items',
        actorIdentifier: 'Aragorn',
        itemIds: ['potion', 'nope'],
      })
    );
    expect(deleted).toMatchObject({ deleted: [{ id: 'potion' }], notFound: ['nope'] });
  });

  it('describes from the adapter on the server, and asks for missing parameters', async () => {
    const w = open();
    expect(json(await w.harness.call('manage-actors', { action: 'describe' }))).toMatchObject({
      gameSystem: 'fakesys',
      fromAdapter: true,
      notes: 'Fake notes: might lives in system.might.',
    });
    expect(text(await w.harness.call('manage-actors', { action: 'update' }))).toBe(
      'Error: manage-actors with action "update" needs updates. Nothing was changed.'
    );
  });
});

describe('manage-world-items', () => {
  it('creates, lists, adds and removes', async () => {
    const w = open(full);
    const created = json(
      await w.harness.call('manage-world-items', {
        action: 'create',
        items: [{ name: 'Rope', type: 'loot' }],
        folder: 'Gear/Travel',
      })
    );
    expect(created).toMatchObject({ total: 1, folderName: 'Travel', folderPath: 'Gear/Travel' });
    const listed = json(
      await w.harness.call('manage-world-items', { action: 'list', folder: 'Travel' })
    );
    expect(listed).toMatchObject({ total: 1, items: [{ name: 'Rope', folder: 'Travel' }] });
    const unknown = await w.harness.call('manage-world-items', {
      action: 'list',
      folder: 'Nowhere',
    });
    expect(text(unknown)).toMatch(
      /Item folder "Nowhere" not found. Item folders: "Gear", "Travel"/
    );

    await w.harness.call('manage-world-items', {
      action: 'add-to-actor',
      actorIdentifier: 'Aragorn',
      items: [{ name: 'Potion', type: 'consumable' }],
    });
    const twice = await w.harness.call('manage-world-items', {
      action: 'remove-from-actor',
      actorIdentifier: 'Aragorn',
      itemNames: ['potion'],
    });
    expect(text(twice)).toMatch(/2 items on "Aragorn" are named "potion".*Nothing was deleted/);
    const removed = json(
      await w.harness.call('manage-world-items', {
        action: 'remove-from-actor',
        actorIdentifier: 'Aragorn',
        itemIds: ['potion'],
        itemNames: ['Sword', 'Shield'],
      })
    );
    expect(removed).toMatchObject({
      removed: [{ id: 'potion' }, { id: 'sword' }],
      notFound: ['Shield'],
    });
  });

  it('logs items added to an actor as created, so undo removes exactly those', async () => {
    const w = open();
    const items = () =>
      (w.foundry.collection('Actor').get('aragorn') as any).getEmbeddedCollection('Item');
    const before = items().size;
    const added = json(
      await w.harness.call('manage-world-items', {
        action: 'add-to-actor',
        actorIdentifier: 'Aragorn',
        items: [
          { name: 'Rope', type: 'loot' },
          { name: 'Torch', type: 'loot' },
        ],
      })
    );
    const ids: string[] = added['created'].map((item: { id: string }) => item.id);
    const entry = w.harness.changeLog.list()[0];
    expect(entry).toMatchObject({
      tool: 'manage-world-items',
      document: 'Actors',
      action: 'create',
      undoable: true,
    });
    expect(entry?.targets.map(target => target.uuid)).toEqual(
      ids.map(id => `Actor.aragorn.Item.${id}`)
    );

    await w.harness.query('undoChanges', { changeId: entry?.id });
    expect(ids.some(id => items().has(id))).toBe(false);
    expect(items().size).toBe(before);
  });

  it('refuses to undo adding an item that changed since, and keeps it', async () => {
    const w = open();
    const added = json(
      await w.harness.call('manage-world-items', {
        action: 'add-to-actor',
        actorIdentifier: 'Aragorn',
        items: [{ name: 'Rope', type: 'loot' }],
      })
    );
    const id: string = added['created'][0].id;
    const entryId = w.harness.changeLog.list()[0]?.id;
    const item = (w.foundry.collection('Actor').get('aragorn') as any)
      .getEmbeddedCollection('Item')
      .get(id);
    await item.update({ name: 'Frayed rope' });
    await expect(w.harness.query('undoChanges', { changeId: entryId })).rejects.toMatchObject({
      moduleCode: 'CONFLICT',
    });
    expect(
      (w.foundry.collection('Actor').get('aragorn') as any).getEmbeddedCollection('Item').has(id)
    ).toBe(true);
  });

  it('describes item types and enumerated values', async () => {
    const w = open();
    w.foundry.setDocumentSubtypes({ Item: ['base', 'weapon', 'spell'] });
    expect(json(await w.harness.call('manage-world-items', { action: 'describe' }))).toMatchObject({
      system: 'fakesys',
      itemTypes: ['weapon', 'spell'],
      enums: { weapon: { damage: ['fire', 'cold'] } },
    });
  });
});

describe('use-item', () => {
  it('does not wait for a use that is still open, and says what it could not check', async () => {
    const w = open({ methods: { Fireball: { use: () => new Promise(() => undefined) } } });
    const answer = json(
      await w.harness.call('use-item', {
        actorIdentifier: 'Aragorn',
        itemIdentifier: 'Fireball',
        targets: ['Sneaky'],
        spellLevel: 4,
      })
    );
    expect(answer).toMatchObject({
      status: 'initiated',
      requiresGMInteraction: true,
      planFrom: 'adapter',
      targets: [{ id: 'tokGoblin', name: 'Sneaky' }],
      targetsVerified: true,
    });
    expect(answer['notVerified']).toContain('whether resources, uses or spell slots were consumed');
    // Every argument of the plan arrives, not only the options.
    expect(w.calls).toEqual([
      {
        item: 'Fireball',
        method: 'use',
        options: { consume: true, level: 4 },
        rest: [{ dialog: false }],
      },
    ]);
  });

  it('uses nothing when a target is unknown or ambiguous', async () => {
    const w = open({ methods: { Fireball: { use: () => true } } });
    const result = await w.harness.call('use-item', {
      actorIdentifier: 'Aragorn',
      itemIdentifier: 'Fireball',
      targets: ['Goblin', 'Balrog'],
    });
    expect(text(result)).toMatch(
      /Nothing was used\. "Goblin" matches 2 tokens|Nothing was used\. .*"Balrog": no token/
    );
    expect(w.calls).toEqual([]);
  });

  it('falls back to a generic method, then to a chat message, and reports a failure with its cause', async () => {
    const w = open({ methods: { Sword: { roll: () => ({ total: 12 }) }, Potion: {} } });
    expect(
      json(
        await w.harness.call('use-item', { actorIdentifier: 'Aragorn', itemIdentifier: 'sword' })
      )
    ).toMatchObject({
      status: 'completed',
      method: 'roll',
      planFrom: 'generic',
    });
    const chat = json(
      await w.harness.call('use-item', { actorIdentifier: 'Aragorn', itemIdentifier: 'Potion' })
    );
    expect(chat).toMatchObject({ planFrom: 'chat', status: 'completed' });
    expect(w.foundry.collection('ChatMessage').get(chat['chatMessageId'])).toBeDefined();
    w.close();

    world = openActorsWorld({
      methods: { Fireball: { use: () => Promise.reject(new Error('No spell slots left')) } },
    });
    const failed = await world.harness.call('use-item', {
      actorIdentifier: 'Aragorn',
      itemIdentifier: 'Fireball',
    });
    expect(text(failed)).toMatch(/Using "Fireball" of "Aragorn" failed: No spell slots left/);
  });
});

describe('ownership', () => {
  it('assigns, reads back and reports unchanged pairs', async () => {
    const w = open();
    expect(
      text(
        await w.harness.call('assign-actor-ownership', {
          actorIdentifier: 'Joanna',
          playerIdentifier: 'mary',
          permissionLevel: 'OBSERVER',
        })
      )
    ).toBe(
      '1 ownership assignments completed (1 changed, 0 unchanged)\n- Set Joanna ownership to OBSERVER for Mary.'
    );
    expect((actorDoc(w.foundry, 'joanna') as any).ownership).toEqual({ default: 0, mary: 2 });
    expect(
      text(
        await w.harness.call('assign-actor-ownership', {
          actorIdentifier: 'joanna',
          playerIdentifier: 'Mary',
          permissionLevel: 'OBSERVER',
        })
      )
    ).toContain('unchanged');
  });

  it('needs confirmation for several players, refuses Gamemasters and partial names', async () => {
    const w = open();
    const bulk = await w.harness.call('assign-actor-ownership', {
      actorIdentifier: 'Joanna',
      playerIdentifier: 'party',
      permissionLevel: 'LIMITED',
    });
    expect(text(bulk)).toMatch(
      /Bulk operation detected: 1 actors × 2 players = 2 ownership changes\. Nothing was changed/
    );
    expect(w.foundry.operations).toEqual([]);
    expect(
      text(
        await w.harness.call('assign-actor-ownership', {
          actorIdentifier: 'Joanna',
          playerIdentifier: 'Gamemaster',
          permissionLevel: 'OWNER',
        })
      )
    ).toMatch(/is a Gamemaster/);
    expect(
      text(
        await w.harness.call('assign-actor-ownership', {
          actorIdentifier: 'Joanna',
          playerIdentifier: 'Jo',
          permissionLevel: 'OWNER',
        })
      )
    ).toMatch(/Player "Jo" not found/);
    const confirmed = await w.harness.call('assign-actor-ownership', {
      actorIdentifier: 'all friendly NPCs',
      playerIdentifier: 'party',
      permissionLevel: 'LIMITED',
      confirmBulkOperation: true,
    });
    // Aragorn is friendly too, but a player owns him.
    expect(text(confirmed)).toMatch(/^2 ownership assignments completed/);
    expect((actorDoc(w.foundry, 'aragorn') as any).ownership).toEqual({ default: 1, john: 3 });
  });

  it('removes the explicit entry and warns about the default level', async () => {
    const w = open();
    expect(
      text(
        await w.harness.call('remove-actor-ownership', {
          actorIdentifier: 'Aragorn',
          playerIdentifier: 'John',
        })
      )
    ).toMatch(/needs confirmRemoval set to true/);
    const removed = text(
      await w.harness.call('remove-actor-ownership', {
        actorIdentifier: 'Aragorn',
        playerIdentifier: 'John',
        confirmRemoval: true,
      })
    );
    expect(removed).toContain(
      'Removed the explicit ownership of John on "Aragorn". John still has LIMITED through the default level of the actor.'
    );
    expect((actorDoc(w.foundry, 'aragorn') as any).ownership).toEqual({ default: 1 });
    expect(w.harness.changeLog.list({ document: 'Actors' })[0]?.before).toEqual({
      ownership: { default: 1, john: 3 },
    });
  });

  it('lists effective levels', async () => {
    const w = open();
    expect(text(await w.harness.call('list-actor-ownership', { actorIdentifier: 'Aragorn' }))).toBe(
      [
        'Aragorn (character, id aragorn), default LIMITED:',
        '  - John: OWNER (3)',
        '  - Mary: LIMITED (1), from the default',
        '  - Olaf: LIMITED (1), from the default',
      ].join('\n')
    );
  });
});
