/**
 * Area generic-access: read and write any document type with field selection.
 *
 * Server side: tools of the package.
 */
import type { ServerArea } from '../../tools/areas.js';
import { GENERIC_ACCESS_TOOLS } from './tools.js';

export const genericAccessArea: ServerArea = {
  id: 'generic-access',
  tools: GENERIC_ACCESS_TOOLS,
  resources: [],
  prompts: [],
};
