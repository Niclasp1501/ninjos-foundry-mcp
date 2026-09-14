/**
 * The tools of the campaign area against the tool directory, a call from the
 * registry to the module handler and back, and the answer an older module gets.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { MODULE_AREAS } from '../../../module/areas/index.js';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { readToolDirectory } from '../../../testing/tool-directory.js';
import { CAMPAIGN_TOOLS } from './tools.js';

interface Schema {
  type?: string;
  enum?: unknown[];
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
}

const directory = readToolDirectory() as unknown as Array<{ name: string; inputSchema: Schema }>;

/** Structure of a schema without its descriptions: types, enums, required, nested properties and items. */
function shape(schema: Schema | undefined): unknown {
  if (!schema) return null;
  return {
    type: schema.type ?? null,
    enum: schema.enum ?? null,
    required: [...(schema.required ?? [])].sort(),
    properties: Object.fromEntries(
      Object.entries(schema.properties ?? {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => [key, shape(value)])
    ),
    items: shape(schema.items),
  };
}

let harness: AreaHarness | null = null;
afterEach(() => {
  harness?.close();
  harness = null;
});

describe('campaign tools', () => {
  it.each(CAMPAIGN_TOOLS.map(tool => [tool.name, tool] as const))(
    '%s has the name and parameters of the tool directory',
    (name, tool) => {
      const listed = directory.find(entry => entry.name === name);
      expect(listed, `${name} is in the tool directory`).toBeDefined();
      expect(shape(tool.inputSchema as Schema)).toEqual(shape(listed?.inputSchema));
      expect(tool.group).toBe('campaign');
      expect(tool.description).not.toMatch(/[–—]/);
      expect(tool.description).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  );

  it('covers every campaign tool of the previous generation', () => {
    expect(CAMPAIGN_TOOLS.map(tool => tool.name).sort()).toEqual([
      'create-campaign-dashboard',
      'create-quest-journal',
      'link-quest-to-npc',
      'update-quest-journal',
    ]);
  });

  it('creates a quest from the registry to the module and back', async () => {
    const h = (harness = createAreaHarness());
    const result = await h.call('create-quest-journal', {
      questTitle: 'Q',
      questDescription: 'D',
      questType: 'escort',
    });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]?.text ?? '')).toMatchObject({
      success: true,
      pageCount: 1,
    });
  });

  it('passes the cause of a module error on unchanged', async () => {
    const h = (harness = createAreaHarness());
    const result = await h.call('create-campaign-dashboard', {
      campaignTitle: 'C',
      campaignDescription: 'D',
      template: 'custom',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(
      'template "custom" needs customParts with at least one part'
    );
  });

  it('tells the model that an older module lacks the query, instead of its raw refusal', async () => {
    const h = (harness = createAreaHarness({
      moduleAreas: MODULE_AREAS.filter(area => area.id !== 'campaign'),
    }));
    const result = await h.call('link-quest-to-npc', {
      journalId: 'j',
      npcName: 'n',
      relationship: 'ally',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(
      'The connected Foundry module does not know the query linkQuestToNpc: it is older than this server.'
    );
  });
});
