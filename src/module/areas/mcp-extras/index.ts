/**
 * Area mcp-extras: resources, prompts, notification on a changed tool list.
 *
 * Module side: no queries or settings; at ready the Gamemaster's browser
 * reports changes made by hand to the server (lists-changed.ts).
 */
import type { ModuleArea } from '../../areas.js';
import { watchForListChanges } from './lists-changed.js';

export const mcpExtrasArea: ModuleArea = {
  id: 'mcp-extras',
  queries: [],
  settings: [],
  ready: () => watchForListChanges(),
};
