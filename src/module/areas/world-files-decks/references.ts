/**
 * Which documents point to a path, and which referenced files do not exist.
 *
 * - "Points to" uses the path rule of world-rewrite-paths (the journals area, only
 *   imported): a prefix counts where a path begins and up to a path boundary,
 *   in plain and in encoded spelling. So the check before a move finds exactly
 *   what the rewrite would change.
 * - Missing files: every text of a document that is a file path as a whole,
 *   or a src, href or url() inside markup, with a known media, text or font
 *   extension. Each folder is listed once; Foundry's own files ("icons/...")
 *   are looked up in "public" as well. Wildcard paths are counted, not checked.
 * - Scanned: scenes, actors, items, journals, playlists, roll tables, card
 *   stacks, macros and users, with every embedded document. Compendiums are
 *   not scanned.
 * - Both only read.
 */
import {
  PUBLIC_TOP_FOLDERS,
  normalizePath,
  parentOf,
  pathsInText,
  stringsOf,
} from '../../../common/areas/world-files-decks/paths.js';
import type { HandlerContext, QueryHandler } from '../../dispatcher.js';
import { requireWorld } from '../../world-ready.js';
import { makePathRule, PathRuleError, rewriteString } from '../journals/path-rewrite.js';
import {
  checked,
  inputOf,
  invalid,
  listOfTexts,
  optionalInteger,
  requireUserPermission,
} from './common.js';
import { listFolder } from './files.js';

export const REFERENCE_COLLECTIONS: Readonly<Record<string, string>> = {
  scenes: 'Scene',
  actors: 'Actor',
  items: 'Item',
  journal: 'JournalEntry',
  playlists: 'Playlist',
  tables: 'RollTable',
  cards: 'Cards',
  macros: 'Macro',
  users: 'User',
};

interface Scanned {
  collection: string;
  documentName: string;
  id: string;
  uuid: string;
  name: string | null;
  data: unknown;
}

function collectionsOf(input: Record<string, unknown>): string[] {
  const wanted = listOfTexts(input, 'collections') ?? Object.keys(REFERENCE_COLLECTIONS);
  const unknown = wanted.filter(name => !(name in REFERENCE_COLLECTIONS));
  if (unknown.length)
    throw invalid(
      `Unknown collection(s): ${unknown.join(', ')}. Known: ${Object.keys(REFERENCE_COLLECTIONS).join(', ')}`
    );
  if (!wanted.length) throw invalid('collections must name at least one collection');
  return wanted;
}

function documentsOf(names: readonly string[]): Scanned[] {
  const out: Scanned[] = [];
  for (const collection of names) {
    const documentName = REFERENCE_COLLECTIONS[collection] as string;
    const entries = (game as unknown as Record<string, unknown>)[collection] as
      { contents?: unknown[] } | undefined;
    for (const entry of entries?.contents ?? []) {
      const doc = entry as { id?: unknown; uuid?: unknown; name?: unknown; toObject?: unknown };
      if (typeof doc.id !== 'string') continue;
      const data =
        typeof doc.toObject === 'function' ? (doc.toObject as () => unknown).call(doc) : { ...doc };
      out.push({
        collection,
        documentName,
        id: doc.id,
        uuid: typeof doc.uuid === 'string' ? doc.uuid : `${documentName}.${doc.id}`,
        name: typeof doc.name === 'string' ? doc.name : null,
        data,
      });
    }
  }
  return out;
}

function progressEvery(context: HandlerContext, done: number, total: number): void {
  if (done % 100 === 0) context.progress({ progress: done, total, message: 'scanning the world' });
}

export const findFileReferences: QueryHandler = {
  access: { kind: 'read' },
  run: (data, context) => {
    requireWorld();
    const input = inputOf(data);
    const path = checked(() => normalizePath(input['path'], 'path'));
    const max = optionalInteger(input, 'maxResults', 1, 1000) ?? 200;
    let rule;
    try {
      // The target only exists to build the rule; nothing is rewritten.
      rule = makePathRule(path, `${path}.probe`);
    } catch (error) {
      if (error instanceof PathRuleError) throw invalid(error.message);
      throw error;
    }
    const documents = documentsOf(collectionsOf(input));
    const references: Array<Record<string, unknown>> = [];
    let total = 0;
    const touched = new Set<string>();
    documents.forEach((doc, index) => {
      for (const { field, value } of stringsOf(doc.data)) {
        const found = rewriteString(value, rule);
        if (!found.count) continue;
        total += 1;
        touched.add(doc.uuid);
        if (references.length < max) {
          references.push({
            collection: doc.collection,
            documentName: doc.documentName,
            uuid: doc.uuid,
            name: doc.name,
            field,
            paths: found.examples.map(example => example.split(' -> ')[0]),
          });
        }
      }
      progressEvery(context, index + 1, documents.length);
    });
    return {
      path,
      scannedDocuments: documents.length,
      documents: touched.size,
      totalReferences: total,
      references,
      truncated: total > references.length,
    };
  },
};

interface Referenced {
  refs: Array<{ uuid: string; name: string | null; field: string }>;
  count: number;
}

export const findMissingFiles: QueryHandler = {
  access: { kind: 'read' },
  run: async (data, context) => {
    requireWorld();
    requireUserPermission('FILES_BROWSE', 'checking files');
    const input = inputOf(data);
    const under =
      input['under'] === undefined
        ? ''
        : checked(() => normalizePath(input['under'], 'under', true));
    const maxDirectories = optionalInteger(input, 'maxDirectories', 1, 1000) ?? 300;
    const max = optionalInteger(input, 'maxResults', 1, 1000) ?? 200;
    const documents = documentsOf(collectionsOf(input));

    const files = new Map<string, Referenced>();
    let wildcards = 0;
    documents.forEach((doc, index) => {
      for (const { field, value } of stringsOf(doc.data)) {
        for (const path of pathsInText(value)) {
          if (path.includes('*')) {
            wildcards += 1;
            continue;
          }
          if (under && path !== under && !path.startsWith(`${under}/`)) continue;
          const entry = files.get(path) ?? { refs: [], count: 0 };
          entry.count += 1;
          if (entry.refs.length < 5) entry.refs.push({ uuid: doc.uuid, name: doc.name, field });
          files.set(path, entry);
        }
      }
      progressEvery(context, index + 1, documents.length);
    });

    const byFolder = new Map<string, string[]>();
    for (const path of [...files.keys()].sort()) {
      const folder = parentOf(path);
      byFolder.set(folder, [...(byFolder.get(folder) ?? []), path]);
    }
    const folders = [...byFolder.keys()];
    const checkedFolders = folders.slice(0, maxDirectories);
    const missing: Array<Record<string, unknown>> = [];
    let totalMissing = 0;
    let checkedFiles = 0;
    for (const [index, folder] of checkedFolders.entries()) {
      const top = folder.split('/')[0] ?? '';
      const inData = await listFolder('data', folder);
      const inPublic = PUBLIC_TOP_FOLDERS.has(top) ? await listFolder('public', folder) : null;
      for (const path of byFolder.get(folder) ?? []) {
        checkedFiles += 1;
        const exists =
          (inData.ok && inData.files.includes(path)) ||
          (inPublic !== null && inPublic.ok && inPublic.files.includes(path));
        if (exists) continue;
        totalMissing += 1;
        if (missing.length >= max) continue;
        const reachable = inData.ok || (inPublic !== null && inPublic.ok);
        const entry = files.get(path) as Referenced;
        missing.push({
          path,
          reason: reachable
            ? 'the folder exists, the file is not in it'
            : `the folder cannot be listed: ${inData.ok ? '' : inData.problem}`,
          referenceCount: entry.count,
          references: entry.refs,
        });
      }
      if ((index + 1) % 25 === 0)
        context.progress({
          progress: index + 1,
          total: checkedFolders.length,
          message: 'listing folders',
        });
    }
    const notChecked = folders.slice(maxDirectories);
    return {
      under: under || null,
      scannedDocuments: documents.length,
      referencedFiles: files.size,
      checkedFiles,
      checkedFolders: checkedFolders.length,
      notCheckedFolders: notChecked.length,
      notCheckedFiles: notChecked.reduce(
        (sum, folder) => sum + (byFolder.get(folder)?.length ?? 0),
        0
      ),
      wildcardsSkipped: wildcards,
      totalMissing,
      missing,
      truncated: totalMissing > missing.length,
    };
  },
};
