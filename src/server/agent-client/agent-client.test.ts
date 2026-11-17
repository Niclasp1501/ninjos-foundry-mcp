import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { askClient, controlFile, endpointFor, NotRunningError, serveControl } from './control.js';
import { evaluationCode, isSoftwareRenderer, placeOf, retryDelayMs } from './page.js';
import {
  clientSettings,
  listProfiles,
  normalizeUrl,
  parseProfile,
  profileDir,
  readProfile,
  writeProfile,
} from './profile.js';
import { secretStoreFor, type HelperRunner } from './secret-store.js';

const ID = 'AbCdEfGhIjKlMnOp';
const temporary: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agent-client-'));
  temporary.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('agent client profiles', () => {
  it('normalizes the address and keeps a route prefix', () => {
    expect(normalizeUrl('https://foundry.example.com/')).toBe('https://foundry.example.com');
    expect(normalizeUrl('https://example.com/vtt/join')).toBe('https://example.com/vtt');
    expect(normalizeUrl('http://localhost:30000/game')).toBe('http://localhost:30000');
    expect(() => normalizeUrl('ftp://example.com')).toThrow(/https/);
    expect(() => normalizeUrl(`https://user:secret${String.fromCharCode(64)}example.com`)).toThrow(
      /password/
    );
  });

  it('needs a user id and fills the defaults', () => {
    expect(() => parseProfile('ai', { url: 'https://example.com' })).toThrow(/userId/);
    expect(() => parseProfile('AI', { url: 'https://example.com', userId: ID })).toThrow(
      /profile name/
    );
    expect(parseProfile('ai', { url: 'https://example.com', userId: ID })).toEqual({
      name: 'ai',
      url: 'https://example.com',
      userId: ID,
      canvas: 'world',
      bridge: 'fallback',
      browser: 'auto',
      width: 1600,
      height: 900,
    });
    expect(() =>
      parseProfile('ai', { url: 'https://e.com', userId: ID, bridge: 'always' })
    ).toThrow(/bridge/);
  });

  it('stores profiles in the state folder without the password', () => {
    const env = { FOUNDRY_MCP_STATE_DIR: tempDir() };
    const profile = parseProfile('player', {
      url: 'https://example.com',
      userId: ID,
      canvas: 'off',
    });
    const file = writeProfile(profile, env);
    expect(JSON.parse(readFileSync(file, 'utf8'))).not.toHaveProperty('password');
    expect(listProfiles(env)).toEqual(['player']);
    expect(readProfile('player', env)).toEqual(profile);
    expect(() => readProfile('missing', env)).toThrow(/no agent client/);
  });

  it('sets the bridge mode and leaves the canvas to the world unless told', () => {
    const base = { url: 'https://example.com', userId: ID };
    expect(clientSettings(parseProfile('a', base))).toEqual({
      'ninjos-foundry-mcp.bridgeOffOnDevice': 'false',
      'ninjos-foundry-mcp.bridgeFallbackOnDevice': 'true',
    });
    expect(clientSettings(parseProfile('a', { ...base, bridge: 'off', canvas: 'off' }))).toEqual({
      'ninjos-foundry-mcp.bridgeOffOnDevice': 'true',
      'ninjos-foundry-mcp.bridgeFallbackOnDevice': 'false',
      'core.noCanvas': 'true',
    });
  });
});

describe('agent client pages', () => {
  it('knows where the page stands', () => {
    expect(placeOf('https://example.com/game')).toBe('game');
    expect(placeOf('https://example.com/vtt/join')).toBe('join');
    expect(placeOf('https://example.com/setup')).toBe('no-world');
    expect(placeOf('about:blank')).toBe('other');
  });

  it('runs code as an expression or as a body and returns plain JSON', async () => {
    const run = async (code: string) => {
      const { expression, body } = evaluationCode(code);
      try {
        return await eval(expression);
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        return await eval(body);
      }
    };
    await expect(run('1 + 1')).resolves.toBe(2);
    await expect(run('const a = { b: 1n }; a.self = a; return a')).resolves.toEqual({
      b: '1',
      self: '[circular]',
    });
    await expect(run('undefined')).resolves.toBeNull();
  });

  it('waits longer after each failure, at most five minutes', () => {
    expect([1, 2, 3, 10].map(retryDelayMs)).toEqual([15_000, 30_000, 60_000, 300_000]);
  });

  it('recognises software rendering', () => {
    expect(isSoftwareRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))')).toBe(true);
    expect(isSoftwareRenderer('ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11)')).toBe(false);
    expect(isSoftwareRenderer(null)).toBe(false);
  });
});

describe('agent client secret store', () => {
  function recordingRunner(answer: { code: number; stdout: string }) {
    const calls: Array<{
      command: string;
      args: string[];
      input?: string;
      env?: Record<string, string>;
    }> = [];
    const run: HelperRunner = async (command, args, options) => {
      calls.push({
        command,
        args,
        ...(options.input !== undefined ? { input: options.input } : {}),
        ...(options.env ? { env: options.env } : {}),
      });
      return { ...answer, stderr: '' };
    };
    return { calls, run };
  }

  it('never puts the password into arguments or the environment of a helper', async () => {
    const secret = 'Sehr-geheim äöü 123';
    for (const platform of ['win32', 'linux'] as const) {
      const dir = tempDir();
      const { calls, run } = recordingRunner({ code: 0, stdout: '' });
      await secretStoreFor(platform, { name: 'ai', dir }, run).write(secret);
      const call = calls[0]!;
      const visible = JSON.stringify({ command: call.command, args: call.args, env: call.env });
      expect(visible).not.toContain(secret);
      expect(visible).not.toContain(Buffer.from(secret, 'utf8').toString('base64'));
      expect(call.input).toBeDefined();
    }
  });

  it('reads the Windows password back through base64 so any character survives', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'password.dpapi'), 'sealed');
    const secret = 'Pässwört€';
    const { run } = recordingRunner({
      code: 0,
      stdout: Buffer.from(secret, 'utf8').toString('base64'),
    });
    const store = secretStoreFor('win32', { name: 'ai', dir }, run);
    await expect(store.has()).resolves.toBe(true);
    await expect(store.read()).resolves.toBe(secret);
    await expect(store.remove()).resolves.toBe(true);
    await expect(store.read()).resolves.toBeNull();
  });

  it('lets the macOS keychain ask for the password itself', async () => {
    const { calls, run } = recordingRunner({ code: 0, stdout: '' });
    const store = secretStoreFor('darwin', { name: 'ai', dir: tempDir() }, run);
    expect(store.asksItself).toBe(true);
    await store.write();
    expect(calls[0]!.args.at(-1)).toBe('-w');
  });
});

describe('agent client control channel', () => {
  it('answers with the right token and refuses without it', async () => {
    const dir = tempDir();
    const { close } = await serveControl(dir, 'ai', async request => ({
      ok: true,
      result: request.command,
    }));
    try {
      await expect(askClient(dir, { command: 'status' }, 5000)).resolves.toEqual({
        ok: true,
        result: 'status',
      });
      const info = JSON.parse(readFileSync(controlFile(dir), 'utf8'));
      writeFileSync(controlFile(dir), JSON.stringify({ ...info, token: 'wrong' }));
      await expect(askClient(dir, { command: 'status' }, 5000)).resolves.toEqual({
        ok: false,
        error: 'Not allowed',
      });
    } finally {
      close();
    }
    await expect(askClient(dir, { command: 'status' }, 5000)).rejects.toBeInstanceOf(
      NotRunningError
    );
  });

  it('names a pipe per folder on Windows', () => {
    const a = endpointFor(
      'win32',
      'C:\\Users\\a\\AppData\\Local\\FoundryMCPServer\\agent-clients\\ai',
      'ai'
    );
    const b = endpointFor(
      'win32',
      'C:\\Users\\b\\AppData\\Local\\FoundryMCPServer\\agent-clients\\ai',
      'ai'
    );
    expect(a).toMatch(/^\\\\\.\\pipe\\ninjos-foundry-mcp-agent-ai-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
    expect(profileDir('ai', { FOUNDRY_MCP_STATE_DIR: '/state' })).toMatch(/agent-clients[\\/]ai$/);
  });
});
