/**
 * Where the password of an agent client lives: the secret store of the
 * operating system, never a plain file, a command line or an environment
 * variable.
 *
 * - Windows: DPAPI for the current Windows user, through Windows PowerShell.
 *   The encrypted bytes lie in password.dpapi in the profile folder; only the
 *   same Windows user on the same machine can decrypt them.
 * - macOS: the login keychain, through `security`.
 * - Linux: the Secret Service (GNOME Keyring, KWallet), through `secret-tool`
 *   from libsecret.
 *
 * The secret travels to and from the helper programs on standard input and
 * output only. What this does not protect against is said plainly in
 * docs/AGENT-CLIENT.md: any program running as the same operating system user
 * can ask the store for it too.
 */
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/** Runs a helper and hands it `input` on standard input. Never gets the secret as an argument. */
export type HelperRunner = (
  command: string,
  args: string[],
  options: { input?: string; env?: Record<string, string>; interactive?: boolean }
) => Promise<{ code: number; stdout: string; stderr: string }>;

export const systemHelperRunner: HelperRunner = (command, args, options) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      // An interactive helper (macOS `security` asking for the password) talks to the terminal itself.
      stdio: options.interactive ? 'inherit' : ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, ...options.env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => (stdout += chunk));
    child.stderr?.on('data', chunk => (stderr += chunk));
    child.on('error', reject);
    child.on('close', code => resolve({ code: code ?? 1, stdout, stderr }));
    if (!options.interactive) child.stdin?.end(options.input ?? '');
  });

export class SecretStoreError extends Error {}

export interface SecretStore {
  /** Name for messages, such as "Windows DPAPI". */
  readonly kind: string;
  /**
   * True when the store asks for the password itself (macOS keychain). Then
   * `write` is called without a secret and the person types it into the store.
   */
  readonly asksItself: boolean;
  has(): Promise<boolean>;
  /** The password, or null when none is stored. */
  read(): Promise<string | null>;
  write(secret?: string): Promise<void>;
  /** True when there was something to remove. */
  remove(): Promise<boolean>;
}

const SERVICE = 'ninjos-foundry-mcp-agent-client';
const ENTROPY = 'ninjos-foundry-mcp agent client';

/** A PowerShell script as -EncodedCommand: no quoting, and nothing secret in it. */
function encoded(script: string): string[] {
  return [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64'),
  ];
}

const PS_PREFIX = `$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$entropy = [Text.Encoding]::UTF8.GetBytes('${ENTROPY}')
`;

// Base64 on both pipes: PowerShell 5.1 reads and writes the console in the
// OEM code page, which would mangle every non-ASCII character of a password.
const PS_WRITE = `${PS_PREFIX}$plain = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
$sealed = [Security.Cryptography.ProtectedData]::Protect($plain, $entropy, 'CurrentUser')
[Array]::Clear($plain, 0, $plain.Length)
[IO.File]::WriteAllText($env:FMCP_SECRET_FILE, [Convert]::ToBase64String($sealed))
`;

const PS_READ = `${PS_PREFIX}$sealed = [Convert]::FromBase64String([IO.File]::ReadAllText($env:FMCP_SECRET_FILE).Trim())
$plain = [Security.Cryptography.ProtectedData]::Unprotect($sealed, $entropy, 'CurrentUser')
[Console]::Out.Write([Convert]::ToBase64String($plain))
`;

function windowsStore(dir: string, run: HelperRunner): SecretStore {
  const file = join(dir, 'password.dpapi');
  const powershell = join(
    process.env['SystemRoot'] ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  );
  const env = { FMCP_SECRET_FILE: file };
  return {
    kind: 'Windows DPAPI',
    asksItself: false,
    has: async () => existsSync(file),
    async read() {
      if (!existsSync(file)) return null;
      const result = await run(powershell, encoded(PS_READ), { env });
      if (result.code !== 0)
        throw new SecretStoreError(
          `The password could not be decrypted (${result.stderr.trim().split('\n')[0] ?? 'DPAPI'}). ` +
            'It only opens for the Windows user who set it, on this machine. Set it again.'
        );
      return Buffer.from(result.stdout.trim(), 'base64').toString('utf8');
    },
    async write(secret) {
      if (secret === undefined) throw new SecretStoreError('No password given');
      const result = await run(powershell, encoded(PS_WRITE), {
        env,
        input: Buffer.from(secret, 'utf8').toString('base64'),
      });
      if (result.code !== 0)
        throw new SecretStoreError(`The password could not be stored: ${result.stderr.trim()}`);
    },
    async remove() {
      if (!existsSync(file)) return false;
      rmSync(file, { force: true });
      return true;
    },
  };
}

function macStore(name: string, run: HelperRunner): SecretStore {
  const id = ['-s', SERVICE, '-a', name];
  return {
    kind: 'macOS keychain',
    asksItself: true,
    has: async () => (await run('security', ['find-generic-password', ...id], {})).code === 0,
    async read() {
      const result = await run('security', ['find-generic-password', ...id, '-w'], {});
      if (result.code !== 0) return null;
      return result.stdout.replace(/\r?\n$/, '');
    },
    async write() {
      // -w as the last argument without a value: security asks on the terminal, twice.
      const result = await run(
        'security',
        ['add-generic-password', ...id, '-l', `Foundry MCP agent client ${name}`, '-U', '-w'],
        { interactive: true }
      );
      if (result.code !== 0) throw new SecretStoreError('The keychain did not store the password.');
    },
    async remove() {
      return (await run('security', ['delete-generic-password', ...id], {})).code === 0;
    },
  };
}

function linuxStore(name: string, run: HelperRunner): SecretStore {
  const attributes = ['service', SERVICE, 'account', name];
  const call = async (args: string[], input?: string) => {
    try {
      return await run('secret-tool', args, input === undefined ? {} : { input });
    } catch {
      throw new SecretStoreError(
        'secret-tool was not found. Install libsecret-tools (Debian, Ubuntu) or libsecret (Fedora, Arch).'
      );
    }
  };
  return {
    kind: 'Secret Service (libsecret)',
    asksItself: false,
    has: async () => (await call(['lookup', ...attributes])).code === 0,
    async read() {
      const result = await call(['lookup', ...attributes]);
      return result.code === 0 ? result.stdout.replace(/\r?\n$/, '') : null;
    },
    async write(secret) {
      if (secret === undefined) throw new SecretStoreError('No password given');
      const result = await call(
        ['store', `--label=Foundry MCP agent client ${name}`, ...attributes],
        secret
      );
      if (result.code !== 0)
        throw new SecretStoreError(
          `The Secret Service did not store the password: ${result.stderr.trim()}`
        );
    },
    async remove() {
      const had = (await call(['lookup', ...attributes])).code === 0;
      await call(['clear', ...attributes]);
      return had;
    },
  };
}

export function secretStoreFor(
  platform: NodeJS.Platform,
  profile: { name: string; dir: string },
  run: HelperRunner = systemHelperRunner
): SecretStore {
  if (platform === 'win32') return windowsStore(profile.dir, run);
  if (platform === 'darwin') return macStore(profile.name, run);
  return linuxStore(profile.name, run);
}
