#!/usr/bin/env node
/**
 * Entry of the backend process: lock, start, and a clean end.
 */
import { join } from 'node:path';
import { dirname } from 'node:path';
import { startBackend } from './backend.js';
import { readConfig } from './config.js';
import { BackendLock } from './lock.js';
import { createLogger } from './logger.js';
import { readServerVersion } from './version.js';

async function main(): Promise<void> {
  const { config, warnings } = readConfig();
  const logger = createLogger({
    component: 'backend',
    file: config.logFile ?? join(dirname(config.originStoreFile), 'logs', 'backend.log'),
  });
  for (const warning of warnings) logger.warn(warning);

  const lock = new BackendLock({ file: config.lockFile });
  const acquired = lock.acquire();
  if (!acquired.acquired) {
    logger.info('Another backend holds the lock, leaving', acquired.holder);
    process.exit(0);
  }
  if (acquired.tookOver) logger.warn(`Took over a stale lock: ${acquired.tookOver.why}`);

  const touch = setInterval(() => lock.touch(), 5 * 60 * 1000);
  touch.unref();

  let backend: Awaited<ReturnType<typeof startBackend>> | null = null;
  let ending = false;
  const end = async (code: number) => {
    if (ending) return;
    ending = true;
    clearInterval(touch);
    try {
      await backend?.close();
    } finally {
      lock.release();
      process.exit(code);
    }
  };

  process.on('SIGINT', () => void end(0));
  process.on('SIGTERM', () => void end(0));
  process.on('uncaughtException', error => {
    logger.error('Uncaught exception', error);
  });
  process.on('unhandledRejection', reason => {
    logger.error(
      'Unhandled rejection',
      reason instanceof Error ? reason : { reason: String(reason) }
    );
  });

  try {
    backend = await startBackend({
      config,
      logger,
      version: readServerVersion(),
      onIdle: () => void end(0),
    });
  } catch (error) {
    logger.error('The backend could not start', error);
    lock.giveBack();
    process.exit(1);
  }
}

void main();
