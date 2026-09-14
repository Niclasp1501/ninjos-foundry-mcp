/**
 * Files in Foundry's data storage: browse, create folders, upload, copy.
 *
 * - Only the source "data" is written; "public" (Foundry's own files) is read.
 * - Paths follow common/areas/world-files-decks/paths.ts; writing never goes
 *   into modules, systems or another world.
 * - An existing file is never replaced without `overwrite: true`.
 * - Every write is read back by listing the folder afterwards.
 * - Deleting and moving are not offered: Foundry's client API has no call to
 *   delete a file. A move is a copy (copy-file), world-rewrite-paths for the
 *   references, and removing the old file outside Foundry.
 * - Files have no document kind; the rights are the write switch, and
 *   Foundry's own permissions FILES_BROWSE and FILES_UPLOAD.
 */
import {
  baseName,
  bytesText,
  checkFileName,
  COPY_FILE_MAX_BYTES,
  extensionOf,
  extensionProblem,
  joinPath,
  normalizePath,
  parentOf,
  UPLOAD_FILE_MAX_BYTES,
  writeProblem,
} from '../../../common/areas/world-files-decks/paths.js';
import { WRITE_SWITCH_ONLY, type Access } from '../../../common/permissions.js';
import { QueryError, type HandlerContext, type QueryHandler } from '../../dispatcher.js';
import { requireWorld } from '../../world-ready.js';
import {
  checked,
  inputOf,
  invalid,
  isRecord,
  listOfTexts,
  messageOf,
  optionalBoolean,
  optionalChoice,
  optionalText,
  recordWorldChange,
  requireUserPermission,
} from './common.js';

export const FILE_SOURCES = ['data', 'public'] as const;
export type FileSource = (typeof FILE_SOURCES)[number];

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  webm: 'video/webm',
  mp4: 'video/mp4',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  csv: 'text/csv',
  pdf: 'application/pdf',
};

export function filePicker(): FoundryWorldFilesDecksFilePicker {
  const scope = globalThis as {
    foundry?: { applications?: { apps?: { FilePicker?: { implementation?: unknown } } } };
    FilePicker?: unknown;
  };
  const picker = (scope.foundry?.applications?.apps?.FilePicker?.implementation ??
    scope.FilePicker) as FoundryWorldFilesDecksFilePicker | undefined;
  if (!picker || typeof picker.browse !== 'function')
    throw new QueryError('NOT_AVAILABLE', "Foundry's FilePicker is not available in this browser");
  return picker;
}

function uploadableExtensions(): ReadonlySet<string> | null {
  const list = (globalThis as { CONST?: { UPLOADABLE_FILE_EXTENSIONS?: unknown } }).CONST
    ?.UPLOADABLE_FILE_EXTENSIONS;
  return isRecord(list) ? new Set(Object.keys(list).map(key => key.toLowerCase())) : null;
}

function decodedEntry(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let text = value;
  try {
    text = decodeURIComponent(value);
  } catch {
    // keep as it is
  }
  return text.replace(/^\/+/, '').replace(/\/+$/, '');
}

export type Listing =
  { ok: true; dirs: string[]; files: string[] } | { ok: false; problem: string };

/** One folder, with full decoded paths. A failure is a result, so a caller can say why. */
export async function listFolder(source: FileSource, path: string): Promise<Listing> {
  let answer: unknown;
  try {
    answer = await filePicker().browse(source, path);
  } catch (error) {
    return { ok: false, problem: messageOf(error) };
  }
  if (!isRecord(answer)) return { ok: false, problem: 'Foundry answered without a listing' };
  const entries = (value: unknown) =>
    (Array.isArray(value) ? value : []).map(decodedEntry).filter((v): v is string => !!v);
  return { ok: true, dirs: entries(answer['dirs']), files: entries(answer['files']) };
}

function pathArgument(input: Record<string, unknown>, key: string, allowRoot: boolean): string {
  return checked(() => normalizePath(input[key] ?? (allowRoot ? '' : undefined), key, allowRoot));
}

function worldId(): string {
  return game.world?.id ?? '';
}

function requireWritable(path: string): void {
  const problem = writeProblem(path, worldId());
  if (problem) throw new QueryError('PERMISSION_DENIED', problem);
}

const dryRunOrSwitch = (data: unknown): Access =>
  inputOf(data)['dryRun'] === true ? { kind: 'read' } : WRITE_SWITCH_ONLY;

export const BROWSE_LIMIT = 500;

export const browseFiles: QueryHandler = {
  access: { kind: 'read' },
  run: async data => {
    requireWorld();
    requireUserPermission('FILES_BROWSE', 'listing files');
    const input = inputOf(data);
    const source = optionalChoice(input, 'source', FILE_SOURCES) ?? 'data';
    const path = pathArgument(input, 'path', true);
    const extensions = listOfTexts(input, 'extensions')?.map(ext =>
      ext.replace(/^\./, '').toLowerCase()
    );
    const listing = await listFolder(source, path);
    if (!listing.ok)
      throw new QueryError(
        'NOT_FOUND',
        `The folder "${path || '(root)'}" in ${source} could not be listed: ${listing.problem}`
      );
    const files = extensions
      ? listing.files.filter(file => extensions.includes(extensionOf(file)))
      : listing.files;
    const entry = (full: string) => ({ name: baseName(full), path: full });
    return {
      source,
      path,
      dirs: listing.dirs.slice(0, BROWSE_LIMIT).map(entry),
      files: files.slice(0, BROWSE_LIMIT).map(entry),
      totalDirs: listing.dirs.length,
      totalFiles: files.length,
      truncated: listing.dirs.length > BROWSE_LIMIT || files.length > BROWSE_LIMIT,
    };
  },
};

export const createDirectory: QueryHandler = {
  access: dryRunOrSwitch,
  run: async (data, context) => {
    requireWorld();
    const input = inputOf(data);
    const path = pathArgument(input, 'path', false);
    const dryRun = optionalBoolean(input, 'dryRun') === true;
    requireWritable(path);
    if (!dryRun) requireUserPermission('FILES_UPLOAD', 'creating folders');

    // Walk down from the top: every level that is missing is created, in order.
    const parts = path.split('/');
    const missing: string[] = [];
    let known = true;
    for (let depth = 1; depth <= parts.length; depth += 1) {
      const level = parts.slice(0, depth).join('/');
      if (known) {
        const parent = await listFolder('data', parentOf(level));
        if (parent.ok && parent.dirs.includes(level)) continue;
        if (!parent.ok && depth > 1)
          throw new QueryError(
            'NOT_FOUND',
            `The folder "${parentOf(level)}" could not be listed: ${parent.problem}`
          );
        known = false;
      }
      missing.push(level);
    }
    if (!missing.length) return { path, created: [], existed: true, dryRun };
    for (const level of missing) requireWritable(level);
    if (dryRun) return { path, created: [], wouldCreate: missing, existed: false, dryRun };

    const created: string[] = [];
    for (const level of missing) {
      try {
        await filePicker().createDirectory('data', level, {});
      } catch (error) {
        throw new QueryError(
          'CREATE_FAILED',
          `Foundry refused to create the folder "${level}": ${messageOf(error)}.` +
            (created.length ? ` Created before the failure: ${created.join(', ')}.` : '')
        );
      }
      const check = await listFolder('data', parentOf(level));
      if (!check.ok || !check.dirs.includes(level)) {
        throw new QueryError(
          'NOT_APPLIED',
          `Foundry reported the folder "${level}" as created, but it is not there when read back.` +
            (created.length ? ` Created before: ${created.join(', ')}.` : '')
        );
      }
      created.push(level);
    }
    recordWorldChange(context, 'Files', {
      query: 'createDirectory',
      tool: 'create-directory',
      action: 'create',
      targets: created.map(name => ({ name })),
      summary: `Created the folder(s) ${created.join(', ')} in the data storage.`,
    });
    return { path, created, existed: false, dryRun };
  },
};

function decodeBase64(text: string): Uint8Array {
  const clean = text.replace(/^data:[^;,]*;base64,/i, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 !== 0)
    throw invalid('base64 is not valid base64 text');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

interface StorePlan {
  directory: string;
  name: string;
  path: string;
  existed: boolean;
}

/** Everything checked before a file is written: place, name, type, folder, existing file. */
async function planStore(directory: string, name: string, overwrite: boolean): Promise<StorePlan> {
  const path = joinPath(directory, name);
  requireWritable(path);
  const typeProblem = extensionProblem(name, uploadableExtensions());
  if (typeProblem) throw new QueryError('PERMISSION_DENIED', typeProblem);
  const folder = await listFolder('data', directory);
  if (!folder.ok)
    throw new QueryError(
      'NOT_FOUND',
      `The folder "${directory || '(root)'}" does not exist or cannot be listed (${folder.problem}). ` +
        'Create it with create-directory first.'
    );
  const existed = folder.files.includes(path);
  if (existed && !overwrite)
    throw new QueryError(
      'EXISTS',
      `"${path}" exists already. Nothing was written; pass overwrite: true to replace it.`
    );
  return { directory, name, path, existed };
}

async function store(plan: StorePlan, bytes: Uint8Array, mime: string): Promise<string> {
  const file = new File([bytes as BlobPart], plan.name, { type: mime });
  let response: unknown;
  try {
    response = await filePicker().upload('data', plan.directory, file, {}, { notify: false });
  } catch (error) {
    throw new QueryError(
      'UPLOAD_FAILED',
      `Foundry refused the upload of "${plan.path}": ${messageOf(error)}`
    );
  }
  if (!response || (isRecord(response) && response['status'] === 'error')) {
    const reason = isRecord(response) ? String(response['message'] ?? 'no reason') : 'no answer';
    throw new QueryError(
      'UPLOAD_FAILED',
      `Foundry refused the upload of "${plan.path}": ${reason}`
    );
  }
  const check = await listFolder('data', plan.directory);
  if (!check.ok || !check.files.includes(plan.path)) {
    throw new QueryError(
      'NOT_APPLIED',
      `Foundry reported the upload of "${plan.path}", but the file is not in the folder when read back.`
    );
  }
  return plan.path;
}

function recordStore(
  context: HandlerContext,
  query: string,
  tool: string,
  plan: StorePlan,
  bytes: number,
  from?: string
): void {
  recordWorldChange(context, 'Files', {
    query,
    tool,
    action: plan.existed ? 'update' : 'create',
    targets: [{ name: plan.path }],
    summary:
      `${plan.existed ? 'Replaced' : 'Wrote'} the file ${plan.path} (${bytesText(bytes)})` +
      (from ? `, copied from ${from}` : '') +
      '. File contents are not kept in the log, so this cannot be undone.',
  });
}

export const uploadFile: QueryHandler = {
  access: dryRunOrSwitch,
  run: async (data, context) => {
    requireWorld();
    const input = inputOf(data);
    const directory = pathArgument(input, 'path', true);
    const name = checked(() => checkFileName(input['name'], 'name'));
    const text = optionalText(input, 'text');
    const base64 = optionalText(input, 'base64');
    if ((text === undefined) === (base64 === undefined))
      throw invalid('Give exactly one of text (for a text file) or base64 (for any file)');
    const overwrite = optionalBoolean(input, 'overwrite') === true;
    const dryRun = optionalBoolean(input, 'dryRun') === true;
    const maxBase64 = Math.ceil((UPLOAD_FILE_MAX_BYTES * 4) / 3) + 200;
    if (base64 !== undefined && base64.length > maxBase64)
      throw invalid(
        `base64 is too long for a file of at most ${bytesText(UPLOAD_FILE_MAX_BYTES)}; put larger files into the data folder directly`
      );
    const bytes = text !== undefined ? new TextEncoder().encode(text) : decodeBase64(base64 ?? '');
    if (bytes.byteLength > UPLOAD_FILE_MAX_BYTES)
      throw invalid(
        `The file has ${bytesText(bytes.byteLength)}; upload-file takes at most ${bytesText(UPLOAD_FILE_MAX_BYTES)}. ` +
          'Put larger files into the data folder directly.'
      );
    if (!dryRun) requireUserPermission('FILES_UPLOAD', 'uploading files');
    const plan = await planStore(directory, name, overwrite);
    if (dryRun)
      return { dryRun, path: plan.path, bytes: bytes.byteLength, wouldReplace: plan.existed };
    const path = await store(plan, bytes, MIME[extensionOf(name)] ?? 'application/octet-stream');
    recordStore(context, 'uploadFile', 'upload-file', plan, bytes.byteLength);
    return { dryRun, path, bytes: bytes.byteLength, replaced: plan.existed };
  },
};

function routeOf(path: string): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const getRoute = (globalThis as { foundry?: { utils?: { getRoute?: (p: string) => string } } })
    .foundry?.utils?.getRoute;
  return typeof getRoute === 'function' ? getRoute(encoded) : `/${encoded}`;
}

export const copyFile: QueryHandler = {
  access: dryRunOrSwitch,
  run: async (data, context) => {
    requireWorld();
    const input = inputOf(data);
    const from = pathArgument(input, 'from', false);
    const directory = pathArgument(input, 'to', true);
    const name = checked(() =>
      checkFileName(input['name'] === undefined ? baseName(from) : input['name'], 'name')
    );
    const overwrite = optionalBoolean(input, 'overwrite') === true;
    const dryRun = optionalBoolean(input, 'dryRun') === true;
    if (joinPath(directory, name) === from)
      throw invalid(`from and the target are the same file: "${from}"`);

    const sourceFolder = await listFolder('data', parentOf(from));
    if (!sourceFolder.ok || !sourceFolder.files.includes(from))
      throw new QueryError(
        'NOT_FOUND',
        `"${from}" is not a file in the data storage` +
          (sourceFolder.ok ? '.' : ` (its folder cannot be listed: ${sourceFolder.problem}).`)
      );
    if (!dryRun) requireUserPermission('FILES_UPLOAD', 'copying files');
    const plan = await planStore(directory, name, overwrite);
    if (dryRun) return { dryRun, from, path: plan.path, wouldReplace: plan.existed };

    const fetcher = (globalThis as { fetch?: typeof fetch }).fetch;
    if (typeof fetcher !== 'function')
      throw new QueryError('NOT_AVAILABLE', 'This browser cannot fetch files (no fetch)');
    let bytes: Uint8Array;
    let mime: string;
    try {
      const response = await fetcher(routeOf(from));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const size = Number(response.headers.get('content-length') ?? 0);
      if (size > COPY_FILE_MAX_BYTES) throw new Error(`the file has ${bytesText(size)}`);
      bytes = new Uint8Array(await response.arrayBuffer());
      mime =
        response.headers.get('content-type') ??
        MIME[extensionOf(name)] ??
        'application/octet-stream';
    } catch (error) {
      throw new QueryError(
        'READ_FAILED',
        `"${from}" could not be read from Foundry: ${messageOf(error)}. Nothing was written.`
      );
    }
    if (bytes.byteLength > COPY_FILE_MAX_BYTES)
      throw invalid(
        `"${from}" has ${bytesText(bytes.byteLength)}; copy-file copies at most ${bytesText(COPY_FILE_MAX_BYTES)}. Nothing was written.`
      );
    const path = await store(plan, bytes, mime);
    recordStore(context, 'copyFile', 'copy-file', plan, bytes.byteLength, from);
    return { dryRun, from, path, bytes: bytes.byteLength, replaced: plan.existed };
  },
};
