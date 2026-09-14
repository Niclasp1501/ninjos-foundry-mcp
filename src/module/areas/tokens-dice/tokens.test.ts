/**
 * The token queries through the dispatcher: scene choice, lookup, the switch
 * and the scene level, reading back, and the answer fields of both server
 * generations.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { failure, openWorld, type World } from './world.test.js';

let world: World | null = null;
afterEach(() => {
  world?.harness.close();
  world = null;
});
const open = (options: Parameters<typeof openWorld>[0] = {}) => (world = openWorld(options));
const token = (w: World, scene: string, id: string) =>
  w.foundry.collection('Scene').get(scene)?.getEmbeddedCollection('Token').get(id);

describe('move-token', () => {
  it('moves on the active scene, reads back and records the change', async () => {
    const w = open();
    const answer = await w.harness.query('move-token', {
      tokenId: 'tok1',
      x: 300,
      y: 400,
      animate: false,
    });
    expect(answer).toMatchObject({
      success: true,
      tokenId: 'tok1',
      tokenName: 'Aria',
      newPosition: { x: 300, y: 400 },
      previousPosition: { x: 100, y: 100 },
      animated: false,
      scene: { id: 'scene1', name: 'Hafen', chosenBy: 'active scene' },
    });
    expect(token(w, 'scene1', 'tok1')).toMatchObject({ x: 300, y: 400 });
    expect(w.harness.changeLog.list()[0]).toMatchObject({
      query: 'move-token',
      document: 'Scenes',
      undoable: true,
    });
  });

  it('answers under the camel case name as well, and uses sceneIdentifier', async () => {
    const w = open();
    await w.harness.query('moveToken', { tokenId: 'tokX', x: 9, y: 9, sceneIdentifier: 'keller' });
    expect(token(w, 'scene2', 'tokX')).toMatchObject({ x: 9, y: 9 });
  });

  it('says on which scene a token lies and that names are no ids', async () => {
    const w = open();
    const elsewhere = await failure(w.harness.query('move-token', { tokenId: 'tokX', x: 1, y: 1 }));
    expect(elsewhere.code).toBe('TOKEN_NOT_FOUND');
    expect(elsewhere.message).toBe(
      'Failed to move token: Token "tokX" not found on the scene "Hafen" [scene1] (the active scene). It lies on the scene "Keller" [scene2]; pass sceneIdentifier to work there.'
    );
    const byName = await failure(w.harness.query('move-token', { tokenId: 'goblin', x: 1, y: 1 }));
    expect(byName.message).toContain(
      'Tokens are identified by their id only; "goblin" is the name of tok2.'
    );
  });

  it('refuses without an active scene and without coordinates', async () => {
    const w = open({ activeScene: false });
    expect(
      await failure(w.harness.query('move-token', { tokenId: 'tok1', x: 1, y: 1 }))
    ).toMatchObject({
      code: 'NO_ACTIVE_SCENE',
    });
    expect(
      (await failure(w.harness.query('move-token', { tokenId: 'tok1', x: 1 }))).message
    ).toContain('x and y coordinates are required');
  });

  it('changes nothing with the switch off or the scene level on read', async () => {
    const off = open({ settings: { 'ninjos-foundry-mcp.allowWriteOperations': false } });
    expect(
      await failure(off.harness.query('move-token', { tokenId: 'tok1', x: 1, y: 1 }))
    ).toMatchObject({
      code: 'WRITE_DISABLED',
    });
    expect(off.foundry.operations).toEqual([]);
    off.harness.close();
    const read = open({ settings: { 'ninjos-foundry-mcp.permScenes': 'read' } });
    const refused = await failure(read.harness.query('delete-tokens', { tokenIds: ['tok3'] }));
    expect(refused.code).toBe('PERMISSION_DENIED');
    expect(refused.message).toContain('permScenes');
  });
});

describe('update-token', () => {
  it('applies the allowed fields and reports what Foundry stored', async () => {
    const w = open();
    const answer = await w.harness.query('update-token', {
      tokenId: 'tok2',
      updates: { hidden: true, disposition: -2, name: 'Sneaky', rotation: 90 },
    });
    expect(answer).toMatchObject({
      success: true,
      updated: true,
      tokenName: 'Sneaky',
      updatedProperties: ['rotation', 'hidden', 'disposition', 'name'],
      appliedUpdates: { hidden: true, disposition: -2, name: 'Sneaky', rotation: 90 },
    });
    expect(token(w, 'scene1', 'tok2')).toMatchObject({ hidden: true, disposition: -2 });
  });

  it('refuses unknown fields and an empty change before writing', async () => {
    const w = open();
    const unknown = await failure(
      w.harness.query('update-token', { tokenId: 'tok2', updates: { actorId: 'x' } })
    );
    expect(unknown).toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(unknown.message).toContain('cannot change: actorId');
    expect(
      (await failure(w.harness.query('update-token', { tokenId: 'tok2', updates: {} }))).message
    ).toContain('nothing to change');
    expect(w.foundry.operations).toEqual([]);
  });
});

describe('delete-tokens', () => {
  it('deletes tokens and never their actors, with both field pairs', async () => {
    const w = open();
    const answer = await w.harness.query('delete-tokens', { tokenIds: ['tok1', 'tok2', 'tok1'] });
    expect(answer).toMatchObject({
      success: true,
      partial: false,
      deletedCount: 2,
      deletedTokens: [
        { id: 'tok1', name: 'Aria', actorId: 'actorA' },
        { id: 'tok2', name: 'Goblin', actorId: 'actorG' },
      ],
      failedTokens: [],
      tokenIds: ['tok1', 'tok2'],
      errors: [],
    });
    expect(w.foundry.collection('Actor').has('actorA')).toBe(true);
    expect(w.foundry.operations.every(op => op.documentName === 'Token')).toBe(true);
    expect(w.harness.changeLog.list()[0]).toMatchObject({ action: 'delete', undoable: true });
  });

  it('deletes nothing when one id is not on the scene', async () => {
    const w = open();
    const refused = await failure(w.harness.query('delete-tokens', { tokenIds: ['tok1', 'tokX'] }));
    expect(refused.code).toBe('TOKEN_NOT_FOUND');
    expect(refused.message).toMatch(
      /^Failed to delete tokens: Nothing was deleted\. Token "tokX" not found/
    );
    expect(token(w, 'scene1', 'tok1')).toBeDefined();
  });

  it('reports per token what failed, and fails when nothing went', async () => {
    const w = open();
    w.foundry.onWrite(op => {
      if (op.id === 'tok3') throw new Error('locked by another module');
    });
    const answer = await w.harness.query('delete-tokens', { tokenIds: ['tok2', 'tok3'] });
    expect(answer).toMatchObject({
      partial: true,
      deletedCount: 1,
      failedTokens: [{ id: 'tok3', name: 'Crate', reason: 'locked by another module' }],
      errors: ['tok3: locked by another module'],
    });
    const none = await failure(w.harness.query('delete-tokens', { tokenIds: ['tok3'] }));
    expect(none).toMatchObject({ code: 'NOT_APPLIED' });
    expect(none.message).toContain('No token was deleted: tok3 (locked by another module)');
  });

  // Seen in a real world: without a drawn canvas Foundry throws after its server deleted the token.
  it('counts a token Foundry deleted before throwing as deleted, and undo recreates it', async () => {
    const w = open({ settings: { 'ninjos-foundry-mcp.permScenes': 'full' } });
    w.foundry.hooks.on('deleteToken', () => {
      throw new TypeError("Cannot read properties of null (reading 'clipboard')");
    });
    const answer = (await w.harness.query('delete-tokens', { tokenIds: ['tok2'] })) as Record<
      string,
      unknown
    >;
    expect(answer).toMatchObject({ deletedCount: 1, partial: false, failedTokens: [] });
    expect((answer['warnings'] as string[])[0]).toContain(
      "TypeError: Cannot read properties of null (reading 'clipboard')"
    );
    expect(token(w, 'scene1', 'tok2')).toBeUndefined();
    const change = w.harness.changeLog.list()[0]!;
    expect(change.targets[0]).toMatchObject({ id: 'tok2', uuid: 'Scene.scene1.Token.tok2' });

    await w.harness.query('undoChanges', { changeId: change.id });
    expect(token(w, 'scene1', 'tok2')).toMatchObject({ name: 'Goblin' });
  });

  it('reads a move back instead of trusting a throw', async () => {
    const w = open();
    w.foundry.hooks.on('updateToken', () => {
      throw new TypeError("Cannot read properties of null (reading 'clipboard')");
    });
    const moved = (await w.harness.query('move-token', { tokenId: 'tok1', x: 7, y: 8 })) as Record<
      string,
      unknown
    >;
    expect(moved).toMatchObject({ newPosition: { x: 7, y: 8 } });
    expect((moved['warnings'] as string[])[0]).toContain('stands where it was sent');
  });
});

describe('get-token-details', () => {
  it('answers flat with the fields the previous server reads', async () => {
    const w = open();
    expect(await w.harness.query('get-token-details', { tokenId: 'tok1' })).toMatchObject({
      success: true,
      id: 'tok1',
      name: 'Aria',
      x: 100,
      y: 100,
      scale: 0.8,
      alpha: 1,
      img: 'aria.webp',
      disposition: 1,
      dispositionName: 'friendly',
      actorId: 'actorA',
      actorLink: true,
      actorData: { id: 'actorA', name: 'Aria', type: 'character', img: null },
    });
    expect(await w.harness.query('getTokenDetails', { tokenId: 'tok3' })).toMatchObject({
      actorId: null,
      actorData: null,
    });
  });

  it('reads with the switch off', async () => {
    const w = open({ settings: { 'ninjos-foundry-mcp.allowWriteOperations': false } });
    expect(await w.harness.query('get-token-details', { tokenId: 'tok2' })).toMatchObject({
      name: 'Goblin',
    });
  });
});
