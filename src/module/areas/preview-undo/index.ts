/**
 * Area preview-undo: preview and undo on the change log of the core.
 *
 * Module side: reading the log, undo, and the setting of the preview mode.
 */
import type { ModuleArea } from '../../areas.js';
import { CONFIRM_SETTING, getConfirmationMode, listChangeHistory } from './history.js';
import { undoChanges } from './undo.js';

export const previewUndoArea: ModuleArea = {
  id: 'preview-undo',
  queries: [
    { names: 'listChangeHistory', handler: listChangeHistory },
    { names: 'undoChanges', handler: undoChanges },
    { names: 'getConfirmationMode', handler: getConfirmationMode },
  ],
  settings: [{ key: CONFIRM_SETTING, kind: Boolean, initial: false, listed: true }],
};
