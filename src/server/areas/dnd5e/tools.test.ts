import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dnd5eAdapter } from '../../../common/areas/dnd5e/adapter.js';
import { readToolDirectory } from '../../../testing/tool-directory.js';
import { serverSystemAdapters, systemDetector } from '../../game-systems.js';
import type { ToolContext } from '../../tools/types.js';
import { dnd5eArea } from './index.js';
import {
  addFeatureTool,
  addFeaturesFromCompendiumTool,
  createNpcTool,
  importResult,
} from './tools.js';

/** The contract of a schema without its descriptions. */
function contract(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(contract);
  if (typeof schema !== 'object' || schema === null) return schema;
  return Object.fromEntries(
    Object.entries(schema as Record<string, unknown>)
      .filter(([key]) => key !== 'description')
      .map(([key, value]) => [
        key,
        key === 'required' && Array.isArray(value) ? [...value].sort() : contract(value),
      ])
  );
}

describe('names and parameters', () => {
  it('match the tool directory of the previous generation in everything but the descriptions', () => {
    const described = new Map(readToolDirectory().map(tool => [tool.name, tool.inputSchema]));
    expect(dnd5eArea.tools?.map(tool => tool.name)).toEqual([
      'dnd5e-create-npc',
      'dnd5e-add-feature',
      'dnd5e-add-features-from-compendium',
    ]);
    for (const tool of dnd5eArea.tools ?? []) {
      expect(contract(tool.inputSchema), tool.name).toEqual(contract(described.get(tool.name)));
    }
  });

  it('writes descriptions without dashes as sentence dashes', () => {
    const all = JSON.stringify(dnd5eArea.tools?.map(tool => [tool.description, tool.inputSchema]));
    expect(all).not.toMatch(/[–—]/);
  });
});

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
            systemVersion: '5.3.3',
            foundryVersion: '14.360',
            users: [],
          };
        return answer(name, record);
      },
    },
  };
}

// Outside the harness no backend installs the areas, so the adapter is registered here.
let removeAdapter: () => void = () => undefined;
beforeEach(() => {
  systemDetector.invalidate();
  removeAdapter = serverSystemAdapters.register(dnd5eAdapter, 'dnd5e-test');
});
afterEach(() => {
  removeAdapter();
  systemDetector.invalidate();
});

describe('towards the module', () => {
  it('sends the defaults an older module expects, the computed ability, and names the rule dependent defaults', async () => {
    const { context: ctx, sent } = context('dnd5e', () => ({
      actor: { id: 'a', name: 'A' },
      item: { id: 'i', name: 'Bow' },
    }));
    const answer = await addFeatureTool.handler(
      {
        featureType: 'attack',
        actorIdentifier: 'A',
        featureName: 'Bow',
        attackType: 'ranged',
        rangeFt: 80,
        damageParts: [{ number: 1, denomination: 8, type: 'piercing' }],
        spellNames: ['x'],
      },
      ctx
    );
    const query = sent.find(entry => entry.name === 'addAttackToActor');
    expect(query?.data).toMatchObject({
      featureType: 'attack',
      effectiveAbility: 'dex',
      weaponClass: 'natural',
      proficient: true,
      reachFt: 5,
      sourceRules: '2014',
      serverDefaults: ['sourceRules'],
    });
    expect(query?.data['spellNames']).toBeUndefined();
    expect(answer).toMatchObject({ ignoredParameters: ['spellNames'] });
  });

  it('computes the class ability for spellcasting and fills compendium defaults for imports', async () => {
    const { context: ctx, sent } = context('dnd5e', () => ({
      actor: {},
      added: [{}],
      skipped: [],
      notFound: [],
      failed: [],
      warnings: [],
    }));
    await addFeatureTool.handler(
      {
        featureType: 'spellcasting',
        actorIdentifier: 'A',
        spellcastingClass: 'druid',
        spellcastingLevel: 3,
      },
      ctx
    );
    await addFeaturesFromCompendiumTool.handler(
      { actorIdentifier: 'A', featureNames: ['Bite'] },
      ctx
    );
    expect(sent.find(entry => entry.name === 'setActorSpellcasting')?.data).toMatchObject({
      effectiveAbility: 'wis',
    });
    expect(sent.find(entry => entry.name === 'addFeaturesFromCompendium')?.data).toMatchObject({
      compendiumPacks: ['dnd5e.monsterfeatures', 'dnd5e.classfeatures'],
      serverDefaults: ['compendiumPacks'],
    });
  });

  it('refuses wrong parameters before asking anything', async () => {
    const { context: ctx, sent } = context('dnd5e', () => ({}));
    await expect(
      addFeatureTool.handler(
        { featureType: 'aura', actorIdentifier: 'A', featureName: 'Heat' },
        ctx
      )
    ).rejects.toThrow(/damageParts is required for featureType "aura".*Nothing was changed/);
    expect(sent).toEqual([]);
  });

  it('refuses in another system, naming it, and never sends the builder query', async () => {
    const { context: ctx, sent } = context('pf2e', () => ({}));
    await expect(createNpcTool.handler({ name: 'X' }, ctx)).rejects.toThrow(
      /Detected game system: "pf2e"/
    );
    expect(sent.map(entry => entry.name)).toEqual(['getWorldInfo']);
  });

  it('keeps the cause: a module that lacks the query, and an old refusal as a value', async () => {
    const tooOld = context('dnd5e', () => {
      throw Object.assign(
        new Error('No handler found for query: ninjos-foundry-mcp.createNpcActor'),
        { moduleCode: 'UNKNOWN_QUERY' }
      );
    });
    await expect(createNpcTool.handler({ name: 'X' }, tooOld.context)).rejects.toThrow(
      /older than this server/
    );
    systemDetector.invalidate();
    const refused = context('dnd5e', () => ({ success: false, error: 'Access denied' }));
    await expect(createNpcTool.handler({ name: 'X' }, refused.context)).rejects.toThrow(
      /Failed to create the NPC "X": Access denied/
    );
  });

  it('treats an import that added nothing and missed names as an error', () => {
    expect(() =>
      importResult({ added: [], notFound: ['Wish'], failed: [], skipped: [] }, 'spells')
    ).toThrow(/No spells were added.*Wish/);
    expect(
      importResult({ added: [], notFound: [], failed: [], skipped: [{ name: 'Shield' }] }, 'spells')
    ).toMatchObject({ added: [] });
  });
});
