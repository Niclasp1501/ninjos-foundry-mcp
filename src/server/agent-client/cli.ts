#!/usr/bin/env node
/**
 * Command line of the agent client. The bundle starts it as `agent-client`
 * (agent-client.cmd on Windows); see docs/AGENT-CLIENT.md.
 *
 * For the person:   users, add, password, remove, list
 * For both:         start, stop, status, js, screenshot, reload, log
 * Internal:         run (the background process `start` launches)
 *
 * Output is English like the rest of the server's technical output. The
 * password is only ever read by `password`, from a terminal, hidden.
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { askClient, NotRunningError, readControlInfo, type ClientStatus } from './control.js';
import { askHidden } from './hidden-input.js';
import {
  listProfiles,
  normalizeUrl,
  parseProfile,
  profileDir,
  ProfileError,
  readProfile,
  removeProfileDir,
  writeProfile,
  type Profile,
} from './profile.js';
import { AgentClientRunner } from './runner.js';
import { secretStoreFor, SecretStoreError } from './secret-store.js';

class UsageError extends Error {}

const USAGE = `Agent client of Ninjo's Foundry MCP: keeps a Foundry user logged in for an AI agent.

Set up (a person does this):
  agent-client users --url <foundry address>          list the users and their ids
  agent-client add <name> --url <address> --user-id <id> [--user <user name>]
                   [--canvas world|on|off] [--bridge fallback|on|off]
                   [--browser auto|chrome|msedge] [--size 1600x900] [--replace]
  agent-client password <name>                         set or change the password (hidden input)
  agent-client password <name> --remove                remove the stored password
  agent-client remove <name>                           delete the profile, its password and browser data
  agent-client list

Use (people and agents):
  agent-client start <name> [--visible]                start in the background
  agent-client stop <name>                             stop; the user is free to log in elsewhere
  agent-client status [<name>] [--json]
  agent-client js <name> <code>                        run JavaScript in the page ("-" reads stdin)
  agent-client screenshot <name> <file.png>
  agent-client reload <name>
  agent-client log <name>

Guide: docs/AGENT-CLIENT.md`;

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) throw new UsageError(`${name} needs a value`);
  return value;
}

function needName(name: string | undefined): string {
  if (!name || name.startsWith('-'))
    throw new UsageError('Name the agent client, for example: agent-client status ai');
  return name;
}

function storeOf(profile: Profile) {
  return secretStoreFor(process.platform, { name: profile.name, dir: profileDir(profile.name) });
}

function describe(status: ClientStatus): string {
  const parts: string[] = [];
  if (status.loggedInAs) parts.push(`as ${status.loggedInAs}`);
  if (status.role !== undefined) parts.push(`role ${status.role}`);
  if (status.world) parts.push(`world ${status.world}`);
  if (status.socketConnected === false) parts.push('connection to Foundry lost');
  if (status.canvas !== undefined) parts.push(status.canvas ? 'canvas on' : 'canvas off');
  if (status.bridge)
    parts.push(
      `bridge ${status.bridge.state}${status.bridge.role ? ` (${status.bridge.role})` : ''}`
    );
  if (status.softwareRendering) parts.push('NO graphics card in use');
  parts.push(status.visible ? 'visible' : 'without a window');
  let text = `${status.name.padEnd(12)} ${status.state.padEnd(18)} ${parts.join(', ')}`;
  if (status.message) text += `\n             ${status.message}`;
  if (status.state !== 'ready') text += `\n             ${status.hint}`;
  return text;
}

async function statusOf(name: string): Promise<ClientStatus | null> {
  try {
    const answer = await askClient(profileDir(name), { command: 'status' }, 10_000);
    return answer.ok && answer.status ? answer.status : null;
  } catch (error) {
    if (error instanceof NotRunningError) return null;
    throw error;
  }
}

/** Users of a world as the login screen shows them, from a short-lived browser without a profile. */
async function listUsers(
  url: string
): Promise<Array<{ id: string; name: string; role: number; active: boolean }>> {
  let browser;
  for (const channel of ['chrome', 'msedge'] as const) {
    try {
      browser = await chromium.launch({ channel, headless: true });
      break;
    } catch {
      // Try the next installed browser.
    }
  }
  if (!browser) throw new Error('Neither Google Chrome nor Microsoft Edge could be started.');
  try {
    const page = await browser.newPage();
    await page.goto(`${url}/join`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForFunction(() => ((globalThis as any).game?.users?.size ?? 0) > 0, null, {
      timeout: 60_000,
    });
    return await page.evaluate(() =>
      [...(globalThis as any).game.users].map((user: any) => ({
        id: String(user.id),
        name: String(user.name),
        role: Number(user.role),
        active: user.active === true,
      }))
    );
  } finally {
    await browser.close();
  }
}

const ROLE_NAMES = ['none', 'player', 'trusted player', 'assistant GM', 'gamemaster'];

async function main(): Promise<number> {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      console.log(USAGE);
      return command === undefined ? 2 : 0;

    case 'users': {
      const url = normalizeUrl(option(args, '--url') ?? '');
      for (const user of await listUsers(url)) {
        console.log(
          `${user.id}  ${user.name}  (${ROLE_NAMES[user.role] ?? user.role}${user.active ? ', logged in now' : ''})`
        );
      }
      return 0;
    }

    case 'add': {
      const name = needName(args[0]);
      const url = normalizeUrl(option(args, '--url') ?? '');
      let userId = option(args, '--user-id');
      const userName = option(args, '--user');
      if (!userId && userName) {
        const match = (await listUsers(url)).filter(user => user.name === userName);
        if (match.length !== 1)
          throw new UsageError(
            match.length
              ? `Several users are called "${userName}"; use --user-id`
              : `No user "${userName}" on ${url}`
          );
        userId = match[0]!.id;
      }
      if (!userId)
        throw new UsageError('Give --user-id <id> (see agent-client users) or --user <user name>');
      if (listProfiles().includes(name) && !args.includes('--replace'))
        throw new UsageError(`"${name}" exists already. Add --replace to overwrite its settings.`);
      const raw: Record<string, unknown> = { url, userId };
      for (const field of ['canvas', 'bridge', 'browser'] as const) {
        const value = option(args, `--${field}`);
        if (value !== undefined) raw[field] = value;
      }
      const size = option(args, '--size');
      if (size) {
        const match = /^(\d+)x(\d+)$/.exec(size);
        if (!match) throw new UsageError('--size looks like 1600x900');
        raw['width'] = Number(match[1]);
        raw['height'] = Number(match[2]);
      }
      const profile = parseProfile(name, raw);
      const file = writeProfile(profile);
      console.log(`Saved ${file}`);
      console.log(
        `Next: agent-client password ${name}    (you type the password; nobody else needs to see it)`
      );
      return 0;
    }

    case 'list': {
      const names = listProfiles();
      if (!names.length)
        console.log('No agent clients yet. Start with: agent-client users --url <address>');
      for (const name of names) {
        const profile = readProfile(name);
        const running = readControlInfo(profileDir(name)) ? 'running' : 'stopped';
        console.log(
          `${name.padEnd(12)} ${profile.url}  user ${profile.userId}  canvas ${profile.canvas}  bridge ${profile.bridge}  ${running}`
        );
      }
      return 0;
    }

    case 'password': {
      const name = needName(args[0]);
      const profile = readProfile(name);
      const store = storeOf(profile);
      if (args.includes('--remove')) {
        const removed = await store.remove();
        console.log(
          removed
            ? `Password of "${name}" removed (${store.kind}).`
            : `"${name}" had no stored password.`
        );
        return 0;
      }
      if (store.asksItself) {
        console.log(`The ${store.kind} asks for the password of "${name}" now.`);
        await store.write();
      } else {
        const first = await askHidden(`Password of the Foundry user for "${name}": `);
        if (!first) throw new UsageError('An empty password is not stored.');
        const second = await askHidden('Again, to be sure: ');
        if (first !== second) throw new UsageError('The two entries differ. Nothing was stored.');
        await store.write(first);
      }
      console.log(`Stored in the ${store.kind}. A running client uses it at its next login.`);
      return 0;
    }

    case 'remove': {
      const name = needName(args[0]);
      const profile = readProfile(name);
      if (readControlInfo(profileDir(name))) {
        await askClient(profileDir(name), { command: 'stop' }, 15_000).catch(() => undefined);
      }
      await storeOf(profile).remove();
      removeProfileDir(name);
      console.log(`"${name}" removed: profile, password and browser data.`);
      return 0;
    }

    case 'start': {
      const name = needName(args[0]);
      readProfile(name);
      const already = await statusOf(name);
      if (already) {
        console.log(describe(already));
        return 0;
      }
      const cli = fileURLToPath(import.meta.url);
      const child = spawn(
        process.execPath,
        [cli, 'run', name, ...(args.includes('--visible') ? ['--visible'] : [])],
        { detached: true, stdio: 'ignore', windowsHide: true }
      );
      child.unref();
      for (let waited = 0; waited < 20_000; waited += 500) {
        await new Promise(resolve => setTimeout(resolve, 500));
        const status = await statusOf(name);
        if (status) {
          console.log(describe(status));
          return 0;
        }
      }
      console.log(`Started, but it does not answer yet. Look with: agent-client log ${name}`);
      return 1;
    }

    case 'run': {
      const name = needName(args[0]);
      const profile = readProfile(name);
      const runner = new AgentClientRunner({
        profile,
        dir: profileDir(name),
        visible: args.includes('--visible'),
        store: storeOf(profile),
      });
      await runner.run();
      return -1; // keeps running
    }

    case 'stop': {
      const name = needName(args[0]);
      try {
        await askClient(profileDir(name), { command: 'stop' }, 15_000);
        console.log(`"${name}" stops. The user is free to log in elsewhere.`);
      } catch (error) {
        if (!(error instanceof NotRunningError)) throw error;
        console.log(`"${name}" was not running.`);
      }
      return 0;
    }

    case 'status': {
      const json = args.includes('--json');
      const names = args[0] && !args[0].startsWith('-') ? [args[0]] : listProfiles();
      const all: Array<ClientStatus | { name: string; state: 'stopped' }> = [];
      for (const name of names) {
        readProfile(name);
        all.push((await statusOf(name)) ?? { name, state: 'stopped' });
      }
      if (json)
        console.log(JSON.stringify(args[0] && !args[0].startsWith('-') ? all[0] : all, null, 2));
      else if (!all.length) console.log('No agent clients yet.');
      else
        for (const status of all)
          console.log('hint' in status ? describe(status) : `${status.name.padEnd(12)} stopped`);
      return 0;
    }

    case 'js': {
      const name = needName(args[0]);
      const source = args.slice(1).join(' ');
      const code = source === '-' || source === '' ? readFileSync(0, 'utf8') : source;
      const answer = await askClient(profileDir(name), { command: 'js', code });
      if (!answer.ok) throw new Error(answer.error);
      console.log(JSON.stringify(answer.result ?? null, null, 2));
      return 0;
    }

    case 'screenshot': {
      const name = needName(args[0]);
      const file = args[1];
      if (!file) throw new UsageError('Name the file: agent-client screenshot <name> <file.png>');
      const answer = await askClient(profileDir(name), { command: 'screenshot' });
      if (!answer.ok || !answer.png) throw new Error(answer.ok ? 'No picture' : answer.error);
      const png = Buffer.from(answer.png, 'base64');
      writeFileSync(file, png);
      console.log(`${file} (${Math.round(png.length / 1024)} KB)`);
      return 0;
    }

    case 'reload': {
      const name = needName(args[0]);
      const answer = await askClient(profileDir(name), { command: 'reload' }, 300_000);
      if (!answer.ok) throw new Error(answer.error);
      if (answer.status) console.log(describe(answer.status));
      return 0;
    }

    case 'log': {
      const name = needName(args[0]);
      try {
        const answer = await askClient(profileDir(name), { command: 'log' }, 10_000);
        if (answer.ok) console.log((answer.lines ?? []).join('\n'));
      } catch (error) {
        if (!(error instanceof NotRunningError)) throw error;
        // Not running: the file keeps what the last run did.
        try {
          console.log(
            readFileSync(`${profileDir(name)}/client.log`, 'utf8')
              .split('\n')
              .slice(-300)
              .join('\n')
          );
        } catch {
          console.log(`"${name}" has no log yet.`);
        }
      }
      return 0;
    }

    default:
      throw new UsageError(`Unknown command "${command}"\n\n${USAGE}`);
  }
}

// No process.exit() after output: it ends at once and cuts a pipe after 64 KB.
main().then(
  code => {
    if (code >= 0) process.exitCode = code;
  },
  error => {
    const known =
      error instanceof UsageError ||
      error instanceof ProfileError ||
      error instanceof SecretStoreError ||
      error instanceof NotRunningError;
    process.stderr.write(
      `${known ? '' : 'Error: '}${error instanceof Error ? error.message : String(error)}\n`
    );
    if (error instanceof NotRunningError)
      process.stderr.write('Start it with: agent-client start <name>\n');
    process.exitCode = 1;
  }
);
