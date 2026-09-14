/**
 * getWorldInfo: the basics of the open world, in the raw form every server
 * understands.
 *
 * A server of the previous generation reads exactly these six fields with
 * exactly these types: `system` as the id string, `systemVersion`,
 * `foundryVersion`, and `users` as a list of every user of the world. It
 * counts and formats on its side and fails when `users` is not a list. The
 * server of this rewrite formats the same raw form, so both generations get
 * the same answer. Formatting belongs to the server.
 */
import type { QueryHandler } from '../../dispatcher.js';
import { requireWorld } from '../../world-ready.js';

export interface RawWorldInfo {
  id: string;
  title: string;
  system: string;
  systemVersion: string;
  foundryVersion: string;
  /** Every user of the world, logged in or not. */
  users: Array<{ id: string; name: string; active: boolean; isGM: boolean }>;
}

export const getWorldInfo: QueryHandler = {
  access: { kind: 'read' },
  run: (): RawWorldInfo => {
    requireWorld();
    return {
      id: game.world?.id ?? '',
      title: game.world?.title ?? '',
      system: game.system?.id ?? 'unknown',
      systemVersion: game.system?.version ?? 'unknown',
      foundryVersion: game.version,
      users: (game.users?.contents ?? []).map(user => ({
        id: user.id,
        name: user.name,
        active: user.active === true,
        isGM: user.isGM === true,
      })),
    };
  },
};
