/**
 * The precondition almost every query shares: Foundry ready, a world loaded,
 * a user logged in. Core, used by every area; a package does not change it.
 */
import { QueryError } from './dispatcher.js';

export function requireWorld(): void {
  if (!game.ready)
    throw new QueryError('NOT_READY', 'Foundry is still starting; try again in a moment');
  if (!game.world) throw new QueryError('NO_WORLD', 'No world is loaded in Foundry');
  if (!game.user) throw new QueryError('NO_USER', 'No user is logged in to Foundry');
}
