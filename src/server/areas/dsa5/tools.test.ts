import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dsa5Adapter } from '../../../common/areas/dsa5/adapter.js';
import { serverSystemAdapters, systemDetector } from '../../game-systems.js';
import type { ToolContext } from '../../tools/types.js';
import { dsa5Area } from './index.js';
import { ARCHETYPE_FIELDS, createFromArchetypeTool, listArchetypesTool } from './tools.js';

interface Sent {
  name: string;
  data: Record<string, unknown>;
}

function context(
  system: string,
  answer: (name: string, data: Record<string, unknown>) => unknown
): { context: ToolContext; sent: Sent[] } {
  const sent: Sent[] = [];
  return {
    sent,
    context: {
      progress: () => undefined,
      query: async (name, data) => {
        const record = (data ?? {}) as Record<string, unknown>;
        sent.push({ name, data: record });
        if (name === 'getWorldInfo')
          return {
            id: 'w',
            title: 'W',
            system,
            systemVersion: '8.1.5',
            foundryVersion: '14.367',
            users: [],
          };
        return answer(name, record);
      },
    },
  };
}

let removeAdapter: () => void = () => undefined;
beforeEach(() => {
  systemDetector.invalidate();
  removeAdapter = serverSystemAdapters.register(dsa5Adapter, 'dsa5-test');
});
afterEach(() => {
  removeAdapter();
  systemDetector.invalidate();
});

describe('names and parameters', () => {
  it('keeps the names and parameters of the previous generation', () => {
    expect(dsa5Area.tools?.map(tool => tool.name)).toEqual([
      'list-dsa5-archetypes',
      'create-dsa5-character-from-archetype',
    ]);
    expect(Object.keys(listArchetypesTool.inputSchema['properties'] as object)).toEqual([
      'packId',
      'filterBySpecies',
      'filterByProfession',
    ]);
    const create = createFromArchetypeTool.inputSchema as Record<string, any>;
    expect(create['required']).toEqual(['archetypePackId', 'archetypeId', 'characterName']);
    expect(Object.keys(create['properties'].customization.properties)).toEqual([
      'age',
      'biography',
      'gender',
      'eyeColor',
      'hairColor',
      'height',
      'weight',
      'species',
      'culture',
      'profession',
    ]);
    expect(create['properties'].customization.properties.age).toMatchObject({
      minimum: 12,
      maximum: 100,
    });
    expect(create['properties'].customization.properties.gender.enum).toEqual([
      'male',
      'female',
      'diverse',
    ]);
    expect(create['properties'].addToWorld.default).toBe(true);
    expect(dsa5Area.adapters).toEqual([dsa5Adapter]);
  });

  it('writes descriptions without dashes as sentence dashes', () => {
    const all = JSON.stringify(dsa5Area.tools?.map(tool => [tool.description, tool.inputSchema]));
    expect(all).not.toMatch(/[–—]/);
  });
});

const packs = [
  { id: 'dsa5-core.archetypes', label: 'Archetypen', type: 'Actor', system: 'dsa5' },
  { id: 'dsa5-bestiary.broken', label: 'Kaputt', type: 'Actor', system: 'dsa5' },
  { id: 'dnd5e.monsters', label: 'Monsters', type: 'Actor', system: 'dnd5e' },
  { id: 'dsa5.skills', label: 'Talente', type: 'Item', system: 'dsa5' },
];
const entries = [
  {
    _id: 'a1',
    name: 'Magierin',
    type: 'character',
    'system.details.species.value': 'Mensch',
    'system.details.career.value': 'Gildenmagierin',
  },
  {
    _id: 'a2',
    name: 'Söldner',
    type: 'character',
    system: { details: { species: { value: 'Zwerg' }, career: { value: 'Söldner' } } },
  },
  { _id: 'a3', name: 'Namenlos', type: 'character' },
  { _id: 'w1', name: 'Wolf', type: 'creature' },
];

function archetypeWorld() {
  return context('dsa5', (name, data) => {
    if (name === 'getAvailablePacks') return packs;
    if (name === 'getPackIndex') {
      if (data['packId'] === 'dsa5-bestiary.broken')
        throw new Error('The index could not be loaded');
      return { packId: data['packId'], label: 'Archetypen', entries };
    }
    throw new Error(`unexpected ${name}`);
  });
}

describe('list-dsa5-archetypes', () => {
  it('asks for species and profession, keeps only heroes and names a compendium it could not read', async () => {
    const { context: ctx, sent } = archetypeWorld();
    const answer = (await listArchetypesTool.handler({}, ctx)) as Record<string, any>;
    expect(sent.filter(entry => entry.name === 'getPackIndex').map(entry => entry.data)).toEqual([
      { packId: 'dsa5-core.archetypes', fields: ARCHETYPE_FIELDS },
      { packId: 'dsa5-bestiary.broken', fields: ARCHETYPE_FIELDS },
    ]);
    expect(answer['summary']).toBe('Found 3 DSA5 archetypes');
    expect(answer['archetypes'][0]).toEqual({
      id: 'a1',
      name: 'Magierin',
      pack: { id: 'dsa5-core.archetypes', label: 'Archetypen' },
      species: 'Mensch',
      profession: 'Gildenmagierin',
      img: null,
    });
    expect(answer['archetypes'][2]).toMatchObject({ species: 'Unknown', profession: 'Unknown' });
    expect(answer['skippedPacks']).toEqual([
      {
        id: 'dsa5-bestiary.broken',
        reason: expect.stringMatching(/The index could not be loaded/),
      },
    ]);
    expect(answer['packsSearched']).toEqual(['dsa5-core.archetypes']);
  });

  it('filters species whole and profession in part, both ignoring case', async () => {
    const { context: ctx } = archetypeWorld();
    const answer = (await listArchetypesTool.handler(
      { packId: 'dsa5-core.archetypes', filterBySpecies: 'mensch', filterByProfession: 'MAGIER' },
      ctx
    )) as Record<string, any>;
    expect(answer['archetypes'].map((entry: any) => entry.id)).toEqual(['a1']);
    expect(answer['summary']).toBe(
      'Found 1 DSA5 archetypes (pack dsa5-core.archetypes, species mensch, profession MAGIER)'
    );
  });

  it('refuses an unknown compendium with the actor compendiums, and another system with its name', async () => {
    const { context: ctx } = archetypeWorld();
    await expect(listArchetypesTool.handler({ packId: 'nope' }, ctx)).rejects.toThrow(
      /Actor compendium "nope" not found. Actor compendiums: "dsa5-core.archetypes"/
    );
    systemDetector.invalidate();
    const other = context('dnd5e', () => []);
    await expect(listArchetypesTool.handler({}, other.context)).rejects.toThrow(
      /requires the game system "dsa5". Detected game system: "dnd5e"/
    );
    expect(other.sent.map(entry => entry.name)).toEqual(['getWorldInfo']);
  });
});

describe('create-dsa5-character-from-archetype', () => {
  const base = { archetypePackId: 'p', archetypeId: 'a1', characterName: 'Rahjada' };

  it('refuses wrong customization before asking anything', async () => {
    const { context: ctx, sent } = context('dsa5', () => ({}));
    await expect(
      createFromArchetypeTool.handler({ ...base, customization: { age: 7, gender: 'x' } }, ctx)
    ).rejects.toThrow(
      /customization.age must be from 12 to 100.*customization.gender.*Nothing was changed/
    );
    expect(sent).toEqual([]);
  });

  it('sends the customization and addToWorld true by default', async () => {
    const { context: ctx, sent } = context('dsa5', () => ({ success: true, created: true }));
    await createFromArchetypeTool.handler({ ...base, customization: { age: 30 } }, ctx);
    expect(sent.find(entry => entry.name === 'createDsa5CharacterFromArchetype')?.data).toEqual({
      ...base,
      customization: { age: 30 },
      addToWorld: true,
    });
  });

  it('names a module that is too old and keeps the cause of a refusal', async () => {
    const tooOld = context('dsa5', () => {
      throw Object.assign(
        new Error(
          'No handler found for query: ninjos-foundry-mcp.createDsa5CharacterFromArchetype'
        ),
        {
          moduleCode: 'UNKNOWN_QUERY',
        }
      );
    });
    await expect(createFromArchetypeTool.handler(base, tooOld.context)).rejects.toThrow(
      /older than this server/
    );
    systemDetector.invalidate();
    const refused = context('dsa5', () => {
      throw new Error('Archetype "a1" not found in compendium "p"');
    });
    await expect(createFromArchetypeTool.handler(base, refused.context)).rejects.toThrow(
      /Failed to create the DSA5 character "Rahjada": Archetype "a1" not found/
    );
  });
});
