/**
 * What every handler shares. Errors with their cause and one
 * "Failed to" in front, the arguments, the choice of the scene and the
 * lookup of a token.
 *
 * Which scene: the one given by `sceneIdentifier` (id or name, the lookup
 * rule of the scenes area), otherwise the scene that is active for everyone, the
 * same one get-current-scene describes. Never the scene the Gamemaster happens
 * to look at. Every answer names the scene it used.
 */
import { lookup, lookupFailure } from '../../../common/areas/scenes/lookup.js';
import { isRecord } from '../../../common/areas/tokens-dice/tokens.js';
import type { ChangeTarget } from '../../../common/change-log.js';
import { QueryError } from '../../dispatcher.js';

export { isRecord };

export function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return 'unknown cause';
}

export function fail(code: string, message: string): never {
  throw new QueryError(code, message);
}

/** Run a query's work; any error gets "Failed to <name>: " once, and keeps its code. */
export async function operation<T>(name: string, work: () => Promise<T> | T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const code = error instanceof QueryError ? error.code : 'FAILED';
    const message = messageOf(error);
    throw new QueryError(
      code,
      message.startsWith(`Failed to ${name}`) ? message : `Failed to ${name}: ${message}`
    );
  }
}

export function argsOf(data: unknown): Record<string, unknown> {
  return isRecord(data) ? data : {};
}

export function requiredText(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || !value.trim())
    fail('INVALID_ARGUMENT', `${key} is required and must be a text that is not empty`);
  return value.trim();
}

export function optionalText(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') fail('INVALID_ARGUMENT', `${key} must be a text`);
  return value;
}

export function optionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') fail('INVALID_ARGUMENT', `${key} must be true or false`);
  return value;
}

export function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Foundry gives a document for a reference field, stored data an id. Both give the id. */
export function idOf(value: unknown): string | null {
  if (typeof value === 'string') return value || null;
  if (isRecord(value) && typeof value['id'] === 'string') return value['id'] || null;
  return null;
}

export interface ChosenScene {
  scene: FoundryTokensDiceScene;
  by: 'active' | 'parameter';
}

export function sceneList(): FoundryTokensDiceScene[] {
  return game.scenes.contents as FoundryTokensDiceScene[];
}

export function chooseScene(args: Record<string, unknown>): ChosenScene {
  const scenes = sceneList();
  const identifier = optionalText(args, 'sceneIdentifier')?.trim();
  if (identifier) {
    const result = lookup(
      scenes.map(scene => ({ id: scene.id, name: scene.name ?? '', scene })),
      identifier
    );
    if (result.found) return { scene: result.entry.scene, by: 'parameter' };
    fail(
      result.reason === 'ambiguous' ? 'AMBIGUOUS' : 'SCENE_NOT_FOUND',
      lookupFailure('scene', identifier, result)
    );
  }
  const active = scenes.find(scene => scene.active === true);
  if (!active)
    fail(
      'NO_ACTIVE_SCENE',
      'No scene is active. Activate a scene for everyone, or pass sceneIdentifier.'
    );
  return { scene: active, by: 'active' };
}

export function sceneInfo(chosen: ChosenScene): Record<string, unknown> {
  return {
    id: chosen.scene.id,
    name: chosen.scene.name ?? '',
    active: chosen.scene.active === true,
    chosenBy: chosen.by === 'active' ? 'active scene' : 'sceneIdentifier',
  };
}

function where(chosen: ChosenScene): string {
  const active = chosen.by === 'active' ? ' (the active scene)' : '';
  return `the scene "${chosen.scene.name ?? ''}" [${chosen.scene.id}]${active}`;
}

/** Why a token id is not on the scene, with the scene it does lie on and a name that was passed as an id. */
export function tokenNotFoundText(chosen: ChosenScene, tokenId: string): string {
  let text = `Token "${tokenId}" not found on ${where(chosen)}.`;
  const elsewhere = sceneList().filter(
    scene => scene.id !== chosen.scene.id && scene.tokens?.get(tokenId)
  );
  if (elsewhere.length) {
    const names = elsewhere.map(scene => `"${scene.name ?? ''}" [${scene.id}]`).join(', ');
    text += ` It lies on the scene ${names}; pass sceneIdentifier to work there.`;
  }
  const lower = tokenId.toLowerCase();
  const named = (chosen.scene.tokens?.contents ?? []).filter(
    token => (token.name ?? '').toLowerCase() === lower
  );
  if (named.length) {
    text += ` Tokens are identified by their id only; "${tokenId}" is the name of ${named.map(t => t.id).join(', ')}.`;
  } else if (!elsewhere.length) {
    text += ' get-current-scene lists the ids of the tokens.';
  }
  return text;
}

export function findToken(chosen: ChosenScene, tokenId: string): FoundryTokensDiceToken {
  const token = chosen.scene.tokens?.get(tokenId);
  if (!token) fail('TOKEN_NOT_FOUND', tokenNotFoundText(chosen, tokenId));
  return token;
}

/** The token as Foundry holds it now, read through the world collection, for reading an effect back. */
export function freshToken(chosen: ChosenScene, tokenId: string): FoundryTokensDiceToken | null {
  const scene = game.scenes.get(chosen.scene.id) as FoundryTokensDiceScene | undefined;
  return scene?.tokens?.get(tokenId) ?? null;
}

export function tokenTarget(token: FoundryTokensDiceToken): ChangeTarget {
  return { id: token.id, uuid: token.uuid, name: token.name ?? '', documentName: 'Token' };
}

export function tokenLabel(token: FoundryTokensDiceToken): string {
  return `"${token.name ?? ''}" [${token.id}]`;
}
