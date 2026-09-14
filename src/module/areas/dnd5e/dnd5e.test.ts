import { afterEach, describe, expect, it } from 'vitest';
import type { ToolResult } from '../../../server/control/api.js';
import { dnd5eAdapter } from '../../../common/areas/dnd5e/adapter.js';
import { turnContext } from '../combat-rolls/encounter.js';
import { compendiumAdapterFor } from '../compendiums/adapter.js';
import { openDnd5eWorld, type Dnd5eWorld, type Dnd5eWorldOptions } from './testing.js';

let world: Dnd5eWorld | null = null;
afterEach(() => {
  world?.close();
  world = null;
});

function open(options: Dnd5eWorldOptions = {}): Dnd5eWorld {
  world = openDnd5eWorld(options);
  return world;
}

type Json = Record<string, any>;
const text = (result: ToolResult) =>
  result.content.map(block => (block.type === 'text' ? block.text : '')).join('');
const json = (result: ToolResult): Json => {
  if (result.isError) throw new Error(`tool failed: ${text(result)}`);
  return JSON.parse(text(result)) as Json;
};
const actor = (w: Dnd5eWorld, name: string) =>
  w.foundry.collection('Actor').find(entry => entry['name'] === name);
const stored = (w: Dnd5eWorld, name: string): Json => actor(w, name)?.toObject() as Json;

const captain = {
  name: 'Bandit Captain',
  creatureType: 'humanoid',
  size: 'medium',
  cr: '2',
  hpAverage: 65,
  hpFormula: '10d8+20',
  acMode: 'flat',
  acValue: 15,
  abilities: { str: 15, dex: 16, con: 14, int: 14, wis: 11, cha: 14 },
  savingThrows: ['str', 'dex', 'wis'],
  skills: [{ skill: 'Athletics', proficiency: 'proficient' }],
  languages: ['Common', "Thieves' Cant", 'Aquan', 'Sylvan'],
};

describe('dnd5e-create-npc', () => {
  it('creates the NPC in the creature folder, reads it back, and leaves derived values alone', async () => {
    const w = open();
    const answer = json(await w.harness.call('dnd5e-create-npc', captain));
    expect(answer).toMatchObject({
      success: true,
      actor: { name: 'Bandit Captain', cr: 2, folder: 'Foundry MCP Creatures' },
      mismatches: [],
    });
    const system = stored(w, 'Bandit Captain')['system'];
    expect(system.details.cr).toBe(2);
    expect(system.source.rules).toBe('2014');
    expect(system.traits.size).toBe('med');
    expect(system.traits.languages).toEqual({
      value: ['common', 'cant', 'aquan'],
      custom: 'Sylvan',
    });
    expect(system.attributes.senses.ranges).toBeDefined();
    expect(system.attributes.prof).toBeUndefined();
    expect(system.details.xp).toBeUndefined();
    expect(answer['warnings'].join(' ')).toMatch(/"Sylvan" is not a key of dnd5e/);
    expect(w.harness.changeLog.list().some(entry => entry.query === 'createNpcActor')).toBe(true);
  });

  it('refuses a name that exists, ignoring case, and creates nothing', async () => {
    const w = open();
    const result = await w.harness.call('dnd5e-create-npc', { ...captain, name: 'GOBLIN' });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('An actor named "GOBLIN" exists already: "Goblin"');
    expect(w.foundry.collection('Actor').size).toBe(2);
  });

  it('takes the rules version of the world when the model does not give one', async () => {
    const w = open({ rulesVersion: 'modern' });
    json(await w.harness.call('dnd5e-create-npc', captain));
    expect(stored(w, 'Bandit Captain')['system'].source.rules).toBe('2024');
  });

  it('stops at the write switch before anything exists', async () => {
    const w = open({ settings: { 'ninjos-foundry-mcp.allowWriteOperations': false } });
    const result = await w.harness.call('dnd5e-create-npc', captain);
    expect(result.isError).toBe(true);
    expect(w.foundry.operations).toEqual([]);
  });

  it('refuses in another game system and names it', async () => {
    const w = open({ system: { id: 'pf2e', version: '7.0.0' } });
    const result = await w.harness.call('dnd5e-create-npc', captain);
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/requires the game system "dnd5e". Detected game system: "pf2e"/);
  });

  it('names every wrong value at once', async () => {
    const w = open();
    const result = await w.harness.call('dnd5e-create-npc', { ...captain, cr: 0.3, acValue: 45 });
    expect(text(result)).toMatch(
      /cr must be a challenge rating of the rules.*acMode "flat" needs acValue from 0 to 30.*Nothing was changed/
    );
  });
});

describe('dnd5e-add-feature', () => {
  it('adds an attack with the given ability and proficiency and names ignored parameters', async () => {
    const w = open();
    const answer = json(
      await w.harness.call('dnd5e-add-feature', {
        featureType: 'attack',
        actorIdentifier: 'goblin',
        featureName: 'Claw',
        attackType: 'melee',
        proficient: false,
        damageParts: [{ number: 1, denomination: 6, type: 'slashing' }],
        saveDC: 12,
      })
    );
    expect(answer).toMatchObject({
      actor: { name: 'Goblin' },
      item: { name: 'Claw', type: 'weapon', activities: 1 },
      ignoredParameters: ['saveDC'],
      mismatches: [],
    });
    const claw = stored(w, 'Goblin')['items'].find((item: Json) => item['name'] === 'Claw');
    expect(claw.system.proficient).toBe(0);
    // A natural weapon of a goblin (STR 8, DEX 14): the better ability, written explicitly.
    expect((Object.values(claw.system.activities)[0] as Json)['attack'].ability).toBe('dex');
    expect(answer['details']).toMatchObject({ ability: 'dex', abilitySource: 'natural weapon' });
  });

  it('refuses a second item of the same name, ignoring case', async () => {
    const w = open();
    const result = await w.harness.call('dnd5e-add-feature', {
      featureType: 'passive',
      actorIdentifier: 'Goblin',
      featureName: 'SCIMITAR',
    });
    expect(text(result)).toContain('already has an item named "Scimitar"');
  });

  it('refuses before the module when a required parameter is missing', async () => {
    const w = open();
    const result = await w.harness.call('dnd5e-add-feature', {
      featureType: 'save',
      actorIdentifier: 'Goblin',
      featureName: 'Spit',
    });
    expect(text(result)).toMatch(/saveAbility is required for featureType "save"/);
    expect(w.foundry.operations).toEqual([]);
  });

  it('builds a save with template dimensions and the world rules', async () => {
    const w = open({ rulesVersion: 'modern' });
    json(
      await w.harness.call('dnd5e-add-feature', {
        featureType: 'save',
        actorIdentifier: 'Goblin',
        featureName: 'Acid Spray',
        saveAbility: 'dex',
        saveDC: 12,
        damageParts: [{ number: 2, denomination: 6, type: 'acid' }],
        areaType: 'line',
        areaSize: 30,
      })
    );
    const spray = stored(w, 'Goblin')['items'].find((item: Json) => item['name'] === 'Acid Spray');
    expect(spray.system.source.rules).toBe('2024');
    expect((Object.values(spray.system.activities)[0] as Json)['target'].template).toMatchObject({
      type: 'line',
      size: '30',
      width: '5',
    });
  });

  it('sets the caster level of an NPC per rules version and reads it back', async () => {
    const w = open();
    const answer = json(
      await w.harness.call('dnd5e-add-feature', {
        featureType: 'spellcasting',
        actorIdentifier: 'Goblin',
        spellcastingClass: 'paladin',
        spellcastingLevel: 1,
        sourceRules: '2024',
      })
    );
    expect(answer['spellcasting']).toMatchObject({
      ability: 'cha',
      casterLevel: 1,
      slots: { spell1: 2 },
      rules: '2024',
    });
    expect(stored(w, 'Goblin')['system'].attributes).toMatchObject({
      spellcasting: 'cha',
      spell: { level: 1 },
    });
  });

  it('leaves an actor with class items alone', async () => {
    const w = open();
    const result = await w.harness.call('dnd5e-add-feature', {
      featureType: 'spellcasting',
      actorIdentifier: 'Mira',
      spellcastingClass: 'wizard',
      spellcastingLevel: 5,
    });
    expect(text(result)).toMatch(/has class items \("Wizard"\).*Nothing was changed/);
  });

  it('copies spells without ids and with their origin, and reports the rest', async () => {
    const w = open();
    const answer = json(
      await w.harness.call('dnd5e-add-feature', {
        featureType: 'spells',
        actorIdentifier: 'Goblin',
        spellNames: ['Fireball', 'fireball', 'Shield', 'Wish'],
      })
    );
    expect(answer['added'].map((entry: Json) => entry['name'])).toEqual(['Fireball', 'Shield']);
    expect(answer['skipped']).toEqual([{ name: 'fireball', reason: 'duplicate in input' }]);
    expect(answer['notFound']).toEqual(['Wish']);
    expect(answer['warnings'][0]).toMatch(
      /standard spell compendiums of the 2014 rules \(dnd5e.spells\)/
    );
    const fireball = stored(w, 'Goblin')['items'].find((item: Json) => item['name'] === 'Fireball');
    expect(fireball._id).not.toBe('fireball');
    expect(fireball._stats).toEqual({ compendiumSource: 'Compendium.dnd5e.spells.Item.fireball' });
    expect(fireball.folder).toBeUndefined();
    expect(fireball.ownership).toBeUndefined();
  });

  it('searches the 2024 spells in a modern world', async () => {
    const w = open({ rulesVersion: 'modern' });
    const answer = json(
      await w.harness.call('dnd5e-add-feature', {
        featureType: 'spells',
        actorIdentifier: 'Goblin',
        spellNames: ['Fireball'],
      })
    );
    expect(answer['added'][0]).toMatchObject({ packId: 'dnd5e.spells24' });
  });
});

describe('dnd5e-add-features-from-compendium', () => {
  it('adds features, refuses to guess between two of one name, and reports a missing compendium', async () => {
    const w = open();
    const answer = json(
      await w.harness.call('dnd5e-add-features-from-compendium', {
        actorIdentifier: 'Goblin',
        featureNames: ['Pack Tactics', 'Multiattack', 'Action Surge', 'Scimitar'],
        compendiumPacks: ['dnd5e.monsterfeatures', 'dnd5e.classfeatures', 'nope.pack'],
      })
    );
    expect(answer['added'].map((entry: Json) => entry['name'])).toEqual([
      'Pack Tactics',
      'Action Surge',
    ]);
    expect(answer['failed'][0]).toMatchObject({ name: 'Multiattack' });
    expect(answer['failed'][0].error).toMatch(
      /ambiguous: 2 entries of compendium "dnd5e.monsterfeatures".*\(ids multi1, multi2\)/
    );
    expect(answer['skipped'][0]).toMatchObject({ name: 'Scimitar' });
    expect(answer['warnings']).toContain('Compendium "nope.pack" does not exist and was skipped.');
  });

  it('is an error when nothing was added and names were not found', async () => {
    const w = open();
    const result = await w.harness.call('dnd5e-add-features-from-compendium', {
      actorIdentifier: 'Goblin',
      featureNames: ['Fireball'],
      compendiumPacks: ['dnd5e.monsterfeatures'],
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/No features were added/);
  });

  it('refuses compendiums that hold no items, with the standard ids', async () => {
    const w = open();
    const result = await w.harness.call('dnd5e-add-features-from-compendium', {
      actorIdentifier: 'Goblin',
      featureNames: ['Bite'],
      compendiumPacks: ['dnd5e.monsters'],
    });
    expect(text(result)).toMatch(
      /none of the compendiums "dnd5e.monsters".*2024 dnd5e.monsterfeatures24/
    );
  });
});

describe('the adapter behind the tools of other packages', () => {
  it('lets get-character summarise dnd5e actors, with spells that have no class', async () => {
    const w = open();
    const goblin = json(await w.harness.call('get-character', { identifier: 'Goblin' }));
    expect(goblin['basicInfo']).toMatchObject({ challengeRating: '1/4', hitPoints: { max: 7 } });
    const mira = json(await w.harness.call('get-character', { identifier: 'Mira' }));
    expect(mira['spellcasting'].map((entry: Json) => entry['name'])).toEqual([
      'Wizard Spellcasting',
      'Other Spellcasting',
    ]);
  });

  it('reads what Foundry prepared, not the stored source', async () => {
    const w = open();
    const testFighter = w.foundry.seed('Actor', {
      _id: 'test-fighter',
      name: 'Test Fighter',
      type: 'character',
      system: {
        abilities: {
          str: { value: 16, proficient: 1 },
          dex: { value: 12 },
          con: { value: 14 },
          int: { value: 8 },
          wis: { value: 10 },
          cha: { value: 10 },
        },
        attributes: { ac: { calc: 'default', flat: null }, hp: { value: 12, max: null, temp: 0 } },
        skills: { ath: { value: 1 } },
        details: {},
      },
      items: [
        {
          _id: 'fighter',
          name: 'Fighter',
          type: 'class',
          system: { identifier: 'fighter', levels: 1 },
        },
      ],
    });
    // As in Foundry: toObject() is the saved source, prepareData writes derived values onto system.
    const source = testFighter.toObject();
    const live = testFighter['system'] as Json;
    live['attributes'].ac.value = 19;
    live['attributes'].hp.max = 12;
    live['attributes'].prof = 2;
    live['details'].level = 1;
    live['abilities'].str.mod = 4;
    live['abilities'].str.save = { value: 6 };
    live['skills'].ath.total = 6;
    Object.defineProperty(testFighter, 'toObject', {
      value: () => structuredClone(source),
      configurable: true,
    });

    const answer = json(await w.harness.call('get-character', { identifier: 'Test Fighter' }));
    expect(answer['basicInfo']).toMatchObject({
      armorClass: 19,
      hitPoints: { value: 12, max: 12 },
      level: 1,
    });
    expect(answer['stats']).toMatchObject({
      valuesFrom: 'prepared',
      proficiencyBonus: 2,
      abilities: { str: { mod: 4, save: 6 } },
      skills: { ath: { total: 6 } },
    });
    // The other abilities carry no prepared modifier here, so the answer names them as computed.
    expect(answer['stats']['computedNote']).toMatch(/computed from the stored scores/);

    const combatant = {
      id: 'cb',
      name: 'Test Fighter',
      actor: testFighter,
      token: null,
      initiative: 12,
      isNPC: false,
      defeated: false,
      hidden: false,
      actorId: 'test-fighter',
    };
    const combat = {
      id: 'c1',
      round: 1,
      turn: 0,
      turns: [combatant],
      combatants: { contents: [combatant], size: 1 },
    };
    expect(turnContext(combat as never)?.actor?.basicInfo).toMatchObject({
      armorClass: 19,
      hitPoints: { max: 12 },
    });
  });

  it('answers the compendium package with words for sizes and index estimates', () => {
    // The compendium tools read the core adapter; there is no separate compendium adapter any more.
    const dnd5eCompendiumAdapter = compendiumAdapterFor(dnd5eAdapter);
    expect(dnd5eCompendiumAdapter.search?.filters.map(filter => filter.name)).toContain(
      'spellcaster'
    );
    const row = dnd5eCompendiumAdapter.creatures?.row({
      toObject: () => ({ type: 'npc', system: { traits: { size: 'sm' }, details: { cr: '1/4' } } }),
    } as never);
    expect(row).toMatchObject({ size: 'small', challengeRating: 0.25 });
    const entry = {
      _id: 'g',
      name: 'Goblin',
      'system.details.cr': 0.25,
      'system.traits.size': 'sm',
    };
    expect(dnd5eCompendiumAdapter.search?.estimate?.(entry, { challengeRating: 1 })).toBeNull();
    expect(dnd5eCompendiumAdapter.search?.estimate?.(entry, { size: 'small' })).toBe(1);
    expect(dnd5eCompendiumAdapter.search?.stats?.(entry)).toMatchObject({
      challengeRating: 0.25,
      size: 'small',
    });
  });
});

describe('a server of the previous generation', () => {
  it('gets actor and item, the slots and all five lists in the old shapes', async () => {
    const w = open();
    const attack = (await w.harness.query('addAttackToActor', {
      featureType: 'attack',
      actorIdentifier: 'Goblin',
      featureName: 'Bite',
      description: '',
      activationType: 'action',
      attackType: 'melee',
      weaponClass: 'simpleM',
      attackBonus: 0,
      proficient: true,
      equipped: true,
      reachFt: 5,
      damageParts: [{ number: 1, denomination: 4, type: 'piercing' }],
      properties: [],
      sourceRules: '2014',
      sourceBook: '',
      sourcePage: '',
      effectiveAbility: 'dex',
    })) as Json;
    expect(attack['actor'].id).toBe('goblin0000000001');
    expect(attack['item']).toMatchObject({ name: 'Bite' });
    expect(attack['details']).toMatchObject({ ability: 'dex', abilitySource: 'server default' });

    const slots = (await w.harness.query('setActorSpellcasting', {
      featureType: 'spellcasting',
      actorIdentifier: 'Goblin',
      spellcastingClass: 'warlock',
      spellcastingLevel: 5,
      sourceRules: '2014',
      effectiveAbility: 'cha',
    })) as Json;
    expect(slots['spellcasting'].slots).toEqual({ pact: { max: 2, level: 3 } });
    expect(Array.isArray(slots['warnings'])).toBe(true);

    const spells = (await w.harness.query('addSpellsToActor', {
      featureType: 'spells',
      actorIdentifier: 'Goblin',
      spellNames: ['Shield'],
      compendiumPacks: ['dnd5e.spells'],
    })) as Json;
    for (const list of ['added', 'skipped', 'notFound', 'failed', 'warnings'])
      expect(Array.isArray(spells[list]), list).toBe(true);
    expect(spells['warnings']).toEqual([]);
  });
});
