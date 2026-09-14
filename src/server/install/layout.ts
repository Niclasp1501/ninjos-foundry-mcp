/**
 * Where the server is installed, and which client configurations can name it.
 *
 * The folder on Windows is the one the previous installer used. Its `node.exe`
 * is the `command` of every Claude entry that installer wrote, so a setup that
 * installs there keeps those entries runnable even where it cannot rewrite them.
 */
import { readdirSync, statSync } from 'node:fs';
import { posix, win32, type PlatformPath } from 'node:path';

/** The key under `mcpServers` every previous installer and guide used. */
export const SERVER_KEY = 'foundry-mcp';

export const INSTALL_FOLDER = 'FoundryMCPServer';

export interface HostPaths {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  home: string;
}

export interface FileProbe {
  exists(path: string): boolean;
  isDirectory(path: string): boolean;
  /** Names in a folder, empty when it cannot be read. */
  list(dir: string): string[];
}

export const systemFileProbe: FileProbe = {
  exists(path) {
    try {
      statSync(path);
      return true;
    } catch {
      return false;
    }
  },
  isDirectory(path) {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  },
  list(dir) {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  },
};

export function pathApi(platform: NodeJS.Platform): PlatformPath {
  return platform === 'win32' ? win32 : posix;
}

export interface InstallLayout {
  root: string;
  node: string;
  app: string;
  wrapper: string;
  backend: string;
  cli: string;
  setupScript: string;
  uninstallScript: string;
  readme: string;
}

/** The names inside a bundle and inside an installation are the same. */
export function bundleNames(platform: NodeJS.Platform): {
  node: string;
  setup: string;
  uninstall: string;
  readme: string;
} {
  return platform === 'win32'
    ? { node: 'node.exe', setup: 'setup.cmd', uninstall: 'uninstall.cmd', readme: 'README.txt' }
    : {
        node: 'node',
        setup: 'setup.command',
        uninstall: 'uninstall.command',
        readme: 'README.txt',
      };
}

export function appPaths(
  platform: NodeJS.Platform,
  root: string
): Omit<InstallLayout, 'setupScript' | 'uninstallScript' | 'readme'> {
  const p = pathApi(platform);
  const app = p.join(root, 'app');
  const server = p.join(app, 'build', 'server');
  return {
    root,
    node: p.join(root, bundleNames(platform).node),
    app,
    wrapper: p.join(server, 'wrapper.js'),
    backend: p.join(server, 'backend-main.js'),
    cli: p.join(server, 'install', 'cli.js'),
  };
}

function localAppData(host: HostPaths): string {
  return host.env['LOCALAPPDATA']?.trim() || win32.join(host.home, 'AppData', 'Local');
}

function roamingAppData(host: HostPaths): string {
  return host.env['APPDATA']?.trim() || win32.join(host.home, 'AppData', 'Roaming');
}

export function installRoot(host: HostPaths): string {
  const p = pathApi(host.platform);
  if (host.platform === 'win32') return p.join(localAppData(host), INSTALL_FOLDER);
  if (host.platform === 'darwin')
    return p.join(host.home, 'Library', 'Application Support', INSTALL_FOLDER);
  const data = host.env['XDG_DATA_HOME']?.trim() || p.join(host.home, '.local', 'share');
  return p.join(data, INSTALL_FOLDER);
}

export function installLayout(host: HostPaths): InstallLayout {
  const root = installRoot(host);
  const p = pathApi(host.platform);
  const names = bundleNames(host.platform);
  return {
    ...appPaths(host.platform, root),
    setupScript: p.join(root, names.setup),
    uninstallScript: p.join(root, names.uninstall),
    readme: p.join(root, names.readme),
  };
}

export type ClientId = 'claude-desktop' | 'claude-desktop-store' | 'claude-code' | 'cursor';

export interface ClientTarget {
  client: ClientId;
  file: string;
  /** Create the file (and its folder) when it does not exist yet. */
  create: boolean;
  /** Add an entry when the file names no server of ours. */
  add: boolean;
}

/**
 * Configurations of clients that are present on this machine.
 *
 * Claude Desktop gets an entry, as with the previous installer. Claude Code and
 * Cursor only get an existing entry updated: adding a server to a tool that
 * never had one would be a change the user did not ask for, and people who use
 * those tools add it with one command (see the user guide).
 *
 * Unlike the previous installer, no Claude Desktop file is created for a Claude
 * that is not installed.
 */
export function clientTargets(host: HostPaths, probe: FileProbe = systemFileProbe): ClientTarget[] {
  const p = pathApi(host.platform);
  const targets: ClientTarget[] = [];
  const desktopFile = 'claude_desktop_config.json';

  if (host.platform === 'win32') {
    const roaming = p.join(roamingAppData(host), 'Claude');
    const program = p.join(localAppData(host), 'AnthropicClaude');
    if (probe.isDirectory(roaming) || probe.isDirectory(program)) {
      targets.push({
        client: 'claude-desktop',
        file: p.join(roaming, desktopFile),
        create: true,
        add: true,
      });
    }
    // Store edition (MSIX): its roaming folder lives inside the package container.
    const packages = p.join(localAppData(host), 'Packages');
    for (const name of probe.list(packages).sort()) {
      if (!/claude/i.test(name)) continue;
      const container = p.join(packages, name, 'LocalCache', 'Roaming');
      if (!probe.isDirectory(container)) continue;
      targets.push({
        client: 'claude-desktop-store',
        file: p.join(container, 'Claude', desktopFile),
        create: true,
        add: true,
      });
    }
  } else {
    const desktopDir =
      host.platform === 'darwin'
        ? p.join(host.home, 'Library', 'Application Support', 'Claude')
        : p.join(host.env['XDG_CONFIG_HOME']?.trim() || p.join(host.home, '.config'), 'Claude');
    const program = host.platform === 'darwin' ? '/Applications/Claude.app' : null;
    if (probe.isDirectory(desktopDir) || (program !== null && probe.isDirectory(program))) {
      targets.push({
        client: 'claude-desktop',
        file: p.join(desktopDir, desktopFile),
        create: true,
        add: true,
      });
    }
  }

  const claudeCode = p.join(host.home, '.claude.json');
  if (probe.exists(claudeCode)) {
    targets.push({ client: 'claude-code', file: claudeCode, create: false, add: false });
  }
  const cursor = p.join(host.home, '.cursor', 'mcp.json');
  if (probe.exists(cursor)) {
    targets.push({ client: 'cursor', file: cursor, create: false, add: false });
  }
  return targets;
}
