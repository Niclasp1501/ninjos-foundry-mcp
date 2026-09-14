#!/usr/bin/env node
/**
 * Command line of the setup, started by setup.cmd / setup.command in the bundle.
 *
 *   install [--source <folder>] [--wait <seconds>] [--no-registry]
 *   uninstall [--wait <seconds>]
 *   status
 *   print-config
 *
 * People read this output after a double click, so it follows the language of
 * the system (German or English) and says what to do next.
 */
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readConfig } from '../config.js';
import { systemProcessProbe } from '../lock.js';
import { installLayout, SERVER_KEY } from './layout.js';
import { systemRunner } from './registry.js';
import {
  desiredEntry,
  install,
  SetupError,
  status,
  uninstall,
  type ClientOutcome,
  type SetupEvent,
  type SetupHost,
} from './setup.js';
import { textsFor, type Texts } from './texts.js';

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function removeLaterWindows(paths: string[], folder: string): void {
  // The uninstaller runs from node.exe and uninstall.cmd; both can go only
  // after this process ended. A short delay in a detached shell does that.
  const quoted = paths.map(path => `"${path}"`).join(' ');
  const script = `ping -n 4 127.0.0.1 >nul & del /f /q ${quoted} & rmdir "${folder}"`;
  const child = spawn('cmd.exe', ['/d', '/c', script], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    windowsVerbatimArguments: true,
  });
  child.unref();
}

function createHost(t: Texts): SetupHost {
  const { config } = readConfig();
  return {
    platform: process.platform,
    env: process.env,
    home: homedir(),
    probe: systemProcessProbe,
    runner: systemRunner,
    lockFile: config.lockFile,
    now: () => new Date(),
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    log: (event: SetupEvent) => console.log(t.event(event)),
    removeLater: removeLaterWindows,
  };
}

function printClients(t: Texts, clients: ClientOutcome[]): boolean {
  let fine = true;
  if (clients.length === 0) console.log(t.noClients);
  for (const outcome of clients) {
    console.log(t.client(outcome));
    if (outcome.status === 'unreadable' || outcome.status === 'failed') fine = false;
  }
  return fine;
}

async function main(): Promise<number> {
  const [command = 'status', ...args] = process.argv.slice(2);
  const t = textsFor(process.env);
  const host = createHost(t);
  const waitSeconds = Number(option(args, '--wait'));
  const waitMs = Number.isFinite(waitSeconds) && waitSeconds >= 0 ? waitSeconds * 1000 : undefined;

  switch (command) {
    case 'install': {
      // cli.js sits in <bundle>/app/build/server/install/.
      const bundle = fileURLToPath(new URL('../../../../', import.meta.url));
      const report = await install(host, {
        source: option(args, '--source') ?? bundle,
        ...(waitMs !== undefined ? { waitMs } : {}),
        registry: !args.includes('--no-registry'),
      });
      console.log(t.installed(report.version, report.layout.root));
      if (report.legacyFolders.length > 0) console.log(t.tookOver(report.legacyFolders));
      if (report.backendStillRunning) console.log(t.restartNeeded);
      if (report.registryProblem) console.log(t.registryProblem(report.registryProblem));
      const fine = printClients(t, report.clients);
      if (report.clients.some(c => c.addSkipped)) console.log(t.lookAlikeHint);
      if (report.claudeCodeWithoutEntry) console.log(t.claudeCodeHint(desiredEntry(report.layout)));
      if (report.legacyMacApp) console.log(t.legacyMacApp);
      console.log(fine ? t.nextSteps : t.checkProblems);
      return fine ? 0 : 1;
    }
    case 'uninstall': {
      const report = await uninstall(host, waitMs !== undefined ? { waitMs } : {});
      const fine = printClients(t, report.clients);
      if (report.registryProblem) console.log(t.registryProblem(report.registryProblem));
      console.log(t.uninstalled(report.layout.root, report.kept));
      if (report.legacyMacApp) console.log(t.legacyMacApp);
      return fine ? 0 : 1;
    }
    case 'status': {
      const report = status(host);
      console.log(JSON.stringify(report, null, 2));
      return 0;
    }
    case 'print-config': {
      const layout = installLayout(host);
      console.log(
        JSON.stringify(
          { mcpServers: { [SERVER_KEY]: { ...desiredEntry(layout), env: {} } } },
          null,
          2
        )
      );
      console.log(t.claudeCodeHint(desiredEntry(layout)));
      return 0;
    }
    default:
      console.log(t.usage);
      return 2;
  }
}

main().then(
  code => process.exit(code),
  error => {
    const t = textsFor(process.env);
    console.error(error instanceof SetupError ? error.message : t.crashed(error));
    process.exit(1);
  }
);
