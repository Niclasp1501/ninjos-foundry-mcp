/**
 * Area chat-tables-macros: chat, rolling and changing tables, macros (running off by default).
 *
 * Module side: query handlers and settings of the package.
 */
import type { ModuleArea } from '../../areas.js';
import { MACRO_EXECUTION_LEVELS, MACRO_EXECUTION_SETTING } from './access.js';
import { deleteChatMessage, listChatMessages, sendChatMessage, updateChatMessage } from './chat.js';
import { createMacro, executeMacro, listMacros } from './macros.js';
import { drawRollTable, getRollTable, resetRollTable, updateRollTable } from './tables.js';

export const chatTablesMacrosArea: ModuleArea = {
  id: 'chat-tables-macros',
  queries: [
    { names: 'listChatMessages', handler: listChatMessages },
    { names: 'sendChatMessage', handler: sendChatMessage },
    { names: 'updateChatMessage', handler: updateChatMessage },
    { names: 'deleteChatMessage', handler: deleteChatMessage },
    { names: 'getRollTable', handler: getRollTable },
    { names: 'drawRollTable', handler: drawRollTable },
    { names: 'resetRollTable', handler: resetRollTable },
    { names: 'updateRollTable', handler: updateRollTable },
    { names: 'listMacros', handler: listMacros },
    { names: 'createMacro', handler: createMacro },
    { names: 'executeMacro', handler: executeMacro },
  ],
  settings: [
    {
      key: MACRO_EXECUTION_SETTING,
      kind: String,
      initial: 'off',
      listed: true,
      options: MACRO_EXECUTION_LEVELS,
    },
  ],
};
