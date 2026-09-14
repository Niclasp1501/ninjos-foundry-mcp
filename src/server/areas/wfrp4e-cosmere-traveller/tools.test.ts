import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { wfrp4eAdapter } from '../../../common/areas/wfrp4e-cosmere-traveller/wfrp4e.js';
import { serverSystemAdapters, systemDetector } from '../../game-systems.js';
import type { ToolContext } from '../../tools/types.js';
import { wfrp4eCosmereTravellerArea } from './index.js';
import { addItemsSchema, updateActorSchema } from './schemas.js';
import { addItemsTool, updateActorTool } from './tools.js';

let unregister: () => void = () => undefined;
beforeEach(() => {
  unregister = serverSystemAdapters.register(wfrp4eAdapter, 'wfrp4e-cosmere-traveller');
});
afterEach(() => {
  unregister();
  systemDetector.invalidate();
});

function context(
  system: string,
  answer: (name: string) => unknown
): { context: ToolContext; sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    context: {
      progress: () => undefined,
      query: async (name: string) => {
        sent.push(name);
        if (name === 'getWorldInfo')
          return { id: 'w', title: 'W', system, systemVersion: '1.0.0', foundryVersion: '14.350' };
        return answer(name);
      },
    } as unknown as ToolContext,
  };
}

describe('names and parameters', () => {
  it('keep the names, required fields and closed objects of the previous generation', () => {
    expect(wfrp4eCosmereTravellerArea.tools?.map(tool => tool.name)).toEqual([
      'wfrp4e-update-actor',
      'wfrp4e-add-items',
    ]);
    expect(updateActorSchema.required).toEqual(['actor']);
    expect(Object.keys(updateActorSchema.properties)).toEqual([
      'actor',
      'characteristics',
      'wounds',
      'skills',
      'career',
      'movement',
      'biography',
    ]);
    expect(Object.keys(updateActorSchema.properties.characteristics.properties)).toEqual([
      'ws',
      'bs',
      's',
      't',
      'i',
      'ag',
      'dex',
      'int',
      'wp',
      'fel',
    ]);
    expect(updateActorSchema.properties.characteristics.properties.ws).toMatchObject({
      additionalProperties: false,
      properties: {
        initial: { type: 'number' },
        advances: { type: 'number' },
        modifier: { type: 'number' },
      },
    });
    expect(updateActorSchema.properties.skills.items.required).toEqual(['name', 'advances']);
    expect(addItemsSchema.required).toEqual(['actor', 'items']);
    expect(addItemsSchema.properties.items).toMatchObject({
      minItems: 1,
      items: { required: ['name'], additionalProperties: false },
    });
    expect(Object.keys(addItemsSchema.properties.items.items.properties)).toEqual([
      'name',
      'type',
      'pack',
      'advances',
      'quantity',
      'setCurrent',
    ]);
  });

  it('write descriptions without dashes as sentence dashes and start with the system', () => {
    for (const tool of [updateActorTool, addItemsTool]) {
      expect(JSON.stringify([tool.description, tool.inputSchema])).not.toMatch(/[–—]/);
      expect(tool.description.startsWith('[WFRP4e only]')).toBe(true);
      expect(tool.group).toBe('systems');
    }
  });
});

describe('handlers', () => {
  it('say what is wrong before asking the module', async () => {
    const { context: ctx, sent } = context('wfrp4e', () => ({}));
    await expect(updateActorTool.handler({ actor: 'A' }, ctx)).rejects.toThrow(
      /Nothing to update: provide characteristics/
    );
    await expect(
      updateActorTool.handler({ actor: 'A', characteristics: { str: { initial: 1 } } }, ctx)
    ).rejects.toThrow(/Unknown characteristic key\(s\): str/);
    expect(sent).toEqual([]);
  });

  it('refuse in another system with the detected id', async () => {
    const { context: ctx, sent } = context('mgt2e', () => ({}));
    await expect(
      addItemsTool.handler({ actor: 'A', items: [{ name: 'Rope' }] }, ctx)
    ).rejects.toThrow(/requires the game system "wfrp4e". Detected game system: "mgt2e"/);
    expect(sent).toEqual(['getWorldInfo']);
  });

  it('pass the module cause on, name a module that is too old, and treat nothing added as an error', async () => {
    const refused = context('wfrp4e', () => {
      throw new Error('Actor not found: Bob');
    });
    await expect(
      updateActorTool.handler({ actor: 'Bob', movement: 4 }, refused.context)
    ).rejects.toThrow(/Failed to update the WFRP4e actor "Bob": Actor not found: Bob/);
    const old = context('wfrp4e', () => {
      throw new Error('No handler found for query: addWfrp4eItems');
    });
    await expect(
      addItemsTool.handler({ actor: 'Bob', items: [{ name: 'Rope' }] }, old.context)
    ).rejects.toThrow(/addWfrp4eItems/);
    const empty = context('wfrp4e', () => ({
      added: [],
      notFound: [],
      ambiguous: [{ name: 'Blessed' }],
    }));
    await expect(
      addItemsTool.handler({ actor: 'Bob', items: [{ name: 'Blessed' }] }, empty.context)
    ).rejects.toThrow(/No items could be added.*Blessed/);
  });
});
