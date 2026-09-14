/**
 * The seven tools from the registry to the module handler and back, and the
 * answer forms of a module of the previous generation.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { openWorld, type World } from '../../../module/areas/tokens-dice/world.test.js';
import type { ToolContext } from '../../tools/types.js';
import {
  deleteTokensTool,
  getTokenDetailsTool,
  moveTokenTool,
  toggleTokenConditionTool,
  tokensDiceTools,
} from './tools.js';

let world: World | null = null;
afterEach(() => {
  world?.harness.close();
  world = null;
});
const open = (options: Parameters<typeof openWorld>[0] = {}) => (world = openWorld(options));
const json = (result: { content: Array<{ text?: string }> }) =>
  JSON.parse(result.content[0]?.text ?? 'null');
const textOf = (result: { content: Array<{ text?: string }> }) => result.content[0]?.text ?? '';

describe('the tools through the registry', () => {
  it('offers all seven in their groups', async () => {
    const w = open();
    const listed = (await w.harness.tools.list()).map(tool => tool.name);
    for (const tool of tokensDiceTools) expect(listed).toContain(tool.name);
    expect(tokensDiceTools.map(tool => tool.group)).toEqual([
      'tokens',
      'tokens',
      'tokens',
      'tokens',
      'tokens',
      'tokens',
      'dice',
    ]);
  });

  it('moves a token on another scene and names the scene', async () => {
    const w = open();
    const result = await w.harness.call('move-token', {
      tokenId: 'tokX',
      x: 50,
      y: 60,
      sceneIdentifier: 'Keller',
    });
    expect(result.isError).toBeUndefined();
    expect(json(result)).toMatchObject({
      newPosition: { x: 50, y: 60 },
      scene: { name: 'Keller', chosenBy: 'sceneIdentifier' },
    });
  });

  it('refuses an unknown update field before the module, and a refusal with its cause', async () => {
    const w = open();
    const unknown = await w.harness.call('update-token', {
      tokenId: 'tok1',
      updates: { img: 'x.webp' },
    });
    expect(textOf(unknown)).toBe(
      'Error: Invalid arguments for update-token: updates.img is not a known parameter'
    );
    w.foundry.setUser('p1');
    expect(textOf(await w.harness.call('get-token-details', { tokenId: 'tok1' }))).toBe(
      'Error: Failed to get token details: Access denied: only a Gamemaster can use the MCP bridge'
    );
  });

  it('shows details nested, deletions with both lists and conditions', async () => {
    const w = open();
    expect(json(await w.harness.call('get-token-details', { tokenId: 'tok2' }))).toMatchObject({
      behavior: { disposition: 'hostile' },
      actor: { id: 'actorG', isLinked: false },
      scene: { id: 'scene1' },
    });
    expect(
      json(
        await w.harness.call('toggle-token-condition', { tokenId: 'tok1', conditionId: 'prone' })
      )
    ).toMatchObject({
      isActive: true,
      changed: true,
    });
    expect(json(await w.harness.call('get-available-conditions'))).toMatchObject({
      gameSystem: 'testsys',
    });
    expect(json(await w.harness.call('delete-tokens', { tokenIds: ['tok3'] }))).toMatchObject({
      deletedCount: 1,
      deletedTokens: [{ id: 'tok3', name: 'Crate' }],
      failedTokens: [],
    });
  });

  it('sends a roll request and requires the confirmed visibility', async () => {
    const w = open();
    const sent = await w.harness.call('request-player-rolls', {
      rollType: 'custom',
      rollTarget: '2d6',
      targetPlayer: 'Clara',
      isPublic: true,
      userConfirmedVisibility: true,
    });
    expect(textOf(sent)).toMatch(
      /^Roll request sent successfully! Roll request sent to Clara\. Public roll button created in chat\.\nRoll: Custom roll\nFormula: 2d6\nChat message: /
    );
    const unconfirmed = await w.harness.call('request-player-rolls', {
      rollType: 'custom',
      rollTarget: '2d6',
      targetPlayer: 'Clara',
      isPublic: true,
      userConfirmedVisibility: false,
    });
    expect(unconfirmed.isError).toBe(true);
    expect(textOf(unconfirmed)).toContain('userConfirmedVisibility must be one of true');
  });
});

describe('a module of the previous generation', () => {
  function context(answers: Record<string, unknown>): ToolContext & { asked: string[] } {
    const asked: string[] = [];
    return {
      asked,
      progress: () => undefined,
      query: async name => {
        asked.push(name);
        const answer = answers[name];
        if (answer instanceof Error) throw answer;
        if (answer === undefined)
          throw new Error(`No handler found for query: ninjos-foundry-mcp.${name}`);
        return answer;
      },
    };
  }

  it('reads deletedTokens and failedTokens', async () => {
    const ctx = context({
      'delete-tokens': {
        success: true,
        deletedCount: 1,
        deletedTokens: ['a'],
        failedTokens: ['b'],
      },
    });
    expect(await deleteTokensTool.handler({ tokenIds: ['a', 'b'] }, ctx)).toMatchObject({
      deletedCount: 1,
      deletedTokens: [{ id: 'a' }],
      failedTokens: [{ id: 'b' }],
    });
  });

  it('turns Access denied and zero deletions into errors', async () => {
    const denied = context({ 'move-token': { error: 'Access denied', success: false } });
    await expect(moveTokenTool.handler({ tokenId: 't', x: 1, y: 1 }, denied)).rejects.toThrow(
      'Failed to move token: Access denied: the module refused because the connected Foundry user is not a Gamemaster.'
    );
    const nothing = context({
      'delete-tokens': { success: true, deletedCount: 0, deletedTokens: [], failedTokens: ['b'] },
    });
    await expect(deleteTokensTool.handler({ tokenIds: ['b'] }, nothing)).rejects.toThrow(
      'no token was deleted: b'
    );
  });

  it('puts "Failed to" in front only once', async () => {
    const ctx = context({
      'move-token': new Error('Failed to move token: Failed to move token: No active scene found'),
    });
    await expect(moveTokenTool.handler({ tokenId: 't', x: 1, y: 1 }, ctx)).rejects.toThrow(
      /^Failed to move token: Failed to move token: No active scene found$/
    );
  });

  it('refuses sceneIdentifier before anything is sent to the old module', async () => {
    const ctx = context({ 'move-token': { success: true } });
    await expect(
      moveTokenTool.handler({ tokenId: 't', x: 1, y: 1, sceneIdentifier: 'Keller' }, ctx)
    ).rejects.toThrow('the connected Foundry module does not know sceneIdentifier');
    expect(ctx.asked).toEqual(['tokensDiceCapabilities']);
  });

  it('nests the flat details and takes active for isActive', async () => {
    const details = context({
      'get-token-details': {
        success: true,
        id: 't',
        name: 'T',
        x: 1,
        y: 2,
        disposition: 0,
        actorId: 'a',
        actorData: { name: 'A', type: 'npc' },
        actorLink: true,
      },
    });
    expect(await getTokenDetailsTool.handler({ tokenId: 't' }, details)).toMatchObject({
      behavior: { disposition: 'neutral' },
      actor: { id: 'a', name: 'A', isLinked: true },
    });
    const toggle = context({
      'toggle-token-condition': {
        success: true,
        tokenId: 't',
        conditionId: 'prone',
        active: true,
        conditionName: 'Prone',
      },
    });
    expect(
      await toggleTokenConditionTool.handler(
        { tokenId: 't', conditionId: 'prone', active: true },
        toggle
      )
    ).toMatchObject({ isActive: true });
  });

  it('says the module is too old when it lacks the query', async () => {
    const ctx = context({});
    await expect(getTokenDetailsTool.handler({ tokenId: 't' }, ctx)).rejects.toThrow(
      /^Failed to get token details: the connected Foundry module does not know the query "get-token-details"/
    );
  });
});
