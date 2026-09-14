/**
 * The mcp-extras area in the registers of the core: resource templates, completion
 * and prompts that read while they are built.
 */
import { describe, expect, it } from 'vitest';
import { installServerAreas } from './areas.js';
import {
  matchUriTemplate,
  MAX_COMPLETION_VALUES,
  PromptRegistry,
  ResourceRegistry,
  type ResourceContext,
} from './resources.js';

const context: ResourceContext = { query: async name => ({ asked: name }) };

describe('matchUriTemplate', () => {
  it('reads each variable from one path segment and decodes it', () => {
    expect(
      matchUriTemplate(
        'foundry://journal/{journalId}/page/{pageId}',
        'foundry://journal/j%201/page/p2'
      )
    ).toEqual({
      journalId: 'j 1',
      pageId: 'p2',
    });
  });

  it('refuses a URI with more or fewer segments, or a broken escape', () => {
    expect(
      matchUriTemplate('foundry://journal/{journalId}', 'foundry://journal/j1/page/p2')
    ).toBeNull();
    expect(matchUriTemplate('foundry://journal/{journalId}', 'foundry://journal/')).toBeNull();
    expect(matchUriTemplate('foundry://actor/{actorId}', 'foundry://actor/%E0%A4%A')).toBeNull();
    expect(matchUriTemplate('foundry://a.b/{id}', 'foundry://aXb/1')).toBeNull();
  });
});

describe('ResourceRegistry with templates', () => {
  const registry = new ResourceRegistry();
  registry.register({ uri: 'foundry://scene/active', name: 'active', read: async () => 'active' });
  registry.registerTemplate({
    uriTemplate: 'foundry://scene/{sceneId}',
    name: 'scene',
    mimeType: 'text/plain',
    read: async variables => `scene ${variables['sceneId']}`,
    complete: {
      sceneId: async (value, completion) =>
        Array.from({ length: 150 }, (_, i) => `${value}${i}${completion.arguments['x'] ?? ''}`),
    },
  });

  it('lists templates apart from resources, without their functions', () => {
    expect(registry.listTemplates()).toEqual([
      { uriTemplate: 'foundry://scene/{sceneId}', name: 'scene', mimeType: 'text/plain' },
    ]);
    expect(registry.list().map(r => r.uri)).toEqual(['foundry://scene/active']);
  });

  it('prefers a fixed resource, then fills a template, and names an unknown URI', async () => {
    expect((await registry.read('foundry://scene/active', context)).contents[0]?.text).toBe(
      'active'
    );
    expect(await registry.read('foundry://scene/abc', context)).toEqual({
      contents: [{ uri: 'foundry://scene/abc', mimeType: 'text/plain', text: 'scene abc' }],
    });
    await expect(registry.read('foundry://nothing', context)).rejects.toThrow(
      'Unknown resource "foundry://nothing"'
    );
  });

  it('caps completion values at the MCP limit and says there are more', async () => {
    const values = await registry.complete(
      'foundry://scene/{sceneId}',
      { argument: { name: 'sceneId', value: 's' }, arguments: { x: '!' } },
      context
    );
    expect(values.values).toHaveLength(MAX_COMPLETION_VALUES);
    expect(values.values[0]).toBe('s0!');
    expect(values).toMatchObject({ total: 150, hasMore: true });
    expect(
      await registry.complete(
        'foundry://scene/{sceneId}',
        { argument: { name: 'other', value: '' } },
        context
      )
    ).toEqual({ values: [], total: 0, hasMore: false });
    await expect(
      registry.complete('foundry://x/{y}', { argument: { name: 'y', value: '' } }, context)
    ).rejects.toThrow('Unknown resource template');
  });
});

describe('PromptRegistry', () => {
  it('builds asynchronously with the context and completes arguments', async () => {
    const prompts = new PromptRegistry();
    prompts.register({
      name: 'p',
      arguments: [{ name: 'need', required: true }],
      build: async (args, built) => ({
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `${args['need']} ${JSON.stringify(await built.query('q'))}`,
            },
          },
        ],
      }),
      complete: { need: async value => [`${value}-a`, `${value}-a`, `${value}-b`] },
    });
    expect(prompts.list()).toEqual([{ name: 'p', arguments: [{ name: 'need', required: true }] }]);
    await expect(prompts.get('p', {}, context)).rejects.toThrow('The prompt "p" needs: need');
    const result = await prompts.get('p', { need: 'x' }, context);
    expect(result.messages[0]?.content.text).toBe('x {"asked":"q"}');
    expect(
      await prompts.complete('p', { argument: { name: 'need', value: 'v' } }, context)
    ).toEqual({
      values: ['v-a', 'v-b'],
      total: 2,
      hasMore: false,
    });
  });
});

describe('installServerAreas with templates', () => {
  const template = { uriTemplate: 'foundry://t/{id}', name: 't', read: async () => '' };

  it('stops the start when two areas bring the same template, naming both', () => {
    expect(() =>
      installServerAreas(
        [
          { id: 'one', resourceTemplates: [template] },
          { id: 'two', resourceTemplates: [template] },
        ],
        {
          tools: { register: () => undefined },
          resources: new ResourceRegistry(),
          prompts: new PromptRegistry(),
        }
      )
    ).toThrow(
      'The resource template "foundry://t/{id}" of area "two" is already registered by area "one"'
    );
  });

  it('refuses a template when the target cannot take one', () => {
    expect(() =>
      installServerAreas([{ id: 'one', resourceTemplates: [template] }], {
        tools: { register: () => undefined },
        resources: { register: () => undefined },
        prompts: new PromptRegistry(),
      })
    ).toThrow('has no registry to go to');
  });
});
