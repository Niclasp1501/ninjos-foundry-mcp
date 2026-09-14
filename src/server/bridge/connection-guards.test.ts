import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OriginGuard, looksLikeHttpRequest, originMatches } from './connection-guards.js';

let dir: string;
let storeFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'origin-guard-'));
  storeFile = join(dir, 'allowed-origins.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('originMatches', () => {
  it('matches exactly, ignoring case and a trailing slash', () => {
    expect(originMatches('https://Foundry.example.org/', 'https://foundry.example.org')).toBe(true);
  });

  it('lets a star stand for subdomains', () => {
    expect(originMatches('https://*.forge-vtt.com', 'https://my-world.forge-vtt.com')).toBe(true);
    expect(originMatches('https://*.forge-vtt.com', 'https://a.b.forge-vtt.com')).toBe(true);
  });

  it('does not let a star cross into a different domain or scheme', () => {
    expect(originMatches('https://*.forge-vtt.com', 'https://forge-vtt.com.evil.net')).toBe(false);
    expect(originMatches('https://*.forge-vtt.com', 'http://my-world.forge-vtt.com')).toBe(false);
  });

  it('lets a star stand for a port', () => {
    expect(originMatches('http://localhost:*', 'http://localhost:30000')).toBe(true);
    expect(originMatches('http://localhost:*', 'http://localhost.evil.net:30000')).toBe(false);
  });
});

describe('OriginGuard with a configured list', () => {
  it('allows what is listed and refuses the rest', () => {
    const guard = new OriginGuard({ configured: ['http://localhost:30000'], storeFile });
    expect(guard.check('http://localhost:30000').allowed).toBe(true);
    expect(guard.check('https://evil.example').allowed).toBe(false);
  });

  it('never learns and never writes the file', () => {
    const guard = new OriginGuard({ configured: ['http://localhost:30000'], storeFile });
    guard.check('https://evil.example');
    expect(() => readFileSync(storeFile)).toThrow();
  });
});

describe('OriginGuard without a list', () => {
  it('remembers the first origin and refuses a second one', () => {
    const guard = new OriginGuard({ configured: [], storeFile });
    expect(guard.check('https://foundry.example.org')).toEqual({ allowed: true, learned: true });
    expect(guard.check('https://foundry.example.org').allowed).toBe(true);
    expect(guard.check('https://evil.example').allowed).toBe(false);
  });

  it('keeps the remembered origin across restarts', () => {
    new OriginGuard({ configured: [], storeFile }).check('https://foundry.example.org');
    const afterRestart = new OriginGuard({ configured: [], storeFile });
    expect(afterRestart.check('https://evil.example').allowed).toBe(false);
    expect(afterRestart.check('https://foundry.example.org').allowed).toBe(true);
  });

  it('does not learn from a preflight', () => {
    const guard = new OriginGuard({ configured: [], storeFile });
    expect(guard.check('https://evil.example', { learn: false }).allowed).toBe(true);
    expect(guard.check('https://foundry.example.org')).toEqual({ allowed: true, learned: true });
    expect(guard.check('https://evil.example').allowed).toBe(false);
  });

  it('never remembers the opaque origin "null"', () => {
    const guard = new OriginGuard({ configured: [], storeFile });
    expect(guard.check('null').allowed).toBe(false);
    expect(guard.check('https://foundry.example.org').allowed).toBe(true);
  });

  it('starts learning again when the file is unreadable', () => {
    writeFileSync(storeFile, 'not json');
    const guard = new OriginGuard({ configured: [], storeFile });
    expect(guard.check('https://foundry.example.org')).toEqual({ allowed: true, learned: true });
  });
});

it('lets a request without Origin through, since only a local program sends none', () => {
  const guard = new OriginGuard({ configured: ['http://localhost:30000'], storeFile });
  expect(guard.check(undefined).allowed).toBe(true);
});

describe('looksLikeHttpRequest', () => {
  it('recognises a browser POST', () => {
    expect(looksLikeHttpRequest('POST / HTTP/1.1\r\nHost: 127.0.0.1:31414\r\n')).toBe(true);
  });

  it('leaves a control message alone', () => {
    expect(looksLikeHttpRequest('{"id":"1","method":"ping"}\n')).toBe(false);
  });
});
