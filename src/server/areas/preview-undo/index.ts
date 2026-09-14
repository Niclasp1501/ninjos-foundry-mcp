/**
 * Area preview-undo: preview and undo on the change log of the core.
 *
 * Server side: list-changes and undo-change. The preview with confirmation
 * runs in the tool registry for every destructive tool (src/server/tools/confirmation.ts).
 */
import type { ServerArea } from '../../tools/areas.js';
import { listChangesTool, undoChangeTool } from './tools.js';

export const previewUndoArea: ServerArea = {
  id: 'preview-undo',
  tools: [listChangesTool, undoChangeTool],
  resources: [],
  prompts: [],
};
