/**
 * The scene of a finished map.
 *
 * The scene itself is created by the handler of the scenes area (`createScene`,
 * imported, not copied): background, size, levels of Foundry 14, thumbnail and
 * read back all come from there. This handler adds what makes it a battle map:
 * the folder, a square grid of 5 ft, token vision and fog exploration.
 *
 * Decisions:
 *
 * - **Not activated unless asked.** `activate` comes from the tool parameter
 *   `activate_scene`, default false. Asking for it needs the right to change
 *   scenes as well.
 * - **Nothing thrown once the scene exists.** Folder, grid and activation
 *   that do not take are warnings: a failure after the scene was created would
 *   make the server report a failed job for a scene that is in the world.
 * - **Folder refused or broken: no folder**, with a warning, as before.
 * - **No outdated fields.** Default permission and global light are not written.
 */
import { MAP_FOLDER_NAME, MAP_QUERY } from '../../../common/areas/maps/constants.js';
import type { Access } from '../../../common/permissions.js';
import { QueryError, type QueryHandler } from '../../dispatcher.js';
import { ensureFolderPath, folderIdOf } from '../../folders.js';
import { requireWorld } from '../../world-ready.js';
import { announce } from '../interface/index.js';
import { createScene } from '../scenes/create.js';
import { activateScene } from '../scenes/view.js';

/** Foundry's square grid. */
export const SQUARE_GRID = 1;

export const MAP_GRID_STYLE = { distance: 5, units: 'ft', color: '#000000', alpha: 0.2 } as const;

export const MAP_SCENE_PADDING = 0.25;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return 'unknown cause';
}

function positive(data: Record<string, unknown>, key: string): number {
  const value = data[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0)
    throw new QueryError('INVALID_ARGUMENT', `${key} must be a positive whole number`);
  return value;
}

function text(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  if (typeof value !== 'string' || !value.trim())
    throw new QueryError('INVALID_ARGUMENT', `${key} is required`);
  return value.trim();
}

export const createMapScene: QueryHandler = {
  access: data => {
    const accesses: Access[] = [{ kind: 'write', document: 'Scenes', action: 'create' }];
    if (isRecord(data) && data['activate'] === true)
      accesses.push({ kind: 'write', document: 'Scenes', action: 'update' });
    return accesses;
  },
  run: async (raw, context) => {
    requireWorld();
    const data = isRecord(raw) ? raw : {};
    const name = text(data, 'name');
    const path = text(data, 'path');
    const width = positive(data, 'width');
    const height = positive(data, 'height');
    const gridSize = positive(data, 'gridSize');
    const activate = data['activate'] === true;
    const warnings: string[] = [];

    let folderId: string | null = null;
    try {
      const folder = await ensureFolderPath(MAP_FOLDER_NAME, {
        type: 'Scene',
        context,
        query: MAP_QUERY.createScene,
        tool: 'generate-map',
        nameMatch: 'ignoreCaseWhenUnique',
      });
      folderId = folder.id;
    } catch (error) {
      warnings.push(`The scene is not in the folder "${MAP_FOLDER_NAME}": ${messageOf(error)}`);
    }

    // Everything above may fail and stop the job. From here on the scene exists.
    const created = await createScene.run(
      {
        name,
        background: path,
        width,
        height,
        padding: MAP_SCENE_PADDING,
        gridSize,
        navigation: false,
        activate: false,
      },
      context
    );
    const report = isRecord(created) ? created : {};
    const sceneId = typeof report['id'] === 'string' ? report['id'] : '';
    if (Array.isArray(report['warnings']))
      for (const warning of report['warnings'])
        if (typeof warning === 'string') warnings.push(warning);

    const scene = game.scenes.get(sceneId) as FoundryMapsScene | undefined;
    if (!scene) {
      return {
        sceneId,
        name,
        activated: false,
        folderId,
        warnings: [...warnings, 'The scene could not be read back after it was created.'],
      };
    }

    try {
      const before = scene.toObject();
      await scene.update({
        folder: folderId,
        grid: { type: SQUARE_GRID, size: gridSize, ...MAP_GRID_STYLE },
        tokenVision: true,
        fog: { exploration: true },
      });
      context.recordChange({
        query: MAP_QUERY.createScene,
        tool: 'generate-map',
        document: 'Scenes',
        action: 'update',
        targets: [{ id: scene.id, uuid: scene.uuid, name: scene.name }],
        summary: `Set the grid, token vision, fog and folder of the map scene "${scene.name}".`,
        before: {
          folder: before['folder'] ?? null,
          grid: before['grid'],
          tokenVision: before['tokenVision'],
          fog: before['fog'],
        },
      });
      const lost: string[] = [];
      if (scene.grid?.size !== gridSize) lost.push(`grid size ${gridSize}`);
      if (scene.grid?.distance !== MAP_GRID_STYLE.distance) lost.push('5 ft per square');
      if (scene.tokenVision !== true) lost.push('token vision');
      if (scene.fog?.exploration !== true) lost.push('fog exploration');
      if (folderIdOf(scene.folder) !== folderId) lost.push(`the folder "${MAP_FOLDER_NAME}"`);
      if (lost.length) warnings.push(`Foundry did not keep: ${lost.join(', ')}.`);
    } catch (error) {
      warnings.push(
        `The grid, vision and folder of the scene could not be set: ${messageOf(error)}`
      );
    }

    let activated = false;
    if (activate) {
      const outcome = await activateScene(scene as unknown as FoundryScenesScene);
      activated = outcome.active;
      if (outcome.active) {
        context.recordChange({
          query: MAP_QUERY.createScene,
          tool: 'generate-map',
          document: 'Scenes',
          action: 'update',
          targets: [{ id: scene.id, uuid: scene.uuid, name: scene.name }],
          summary: `Activated the map scene "${scene.name}" for all players.`,
        });
      } else {
        warnings.push(`The scene was created but not activated: ${outcome.reason}.`);
      }
    }

    announce('sceneCreated', { name: scene.name });
    if (activated) announce('sceneSwitched', { name: scene.name });
    return { sceneId: scene.id, name: scene.name, activated, folderId, warnings };
  },
};
