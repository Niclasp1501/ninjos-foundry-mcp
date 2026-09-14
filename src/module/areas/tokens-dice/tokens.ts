/**
 * Move-token, update-token, delete-tokens, get-token-details.
 *
 * Tokens lie in scenes, so moving, changing and deleting a token is a change
 * to a scene: the switch and the scene level decide, and deleting a token
 * needs no more than that. It never deletes an actor; the level "full" for
 * scenes would also allow deleting whole scenes.
 *
 * Every write is read back from the world collection before success is
 * reported, and each answer carries the fields both server generations read.
 */
import { smallEnough } from '../../../common/change-log.js';
import {
  dispositionWord,
  readTokenUpdates,
  type TokenUpdateKey,
} from '../../../common/areas/tokens-dice/tokens.js';
import type { Access } from '../../../common/permissions.js';
import { afterWriteWarning, errorText, settleWrite } from '../../client-errors.js';
import type { QueryHandler } from '../../dispatcher.js';
import { requireWorld } from '../../world-ready.js';
import {
  argsOf,
  chooseScene,
  fail,
  finiteNumber,
  findToken,
  freshToken,
  messageOf,
  operation,
  optionalBoolean,
  requiredText,
  sceneInfo,
  tokenLabel,
  tokenNotFoundText,
  tokenTarget,
} from './support.js';

export const SCENE_CHANGE: Access = { kind: 'write', document: 'Scenes', action: 'update' };

const fieldOf = (token: FoundryTokensDiceToken, key: string): unknown =>
  (token as unknown as Record<string, unknown>)[key] ?? null;

export const moveToken: QueryHandler = {
  access: SCENE_CHANGE,
  run: (raw, context) =>
    operation('move token', async () => {
      requireWorld();
      const args = argsOf(raw);
      const tokenId = requiredText(args, 'tokenId');
      const x = args['x'];
      const y = args['y'];
      if (!finiteNumber(x) || !finiteNumber(y))
        fail('INVALID_ARGUMENT', 'x and y coordinates are required and must be numbers');
      // The tool's default. A server of the previous generation always sends the field.
      const animate = optionalBoolean(args, 'animate') ?? false;
      const chosen = chooseScene(args);
      const token = findToken(chosen, tokenId);
      const before = { x: token.x, y: token.y };

      // Read back even when Foundry throws: its client code can fail after the server stored the move.
      const attempt = await settleWrite(() => token.update({ x, y }, { animate }));
      const stored = freshToken(chosen, tokenId);
      if (!stored) fail('NOT_APPLIED', `The token ${tokenLabel(token)} is gone after moving it`);
      if (stored.x !== x || stored.y !== y) {
        fail(
          attempt.threw ? 'UPDATE_FAILED' : 'NOT_APPLIED',
          (attempt.threw ? `Foundry refused the move: ${errorText(attempt.error)}. ` : '') +
            `Foundry stored the position ${stored.x}, ${stored.y} for ${tokenLabel(stored)} instead of ${x}, ${y}`
        );
      }
      context.recordChange({
        query: 'move-token',
        tool: 'move-token',
        document: 'Scenes',
        action: 'update',
        targets: [tokenTarget(stored)],
        summary: `Moved the token ${tokenLabel(stored)} on the scene "${chosen.scene.name ?? ''}" from ${before.x}, ${before.y} to ${x}, ${y}.`,
        before,
        after: { x, y },
      });
      return {
        success: true,
        tokenId,
        tokenName: stored.name ?? '',
        newPosition: { x: stored.x, y: stored.y },
        previousPosition: before,
        animated: animate,
        ...(attempt.threw
          ? {
              warnings: [
                afterWriteWarning(attempt.error, 'Read back, the token stands where it was sent.'),
              ],
            }
          : {}),
        scene: sceneInfo(chosen),
      };
    }),
};

export const updateToken: QueryHandler = {
  access: SCENE_CHANGE,
  run: (raw, context) =>
    operation('update token', async () => {
      requireWorld();
      const args = argsOf(raw);
      const tokenId = requiredText(args, 'tokenId');
      if (args['updates'] === undefined || args['updates'] === null)
        fail('INVALID_ARGUMENT', 'updates object is required');
      const { updates, problems } = readTokenUpdates(args['updates']);
      if (problems.length) fail('INVALID_ARGUMENT', `Nothing was changed. ${problems.join('; ')}`);
      const chosen = chooseScene(args);
      const token = findToken(chosen, tokenId);
      const keys = Object.keys(updates) as TokenUpdateKey[];
      const before = Object.fromEntries(keys.map(key => [key, fieldOf(token, key)]));

      const attempt = await settleWrite(() => token.update({ ...updates }));
      const stored = freshToken(chosen, tokenId);
      if (!stored) fail('NOT_APPLIED', `The token ${tokenLabel(token)} is gone after changing it`);
      const applied = Object.fromEntries(keys.map(key => [key, fieldOf(stored, key)]));
      const differing = keys.filter(key => applied[key] !== updates[key]);
      const detail = (key: TokenUpdateKey) =>
        `${key}: sent ${JSON.stringify(updates[key])}, stored ${JSON.stringify(applied[key])}`;
      if (differing.length === keys.length) {
        fail(
          attempt.threw ? 'UPDATE_FAILED' : 'NOT_APPLIED',
          (attempt.threw ? `Foundry refused the change: ${errorText(attempt.error)}. ` : '') +
            `Foundry kept none of the changes to ${tokenLabel(stored)}: ${differing.map(detail).join('; ')}`
        );
      }
      const warnings: string[] = [];
      if (attempt.threw)
        warnings.push(
          afterWriteWarning(attempt.error, 'Read back, the token holds the changes listed here.')
        );
      if (differing.length)
        warnings.push(
          `Foundry stored some values differently: ${differing.map(detail).join('; ')}`
        );
      context.recordChange({
        query: 'update-token',
        tool: 'update-token',
        document: 'Scenes',
        action: 'update',
        targets: [tokenTarget(stored)],
        summary: `Changed ${keys.join(', ')} of the token ${tokenLabel(stored)} on the scene "${chosen.scene.name ?? ''}".`,
        before,
        after: applied,
      });
      return {
        success: true,
        tokenId,
        tokenName: stored.name ?? '',
        updated: true,
        updatedProperties: keys,
        appliedUpdates: applied,
        ...(warnings.length ? { warnings } : {}),
        scene: sceneInfo(chosen),
      };
    }),
};

export const deleteTokens: QueryHandler = {
  access: SCENE_CHANGE,
  run: (raw, context) =>
    operation('delete tokens', async () => {
      requireWorld();
      const args = argsOf(raw);
      const list = args['tokenIds'];
      if (!Array.isArray(list) || list.length === 0)
        fail('INVALID_ARGUMENT', 'tokenIds array is required and must not be empty');
      if (list.some(id => typeof id !== 'string' || !id.trim()))
        fail('INVALID_ARGUMENT', 'every entry of tokenIds must be the id of a token');
      const ids = [...new Set((list as string[]).map(id => id.trim()))];
      const chosen = chooseScene(args);

      // Every id is checked first: a wrong id means the picture of the scene is wrong, so nothing goes.
      const missing = ids.filter(id => !chosen.scene.tokens?.get(id));
      if (missing.length) {
        fail(
          'TOKEN_NOT_FOUND',
          `Nothing was deleted. ${missing.map(id => tokenNotFoundText(chosen, id)).join(' ')}`
        );
      }

      const deleted: Array<{ id: string; name: string; actorId: string | null; uuid: string }> = [];
      const failed: Array<{ id: string; name: string; reason: string }> = [];
      const before: unknown[] = [];
      // Deleted by the server although Foundry's client code threw afterwards (no drawn canvas).
      const goneDespite: Array<{ id: string; error: unknown }> = [];
      for (const id of ids) {
        const token = chosen.scene.tokens?.get(id);
        if (!token) {
          failed.push({ id, name: '', reason: 'it vanished from the scene before its turn' });
          continue;
        }
        const name = token.name ?? '';
        const data = token.toObject();
        const attempt = await settleWrite(() =>
          chosen.scene.deleteEmbeddedDocuments('Token', [id])
        );
        if (freshToken(chosen, id)) {
          failed.push({
            id,
            name,
            reason: attempt.threw
              ? messageOf(attempt.error)
              : 'it is still on the scene after deleting it',
          });
          continue;
        }
        if (attempt.threw) goneDespite.push({ id, error: attempt.error });
        deleted.push({ id, name, actorId: token.actorId ?? null, uuid: token.uuid });
        before.push(data);
      }
      const warnings = goneDespite.length
        ? [
            afterWriteWarning(
              goneDespite[0]?.error,
              `Read back, ${goneDespite.map(entry => entry.id).join(', ')} ${goneDespite.length === 1 ? 'is' : 'are'} ` +
                'gone, counted as deleted and recorded, so undo-change can recreate them.'
            ),
          ]
        : [];

      if (deleted.length === 0) {
        fail(
          'NOT_APPLIED',
          `No token was deleted: ${failed.map(f => `${f.id} (${f.reason})`).join('; ')}`
        );
      }
      context.recordChange({
        query: 'delete-tokens',
        tool: 'delete-tokens',
        document: 'Scenes',
        action: 'delete',
        // With the uuid, so undo-change finds the scene to recreate them in.
        targets: deleted.map(token => ({
          id: token.id,
          uuid: token.uuid,
          name: token.name,
          documentName: 'Token',
        })),
        summary: `Deleted ${deleted.length} token(s) from the scene "${chosen.scene.name ?? ''}": ${deleted.map(t => `"${t.name}"`).join(', ')}. Their actors were not touched.`,
        before: smallEnough(before),
      });
      return {
        success: true,
        partial: failed.length > 0,
        deletedCount: deleted.length,
        deletedTokens: deleted.map(({ uuid: _uuid, ...token }) => token),
        failedTokens: failed,
        ...(warnings.length ? { warnings } : {}),
        // The field names a server of the previous generation reads.
        tokenIds: deleted.map(token => token.id),
        errors: failed.map(entry => `${entry.id}: ${entry.reason}`),
        scene: sceneInfo(chosen),
      };
    }),
};

export const getTokenDetails: QueryHandler = {
  access: { kind: 'read' },
  run: raw =>
    operation('get token details', () => {
      requireWorld();
      const args = argsOf(raw);
      const tokenId = requiredText(args, 'tokenId');
      const chosen = chooseScene(args);
      const token = findToken(chosen, tokenId);
      const actorId = token.actorId ?? null;
      const actor =
        token.actor ??
        (actorId ? (game.actors.get(actorId) as FoundryTokensDiceActor | undefined) : undefined) ??
        null;
      const disposition = typeof token.disposition === 'number' ? token.disposition : 0;
      // Flat, with the field names a server of the previous generation reads.
      return {
        success: true,
        id: token.id,
        name: token.name ?? '',
        x: token.x,
        y: token.y,
        width: token.width ?? 1,
        height: token.height ?? 1,
        rotation: token.rotation ?? 0,
        scale: token.texture?.scaleX ?? 1,
        alpha: token.alpha ?? 1,
        hidden: token.hidden === true,
        img: token.texture?.src ?? null,
        disposition,
        dispositionName: dispositionWord(disposition),
        elevation: token.elevation ?? 0,
        lockRotation: token.lockRotation === true,
        actorId,
        actorLink: token.actorLink === true,
        actorData: actor
          ? {
              id: actor.id,
              name: actor.name ?? '',
              type: actor.type ?? null,
              img: actor.img ?? null,
            }
          : null,
        scene: sceneInfo(chosen),
      };
    }),
};
