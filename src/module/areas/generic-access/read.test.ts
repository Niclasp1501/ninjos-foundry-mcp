import { afterEach, describe, expect, it } from 'vitest';
import type { FakeFoundry } from '../../../testing/fake-foundry.js';
import { openGeneric, type GenericSetup } from './testing.js';

let setup: GenericSetup | null = null;
afterEach(() => {
  setup?.harness.close();
  setup = null;
});

type Answer = Record<string, unknown>;

function seedWorld(foundry: FakeFoundry): void {
  foundry.seed('Folder', { _id: 'f1', name: 'Heroes', type: 'Actor' });
  foundry.seed('Actor', {
    _id: 'a1',
    name: 'Grok',
    type: 'character',
    folder: 'f1',
    system: {
      attributes: { hp: { value: 10, max: 10 } },
      skills: [
        { name: 'climb', value: 1 },
        { name: 'swim', value: 2 },
      ],
      biography: 'b'.repeat(2500),
    },
    items: [
      { _id: 'i1', name: 'Sword', type: 'weapon' },
      { _id: 'i2', name: 'Rope', type: 'loot' },
    ],
  });
  foundry.seed('Actor', {
    _id: 'a2',
    name: 'Anna',
    type: 'character',
    system: { attributes: { hp: { value: 3 } } },
  });
  foundry.seed('Actor', {
    _id: 'a3',
    name: 'Wolf',
    type: 'npc',
    system: { attributes: { hp: { value: 8 } } },
  });
  foundry.addPack({
    id: 'dnd5e.monsters',
    documentName: 'Actor',
    documents: [
      {
        _id: 'm1',
        name: 'Goblin',
        type: 'npc',
        system: { details: { cr: 0.25 } },
        items: [{ _id: 'mi1', name: 'Scimitar', type: 'weapon' }],
      },
      { _id: 'm2', name: 'Ogre', type: 'npc', system: { details: { cr: 2 } } },
    ],
  });
}

function open(): GenericSetup {
  setup = openGeneric();
  seedWorld(setup.foundry);
  return setup;
}

describe('listDocuments', () => {
  it('filters, sorts, selects fields and pages', async () => {
    const { harness } = open();
    const first = (await harness.query('listDocuments', {
      documentType: 'actor',
      where: [{ path: 'system.attributes.hp.value', op: 'gt', value: 5 }],
      fields: ['name', 'system.skills[*].name', 'system.nope'],
      sortBy: 'name',
      sortDirection: 'desc',
      limit: 1,
    })) as Answer;
    expect(first).toMatchObject({
      documentType: 'Actor',
      source: 'world',
      available: 3,
      total: 2,
      returned: 1,
      nextOffset: 1,
    });
    expect(first['documents']).toEqual([
      {
        id: 'a3',
        uuid: 'Actor.a3',
        fields: { name: 'Wolf' },
        missingFields: ['system.skills[*].name', 'system.nope'],
      },
    ]);
    const second = (await harness.query('listDocuments', {
      documentType: 'Actor',
      where: [{ path: 'system.attributes.hp.value', op: 'gt', value: 5 }],
      sortBy: 'name',
      sortDirection: 'desc',
      offset: 1,
    })) as Answer;
    expect(second['documents']).toEqual([
      { id: 'a1', uuid: 'Actor.a1', name: 'Grok', type: 'character', folder: 'f1' },
    ]);
    expect(second['nextOffset']).toBeNull();
    expect(second['specialisedTools']).toContain('manage-actors');
  });

  it('stops before the character budget and says so', async () => {
    const { harness } = open();
    const answer = (await harness.query('listDocuments', {
      documentType: 'Actor',
      fields: ['*'],
      maxChars: 1000,
    })) as Answer;
    expect(answer['stoppedByBudget']).toBe(true);
    expect(answer['returned']).toBe(1);
    expect((answer['documents'] as Answer[])[0]).toMatchObject({
      id: 'a1',
      tooLarge: expect.any(String),
    });
    expect(answer['nextOffset']).toBe(1);
  });

  it('lists embedded documents and compendium index rows', async () => {
    const { harness } = open();
    const items = (await harness.query('listDocuments', {
      documentType: 'Item',
      parentUuid: 'Actor.a1',
      where: [{ path: 'type', op: 'eq', value: 'loot' }],
    })) as Answer;
    expect(items).toMatchObject({ source: 'embedded', total: 1 });
    expect(items['documents']).toEqual([
      { id: 'i2', uuid: 'Actor.a1.Item.i2', name: 'Rope', type: 'loot' },
    ]);

    const pack = (await harness.query('listDocuments', {
      documentType: 'Actor',
      pack: 'dnd5e.monsters',
      where: [{ path: 'system.details.cr', op: 'lt', value: 1 }],
      fields: ['name', 'system.details.cr'],
    })) as Answer;
    expect(pack).toMatchObject({ source: 'compendium', total: 1 });
    expect(pack['documents']).toEqual([
      {
        id: 'm1',
        uuid: 'Compendium.dnd5e.monsters.Actor.m1',
        fields: { name: 'Goblin', 'system.details.cr': 0.25 },
      },
    ]);

    const inPack = (await harness.query('listDocuments', {
      documentType: 'Item',
      parentUuid: 'Compendium.dnd5e.monsters.Actor.m1',
    })) as Answer;
    expect(inPack['documents']).toEqual([
      {
        id: 'mi1',
        uuid: 'Compendium.dnd5e.monsters.Actor.m1.Item.mi1',
        name: 'Scimitar',
        type: 'weapon',
      },
    ]);
  });

  it('names what is wrong instead of returning nothing', async () => {
    const { harness } = open();
    await expect(
      harness.query('listDocuments', { documentType: 'Spaceship' })
    ).rejects.toMatchObject({
      moduleCode: 'INVALID_ARGUMENT',
      message: expect.stringContaining('Known types'),
    });
    await expect(harness.query('listDocuments', { documentType: 'Wall' })).rejects.toThrow(
      /parentUuid/
    );
    await expect(
      harness.query('listDocuments', { documentType: 'Item', parentUuid: 'JournalEntry.none' })
    ).rejects.toMatchObject({
      moduleCode: 'NOT_FOUND',
    });
    await expect(
      harness.query('listDocuments', { documentType: 'Wall', parentUuid: 'Actor.a1' })
    ).rejects.toThrow(/holds no Wall/);
    await expect(harness.query('listDocuments', { documentType: 'Setting' })).rejects.toMatchObject(
      {
        moduleCode: 'REFUSED',
      }
    );
    await expect(
      harness.query('listDocuments', {
        documentType: 'Actor',
        where: [{ path: 'name', op: 'like' }],
      })
    ).rejects.toMatchObject({ moduleCode: 'INVALID_ARGUMENT' });
  });
});

describe('getDocument', () => {
  it('reads by uuid or by type and id, with fields', async () => {
    const { harness } = open();
    const byId = (await harness.query('getDocument', {
      documentType: 'Item',
      id: 'i1',
      parentUuid: 'Actor.a1',
    })) as Answer;
    expect(byId).toMatchObject({
      uuid: 'Actor.a1.Item.i1',
      parentUuid: 'Actor.a1',
      data: { name: 'Sword' },
    });

    const fields = (await harness.query('getDocument', {
      uuid: 'Actor.a1',
      fields: ['system.skills.1.value', 'items[*].name'],
    })) as Answer;
    expect(fields['fields']).toEqual({
      'system.skills.1.value': 2,
      'items[*].name': ['Sword', 'Rope'],
    });
  });

  it('reads compendium entries and their embedded documents', async () => {
    const { harness } = open();
    const entry = (await harness.query('getDocument', {
      documentType: 'Actor',
      id: 'm1',
      pack: 'dnd5e.monsters',
      embedded: 'summary',
    })) as Answer;
    expect(entry).toMatchObject({ pack: 'dnd5e.monsters', name: 'Goblin' });
    expect((entry['data'] as Answer)['items']).toEqual({
      count: 1,
      entries: [{ _id: 'mi1', name: 'Scimitar', type: 'weapon' }],
    });
    const child = (await harness.query('getDocument', {
      uuid: 'Compendium.dnd5e.monsters.Actor.m1.Item.mi1',
    })) as Answer;
    expect(child).toMatchObject({
      documentName: 'Item',
      parentUuid: 'Compendium.dnd5e.monsters.Actor.m1',
      data: { name: 'Scimitar' },
    });
  });

  it('gives a large document in parts and notices a change in between', async () => {
    const { harness, foundry } = open();
    const first = (await harness.query('getDocument', {
      uuid: 'Actor.a1',
      maxChars: 1000,
    })) as Answer;
    const chunk = first['chunk'] as Answer;
    expect(chunk).toMatchObject({ of: 'data', start: 0, end: 1000, nextStart: 1000 });
    const parts = [chunk['text'] as string];
    let next = chunk['nextStart'] as number | null;
    while (next !== null) {
      const part = (await harness.query('getDocument', {
        uuid: 'Actor.a1',
        maxChars: 1000,
        chunkStart: next,
        fingerprint: first['fingerprint'],
      })) as Answer;
      const text = part['chunk'] as Answer;
      parts.push(text['text'] as string);
      next = text['nextStart'] as number | null;
    }
    expect(JSON.parse(parts.join(''))).toMatchObject({ name: 'Grok' });

    await (foundry.collection('Actor').get('a1') as { update(c: object): Promise<unknown> }).update(
      { name: 'Grak' }
    );
    await expect(
      harness.query('getDocument', {
        uuid: 'Actor.a1',
        maxChars: 1000,
        chunkStart: 1000,
        fingerprint: first['fingerprint'],
      })
    ).rejects.toMatchObject({ moduleCode: 'CHANGED' });
  });

  it('says when an id is really a name', async () => {
    const { harness } = open();
    await expect(
      harness.query('getDocument', { documentType: 'Actor', id: 'Grok' })
    ).rejects.toMatchObject({
      moduleCode: 'NOT_FOUND',
      message: expect.stringContaining('id a1'),
    });
  });
});

describe('describeDocumentType', () => {
  it('lists every type Foundry describes', async () => {
    const { harness } = open();
    const answer = (await harness.query('describeDocumentType', {})) as { types: Answer[] };
    const byName = new Map(answer.types.map(type => [type['documentName'], type]));
    expect(byName.get('Actor')).toMatchObject({
      world: true,
      count: 3,
      embedded: ['Item', 'ActiveEffect'],
    });
    expect(byName.get('Wall')).toMatchObject({ world: false, embeddedIn: ['Scene'] });
    expect(byName.get('Setting')).toMatchObject({ refused: 'read and write' });
    expect(byName.has('Canvas')).toBe(false);
  });

  it('describes fields, system fields from a data model or a template, permissions and protection', async () => {
    const { harness } = open();
    const character = (await harness.query('describeDocumentType', {
      documentType: 'Actor',
      subtype: 'character',
    })) as Answer;
    expect(character['subtypes']).toEqual(['base', 'character', 'npc']);
    expect(character['fields']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'name', type: 'StringField', required: true }),
        expect.objectContaining({ path: 'items', embeddedDocument: 'Item' }),
      ])
    );
    expect(character['systemFields']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'system.attributes.hp.value',
          type: 'NumberField',
          initial: 10,
        }),
        expect.objectContaining({ path: 'system.skills.*.name', type: 'StringField' }),
      ])
    );
    expect(String(character['permissions'])).toContain('permActors');
    expect(character['protectedFields']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'ownership',
          reason: expect.stringContaining('assign-actor-ownership'),
        }),
      ])
    );

    const npc = (await harness.query('describeDocumentType', {
      documentType: 'Actor',
      subtype: 'npc',
    })) as Answer;
    expect(npc['systemFields']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'system.details.cr', type: 'number', initial: 1 }),
      ])
    );

    const page = (await harness.query('describeDocumentType', {
      documentType: 'JournalEntryPage',
    })) as Answer;
    expect(String(page['permissions'])).toContain('outermost document');

    await expect(
      harness.query('describeDocumentType', { documentType: 'Actor', subtype: 'dragon' })
    ).rejects.toMatchObject({ moduleCode: 'INVALID_ARGUMENT' });
  });
});
