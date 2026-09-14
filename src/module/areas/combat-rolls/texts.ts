/**
 * The texts that reach the chat, in the language of the
 * Gamemaster who posts them, with the English text when a translation is
 * missing. Keys under ninjos-foundry-mcp.combat-rolls.chat.*.
 */
import { defineAnnouncements } from '../../notify.js';

export const chatTexts = defineAnnouncements(
  'combat-rolls',
  {
    initiativeFlavor: { level: 'info', en: '{name} rolls for initiative.' },
    checkFlavor: { level: 'info', en: '{actor}: {label}' },
  },
  { group: 'chat' }
);
