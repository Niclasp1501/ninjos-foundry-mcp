/**
 * The folder where the server keeps what it learns and what the person sets
 * up: the remembered origin, the agent clients.
 *
 * Next to the installation on Windows (%LOCALAPPDATA%\FoundryMCPServer), under
 * ~/.config/ninjos-foundry-mcp elsewhere. FOUNDRY_MCP_STATE_DIR moves it, which
 * is also what the tests use.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

export function stateDir(env: Record<string, string | undefined> = process.env): string {
  return (
    env['FOUNDRY_MCP_STATE_DIR'] ||
    (env['LOCALAPPDATA']
      ? join(env['LOCALAPPDATA'], 'FoundryMCPServer')
      : join(homedir(), '.config', 'ninjos-foundry-mcp'))
  );
}
