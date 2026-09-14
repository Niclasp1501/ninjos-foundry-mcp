/**
 * The entry under "Apps" in Windows, through reg.exe.
 *
 * Same key as the previous installer,
 * so there is one entry, not two, and it now starts the new uninstaller.
 */
import { spawnSync } from 'node:child_process';
import { win32 } from 'node:path';

export interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface CommandRunner {
  run(command: string, args: string[]): CommandResult;
}

export const systemRunner: CommandRunner = {
  run(command, args) {
    const result = spawnSync(command, args, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15_000,
    });
    return {
      status: result.status,
      stdout: result.stdout ?? '',
      stderr: result.stderr || (result.error ? result.error.message : ''),
    };
  },
};

export const UNINSTALL_KEY =
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\FoundryMCPServer';

/** The value of `name` in the output of `reg query`, or null. */
export function parseRegValue(output: string, name: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s+(\S+)\s+REG_\w+\s+(.*)$/.exec(line);
    if (match && match[1] === name) return (match[2] ?? '').trim();
  }
  return null;
}

/** The folder the registered uninstaller sits in, or null without an entry. */
export function registeredInstallFolder(runner: CommandRunner): string | null {
  const result = runner.run('reg', ['query', UNINSTALL_KEY, '/v', 'UninstallString']);
  if (result.status !== 0) return null;
  const value = parseRegValue(result.stdout, 'UninstallString');
  if (!value) return null;
  const path = value.replace(/^"([^"]*)".*$/, '$1');
  return /^(uninstall\.exe|uninstall\.cmd)$/i.test(win32.basename(path))
    ? win32.dirname(path)
    : null;
}

export interface UninstallEntry {
  version: string;
  installFolder: string;
  uninstallScript: string;
}

function problemOf(result: CommandResult, what: string): string | null {
  if (result.status === 0) return null;
  return `${what} failed: ${(result.stderr || result.stdout).trim() || `exit ${result.status}`}`;
}

/** Write the entry. Returns a problem text, or null when it worked. */
export function registerUninstaller(runner: CommandRunner, entry: UninstallEntry): string | null {
  const values: Array<[string, 'REG_SZ' | 'REG_DWORD', string]> = [
    // The name users see today stays, so the entry does not look like a second program.
    ['DisplayName', 'REG_SZ', 'Foundry MCP Server'],
    ['DisplayVersion', 'REG_SZ', entry.version],
    ['Publisher', 'REG_SZ', "Ninjo's Foundry MCP"],
    ['InstallLocation', 'REG_SZ', entry.installFolder],
    ['UninstallString', 'REG_SZ', `"${entry.uninstallScript}"`],
    ['NoModify', 'REG_DWORD', '1'],
    ['NoRepair', 'REG_DWORD', '1'],
  ];
  for (const [name, type, data] of values) {
    const problem = problemOf(
      runner.run('reg', ['add', UNINSTALL_KEY, '/v', name, '/t', type, '/d', data, '/f']),
      `Registering ${name}`
    );
    if (problem) return problem;
  }
  // The previous installer pointed the icon at its own icon.ico, which is gone now.
  runner.run('reg', ['delete', UNINSTALL_KEY, '/v', 'DisplayIcon', '/f']);
  return null;
}

export function removeUninstaller(runner: CommandRunner): string | null {
  const query = runner.run('reg', ['query', UNINSTALL_KEY]);
  if (query.status !== 0) return null;
  return problemOf(runner.run('reg', ['delete', UNINSTALL_KEY, '/f']), 'Removing the Apps entry');
}
