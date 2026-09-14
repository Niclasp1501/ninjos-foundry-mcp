/**
 * Area chat-tables-macros: chat, rolling and changing tables, macros (running off by default).
 *
 * Server side: tools, resources and prompts of the package.
 */
import type { ServerArea } from '../../tools/areas.js';
import {
  deleteChatMessageTool,
  listChatMessagesTool,
  sendChatMessageTool,
  updateChatMessageTool,
} from './chat-tools.js';
import { createMacroTool, executeMacroTool, listMacrosTool } from './macro-tools.js';
import {
  drawRollTableTool,
  getRollTableTool,
  resetRollTableTool,
  updateRollTableTool,
} from './table-tools.js';

export const chatTablesMacrosArea: ServerArea = {
  id: 'chat-tables-macros',
  tools: [
    listChatMessagesTool,
    sendChatMessageTool,
    updateChatMessageTool,
    deleteChatMessageTool,
    getRollTableTool,
    drawRollTableTool,
    resetRollTableTool,
    updateRollTableTool,
    listMacrosTool,
    createMacroTool,
    executeMacroTool,
  ],
  resources: [],
  prompts: [],
};
