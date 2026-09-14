/**
 * Reading and writing a client configuration file without losing anything.
 *
 * - A file that is not valid JSON is never touched. The previous Windows
 *   installer replaced it with a file holding only its own entry, which cost
 *   people every other server.
 * - Nothing is written when nothing changes, so running setup twice leaves no
 *   second backup. Before a change there is a backup, and only the newest few
 *   backups of our own naming are kept.
 * - Indentation, line ends, a byte order mark and the final newline stay as
 *   they were, so the user's diff shows only our entry.
 * - The new content goes to a temporary file first and replaces the original in
 *   one rename, then is read back. A failed check restores the backup.
 * - If another program changed the file while we worked, nothing is written.
 */
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { ConfigShapeError, type ConfigEdit, type EntryChange } from './client-config.js';

export const BACKUP_MARK = '.foundry-mcp-backup-';
export const DEFAULT_BACKUPS_KEPT = 3;

export interface JsonFormat {
  indent: string;
  eol: '\n' | '\r\n';
  bom: boolean;
  finalNewline: boolean;
}

export function detectFormat(text: string): JsonFormat {
  const bom = text.startsWith('﻿');
  const indent = /^[ \t]+(?=")/m.exec(text)?.[0] ?? '  ';
  return {
    indent,
    eol: text.includes('\r\n') ? '\r\n' : '\n',
    bom,
    finalNewline: /\n$/.test(text) || text.trim() === '',
  };
}

export function formatJson(value: unknown, format: JsonFormat): string {
  let text = JSON.stringify(value, null, format.indent);
  if (format.eol === '\r\n') text = text.replace(/\n/g, '\r\n');
  if (format.finalNewline) text += format.eol;
  return (format.bom ? '﻿' : '') + text;
}

export type FileStatus = 'written' | 'created' | 'unchanged' | 'missing' | 'unreadable' | 'failed';

export interface FileOutcome {
  file: string;
  status: FileStatus;
  changes: EntryChange[];
  lookAlikes: string[];
  addSkipped: boolean;
  backup?: string;
  problem?: string;
}

export interface UpdateOptions {
  create: boolean;
  now: () => Date;
  keepBackups?: number;
}

function stamp(date: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}` +
    `-${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Copy the file next to itself and drop our older backups beyond `keep`. */
export function backupFile(file: string, now: Date, keep: number): string {
  const dir = dirname(file);
  const base = `${basename(file)}${BACKUP_MARK}${stamp(now)}`;
  let target = join(dir, base);
  for (let n = 2; exists(target); n += 1) target = join(dir, `${base}-${n}`);
  copyFileSync(file, target);

  // The stamp in the name sorts by time; file times change when people copy folders.
  const prefix = `${basename(file)}${BACKUP_MARK}`;
  const ours = readdirSync(dir)
    .filter(name => name.startsWith(prefix))
    .sort((a, b) => b.localeCompare(a));
  for (const old of ours.slice(Math.max(1, keep))) {
    if (join(dir, old) !== target) rmSync(join(dir, old), { force: true });
  }
  return target;
}

function exists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function outcome(file: string, status: FileStatus, edit?: ConfigEdit): FileOutcome {
  return {
    file,
    status,
    changes: edit?.changes ?? [],
    lookAlikes: edit?.lookAlikes ?? [],
    addSkipped: edit?.addSkipped ?? false,
  };
}

/** Apply `edit` to the JSON in `file` under the rules at the top of this file. */
export function updateJsonFile(
  file: string,
  edit: (value: unknown) => ConfigEdit,
  options: UpdateOptions
): FileOutcome {
  let text: string;
  let before: { mtimeMs: number; size: number; mode: number };
  try {
    const stat = statSync(file);
    before = { mtimeMs: stat.mtimeMs, size: stat.size, mode: stat.mode };
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      return { ...outcome(file, 'unreadable'), problem: messageOf(error) };
    }
    if (!options.create) return outcome(file, 'missing');
    return createFile(file, edit);
  }

  const format = detectFormat(text);
  let parsed: unknown;
  try {
    const body = text.replace(/^﻿/, '');
    parsed = body.trim() === '' ? {} : JSON.parse(body);
  } catch (error) {
    return {
      ...outcome(file, 'unreadable'),
      problem: `not valid JSON, left unchanged (${messageOf(error)})`,
    };
  }

  let result: ConfigEdit;
  try {
    result = edit(parsed);
  } catch (error) {
    if (error instanceof ConfigShapeError) {
      return { ...outcome(file, 'unreadable'), problem: `${error.message}, left unchanged` };
    }
    throw error;
  }
  if (!result.changed) return outcome(file, 'unchanged', result);

  const wanted = formatJson(result.value, format);
  let backup: string;
  try {
    backup = backupFile(file, options.now(), options.keepBackups ?? DEFAULT_BACKUPS_KEPT);
  } catch (error) {
    return {
      ...outcome(file, 'failed', result),
      problem: `no backup possible, left unchanged (${messageOf(error)})`,
    };
  }

  const temporary = `${file}.foundry-mcp-new`;
  try {
    const now = statSync(file);
    if (now.mtimeMs !== before.mtimeMs || now.size !== before.size) {
      return {
        ...outcome(file, 'failed', result),
        backup,
        problem: 'another program changed the file meanwhile, left unchanged',
      };
    }
    writeFileSync(temporary, wanted, 'utf8');
    if (process.platform !== 'win32') chmodSync(temporary, before.mode & 0o777);
    renameSync(temporary, file);
    const check = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')) as unknown;
    if (JSON.stringify(check) !== JSON.stringify(result.value)) {
      throw new Error('the file reads back differently');
    }
  } catch (error) {
    rmSync(temporary, { force: true });
    let restored = '';
    try {
      copyFileSync(backup, file);
      restored = ', backup restored';
    } catch (restoreError) {
      restored = `, restoring the backup failed too (${messageOf(restoreError)})`;
    }
    return {
      ...outcome(file, 'failed', result),
      backup,
      problem: `${messageOf(error)}${restored}`,
    };
  }
  return { ...outcome(file, 'written', result), backup };
}

function createFile(file: string, edit: (value: unknown) => ConfigEdit): FileOutcome {
  const result = edit({});
  if (!result.changed) return outcome(file, 'missing', result);
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, formatJson(result.value, detectFormat('')), {
      encoding: 'utf8',
      flag: 'wx',
    });
  } catch (error) {
    return { ...outcome(file, 'failed', result), problem: messageOf(error) };
  }
  return outcome(file, 'created', result);
}

/** Parse a configuration for reading only. */
export function readJsonFile(file: string): { value: unknown } | { problem: string } | null {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return { problem: messageOf(error) };
  }
  try {
    const body = text.replace(/^﻿/, '');
    return { value: body.trim() === '' ? {} : (JSON.parse(body) as unknown) };
  } catch (error) {
    return { problem: `not valid JSON (${messageOf(error)})` };
  }
}
