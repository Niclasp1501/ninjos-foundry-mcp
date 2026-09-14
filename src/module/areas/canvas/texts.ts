/**
 * What the Gamemaster sees in Foundry. Only one thing, on
 * purpose: when the AI moves every player's view, the person at the table
 * should know it was the AI and not a slip of the hand.
 */
import { defineAnnouncements } from '../../notify.js';

export const canvasNotes = defineAnnouncements('canvas', {
  viewsPulled: {
    level: 'info',
    en: 'The AI moved the view of everyone on the scene {scene}.',
  },
});
