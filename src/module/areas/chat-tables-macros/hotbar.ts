/**
 * Who keeps a macro on the hotbar.
 *
 * Foundry stores a hotbar per user as `{ "<slot>": "<macro id>" }` and leaves
 * the id there when the macro is deleted (`User#getHotbarMacros` then finds no
 * macro, and the slot shows empty). delete-macro and delete-document ask this
 * before they delete a macro.
 */
import { isRecord } from './lookup.js';

/** One user whose hotbar holds the macro, with the slots (1 to 50). */
export interface HotbarUse {
  userId: string;
  user: string;
  gamemaster: boolean;
  slots: number[];
}

/** Every user whose hotbar holds this macro id. Foundry stores `{ "<slot>": "<macro id>" }`. */
export function hotbarUses(macroId: string): HotbarUse[] {
  const users = game.users?.contents ?? [];
  const uses: HotbarUse[] = [];
  for (const user of users) {
    const hotbar = (user as { hotbar?: unknown }).hotbar;
    if (!isRecord(hotbar)) continue;
    const slots = Object.entries(hotbar)
      .filter(([, id]) => id === macroId)
      .map(([slot]) => Number(slot))
      .filter(slot => Number.isInteger(slot))
      .sort((a, b) => a - b);
    if (slots.length)
      uses.push({ userId: user.id, user: user.name, gamemaster: user.isGM === true, slots });
  }
  return uses;
}

export function hotbarText(uses: readonly HotbarUse[]): string {
  return uses
    .map(
      use =>
        `${use.user} (${use.gamemaster ? 'Gamemaster' : 'player'}) in slot ${use.slots.join(', ')}`
    )
    .join('; ');
}
