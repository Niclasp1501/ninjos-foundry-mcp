/**
 * Which chat messages a piece of work created.
 *
 * Drawing from a table and running a macro create messages inside Foundry,
 * which returns them only sometimes. Listening to `createChatMessage` for the
 * local user while the work runs finds them either way, so each one can be
 * read back and checked for who sees it.
 */
import { idOf } from './lookup.js';

export interface MessageCapture {
  readonly ids: string[];
  stop(): void;
}

export function captureCreatedMessages(): MessageCapture {
  const ids: string[] = [];
  const own = game.user?.id;
  // Hooks.off is declared in the core, so no cast is needed.
  const hooks = Hooks;
  const hookId = hooks.on(
    'createChatMessage',
    (message: unknown, _options: unknown, userId: unknown) => {
      const id = idOf(message);
      if (id && (userId === undefined || userId === own)) ids.push(id);
    }
  );
  let stopped = false;
  return {
    ids,
    stop: () => {
      if (stopped) return;
      stopped = true;
      hooks.off('createChatMessage', hookId);
    },
  };
}
