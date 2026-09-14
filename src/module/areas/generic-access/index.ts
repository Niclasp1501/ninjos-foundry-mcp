/**
 * Area generic-access: read and write any document type with field selection.
 *
 * Module side: query handlers of the package. No settings and no visible texts.
 */
import type { ModuleArea } from '../../areas.js';
import { describeDocumentType, getDocument, listDocuments } from './read.js';
import { createDocument, deleteDocument, updateDocument } from './write.js';

export const genericAccessArea: ModuleArea = {
  id: 'generic-access',
  queries: [
    { names: 'listDocuments', handler: listDocuments },
    { names: 'getDocument', handler: getDocument },
    { names: 'describeDocumentType', handler: describeDocumentType },
    { names: 'createDocument', handler: createDocument },
    { names: 'updateDocument', handler: updateDocument },
    { names: 'deleteDocument', handler: deleteDocument },
  ],
  settings: [],
};
