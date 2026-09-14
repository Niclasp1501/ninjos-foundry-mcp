/**
 * Area campaign: dashboard and quest journals.
 *
 * Module side: the handlers build the content of dashboards and quest pages
 * and write it; dashboard-sheet.ts shows the saved progress on the page.
 *
 * Query names: `createJournalEntry` and `updateCampaignProgress` are the names
 * of the previous generation. The four
 * tool queries are new, because the previous server built the HTML itself
 * and read and wrote pages in chunks, which this package does not do.
 */
import { MODULE_ID } from '../../../common/constants.js';
import type { ModuleArea } from '../../areas.js';
import { installDashboardHooks } from './dashboard-sheet.js';
import {
  createCampaignDashboard,
  createJournalEntry,
  createQuestJournal,
  linkQuestToNpc,
  updateCampaignProgress,
  updateQuestJournal,
} from './handlers.js';

const STYLESHEET_ID = `${MODULE_ID}-campaign-styles`;

/**
 * Load styles/campaign.css until module.json lists it. Does nothing when it is
 * already there.
 */
export function attachCampaignStylesheet(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLESHEET_ID)) return;
  const path = `modules/${MODULE_ID}/styles/campaign.css`;
  const listed = Array.from(
    document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')
  ).some(link => link.href.includes(path));
  if (listed) return;
  const link = document.createElement('link');
  link.id = STYLESHEET_ID;
  link.rel = 'stylesheet';
  link.href = path;
  document.head.append(link);
}

export const campaignArea: ModuleArea = {
  id: 'campaign',
  queries: [
    { names: 'createCampaignDashboard', handler: createCampaignDashboard },
    { names: 'createQuestJournal', handler: createQuestJournal },
    { names: 'linkQuestToNpc', handler: linkQuestToNpc },
    { names: 'updateQuestJournal', handler: updateQuestJournal },
    { names: 'createJournalEntry', handler: createJournalEntry },
    { names: 'updateCampaignProgress', handler: updateCampaignProgress },
  ],
  settings: [],
  init: () => {
    attachCampaignStylesheet();
    installDashboardHooks();
  },
};
