/**
 * Install, update, uninstall and status of the PC server.
 *
 * Installing and updating are the same step: copy the bundle to the install
 * folder, take over what the previous installer left, point every client entry
 * of ours at the new server. Everything that touches the system (registry,
 * processes, the removal of files still in use) goes through the host, so the
 * tests run the whole flow in a temporary folder.
 */
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs';
import type { ProcessProbe } from '../lock.js';
import { runningBackend, waitForBackendEnd } from './backend-wait.js';
import {
  describeEntries,
  mergeServerEntry,
  removeServerEntries,
  serverMatcher,
  type DesiredEntry,
} from './client-config.js';
import { readJsonFile, updateJsonFile, type FileOutcome } from './config-file.js';
import {
  appPaths,
  bundleNames,
  clientTargets,
  installLayout,
  pathApi,
  systemFileProbe,
  type ClientId,
  type HostPaths,
  type InstallLayout,
} from './layout.js';
import {
  backendShim,
  LEGACY_MAC_APP,
  LEGACY_WINDOWS_MARKERS,
  LEGACY_WINDOWS_PROGRAM,
  legacyEntryDir,
  legacyStartMenu,
  wrapperShim,
} from './legacy.js';
import {
  registeredInstallFolder,
  registerUninstaller,
  removeUninstaller,
  type CommandRunner,
} from './registry.js';

export class SetupError extends Error {}

export interface SetupHost extends HostPaths {
  probe: ProcessProbe;
  runner: CommandRunner;
  lockFile: string;
  now(): Date;
  sleep(ms: number): Promise<void>;
  log(event: SetupEvent): void;
  /** Remove paths the running uninstaller still holds, once it has ended. */
  removeLater(paths: string[], thenFolderIfEmpty: string): void;
}

export type SetupEvent =
  | { kind: 'waiting-for-backend'; pid: number; seconds: number }
  | { kind: 'backend-still-running'; pid: number };

export interface ClientOutcome extends FileOutcome {
  client: ClientId;
}

export interface InstallReport {
  layout: InstallLayout;
  version: string;
  copied: boolean;
  backendStillRunning: boolean;
  legacyFolders: string[];
  legacyRemoved: string[];
  shims: string[];
  registryProblem: string | null;
  clients: ClientOutcome[];
  /** The previous macOS program folder, which needs admin rights to remove. */
  legacyMacApp: boolean;
  /** Claude Code is installed but names no server of ours. */
  claudeCodeWithoutEntry: boolean;
}

export interface InstallOptions {
  /** Folder of the unpacked bundle: runtime, app, scripts. */
  source: string;
  waitMs?: number;
  /** false leaves "Apps" in Windows alone, for a portable use. */
  registry?: boolean;
}

const DEFAULT_WAIT_MS = 90_000;

function stampOf(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\..*$/, '');
}

export function readBundleVersion(app: string, platform: NodeJS.Platform): string {
  try {
    const data = JSON.parse(readFileSync(pathApi(platform).join(app, 'package.json'), 'utf8')) as {
      version?: unknown;
    };
    return typeof data.version === 'string' && data.version ? data.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Folders of earlier installations: the default one and a registered custom one. */
export function legacyFolders(host: SetupHost, layout: InstallLayout): string[] {
  if (host.platform !== 'win32') return [];
  const p = pathApi(host.platform);
  const candidates = [layout.root];
  const registered = registeredInstallFolder(host.runner);
  if (registered && p.resolve(registered).toLowerCase() !== p.resolve(layout.root).toLowerCase()) {
    candidates.push(registered);
  }
  return candidates.filter(folder =>
    LEGACY_WINDOWS_MARKERS.some(marker => existsSync(p.join(folder, marker)))
  );
}

function matcherFor(host: SetupHost, layout: InstallLayout, folders: string[], claimKey: boolean) {
  const p = pathApi(host.platform);
  const wrappers = [
    layout.wrapper,
    ...folders.map(folder => appPaths(host.platform, folder).wrapper),
  ];
  for (const folder of folders) wrappers.push(p.join(legacyEntryDir(p, folder), 'index.cjs'));
  return serverMatcher({ wrappers, claimKey });
}

/**
 * Put a new file or folder in place of an old one. When the old one cannot be
 * deleted (a running backend holds node.exe on Windows), it is renamed aside,
 * which Windows allows for a running program, and removed on a later run.
 */
function replacePath(from: string, to: string, stamp: string): void {
  const incoming = `${to}.new`;
  rmSync(incoming, { recursive: true, force: true });
  cpSync(from, incoming, { recursive: true });
  if (existsSync(to)) {
    try {
      rmSync(to, { recursive: true });
    } catch {
      renameSync(to, `${to}.old-${stamp}`);
    }
  }
  renameSync(incoming, to);
}

function removeAsideLeftovers(host: SetupHost, root: string): void {
  const p = pathApi(host.platform);
  const names = new Set(['app', bundleNames(host.platform).node]);
  for (const name of safeList(root)) {
    const match = /^(.+)\.old-\d{8}T\d{6}$/.exec(name);
    if (!match || !names.has(match[1] ?? '')) continue;
    try {
      rmSync(p.join(root, name), { recursive: true, force: true });
    } catch {
      // Still in use by a backend that has not ended yet. Next run.
    }
  }
}

function safeList(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function copyBundle(host: SetupHost, source: string, layout: InstallLayout): void {
  const p = pathApi(host.platform);
  const names = bundleNames(host.platform);
  const from = appPaths(host.platform, source);
  if (!existsSync(from.node) || !existsSync(from.wrapper) || !existsSync(from.backend)) {
    throw new SetupError(
      `The folder ${source} is not a complete bundle: ${names.node} or app/build/server is missing.`
    );
  }
  const stamp = stampOf(host.now());
  mkdirSync(layout.root, { recursive: true });
  removeAsideLeftovers(host, layout.root);
  replacePath(from.app, layout.app, stamp);
  replacePath(from.node, layout.node, stamp);
  for (const [name, target] of [
    [names.setup, layout.setupScript],
    [names.uninstall, layout.uninstallScript],
    [names.readme, layout.readme],
  ] as const) {
    const file = p.join(source, name);
    if (existsSync(file)) copyFileSync(file, target);
  }
  if (host.platform !== 'win32') {
    for (const file of [layout.node, layout.setupScript, layout.uninstallScript]) {
      if (existsSync(file)) chmodSync(file, 0o755);
    }
  }
}

/** Remove the program of the previous Windows installer and keep its entry paths working. */
function takeOverLegacyFolder(
  host: SetupHost,
  folder: string,
  layout: InstallLayout,
  report: InstallReport
): void {
  const p = pathApi(host.platform);
  const oldNode = p.join(folder, 'node.exe');
  const customFolder = p.resolve(folder).toLowerCase() !== p.resolve(layout.root).toLowerCase();

  for (const name of LEGACY_WINDOWS_PROGRAM) {
    const path = p.join(folder, name);
    if (!existsSync(path)) continue;
    rmSync(path, { recursive: true, force: true });
    report.legacyRemoved.push(path);
  }

  // A configuration this setup cannot reach still starts <folder>\node.exe
  // with the old entry path. In a custom folder that node.exe is the old
  // runtime, which cannot run this server, so it is replaced as well.
  if (customFolder && existsSync(oldNode)) {
    replacePath(layout.node, oldNode, stampOf(host.now()));
  }

  const dist = legacyEntryDir(p, folder);
  mkdirSync(dist, { recursive: true });
  const entry = p.join(dist, 'index.cjs');
  writeFileSync(entry, wrapperShim(layout.wrapper, host.platform), 'utf8');
  writeFileSync(
    p.join(dist, 'backend.bundle.cjs'),
    backendShim(layout.backend, host.platform),
    'utf8'
  );
  report.shims.push(entry);
}

function removeLegacyStartMenu(host: SetupHost): void {
  if (host.platform !== 'win32') return;
  const p = pathApi(host.platform);
  const roaming = host.env['APPDATA']?.trim() || p.join(host.home, 'AppData', 'Roaming');
  const folder = legacyStartMenu(p, roaming);
  rmSync(p.join(folder, 'Uninstall.lnk'), { force: true });
  try {
    rmdirSync(folder);
  } catch {
    // Not empty (the ComfyUI link stays) or not there.
  }
}

async function waitForBackend(host: SetupHost, waitMs: number): Promise<boolean> {
  const result = await waitForBackendEnd({
    lockFile: host.lockFile,
    probe: host.probe,
    timeoutMs: waitMs,
    sleep: ms => host.sleep(ms),
    onWaiting: pid =>
      host.log({ kind: 'waiting-for-backend', pid, seconds: Math.round(waitMs / 1000) }),
  });
  if (!result.ended && result.pid !== null) {
    host.log({ kind: 'backend-still-running', pid: result.pid });
  }
  return !result.ended;
}

export function desiredEntry(layout: InstallLayout): DesiredEntry {
  return { command: layout.node, args: [layout.wrapper] };
}

export async function install(host: SetupHost, options: InstallOptions): Promise<InstallReport> {
  const p = pathApi(host.platform);
  const layout = installLayout(host);
  const source = p.resolve(options.source);
  const copied = p.resolve(layout.root).toLowerCase() !== source.toLowerCase();
  const folders = legacyFolders(host, layout);

  const report: InstallReport = {
    layout,
    version: readBundleVersion(copied ? p.join(source, 'app') : layout.app, host.platform),
    copied,
    backendStillRunning: false,
    legacyFolders: folders,
    legacyRemoved: [],
    shims: [],
    registryProblem: null,
    clients: [],
    legacyMacApp: host.platform === 'darwin' && systemFileProbe.isDirectory(LEGACY_MAC_APP),
    claudeCodeWithoutEntry: false,
  };

  if (copied || folders.length > 0) {
    report.backendStillRunning = await waitForBackend(host, options.waitMs ?? DEFAULT_WAIT_MS);
  }
  if (copied) copyBundle(host, source, layout);
  if (!existsSync(layout.wrapper)) {
    throw new SetupError(
      `No server found in ${layout.app}. Run the setup from the unpacked bundle.`
    );
  }
  for (const folder of folders) takeOverLegacyFolder(host, folder, layout, report);
  removeLegacyStartMenu(host);

  if (host.platform === 'win32' && options.registry !== false) {
    report.registryProblem = registerUninstaller(host.runner, {
      version: report.version,
      installFolder: layout.root,
      uninstallScript: layout.uninstallScript,
    });
  }

  const matcher = matcherFor(host, layout, folders, true);
  const desired = desiredEntry(layout);
  for (const target of clientTargets(host)) {
    const result = updateJsonFile(
      target.file,
      value => mergeServerEntry(value, desired, matcher, { add: target.add }),
      { create: target.create, now: () => host.now() }
    );
    report.clients.push({ client: target.client, ...result });
    if (
      target.client === 'claude-code' &&
      result.status !== 'unreadable' &&
      result.status !== 'failed' &&
      result.changes.length === 0
    ) {
      report.claudeCodeWithoutEntry = true;
    }
  }
  return report;
}

export interface UninstallReport {
  layout: InstallLayout;
  backendStillRunning: boolean;
  clients: ClientOutcome[];
  removed: string[];
  removedLater: string[];
  kept: string[];
  registryProblem: string | null;
  legacyMacApp: boolean;
}

export async function uninstall(
  host: SetupHost,
  options: { waitMs?: number } = {}
): Promise<UninstallReport> {
  const p = pathApi(host.platform);
  const layout = installLayout(host);
  const folders = [layout.root, ...legacyFolders(host, layout).filter(f => f !== layout.root)];
  const report: UninstallReport = {
    layout,
    backendStillRunning: await waitForBackend(host, options.waitMs ?? DEFAULT_WAIT_MS),
    clients: [],
    removed: [],
    removedLater: [],
    kept: [],
    registryProblem: null,
    legacyMacApp: host.platform === 'darwin' && systemFileProbe.isDirectory(LEGACY_MAC_APP),
  };

  // Only entries that start this installation. A `foundry-mcp` entry pointing
  // at a repository build belongs to the person who wrote it.
  const matcher = matcherFor(host, layout, folders, false);
  for (const target of clientTargets(host)) {
    const result = updateJsonFile(target.file, value => removeServerEntries(value, matcher), {
      create: false,
      now: () => host.now(),
    });
    report.clients.push({ client: target.client, ...result });
  }

  if (host.platform === 'win32') report.registryProblem = removeUninstaller(host.runner);
  removeLegacyStartMenu(host);

  const now = [
    layout.app,
    p.join(layout.root, 'foundry-mcp-server'),
    layout.setupScript,
    layout.readme,
  ];
  for (const path of now) {
    if (!existsSync(path)) continue;
    rmSync(path, { recursive: true, force: true });
    report.removed.push(path);
  }
  removeAsideLeftovers(host, layout.root);

  const inUse = [layout.node, layout.uninstallScript].filter(path => existsSync(path));
  if (host.platform === 'win32') {
    if (inUse.length > 0) host.removeLater(inUse, layout.root);
    report.removedLater.push(...inUse);
  } else {
    for (const path of inUse) rmSync(path, { force: true });
    report.removed.push(...inUse);
  }

  const inUseNames = new Set(inUse.map(path => p.basename(path)));
  report.kept = safeList(layout.root)
    .filter(name => !inUseNames.has(name))
    .map(name => p.join(layout.root, name));
  if (report.kept.length === 0 && host.platform !== 'win32') {
    try {
      rmdirSync(layout.root);
    } catch {
      // Something appeared meanwhile; it stays.
    }
  }
  return report;
}

export interface StatusReport {
  layout: InstallLayout;
  installed: boolean;
  version: string | null;
  backendPid: number | null;
  legacyFolders: string[];
  legacyMacApp: boolean;
  clients: Array<{
    client: ClientId;
    file: string;
    exists: boolean;
    problem?: string;
    entries: Array<{ key: string; paths: string[] }>;
    lookAlikes: string[];
  }>;
}

/** What is installed and configured, without changing anything. */
export function status(host: SetupHost): StatusReport {
  const layout = installLayout(host);
  const installed = existsSync(layout.node) && existsSync(layout.wrapper);
  const folders = legacyFolders(host, layout);
  const matcher = matcherFor(host, layout, folders, true);
  return {
    layout,
    installed,
    version: installed ? readBundleVersion(layout.app, host.platform) : null,
    backendPid: runningBackend(host.lockFile, host.probe),
    legacyFolders: folders,
    legacyMacApp: host.platform === 'darwin' && systemFileProbe.isDirectory(LEGACY_MAC_APP),
    clients: clientTargets(host).map(target => {
      const read = readJsonFile(target.file);
      if (read === null) {
        return {
          client: target.client,
          file: target.file,
          exists: false,
          entries: [],
          lookAlikes: [],
        };
      }
      if ('problem' in read) {
        return {
          client: target.client,
          file: target.file,
          exists: true,
          problem: read.problem,
          entries: [],
          lookAlikes: [],
        };
      }
      try {
        const found = describeEntries(read.value, matcher);
        return {
          client: target.client,
          file: target.file,
          exists: true,
          entries: found.owned,
          lookAlikes: found.lookAlikes,
        };
      } catch (error) {
        return {
          client: target.client,
          file: target.file,
          exists: true,
          problem: error instanceof Error ? error.message : String(error),
          entries: [],
          lookAlikes: [],
        };
      }
    }),
  };
}
