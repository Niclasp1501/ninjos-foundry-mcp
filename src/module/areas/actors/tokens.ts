/**
 * Putting world actors into a scene as tokens, for manage-actors "place" and
 * create-actor-from-compendium with addToScene.
 *
 * Always the active scene, and the answer names it (the
 * old output said "current scene" and meant the active one). All tokens of a
 * call are created in one write and read back before success is reported.
 */
import {
  PlacementError,
  tokenPositions,
  type PlacementKind,
  type Point,
  type SceneRect,
} from '../../../common/areas/actors/placement.js';
import { afterWriteWarning, settleWrite } from '../../client-errors.js';
import { QueryError, type HandlerContext } from '../../dispatcher.js';
import { dropRemoteTokenImage, isRecord, messageOf } from './common.js';

export interface PlacedToken {
  id: string;
  name: string;
  actorId: string;
  x: number;
  y: number;
  hidden: boolean;
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** The scene rectangle without padding, from Foundry's dimensions or from width, height and padding. */
export function sceneRect(scene: FoundryActorsScene): SceneRect {
  const gridValue = scene.grid;
  const grid = number(gridValue) ?? (isRecord(gridValue) ? number(gridValue['size']) : null) ?? 100;
  const dims = isRecord(scene.dimensions) ? scene.dimensions : null;
  if (dims) {
    const x = number(dims['sceneX']);
    const y = number(dims['sceneY']);
    const width = number(dims['sceneWidth']);
    const height = number(dims['sceneHeight']);
    if (x !== null && y !== null && width !== null && height !== null)
      return { x, y, width, height, grid: number(dims['size']) ?? grid };
  }
  const width = number(scene.width) ?? 4000;
  const height = number(scene.height) ?? 3000;
  const padding = number(scene.padding) ?? 0;
  return {
    x: Math.ceil((width * padding) / grid) * grid,
    y: Math.ceil((height * padding) / grid) * grid,
    width,
    height,
    grid,
  };
}

async function tokenData(
  actor: FoundryActorsActor,
  point: Point,
  hidden: boolean
): Promise<Record<string, unknown>> {
  let data: Record<string, unknown> | null = null;
  if (typeof actor.getTokenDocument === 'function') {
    const document = await actor.getTokenDocument({ x: point.x, y: point.y, hidden });
    const toObject = (document as { toObject?: unknown } | null)?.toObject;
    if (typeof toObject === 'function') data = toObject.call(document) as Record<string, unknown>;
  }
  if (!data) {
    const source = actor.toObject();
    const prototype = isRecord(source['prototypeToken']) ? source['prototypeToken'] : {};
    data = { ...prototype, name: prototype['name'] ?? actor.name };
  }
  delete data['_id'];
  Object.assign(data, { actorId: actor.id, x: point.x, y: point.y, hidden });
  dropRemoteTokenImage(data);
  return data;
}

export async function placeActorTokens(
  scene: FoundryActorsScene,
  list: readonly FoundryActorsActor[],
  options: { kind: PlacementKind; coordinates?: readonly Point[]; hidden: boolean },
  log: { context: HandlerContext; query: string; tool: string; warnings?: string[] }
): Promise<PlacedToken[]> {
  let points: Point[];
  try {
    points = tokenPositions(options.kind, list.length, sceneRect(scene), {
      ...(options.coordinates ? { coordinates: options.coordinates } : {}),
    });
  } catch (error) {
    if (error instanceof PlacementError) throw new QueryError('INVALID_ARGUMENT', error.message);
    throw error;
  }

  const datas: Record<string, unknown>[] = [];
  for (const [index, actor] of list.entries())
    datas.push(await tokenData(actor, points[index] as Point, options.hidden));

  const idsBefore = new Set(scene.tokens.map(token => token.id));
  // Foundry's client code can throw after the server created the tokens (no drawn canvas): read back.
  const attempt = await settleWrite(() => scene.createEmbeddedDocuments('Token', datas));
  let created: Array<{ id: string }> = Array.isArray(attempt.value) ? attempt.value : [];
  if (attempt.threw) {
    created = scene.tokens.filter(token => !idsBefore.has(token.id));
    if (created.length !== datas.length)
      throw new QueryError(
        'NOT_CREATED',
        `The tokens could not be created in scene "${scene.name}": ${messageOf(attempt.error)}` +
          (created.length
            ? `. ${created.length} of ${datas.length} are there all the same: ${created.map(token => token.id).join(', ')}.`
            : '')
      );
    log.warnings?.push(
      afterWriteWarning(
        attempt.error,
        `Read back, all ${created.length} token(s) are in the scene.`
      )
    );
  }
  const placed: PlacedToken[] = [];
  for (const document of created) {
    const token = scene.tokens.get(document.id);
    if (!token) {
      throw new QueryError(
        'NOT_APPLIED',
        `A token was created in scene "${scene.name}", but it is not there when read back (id ${document.id}).`
      );
    }
    placed.push({
      id: token.id,
      name: token.name ?? '',
      actorId: token.actorId ?? '',
      x: token.x ?? 0,
      y: token.y ?? 0,
      hidden: token.hidden === true,
    });
  }
  log.context.recordChange({
    query: log.query,
    tool: log.tool,
    document: 'Scenes',
    action: 'update',
    targets: [
      { id: scene.id, uuid: scene.uuid, name: scene.name, documentName: 'Scene' },
      ...placed.map(token => ({ id: token.id, name: token.name, documentName: 'Token' })),
    ],
    summary: `Placed ${placed.length} token(s) in scene "${scene.name}".`,
  });
  return placed;
}
