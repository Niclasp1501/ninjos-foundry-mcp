/**
 * DeleteScene.
 *
 * By id only, never by a name that could be mistaken, and never the active
 * scene. The deletion is read back.
 */
import type { QueryHandler } from '../../dispatcher.js';
import { requireWorld } from '../../world-ready.js';
import { dataOf, fail, operation, textArg } from './support.js';

export const deleteScene: QueryHandler = {
  access: { kind: 'write', document: 'Scenes', action: 'delete' },
  run: (raw, context) =>
    operation('delete scene', async () => {
      requireWorld();
      const id = textArg(dataOf(raw), 'sceneId') ?? fail('INVALID_ARGUMENT', 'sceneId is required');
      const scene = game.scenes.get(id) as FoundryScenesScene | undefined;
      if (!scene) {
        const named = game.scenes.contents.filter(entry => entry.name === id);
        const hint = named.length
          ? ` A scene is named like that (${named.map(entry => entry.id).join(', ')}); delete-scene takes the id only, never a name.`
          : ' delete-scene takes the id only, never a name.';
        fail('SCENE_NOT_FOUND', `no scene has the id "${id}".${hint}`);
      }
      if (scene.active === true)
        fail(
          'SCENE_ACTIVE',
          `"${scene.name}" is the active scene and is never deleted; activate another scene first`
        );

      const before = scene.toObject();
      await scene.delete();
      if (game.scenes.get(id))
        fail('NOT_APPLIED', `Foundry still has the scene "${scene.name}" after deleting it`);
      context.recordChange({
        query: 'deleteScene',
        tool: 'delete-scene',
        document: 'Scenes',
        action: 'delete',
        targets: [{ id, name: scene.name }],
        summary: `Deleted the scene "${scene.name}".`,
        before,
      });
      return { id, name: scene.name, deleted: true };
    }),
};
