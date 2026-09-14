/**
 * The whole flow in a temporary folder that stands in for the user profile.
 * Nothing here reads or writes a real Claude configuration, the registry or a
 * port: the host points every location into the folder and fakes reg.exe.
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProcessProbe } from '../lock.js';
import { waitForBackendEnd } from './backend-wait.js';
import { clientTargets, type FileProbe } from './layout.js';
import {
  parseRegValue,
  registeredInstallFolder,
  UNINSTALL_KEY,
  type CommandRunner,
} from './registry.js';
import { install, status, uninstall, type SetupHost } from './setup.js';

let base: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'setup-flow-'));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

function write(path: string, content = ''): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

const noBackend: ProcessProbe = { isAlive: () => false, isNode: () => undefined };

interface FakeRegistry extends CommandRunner {
  calls: string[][];
  values: Map<string, string>;
}

function fakeRegistry(): FakeRegistry {
  const values = new Map<string, string>();
  const calls: string[][] = [];
  return {
    calls,
    values,
    run(command, args) {
      calls.push([command, ...args]);
      const [verb] = args;
      if (verb === 'add') values.set(args[3] as string, args[7] as string);
      if (verb === 'delete' && args[2] === '/f') values.clear();
      if (verb === 'delete' && args[2] === '/v') values.delete(args[3] as string);
      if (verb === 'query') {
        if (values.size === 0) return { status: 1, stdout: '', stderr: 'not found' };
        const lines = [...values].map(([name, data]) => `    ${name}    REG_SZ    ${data}`);
        return {
          status: 0,
          stdout: `\r\n${UNINSTALL_KEY}\r\n${lines.join('\r\n')}\r\n`,
          stderr: '',
        };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
  };
}

function hostFor(
  platform: NodeJS.Platform,
  registry: CommandRunner,
  removed: string[][] = []
): SetupHost {
  return {
    platform,
    home: join(base, 'home'),
    env: { LOCALAPPDATA: join(base, 'Local'), APPDATA: join(base, 'Roaming') },
    probe: noBackend,
    runner: registry,
    lockFile: join(base, 'foundry-mcp-backend.lock'),
    now: () => new Date(Date.UTC(2026, 8, 14, 12, 0, 0)),
    sleep: async () => {},
    log: () => {},
    removeLater: paths => removed.push(paths),
  };
}

/** A bundle as the build script lays it out, with a wrapper that leaves a mark. */
function makeBundle(nodeName: string): string {
  const bundle = join(base, 'bundle');
  write(join(bundle, nodeName), 'new runtime');
  write(
    join(bundle, 'app', 'package.json'),
    JSON.stringify({ name: 'x', version: '1.2.3', type: 'module' })
  );
  write(
    join(bundle, 'app', 'build', 'server', 'wrapper.js'),
    "import { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.MARK, 'wrapper');\n"
  );
  write(
    join(bundle, 'app', 'build', 'server', 'backend-main.js'),
    "import { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.MARK, 'backend');\n"
  );
  write(join(bundle, 'setup.cmd'), 'setup');
  write(join(bundle, 'uninstall.cmd'), 'uninstall');
  write(join(bundle, 'README.txt'), 'readme');
  return bundle;
}

const windowsOnly = process.platform === 'win32';

describe.runIf(windowsOnly)('install and uninstall on Windows over the previous installer', () => {
  it('takes over silently and removes cleanly', async () => {
    const root = join(base, 'Local', 'FoundryMCPServer');
    const legacyDist = join(root, 'foundry-mcp-server', 'packages', 'mcp-server', 'dist');
    write(join(root, 'node.exe'), 'old runtime');
    write(join(root, 'Uninstall.exe'), 'old uninstaller');
    write(join(root, 'node', 'node.exe'), 'second copy');
    write(join(legacyDist, 'index.cjs'), 'old wrapper');
    write(join(legacyDist, 'backend.bundle.cjs'), 'old backend');
    write(join(legacyDist, 'backend.js'), 'old backend');
    write(join(root, 'configure-claude.ps1'), 'x');
    write(join(root, 'allowed-origins.json'), '["https://dnd.example"]');
    write(join(root, 'ComfyUI', 'models', 'map.safetensors'), 'model');
    write(join(root, 'start-comfyui.bat'), 'x');
    const startMenu = join(
      base,
      'Roaming',
      'Microsoft',
      'Windows',
      'Start Menu',
      'Programs',
      'Foundry MCP Server'
    );
    write(join(startMenu, 'Uninstall.lnk'), 'x');

    const desktop = join(base, 'Roaming', 'Claude', 'claude_desktop_config.json');
    write(
      desktop,
      JSON.stringify(
        {
          mcpServers: {
            files: { command: 'npx', args: ['files'] },
            'foundry-mcp': {
              command: join(root, 'node.exe'),
              args: [join(legacyDist, 'index.cjs')],
              env: { LOG_LEVEL: 'info' },
            },
          },
          preferences: { a: 1 },
        },
        null,
        2
      )
    );
    const store = join(
      base,
      'Local',
      'Packages',
      'Claude_pzs8sxrjxfjjc',
      'LocalCache',
      'Roaming',
      'Claude',
      'claude_desktop_config.json'
    );
    write(store, '{ "mcpServers": {} }');
    const claudeCode = join(base, 'home', '.claude.json');
    write(claudeCode, JSON.stringify({ projects: {}, mcpServers: {} }));

    const registry = fakeRegistry();
    registry.values.set('UninstallString', `"${join(root, 'Uninstall.exe')}"`);
    const bundle = makeBundle('node.exe');

    const report = await install(hostFor('win32', registry), { source: bundle });

    expect(report.version).toBe('1.2.3');
    expect(report.legacyFolders).toEqual([root]);
    expect(readFileSync(join(root, 'node.exe'), 'utf8')).toBe('new runtime');
    expect(existsSync(join(root, 'app', 'build', 'server', 'wrapper.js'))).toBe(true);
    for (const gone of [
      'Uninstall.exe',
      'node',
      'configure-claude.ps1',
      join('foundry-mcp-server', 'packages', 'mcp-server', 'dist', 'backend.js'),
    ]) {
      expect(existsSync(join(root, gone)), gone).toBe(false);
    }
    for (const kept of [
      'allowed-origins.json',
      join('ComfyUI', 'models', 'map.safetensors'),
      'start-comfyui.bat',
    ]) {
      expect(existsSync(join(root, kept)), kept).toBe(true);
    }
    expect(existsSync(join(startMenu, 'Uninstall.lnk'))).toBe(false);

    // The old entry path still starts the new server, and the old backend name the new backend.
    const mark = join(base, 'mark.txt');
    execFileSync(process.execPath, [join(legacyDist, 'index.cjs')], {
      env: { ...process.env, MARK: mark },
    });
    expect(readFileSync(mark, 'utf8')).toBe('wrapper');
    execFileSync(process.execPath, [join(legacyDist, 'backend.bundle.cjs')], {
      env: { ...process.env, MARK: mark },
    });
    expect(readFileSync(mark, 'utf8')).toBe('backend');

    const entry = {
      command: join(root, 'node.exe'),
      args: [join(root, 'app', 'build', 'server', 'wrapper.js')],
    };
    const desktopConfig = JSON.parse(readFileSync(desktop, 'utf8')) as Record<string, unknown>;
    expect(desktopConfig).toEqual({
      mcpServers: {
        files: { command: 'npx', args: ['files'] },
        'foundry-mcp': { ...entry, env: { LOG_LEVEL: 'info' } },
      },
      preferences: { a: 1 },
    });
    expect(JSON.parse(readFileSync(store, 'utf8'))).toEqual({
      mcpServers: { 'foundry-mcp': { ...entry, env: {} } },
    });
    expect(JSON.parse(readFileSync(claudeCode, 'utf8'))).toEqual({ projects: {}, mcpServers: {} });
    expect(report.claudeCodeWithoutEntry).toBe(true);

    expect(registry.values.get('UninstallString')).toBe(`"${join(root, 'uninstall.cmd')}"`);
    expect(registry.values.get('DisplayVersion')).toBe('1.2.3');
    expect(registeredInstallFolder(registry)).toBe(root);

    // A second run changes no configuration and leaves no second backup.
    const again = await install(hostFor('win32', registry), { source: bundle });
    expect(again.clients.map(c => c.status)).toEqual(['unchanged', 'unchanged', 'unchanged']);
    expect(
      readdirSync(dirname(desktop)).filter(n => n.includes('.foundry-mcp-backup-'))
    ).toHaveLength(1);

    const before = status(hostFor('win32', registry));
    expect(before.installed).toBe(true);
    expect(before.clients[0]?.entries.map(e => e.key)).toEqual(['foundry-mcp']);

    const removed: string[][] = [];
    const gone = await uninstall(hostFor('win32', registry, removed));
    expect(JSON.parse(readFileSync(desktop, 'utf8'))).toEqual({
      mcpServers: { files: { command: 'npx', args: ['files'] } },
      preferences: { a: 1 },
    });
    expect(JSON.parse(readFileSync(store, 'utf8'))).toEqual({ mcpServers: {} });
    expect(registry.values.size).toBe(0);
    expect(existsSync(join(root, 'app'))).toBe(false);
    expect(existsSync(join(root, 'foundry-mcp-server'))).toBe(false);
    expect(removed).toEqual([[join(root, 'node.exe'), join(root, 'uninstall.cmd')]]);
    expect(gone.kept.map(path => path.slice(root.length + 1)).sort()).toEqual(
      ['ComfyUI', 'allowed-origins.json', 'start-comfyui.bat'].sort()
    );
  });

  it('adds to a fresh Claude Desktop and does not create files for absent clients', async () => {
    mkdirSync(join(base, 'Local', 'AnthropicClaude'), { recursive: true });
    const registry = fakeRegistry();
    const report = await install(hostFor('win32', registry), { source: makeBundle('node.exe') });
    expect(report.legacyFolders).toEqual([]);
    expect(report.clients.map(c => [c.client, c.status])).toEqual([['claude-desktop', 'created']]);
    expect(existsSync(join(base, 'home', '.claude.json'))).toBe(false);
  });
});

describe.runIf(!windowsOnly)('install and uninstall on macOS and Linux', () => {
  it('installs, configures and removes without the registry', async () => {
    const platform = process.platform;
    const host = hostFor(platform, fakeRegistry());
    const desktopDir =
      platform === 'darwin'
        ? join(base, 'home', 'Library', 'Application Support', 'Claude')
        : join(base, 'home', '.config', 'Claude');
    mkdirSync(desktopDir, { recursive: true });
    const report = await install({ ...host, env: {} }, { source: makeBundle('node') });
    expect(report.clients.map(c => c.status)).toEqual(['created']);
    const gone = await uninstall({ ...host, env: {} });
    expect(gone.kept).toEqual([]);
    expect(existsSync(report.layout.root)).toBe(false);
  });
});

describe('clientTargets', () => {
  const probe = (
    dirs: string[],
    files: string[] = [],
    lists: Record<string, string[]> = {}
  ): FileProbe => ({
    exists: path => dirs.includes(path) || files.includes(path),
    isDirectory: path => dirs.includes(path),
    list: dir => lists[dir] ?? [],
  });

  it('finds the Store edition of Claude Desktop only where its container exists', () => {
    const env = { LOCALAPPDATA: 'C:\\L', APPDATA: 'C:\\R' };
    const targets = clientTargets(
      { platform: 'win32', env, home: 'C:\\H' },
      probe(['C:\\L\\Packages\\Claude_abc\\LocalCache\\Roaming'], [], {
        'C:\\L\\Packages': ['Claude_abc', 'Claude_empty', 'Other'],
      })
    );
    expect(targets).toEqual([
      {
        client: 'claude-desktop-store',
        file: 'C:\\L\\Packages\\Claude_abc\\LocalCache\\Roaming\\Claude\\claude_desktop_config.json',
        create: true,
        add: true,
      },
    ]);
  });

  it('only updates Claude Code and Cursor, never adds', () => {
    const targets = clientTargets(
      { platform: 'darwin', env: {}, home: '/Users/gm' },
      probe(['/Applications/Claude.app'], ['/Users/gm/.claude.json', '/Users/gm/.cursor/mcp.json'])
    );
    expect(targets.map(t => [t.client, t.add])).toEqual([
      ['claude-desktop', true],
      ['claude-code', false],
      ['cursor', false],
    ]);
  });
});

describe('waitForBackendEnd', () => {
  it('waits until the backend holding the lock has ended', async () => {
    const lockFile = join(base, 'lock');
    writeFileSync(lockFile, '4242');
    let checks = 0;
    const probe: ProcessProbe = { isAlive: () => ++checks < 3, isNode: () => true };
    const seen: number[] = [];
    const result = await waitForBackendEnd({
      lockFile,
      probe,
      timeoutMs: 10_000,
      sleep: async () => {},
      onWaiting: pid => seen.push(pid),
    });
    expect(result).toEqual({ ended: true, pid: null });
    expect(seen).toEqual([4242]);
  });

  it('gives up after the timeout and names the process', async () => {
    const lockFile = join(base, 'lock');
    writeFileSync(lockFile, '4242');
    const probe: ProcessProbe = { isAlive: () => true, isNode: () => true };
    const result = await waitForBackendEnd({
      lockFile,
      probe,
      timeoutMs: 3000,
      sleep: async () => {},
    });
    expect(result).toEqual({ ended: false, pid: 4242 });
  });
});

describe('registry output', () => {
  it('reads a value from reg query', () => {
    const output = `\r\n${UNINSTALL_KEY}\r\n    DisplayName    REG_SZ    Foundry MCP Server\r\n    UninstallString    REG_SZ    "C:\\A B\\Uninstall.exe"\r\n`;
    expect(parseRegValue(output, 'UninstallString')).toBe('"C:\\A B\\Uninstall.exe"');
    expect(parseRegValue(output, 'Missing')).toBeNull();
  });
});
