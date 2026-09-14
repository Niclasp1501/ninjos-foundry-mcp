/**
 * Area journals: every journal and folder tool, world-rewrite-paths,
 * and two actor tools (actors.ts).
 *
 * Module side: query handlers and settings of the package.
 *
 * Query names: every name a server of the previous generation sends for these
 * tools is answered with its data contract, including
 * getJournalContent, getJournalPageContent and updateJournalContent, which the
 * old quest tools use as well. setJournalPage, addJournalPage and
 * searchJournals are new; the new server falls back to the old names when a
 * module does not know them.
 */
import type { ModuleArea } from '../../areas.js';
import { refreshActorItemsFromSource, setActorToken } from './actors.js';
import { deleteFolder, renameFolder } from './folders.js';
import { getJournalContent, getJournalPageContent, listJournals, searchJournals } from './read.js';
import { linkJournalTags, rewriteJournalImages } from './repair.js';
import { splitJournalPage } from './split.js';
import { rewriteWorldPaths } from './world-paths.js';
import {
  addJournalPage,
  appendJournalPageContent,
  createCleanJournal,
  deleteJournalEntry,
  deleteJournalPage,
  renameJournal,
  setJournalPage,
  setJournalPageFromFile,
  updateJournalContent,
} from './write.js';

export const journalsArea: ModuleArea = {
  id: 'journals',
  queries: [
    { names: 'listJournals', handler: listJournals },
    { names: 'getJournalContent', handler: getJournalContent },
    { names: 'getJournalPageContent', handler: getJournalPageContent },
    { names: 'searchJournals', handler: searchJournals },
    { names: 'createCleanJournal', handler: createCleanJournal },
    { names: 'setJournalPage', handler: setJournalPage },
    { names: 'addJournalPage', handler: addJournalPage },
    { names: 'updateJournalContent', handler: updateJournalContent },
    { names: 'appendJournalPageContent', handler: appendJournalPageContent },
    { names: 'setJournalPageFromFile', handler: setJournalPageFromFile },
    { names: 'splitJournalPage', handler: splitJournalPage },
    { names: 'renameJournal', handler: renameJournal },
    { names: 'deleteJournalPage', handler: deleteJournalPage },
    { names: 'deleteJournalEntry', handler: deleteJournalEntry },
    { names: 'rewriteJournalImages', handler: rewriteJournalImages },
    { names: 'linkJournalTags', handler: linkJournalTags },
    { names: 'rewriteWorldPaths', handler: rewriteWorldPaths },
    { names: 'setActorToken', handler: setActorToken },
    { names: 'refreshActorItemsFromSource', handler: refreshActorItemsFromSource },
    { names: 'renameFolder', handler: renameFolder },
    { names: 'deleteFolder', handler: deleteFolder },
  ],
  settings: [],
};
