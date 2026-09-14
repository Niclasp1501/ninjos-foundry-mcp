/**
 * Log lines on stderr and, for the backend, in a file.
 *
 * Standard output belongs to MCP in the wrapper, so nothing here ever writes
 * there. The backend runs detached without a console; its only record is the
 * file. The file is rotated at a fixed size: on 06.09.2026 the one line that
 * explained an eleven hour outage sat in a 19 MB log nobody opened.
 */
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

export type Level = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

export interface LoggerOptions {
  component: string;
  file?: string | null;
  stderr?: boolean;
  maxFileBytes?: number;
  debug?: boolean;
}

function render(meta: unknown): string {
  if (meta === undefined) return '';
  if (meta instanceof Error) return ` ${meta.message}`;
  try {
    return ` ${JSON.stringify(meta)}`;
  } catch {
    return ` ${String(meta)}`;
  }
}

export function createLogger(options: LoggerOptions): Logger {
  const maxBytes = options.maxFileBytes ?? 2 * 1024 * 1024;
  let fileBroken = false;

  const toFile = (line: string) => {
    if (!options.file || fileBroken) return;
    try {
      mkdirSync(dirname(options.file), { recursive: true });
      try {
        if (statSync(options.file).size > maxBytes) renameSync(options.file, `${options.file}.old`);
      } catch {
        // No file yet.
      }
      appendFileSync(options.file, `${line}\n`);
    } catch {
      // A log that cannot be written must not take the server down with it.
      fileBroken = true;
    }
  };

  const write = (level: Level, message: string, meta?: unknown) => {
    if (level === 'debug' && !options.debug) return;
    const line = `${new Date().toISOString()} ${level.toUpperCase()} [${options.component}] ${message}${render(meta)}`;
    if (options.stderr !== false) process.stderr.write(`${line}\n`);
    toFile(line);
  };

  return {
    debug: (m, meta) => write('debug', m, meta),
    info: (m, meta) => write('info', m, meta),
    warn: (m, meta) => write('warn', m, meta),
    error: (m, meta) => write('error', m, meta),
  };
}

/** For tests and for code that must log somewhere but nowhere in particular. */
export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** The same log with `[scope]` in front of every message. Writes where `base` writes. */
export function scopedLogger(base: Logger, scope: string): Logger {
  const prefix = `[${scope}] `;
  return {
    debug: (m, meta) => base.debug(prefix + m, meta),
    info: (m, meta) => base.info(prefix + m, meta),
    warn: (m, meta) => base.warn(prefix + m, meta),
    error: (m, meta) => base.error(prefix + m, meta),
  };
}

let areaLogTarget: Logger = silentLogger;

/**
 * Where area loggers write: the backend sets its own logger at start, so every
 * area writes into the one rotated backend log instead of opening the file a
 * second time (two rotations on one file lose lines). Returns the previous
 * target, for tests that restore it.
 */
export function setAreaLogTarget(logger: Logger): Logger {
  const previous = areaLogTarget;
  areaLogTarget = logger;
  return previous;
}

/**
 * The log of one area, `[area:<id>]` in the backend log. Usable at import:
 * each line goes to the target of the moment it is written, so a logger taken
 * before the backend started writes into the backend log as soon as it runs.
 * Before that, and in tests without a backend, lines go nowhere.
 */
export function areaLogger(areaId: string): Logger {
  const prefix = `[area:${areaId}] `;
  return {
    debug: (m, meta) => areaLogTarget.debug(prefix + m, meta),
    info: (m, meta) => areaLogTarget.info(prefix + m, meta),
    warn: (m, meta) => areaLogTarget.warn(prefix + m, meta),
    error: (m, meta) => areaLogTarget.error(prefix + m, meta),
  };
}
