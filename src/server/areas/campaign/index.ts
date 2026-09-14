/**
 * Area campaign: dashboard and quest journals.
 *
 * Server side: the four campaign tools.
 */
import type { ServerArea } from '../../tools/areas.js';
import { CAMPAIGN_TOOLS } from './tools.js';

export const campaignArea: ServerArea = {
  id: 'campaign',
  tools: CAMPAIGN_TOOLS,
  resources: [],
  prompts: [],
};
