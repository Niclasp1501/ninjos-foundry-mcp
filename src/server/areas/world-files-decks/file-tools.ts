/**
 * browse-files, create-directory, upload-file, copy-file, find-file-references, find-missing-files.
 */
import { readOnlyTool, writingTool, type ToolDefinition } from '../../tools/types.js';
import {
  ask,
  COPY_TIMEOUT_MS,
  DRY_RUN,
  isRecord,
  listOf,
  param,
  pick,
  schema,
  SCAN_TIMEOUT_MS,
  str,
  unknownShape,
} from './shared.js';

const COLLECTIONS = param(
  'array',
  'Collections to scan: scenes, actors, items, journal, playlists, tables, cards, macros, users. Default all.',
  { items: { type: 'string' } }
);

export const browseFilesTool: ToolDefinition = {
  name: 'browse-files',
  title: 'Browse files',
  group: 'files',
  description:
    "List folders and files in one folder of Foundry's data storage (source data, default) or of Foundry's own " +
    'public files (source public). Paths are relative, such as "worlds/<world>/maps". Up to 500 entries each.',
  inputSchema: schema({
    path: param('string', 'Folder to list; empty for the top'),
    source: param('string', 'data (default) or public', { enum: ['data', 'public'] }),
    extensions: param('array', 'Only files with these extensions, such as ["png", "webp"]', {
      items: { type: 'string' },
    }),
  }),
  annotations: readOnlyTool('Browse files'),
  handler: async (args, context) => {
    const answer = await ask(
      context,
      'browseFiles',
      pick(args, ['path', 'source', 'extensions']),
      'browse files'
    );
    if (!isRecord(answer) || !Array.isArray(answer['files'])) return unknownShape(answer);
    const lines = [`${str(answer['source'])}: ${str(answer['path']) || '(top)'}`];
    const dirs = listOf(answer['dirs']).filter(isRecord);
    const files = listOf(answer['files']).filter(isRecord);
    lines.push(
      `Folders (${String(answer['totalDirs'])}):`,
      ...dirs.map(dir => `  ${str(dir['path'])}/`)
    );
    lines.push(
      `Files (${String(answer['totalFiles'])}):`,
      ...files.map(file => `  ${str(file['path'])}`)
    );
    if (answer['truncated'] === true) lines.push('Only the first 500 of each are shown.');
    return lines.join('\n');
  },
};

export const createDirectoryTool: ToolDefinition = {
  name: 'create-directory',
  title: 'Create a folder',
  group: 'files',
  description:
    "Create a folder in Foundry's data storage, with any missing folders above it. Never inside modules, systems " +
    'or another world. An existing folder is left as it is. Needs the write switch.',
  inputSchema: schema(
    {
      path: param('string', 'The folder to create, such as "worlds/<world>/handouts"'),
      dryRun: DRY_RUN,
    },
    ['path']
  ),
  annotations: writingTool('Create a folder', { destructive: false, idempotent: true }),
  handler: async (args, context) => {
    const answer = await ask(
      context,
      'createDirectory',
      pick(args, ['path', 'dryRun']),
      'create folder'
    );
    if (!isRecord(answer) || typeof answer['path'] !== 'string') return unknownShape(answer);
    if (answer['existed'] === true)
      return `The folder ${answer['path']} exists already; nothing changed.`;
    const planned = listOf(answer['wouldCreate']).map(String);
    if (answer['dryRun'] === true) return `Dry run: would create ${planned.join(', ')}.`;
    return `Created and read back: ${listOf(answer['created']).map(String).join(', ')}.`;
  },
};

export const uploadFileTool: ToolDefinition = {
  name: 'upload-file',
  title: 'Upload a small file',
  group: 'files',
  description:
    "Write a small file (at most 512 KiB) into an existing folder of Foundry's data storage, from text or from " +
    'base64. An existing file is only replaced with overwrite: true. Scripts and HTML are never written, and ' +
    'Foundry accepts only its upload types. Never inside modules, systems or another world. Needs the write switch. ' +
    'Foundry cannot delete files; there is no tool for that.',
  inputSchema: schema(
    {
      path: param(
        'string',
        'The folder, such as "worlds/<world>/handouts"; it must exist (create-directory)'
      ),
      name: param('string', 'File name with extension, such as "letter.md"'),
      text: param('string', 'Content of a text file, written as UTF-8'),
      base64: param(
        'string',
        'Content as base64 (a data: URL prefix is accepted); give text or base64'
      ),
      overwrite: param('boolean', 'Replace a file of the same name'),
      dryRun: DRY_RUN,
    },
    ['path', 'name']
  ),
  annotations: writingTool('Upload a small file', { destructive: true, idempotent: true }),
  handler: async (args, context) => {
    const answer = await ask(
      context,
      'uploadFile',
      pick(args, ['path', 'name', 'text', 'base64', 'overwrite', 'dryRun']),
      'upload file'
    );
    if (!isRecord(answer) || typeof answer['path'] !== 'string') return unknownShape(answer);
    if (answer['dryRun'] === true)
      return `Dry run: would ${answer['wouldReplace'] === true ? 'replace' : 'write'} ${answer['path']} (${String(answer['bytes'])} bytes).`;
    return `${answer['replaced'] === true ? 'Replaced' : 'Wrote'} ${answer['path']} (${String(answer['bytes'])} bytes), read back in its folder.`;
  },
};

export const copyFileTool: ToolDefinition = {
  name: 'copy-file',
  title: 'Copy a file',
  group: 'files',
  description:
    "Copy a file (at most 50 MiB) inside Foundry's data storage into an existing folder. The original stays: " +
    'Foundry cannot delete files. To move files: find-file-references on the old path, copy-file, then ' +
    'world-rewrite-paths (dryRun first), then find-missing-files. Needs the write switch.',
  inputSchema: schema(
    {
      from: param('string', 'The file to copy, such as "worlds/<world>/old/map.webp"'),
      to: param('string', 'The target folder; it must exist'),
      name: param('string', 'New file name; default the same name'),
      overwrite: param('boolean', 'Replace a file of the same name in the target folder'),
      dryRun: DRY_RUN,
    },
    ['from', 'to']
  ),
  annotations: writingTool('Copy a file', { destructive: true, idempotent: true }),
  handler: async (args, context) => {
    const answer = await ask(
      context,
      'copyFile',
      pick(args, ['from', 'to', 'name', 'overwrite', 'dryRun']),
      'copy file',
      { timeoutMs: COPY_TIMEOUT_MS }
    );
    if (!isRecord(answer) || typeof answer['path'] !== 'string') return unknownShape(answer);
    if (answer['dryRun'] === true)
      return `Dry run: would copy ${str(answer['from'])} to ${answer['path']}${answer['wouldReplace'] === true ? ', replacing the file there' : ''}.`;
    return (
      `Copied ${str(answer['from'])} to ${answer['path']} (${String(answer['bytes'])} bytes), read back. ` +
      'The original is unchanged; references still point to it until world-rewrite-paths changes them.'
    );
  },
};

function referenceLine(ref: Record<string, unknown>): string {
  return `${str(ref['uuid'])}${str(ref['name']) ? ` "${str(ref['name'])}"` : ''} ${str(ref['field'])}`;
}

export const findFileReferencesTool: ToolDefinition = {
  name: 'find-file-references',
  title: 'Find documents that use a path',
  group: 'files',
  description:
    'Find every field of every world document that points to a file or folder path, with the same path rule ' +
    'world-rewrite-paths uses: a folder matches the files under it, never a longer name. Use it before moving ' +
    'or replacing files. Compendiums are not scanned.',
  inputSchema: schema(
    {
      path: param('string', 'File or folder path, such as "worlds/<world>/tokens"'),
      collections: COLLECTIONS,
      maxResults: param('integer', 'At most this many references, 1 to 1000, default 200'),
    },
    ['path']
  ),
  annotations: readOnlyTool('Find documents that use a path'),
  handler: async (args, context) => {
    const answer = await ask(
      context,
      'findFileReferences',
      pick(args, ['path', 'collections', 'maxResults']),
      'find file references',
      { timeoutMs: SCAN_TIMEOUT_MS, onProgress: progress => context.progress(progress) }
    );
    if (!isRecord(answer) || !Array.isArray(answer['references'])) return unknownShape(answer);
    const refs = answer['references'].filter(isRecord);
    const lines = [
      `${String(answer['totalReferences'])} reference(s) to ${str(answer['path'])} in ${String(answer['documents'])} of ${String(answer['scannedDocuments'])} documents.`,
    ];
    for (const ref of refs)
      lines.push(`${referenceLine(ref)}: ${listOf(ref['paths']).map(String).join(', ')}`);
    if (answer['truncated'] === true)
      lines.push('More references exist; raise maxResults or narrow the path.');
    return lines.join('\n');
  },
};

export const findMissingFilesTool: ToolDefinition = {
  name: 'find-missing-files',
  title: 'Find missing files',
  group: 'files',
  description:
    'Find files that world documents point to but that do not exist: images, sounds, videos, text and fonts ' +
    "in fields and in markup, looked up in the data storage and in Foundry's own files. Wildcard paths are " +
    'counted but not checked. Compendiums are not scanned.',
  inputSchema: schema({
    under: param('string', 'Only paths inside this folder'),
    collections: COLLECTIONS,
    maxDirectories: param(
      'integer',
      'At most this many folders are listed, 1 to 1000, default 300'
    ),
    maxResults: param(
      'integer',
      'At most this many missing files are named, 1 to 1000, default 200'
    ),
  }),
  annotations: readOnlyTool('Find missing files'),
  handler: async (args, context) => {
    const answer = await ask(
      context,
      'findMissingFiles',
      pick(args, ['under', 'collections', 'maxDirectories', 'maxResults']),
      'find missing files',
      { timeoutMs: SCAN_TIMEOUT_MS, onProgress: progress => context.progress(progress) }
    );
    if (!isRecord(answer) || !Array.isArray(answer['missing'])) return unknownShape(answer);
    const lines = [
      `${String(answer['totalMissing'])} missing of ${String(answer['checkedFiles'])} checked files ` +
        `(${String(answer['referencedFiles'])} referenced in ${String(answer['scannedDocuments'])} documents).`,
    ];
    for (const entry of answer['missing'].filter(isRecord)) {
      lines.push(
        `${str(entry['path'])} (${str(entry['reason'])}), used ${String(entry['referenceCount'])} time(s):`
      );
      for (const ref of listOf(entry['references']).filter(isRecord))
        lines.push(`  ${referenceLine(ref)}`);
    }
    if (answer['truncated'] === true) lines.push('More files are missing; raise maxResults.');
    if (Number(answer['notCheckedFolders']) > 0)
      lines.push(
        `Not checked: ${String(answer['notCheckedFiles'])} file(s) in ${String(answer['notCheckedFolders'])} folder(s); raise maxDirectories or use under.`
      );
    if (Number(answer['wildcardsSkipped']) > 0)
      lines.push(`${String(answer['wildcardsSkipped'])} wildcard path(s) were not checked.`);
    return lines.join('\n');
  },
};
