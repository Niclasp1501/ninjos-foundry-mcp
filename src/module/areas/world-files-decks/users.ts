/**
 * The users of the world with role, login state, character and viewed scene.
 *
 * Nothing about access is listed: no password fields, no permissions beyond
 * the role. Foundry users carry no e-mail address; a field of that name from a
 * module would not be read either, because only named fields are copied.
 */
import type { QueryHandler } from '../../dispatcher.js';
import { requireWorld } from '../../world-ready.js';
import { idOf, inputOf, optionalBoolean } from './common.js';

const ROLE_NAMES: Record<number, string> = {
  0: 'none',
  1: 'player',
  2: 'trusted player',
  3: 'assistant gamemaster',
  4: 'gamemaster',
};

function roleNameOf(role: number | undefined): string {
  const roles = (globalThis as { CONST?: { USER_ROLES?: Record<string, number> } }).CONST
    ?.USER_ROLES;
  if (roles && typeof role === 'number') {
    const entry = Object.entries(roles).find(([, value]) => value === role);
    if (entry) return entry[0].toLowerCase().replace(/_/g, ' ');
  }
  return typeof role === 'number' ? (ROLE_NAMES[role] ?? `role ${role}`) : 'unknown';
}

export const listUsers: QueryHandler = {
  access: { kind: 'read' },
  run: data => {
    requireWorld();
    const onlyActive = optionalBoolean(inputOf(data), 'onlyActive') === true;
    const self = game.user?.id;
    const users = (game.users?.contents ?? []) as FoundryWorldFilesDecksUser[];
    return {
      users: users
        .filter(user => !onlyActive || user.active)
        .map(user => {
          const characterId = idOf(user.character);
          const character = characterId ? game.actors.get(characterId) : undefined;
          const sceneId = typeof user.viewedScene === 'string' ? user.viewedScene : null;
          const scene = sceneId ? game.scenes.get(sceneId) : undefined;
          return {
            id: user.id,
            name: user.name,
            role: typeof user.role === 'number' ? user.role : null,
            roleName: roleNameOf(user.role),
            isGM: user.isGM === true,
            active: user.active === true,
            isSelf: user.id === self,
            character: characterId ? { id: characterId, name: character?.name ?? null } : null,
            viewedScene: sceneId && user.active ? { id: sceneId, name: scene?.name ?? null } : null,
            avatar: typeof user.avatar === 'string' ? user.avatar : null,
          };
        }),
    };
  },
};
