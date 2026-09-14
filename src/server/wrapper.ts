#!/usr/bin/env node
/**
 * Entry of the MCP server a client starts: one process per session.
 *
 * Speaks MCP on standard input and output and hands everything to the shared
 * backend, starting one when none runs. It ends itself when the client goes
 * away and never ends the backend: until 04.09.2026 a closing session took the
 * backend down with it, and with it the bridge of every other open session.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { readConfig } from './config.js';
import { BackendClient } from './control/backend-client.js';
import { createLogger } from './logger.js';
import { createMcpServer } from './mcp-facade.js';
import { readServerVersion } from './version.js';

async function main(): Promise<void> {
  const { config, warnings } = readConfig();
  const logger = createLogger({ component: 'wrapper' });
  for (const warning of warnings) logger.warn(warning);

  const backendScript = fileURLToPath(new URL('./backend-main.js', import.meta.url));
  const client = new BackendClient({
    host: config.controlHost,
    port: config.controlPort,
    logger,
    spawnBackend: () => {
      const child = spawn(process.execPath, [backendScript], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: process.env,
      });
      child.unref();
    },
  });

  // Connect right away, so the backend counts this session while it is open.
  client.ensureConnected().catch(error => logger.warn('Backend not reachable yet', error));

  const server = createMcpServer({
    name: config.serverName,
    version: readServerVersion(),
    api: client,
    logger,
  });
  await server.connect(new StdioServerTransport());

  let ending = false;
  const end = () => {
    if (ending) return;
    ending = true;
    client.close();
    process.exit(0);
  };
  process.stdin.on('end', end);
  process.stdin.on('close', end);
  process.on('SIGINT', end);
  process.on('SIGTERM', end);
}

void main();
