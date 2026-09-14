/**
 * The view. Reading what the canvas shows, panning, pinging and
 * the Gamemaster's targets.
 *
 * Rights: panning only the Gamemaster's own view
 * changes nothing anyone else sees and counts as reading. Pulling everyone's
 * view, a ping and targets are seen by the players, so they need the switch
 * "Allow Write Operations", but no level: no document changes. None of the
 * three is recorded in the change log, which holds changes to documents.
 *
 * All four actions need the drawn canvas; without it they fail and say why.
 */
import { WRITE_SWITCH_ONLY } from '../../../common/permissions.js';
import type { QueryHandler } from '../../dispatcher.js';
import { requireWorld } from '../../world-ready.js';
import {
  argsOf,
  board,
  fail,
  finite,
  gridOf,
  idsIn,
  numberIn,
  operation,
  optionalBoolean,
  placeOf,
  READ,
  requireBoard,
  sceneInfo,
  sceneList,
  tokenOn,
  type Located,
} from './support.js';
import { canvasNotes } from './texts.js';

export const PING_STYLES = ['pulse', 'alert', 'chevron', 'arrow'] as const;
export const MAX_TARGETS = 50;

/** Tools that fail without a drawn canvas, named in get-canvas-view. */
export const CANVAS_ONLY_TOOLS = ['pan-camera', 'ping-canvas', 'set-targets'];

function viewOf(canvas: FoundryCanvasBoard): { x: number; y: number; scale: number } | null {
  const pivot = canvas.stage?.pivot;
  const scale = canvas.stage?.scale;
  return pivot && finite(pivot.x) && finite(pivot.y) && scale && finite(scale.x)
    ? { x: pivot.x, y: pivot.y, scale: scale.x }
    : null;
}

function targetsOf(user: FoundryUser | null): Array<{ id: string; name: string }> {
  const targets = (user as FoundryTargetingUser | null)?.targets;
  if (!(targets instanceof Set)) return [];
  return [...targets].map(target => ({
    id: target.id,
    name: target.document?.name ?? '',
  }));
}

function noCanvasSetting(): boolean | null {
  try {
    const value = game.settings.get('core', 'noCanvas');
    return typeof value === 'boolean' ? value : null;
  } catch {
    return null;
  }
}

export const getCanvasView: QueryHandler = {
  access: READ,
  run: () =>
    operation('read the canvas view', () => {
      requireWorld();
      const canvas = board();
      const ready = canvas?.ready === true && !!canvas.scene;
      const viewed =
        ready && canvas?.scene
          ? (game.scenes.get(canvas.scene.id) as FoundryCanvasScene | undefined)
          : undefined;
      const active = sceneList().find(scene => scene.active === true);
      return {
        canvasReady: ready,
        noCanvas: noCanvasSetting(),
        viewedScene: viewed ? { id: viewed.id, name: viewed.name ?? '' } : null,
        activeScene: active ? { id: active.id, name: active.name ?? '' } : null,
        view: ready && canvas ? viewOf(canvas) : null,
        targets: targetsOf(game.user),
        needsCanvas: CANVAS_ONLY_TOOLS,
      };
    }),
};

function samePlace(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1;
}

export const panCamera: QueryHandler = {
  access: data => (argsOf(data)['forEveryone'] === true ? WRITE_SWITCH_ONLY : READ),
  run: data =>
    operation('pan the camera', async () => {
      requireWorld();
      const args = argsOf(data);
      const { canvas, chosen } = requireBoard('Panning the camera', args);
      const grid = gridOf(chosen.scene);
      const forEveryone = optionalBoolean(args, 'forEveryone') === true;
      const scale = numberIn(args, 'scale', { min: 0.05, max: 10 });
      const duration = numberIn(args, 'duration', { min: 0, max: 10_000, integer: true }) ?? 250;
      let place: Located | undefined;
      if (typeof args['tokenId'] === 'string' && args['tokenId'].trim()) {
        const token = tokenOn(chosen.scene, args['tokenId'].trim());
        place = placeOf({ at: { tokenId: token.id } }, 'at', chosen.scene, grid);
      } else if (args['x'] !== undefined || args['y'] !== undefined) {
        place = placeOf({ at: { x: args['x'], y: args['y'] } }, 'at', chosen.scene, grid);
      }
      if (!place && scale === undefined)
        fail(
          'INVALID_ARGUMENT',
          'Give tokenId, or x and y, or scale; otherwise there is nothing to pan to.'
        );
      if (typeof canvas.animatePan !== 'function')
        fail(
          'CANVAS_REQUIRED',
          'The canvas of this Foundry version has no animatePan. Nothing was done.'
        );

      const before = viewOf(canvas);
      const view: { x?: number; y?: number; scale?: number; duration: number } = { duration };
      if (place) {
        view.x = place.point.x;
        view.y = place.point.y;
      }
      if (scale !== undefined) view.scale = scale;
      await canvas.animatePan(view);
      const after = viewOf(canvas);

      const warnings: string[] = [];
      if (!after) warnings.push('The view could not be read back from the canvas.');
      if (after && place && !samePlace(after, place.point))
        warnings.push(
          `Foundry stopped the view at x ${Math.round(after.x)}, y ${Math.round(after.y)} instead of the point asked for, usually at the edge of the scene.`
        );
      if (after && scale !== undefined && Math.abs(after.scale - scale) > 0.01)
        warnings.push(
          `Foundry set the zoom to ${after.scale} instead of ${scale}; it keeps the zoom within its limits.`
        );

      let pulled = false;
      if (forEveryone) {
        if (typeof canvas.ping !== 'function')
          fail(
            'CANVAS_REQUIRED',
            'The canvas of this Foundry version has no ping, so the other views cannot be moved. Only the Gamemaster view moved.'
          );
        const center = place?.point ?? (after ? { x: after.x, y: after.y } : before);
        if (!center)
          fail(
            'NOT_APPLIED',
            'The point to move everyone to could not be read. Only the Gamemaster view moved.'
          );
        const sent = await canvas.ping(
          { x: center.x, y: center.y },
          {
            style: 'chevron',
            pull: true,
            ...(after ? { zoom: after.scale } : scale !== undefined ? { zoom: scale } : {}),
          }
        );
        if (sent === false)
          fail(
            'NOT_APPLIED',
            'The Gamemaster view moved, but Foundry did not send the pull to the other users (canvas.ping answered false).'
          );
        pulled = true;
        if (sent !== true)
          warnings.push(
            'Foundry did not confirm that the pull was sent; whether the players saw it cannot be read back.'
          );
        canvasNotes.announce('viewsPulled', { scene: chosen.scene.name ?? chosen.scene.id });
      }
      return {
        scene: sceneInfo(chosen),
        ...(place?.token ? { token: place.token } : {}),
        requested: {
          ...(place ? { x: place.point.x, y: place.point.y } : {}),
          ...(scale !== undefined ? { scale } : {}),
        },
        before,
        view: after,
        forEveryone,
        pulled,
        warnings,
      };
    }),
};

export const pingCanvas: QueryHandler = {
  access: WRITE_SWITCH_ONLY,
  run: data =>
    operation('ping the canvas', async () => {
      requireWorld();
      const args = argsOf(data);
      const { canvas, chosen } = requireBoard('A ping', args);
      const grid = gridOf(chosen.scene);
      const place = placeOf(
        {
          at:
            typeof args['tokenId'] === 'string'
              ? { tokenId: args['tokenId'] }
              : { x: args['x'], y: args['y'] },
        },
        'at',
        chosen.scene,
        grid
      );
      const style = args['style'] ?? 'pulse';
      if (typeof style !== 'string' || !(PING_STYLES as readonly string[]).includes(style))
        fail('INVALID_ARGUMENT', `style must be one of ${PING_STYLES.join(', ')}`);
      const pull = optionalBoolean(args, 'pullViews') === true;
      const zoom = numberIn(args, 'zoom', { min: 0.05, max: 10 });
      if (typeof canvas.ping !== 'function')
        fail(
          'CANVAS_REQUIRED',
          'The canvas of this Foundry version has no ping. Nothing was done.'
        );
      const sent = await canvas.ping(place.point, {
        style,
        pull,
        ...(zoom !== undefined ? { zoom } : {}),
      });
      if (sent === false)
        fail('NOT_APPLIED', 'Foundry did not send the ping (canvas.ping answered false).');
      if (pull)
        canvasNotes.announce('viewsPulled', { scene: chosen.scene.name ?? chosen.scene.id });
      return {
        scene: sceneInfo(chosen),
        point: place.point,
        ...(place.token ? { token: place.token } : {}),
        style,
        pulled: pull,
        confirmed: sent === true,
        warnings:
          sent === true
            ? []
            : ['Foundry did not confirm the ping; whether the players saw it cannot be read back.'],
      };
    }),
};

export const setTargets: QueryHandler = {
  access: WRITE_SWITCH_ONLY,
  run: data =>
    operation('set targets', async () => {
      requireWorld();
      const args = argsOf(data);
      const identifiers = idsIn(args, 'tokenIds', MAX_TARGETS, 0);
      const { chosen } = requireBoard('Setting targets', args);
      const problems: string[] = [];
      const tokens: FoundryCanvasToken[] = [];
      for (const identifier of identifiers) {
        try {
          tokens.push(tokenOn(chosen.scene, identifier));
        } catch (error) {
          problems.push(error instanceof Error ? error.message : String(error));
        }
      }
      if (problems.length) fail('TOKEN_NOT_FOUND', `${problems.join(' ')} No target was changed.`);
      const ids = [...new Set(tokens.map(token => token.id))];
      const user = game.user as FoundryTargetingUser | null;
      if (!user || typeof user.updateTokenTargets !== 'function')
        fail(
          'NO_FOUNDRY',
          'The logged in user has no updateTokenTargets in this Foundry version. No target was changed.'
        );
      const previous = targetsOf(user);
      await user.updateTokenTargets(ids);
      const now = targetsOf(user);
      const nowIds = new Set(now.map(target => target.id));
      if (nowIds.size !== ids.length || ids.some(id => !nowIds.has(id))) {
        fail(
          'NOT_APPLIED',
          `Foundry holds the targets ${now.map(t => t.id).join(', ') || 'none'} instead of ${ids.join(', ') || 'none'} when read back.`
        );
      }
      return { scene: sceneInfo(chosen), previous, targets: now };
    }),
};
