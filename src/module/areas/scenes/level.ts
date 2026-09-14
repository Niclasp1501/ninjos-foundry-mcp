/**
 * The level of a scene in Foundry 14.
 *
 * Since Foundry 14 the background that is drawn hangs on the level, not on
 * the scene. Setting only the scene field shows nothing on the map. So every
 * change of background or background colour also goes to the level: first
 * through the scene, and when that does not take effect, on the level as an
 * embedded document. Whether it worked is read back, never assumed.
 */
import { decodeMediaPath } from '../../../common/areas/scenes/names.js';
import { idOf, isRecord, messageOf } from './support.js';

/** Settings a template passes on to a new scene's level. */
export interface LevelSettings {
  background?: { tint?: unknown; alphaThreshold?: unknown; color?: unknown };
  foreground?: unknown;
  elevation?: unknown;
  textures?: unknown;
}

export interface LevelPatch {
  src?: string;
  color?: string;
  settings?: LevelSettings;
}

export interface LevelOutcome {
  levelPatched: boolean;
  levelId?: string;
  /** Why the level was not patched, or what had to be done instead. */
  reason?: string;
}

export function hasLevels(scene: FoundryScenesScene): boolean {
  return isRecord(scene.levels) || scene.levels instanceof Map;
}

/** The level a scene starts on: its initial level, otherwise the one sorted first. */
export function mainLevel(scene: FoundryScenesScene): FoundryScenesLevel | undefined {
  if (!hasLevels(scene) || !scene.levels) return undefined;
  const initial = idOf(scene.initialLevel);
  if (initial) {
    const level = scene.levels.get(initial);
    if (level) return level;
  }
  return [...scene.levels.contents].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))[0];
}

/** What a template's level contributes, without its identity or its background image. */
export function levelSettingsOf(scene: FoundryScenesScene): LevelSettings | undefined {
  const level = mainLevel(scene);
  if (!level) return undefined;
  const data = level.toObject();
  const settings: LevelSettings = {};
  const background = data['background'];
  if (isRecord(background)) {
    const { src: _src, ...rest } = background;
    settings.background = rest;
  }
  for (const key of ['foreground', 'elevation', 'textures'] as const) {
    if (data[key] !== undefined) settings[key] = structuredClone(data[key]);
  }
  return settings;
}

function levelChanges(patch: LevelPatch): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  const settings = patch.settings ?? {};
  const background: Record<string, unknown> = { ...(settings.background ?? {}) };
  if (patch.src !== undefined) background['src'] = patch.src;
  if (patch.color !== undefined) background['color'] = patch.color;
  if (Object.keys(background).length) changes['background'] = background;
  for (const key of ['foreground', 'elevation', 'textures'] as const) {
    if (settings[key] !== undefined) changes[key] = settings[key];
  }
  return changes;
}

function sameColor(a: unknown, b: string): boolean {
  if (typeof a === 'number') return `#${a.toString(16).padStart(6, '0')}` === b.toLowerCase();
  return typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
}

function takesEffect(level: FoundryScenesLevel | undefined, patch: LevelPatch): boolean {
  if (!level) return false;
  const background = level.background ?? {};
  if (
    patch.src !== undefined &&
    decodeMediaPath(background.src ?? '') !== decodeMediaPath(patch.src)
  )
    return false;
  if (patch.color !== undefined && !sameColor(background.color, patch.color)) return false;
  return true;
}

export async function patchLevel(
  scene: FoundryScenesScene,
  patch: LevelPatch
): Promise<LevelOutcome> {
  if (!hasLevels(scene) || !scene.levels) {
    return { levelPatched: false, reason: 'this Foundry version has no scene levels' };
  }
  const changes = levelChanges(patch);
  if (!Object.keys(changes).length)
    return { levelPatched: false, reason: 'nothing to set on the level' };

  const target = mainLevel(scene);
  if (!target) {
    try {
      const [level] = await scene.createEmbeddedDocuments('Level', [
        { name: scene.name, ...changes },
      ]);
      const check = level ? scene.levels.get(level.id) : undefined;
      if (takesEffect(check, patch) && check)
        return {
          levelPatched: true,
          levelId: check.id,
          reason: 'the scene had no level; one was created',
        };
      return {
        levelPatched: false,
        reason: 'the scene had no level, and the created one does not show the change',
      };
    } catch (error) {
      return { levelPatched: false, reason: `creating a level failed: ${messageOf(error)}` };
    }
  }

  const problems: string[] = [];
  try {
    await scene.update({ levels: [{ _id: target.id, ...changes }] });
  } catch (error) {
    problems.push(`through the scene: ${messageOf(error)}`);
  }
  if (takesEffect(scene.levels.get(target.id), patch))
    return { levelPatched: true, levelId: target.id };
  if (!problems.length) problems.push('through the scene: no effect');

  try {
    await scene.updateEmbeddedDocuments('Level', [{ _id: target.id, ...changes }]);
  } catch (error) {
    problems.push(`as an embedded document: ${messageOf(error)}`);
  }
  if (takesEffect(scene.levels.get(target.id), patch))
    return { levelPatched: true, levelId: target.id };
  if (problems.length < 2) problems.push('as an embedded document: no effect');
  return {
    levelPatched: false,
    levelId: target.id,
    reason: `the level could not be changed (${problems.join('; ')})`,
  };
}
