/**
 * Area journals: every journal and folder tool, world-rewrite-paths,
 * and two actor tools.
 *
 * Server side: tools, resources and prompts of the package.
 */
import type { ServerArea } from '../../tools/areas.js';
import { JOURNAL_TOOLS } from './tools.js';

export const journalsArea: ServerArea = {
  id: 'journals',
  tools: JOURNAL_TOOLS,
  resources: [],
  prompts: [],
};
