/**
 * The reading queries. list-scenes, listSceneFolders and
 * getActiveScene.
 */
import { decodeMediaPath } from '../../../common/areas/scenes/names.js';
import type { QueryHandler } from '../../dispatcher.js';
import { requireWorld } from '../../world-ready.js';
import { folderPath, sceneFolders } from './folders.js';
import { mainLevel } from './level.js';
import {
  activeScene,
  booleanArg,
  dataOf,
  fail,
  idOf,
  operation,
  sceneList,
  sizeOf,
  textArg,
} from './support.js';

/** The background that is drawn: the level's in Foundry 14, the scene's before. */
export function backgroundOf(scene: FoundryScenesScene): string | null {
  const src = mainLevel(scene)?.background?.src ?? scene.background?.src ?? null;
  return src ? decodeMediaPath(src) : null;
}

export const listScenes: QueryHandler = {
  access: { kind: 'read' },
  run: raw =>
    operation('list scenes', () => {
      requireWorld();
      const data = dataOf(raw);
      const filter = textArg(data, 'filter')?.toLowerCase();
      const activeOnly = booleanArg(data, 'include_active_only') === true;
      const all = sceneList();
      const shown = all.filter(
        scene =>
          (!activeOnly || scene.active === true) &&
          (!filter || (scene.name ?? '').toLowerCase().includes(filter))
      );
      // A bare list, as a server of the previous generation passes it on. `dimensions` and
      // `lighting` are its field names; `width`, `height` and `lights` are the plain ones.
      return shown.map(scene => ({
        id: scene.id,
        name: scene.name,
        active: scene.active === true,
        dimensions: { width: scene.width, height: scene.height },
        width: scene.width,
        height: scene.height,
        gridSize: scene.grid?.size ?? null,
        background: backgroundOf(scene),
        walls: sizeOf(scene.walls),
        tokens: sizeOf(scene.tokens),
        lighting: sizeOf(scene.lights),
        lights: sizeOf(scene.lights),
        sounds: sizeOf(scene.sounds),
        navigation: scene.navigation === true,
      }));
    }),
};

export const listSceneFolders: QueryHandler = {
  access: { kind: 'read' },
  run: () =>
    operation('list scene folders', () => {
      requireWorld();
      const scenes = sceneList();
      const folders = sceneFolders().map(folder => {
        const { path, complete } = folderPath(folder);
        return {
          id: folder.id,
          path,
          ...(complete ? {} : { pathIncomplete: true }),
          scenes: scenes.filter(scene => idOf(scene.folder) === folder.id).length,
        };
      });
      folders.sort((a, b) => a.path.localeCompare(b.path));
      return { folders };
    }),
};

export const getActiveScene: QueryHandler = {
  access: { kind: 'read' },
  run: raw =>
    operation('get the current scene', () => {
      requireWorld();
      const data = dataOf(raw);
      const includeTokens = booleanArg(data, 'includeTokens') ?? true;
      // A server of the previous generation sends no data and filters hidden tokens itself,
      // so without the field every token comes, each with its hidden flag.
      const includeHidden = booleanArg(data, 'includeHidden') ?? true;
      const hiddenAsked = data['includeHidden'] !== undefined && data['includeHidden'] !== null;
      const scene = activeScene();
      if (!scene) fail('SCENE_NOT_FOUND', 'no scene is active');

      const notes = scene.notes?.contents ?? [];
      const background = backgroundOf(scene);
      const result: Record<string, unknown> = {
        id: scene.id,
        name: scene.name,
        active: true,
        // Top-level fields a server of the previous generation reads; background only for whether it is set.
        width: scene.width,
        height: scene.height,
        padding: scene.padding ?? 0,
        background: background === null ? null : { src: background },
        walls: sizeOf(scene.walls),
        lights: sizeOf(scene.lights),
        sounds: sizeOf(scene.sounds),
        dimensions: { width: scene.width, height: scene.height, padding: scene.padding ?? 0 },
        hasBackground: background !== null,
        navigation: scene.navigation === true,
        elements: {
          walls: sizeOf(scene.walls),
          lights: sizeOf(scene.lights),
          sounds: sizeOf(scene.sounds),
          notes: notes.length,
        },
        notes: notes.map(note => ({
          id: note.id,
          text: (note.text ?? '').slice(0, 100),
          x: note.x,
          y: note.y,
        })),
      };

      if (includeTokens) {
        const all = scene.tokens?.contents ?? [];
        // The summary follows the same rule as the list: hidden tokens only with includeHidden.
        const tokens = includeHidden ? all : all.filter(token => token.hidden !== true);
        result['tokens'] = tokens.map(token => ({
          id: token.id,
          name: token.name ?? '',
          x: token.x,
          y: token.y,
          width: token.width ?? 1,
          height: token.height ?? 1,
          actorId: token.actorId ?? null,
          img: token.texture?.src ?? null,
          hidden: token.hidden === true,
          disposition: typeof token.disposition === 'number' ? token.disposition : 0,
        }));
        result['tokenSummary'] = {
          shown: tokens.length,
          hidden: tokens.filter(token => token.hidden === true).length,
          ...(includeHidden || !hiddenAsked ? {} : { hiddenNotShown: all.length - tokens.length }),
          withActor: tokens.filter(token => token.actorId).length,
        };
      }
      return result;
    }),
};
