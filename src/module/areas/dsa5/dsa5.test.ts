import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { ToolResult } from '../../../server/control/api.js';
import { dsa5Notes } from './archetype.js';
import { openDsa5World, type Dsa5World } from './testing.js';

let world: Dsa5World | null = null;
afterEach(() => {
  world?.close();
  world = null;
});
const open = (options = {}) => (world = openDsa5World(options));

type Json = Record<string, any>;
const text = (result: ToolResult) =>
  result.content.map(block => (block.type === 'text' ? block.text : '')).join('');
const json = (result: ToolResult): Json => {
  if (result.isError) throw new Error(`tool failed: ${text(result)}`);
  return JSON.parse(text(result)) as Json;
};
const actorNamed = (w: Dsa5World, name: string) =>
  w.foundry.collection('Actor').find(entry => entry['name'] === name);

const request = {
  archetypePackId: 'dsa5-core.archetypes',
  archetypeId: 'archMage0000001',
  characterName: 'Rahjada',
  customization: {
    age: 24,
    gender: 'female',
    hairColor: 'schwarz',
    height: 172,
    profession: 'Magierin',
  },
};

describe('create-dsa5-character-from-archetype', () => {
  it('creates the hero with every customization written, read back and logged', async () => {
    const w = open();
    const answer = json(await w.harness.call('create-dsa5-character-from-archetype', request));
    expect(answer).toMatchObject({
      success: true,
      created: true,
      summary: 'DSA5 Character "Rahjada" created from archetype "Gildenmagier aus Punin"',
      actor: { name: 'Rahjada', type: 'character' },
      folder: { path: 'Foundry MCP Actors' },
      archetype: { id: 'archMage0000001', packId: 'dsa5-core.archetypes', packLabel: 'Archetypen' },
      customization: {
        'system.details.age.value': '24',
        'system.details.career.value': 'Magierin',
      },
      tokensPlaced: 0,
    });
    const stored = actorNamed(w, 'Rahjada')?.toObject() as Json;
    expect(stored['system'].details).toMatchObject({
      age: { value: '24' },
      gender: { value: 'female' },
      haircolor: { value: 'schwarz' },
      height: { value: '172' },
      career: { value: 'Magierin' },
      species: { value: 'Mensch' },
    });
    expect(stored['_stats']).toEqual({
      compendiumSource: 'Compendium.dsa5-core.archetypes.Actor.archMage0000001',
    });
    expect(stored['_id']).not.toBe('archMage0000001');
    expect(stored['prototypeToken'].name).toBe('Rahjada');
    expect(w.foundry.collection('Scene').get('scene1')?.getEmbeddedCollection('Token').size).toBe(
      1
    );
    expect(
      w.harness.changeLog.list().some(entry => entry.query === 'createDsa5CharacterFromArchetype')
    ).toBe(true);
  });

  it('only prepares the hero with addToWorld false', async () => {
    const w = open();
    const answer = json(
      await w.harness.call('create-dsa5-character-from-archetype', {
        ...request,
        addToWorld: false,
      })
    );
    expect(answer).toMatchObject({
      created: false,
      prepared: { name: 'Rahjada', details: { career: { value: 'Magierin' } } },
    });
    expect(w.foundry.operations).toEqual([]);
  });

  it('refuses a creature, a taken name and a missing archetype before writing', async () => {
    const w = open();
    const creature = await w.harness.call('create-dsa5-character-from-archetype', {
      ...request,
      archetypeId: 'archWolf0000001',
    });
    expect(text(creature)).toMatch(/of type "creature", not an archetype of a hero/);
    const taken = await w.harness.call('create-dsa5-character-from-archetype', {
      ...request,
      characterName: 'ALRIK',
    });
    expect(text(taken)).toMatch(/An actor named "ALRIK" exists already: "Alrik"/);
    const missing = await w.harness.call('create-dsa5-character-from-archetype', {
      ...request,
      archetypeId: 'nope',
    });
    expect(text(missing)).toMatch(
      /Archetype "nope" not found in compendium "dsa5-core.archetypes"/
    );
    expect(w.foundry.operations).toEqual([]);
  });

  it('stops at the write switch and in another game system', async () => {
    const off = open({ settings: { 'ninjos-foundry-mcp.allowWriteOperations': false } });
    const refused = await off.harness.call('create-dsa5-character-from-archetype', request);
    expect(refused.isError).toBe(true);
    expect(off.foundry.operations).toEqual([]);
    off.close();
    const other = open({ system: { id: 'dnd5e', version: '5.3.3' } });
    const wrong = await other.harness.call('create-dsa5-character-from-archetype', request);
    expect(text(wrong)).toMatch(/requires the game system "dsa5". Detected game system: "dnd5e"/);
  });

  it('carries the announcement in German and English', () => {
    const key = dsa5Notes.languageKey('characterCreated').split('.');
    for (const language of ['de', 'en']) {
      const file = JSON.parse(
        readFileSync(new URL(`./lang.${language}.json`, import.meta.url), 'utf8')
      ) as Json;
      expect(
        key.reduce((node: any, part) => node?.[part], file),
        language
      ).toEqual(expect.any(String));
    }
  });
});

describe('list-dsa5-archetypes through the compendium queries', () => {
  it('lists the heroes of dsa5 compendiums with species and profession', async () => {
    const w = open();
    const answer = json(await w.harness.call('list-dsa5-archetypes', {}));
    expect(answer['summary']).toBe('Found 2 DSA5 archetypes');
    expect(answer['archetypes']).toEqual([
      expect.objectContaining({
        id: 'archMage0000001',
        species: 'Mensch',
        profession: 'Gildenmagier',
      }),
      expect.objectContaining({ id: 'archDwarf000001', species: 'Zwerg', profession: 'Söldner' }),
    ]);
    const dwarves = json(
      await w.harness.call('list-dsa5-archetypes', { filterBySpecies: 'zwerg' })
    );
    expect(dwarves['archetypes'].map((entry: Json) => entry['name'])).toEqual([
      'Zwergischer Söldner',
    ]);
    const own = json(await w.harness.call('list-dsa5-archetypes', { packId: 'world.heroes' }));
    expect(own['archetypes'].map((entry: Json) => entry['name'])).toEqual(['Eigener Held']);
  });
});

describe('the adapter behind the tools of other packages', () => {
  it('lets get-character summarise a hero', async () => {
    const w = open();
    const answer = json(await w.harness.call('get-character', { identifier: 'Alrik' }));
    expect(answer['basicInfo']).toMatchObject({
      lifePoints: { value: 25, max: 29 },
      astralEnergy: { value: 30, max: 34 },
      species: 'Mensch',
    });
    expect(answer['spellcasting'].map((entry: Json) => entry['name'])).toEqual(['Spells']);
  });

  it('sets a condition with the effect dsa5 creates and removes a condition with levels whole', async () => {
    const w = open();
    const set = json(
      await w.harness.call('toggle-token-condition', {
        tokenId: 'tok1',
        conditionId: 'inpain',
        active: false,
      })
    );
    expect(set).toMatchObject({ changed: true });
    const alrik = () => actorNamed(w, 'Alrik')?.toObject() as Json;
    expect(alrik()['effects']).toEqual([]);
    json(
      await w.harness.call('toggle-token-condition', {
        tokenId: 'tok1',
        conditionId: 'inpain',
        active: true,
      })
    );
    expect(alrik()['effects'][0]).toMatchObject({
      statuses: ['inpain'],
      system: { condition: { value: 1, max: 4, manual: 1, auto: 0 } },
    });
  });

  it('rolls a skill check as 3d20 through roll-actor-check', async () => {
    const w = open();
    const answer = json(
      await w.harness.call('roll-actor-check', {
        actorId: 'Alrik',
        rollType: 'skill',
        rollTarget: 'Sinnesschärfe',
      })
    );
    expect(answer).toMatchObject({
      adapter: 'Das Schwarze Auge 5',
      formula: '3d20',
      label: 'Sinnesschärfe check: 3d20 against KL 14, IN 13, IN 13, 7 skill points to spend',
    });
    const refused = await w.harness.call('roll-actor-check', {
      actorId: 'Alrik',
      rollType: 'save',
      rollTarget: 'mu',
    });
    expect(text(refused)).toMatch(/not offered for the game system "dsa5"/);
  });
});
