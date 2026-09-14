/**
 * Area tokens-dice: tokens, conditions, roll requests to players.
 *
 * Module side. Every query answers under the hyphenated name a server of
 * either generation sends, and the six token queries also under the camel
 * case names the previous module registered.
 * `tokensDiceCapabilities` is new: a server asks it before sending
 * `sceneIdentifier`, which a module of the previous generation would ignore.
 */
import type { ModuleArea } from '../../areas.js';
import { getAvailableConditions, toggleTokenCondition } from './conditions.js';
import { confirmOpenRollResults, installRollHooks } from './roll-card.js';
import { requestPlayerRolls } from './rolls.js';
import { deleteTokens, getTokenDetails, moveToken, updateToken } from './tokens.js';

export const tokensDiceArea: ModuleArea = {
  id: 'tokens-dice',
  queries: [
    { names: ['move-token', 'moveToken'], handler: moveToken },
    { names: ['update-token', 'updateToken'], handler: updateToken },
    { names: ['delete-tokens', 'deleteTokens'], handler: deleteTokens },
    { names: ['get-token-details', 'getTokenDetails'], handler: getTokenDetails },
    { names: ['toggle-token-condition', 'toggleTokenCondition'], handler: toggleTokenCondition },
    {
      names: ['get-available-conditions', 'getAvailableConditions'],
      handler: getAvailableConditions,
    },
    { names: 'request-player-rolls', handler: requestPlayerRolls },
    {
      names: 'tokensDiceCapabilities',
      handler: { access: { kind: 'read' }, run: () => ({ sceneIdentifier: true, rollCard: 2 }) },
    },
  ],
  settings: [],
  init: () => installRollHooks(),
  ready: async () => {
    if (!game.user?.isGM) return;
    await confirmOpenRollResults();
  },
};
