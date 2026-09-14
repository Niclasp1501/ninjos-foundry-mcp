import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BackendLock, readLockPid, type ProcessProbe } from './lock.js';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'backend-lock-'));
  file = join(dir, 'foundry-mcp-backend.lock');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const probe = (alive: boolean, node: boolean | undefined): ProcessProbe => ({
  isAlive: () => alive,
  isNode: () => node,
});

describe('BackendLock', () => {
  it('lets exactly one backend hold the lock', () => {
    const first = new BackendLock({ file, pid: 100, probe: probe(true, true) });
    const second = new BackendLock({ file, pid: 200, probe: probe(true, true) });
    expect(first.acquire()).toEqual({ acquired: true });
    expect(second.acquire()).toMatchObject({ acquired: false, holder: { pid: 100 } });
  });

  it('takes over the lock of a process that is gone', () => {
    writeFileSync(file, JSON.stringify({ pid: 100 }));
    const lock = new BackendLock({ file, pid: 200, probe: probe(false, undefined) });
    const result = lock.acquire();
    expect(result).toMatchObject({ acquired: true, tookOver: { pid: 100 } });
    expect(readLockPid(readFileSync(file, 'utf8'))).toBe(200);
  });

  it('takes over the lock of a process that is not Node', () => {
    writeFileSync(file, '100');
    const lock = new BackendLock({ file, pid: 200, probe: probe(true, false) });
    expect(lock.acquire()).toMatchObject({ acquired: true });
  });

  it('respects a live Node holder until its lock is older than the limit', () => {
    writeFileSync(file, JSON.stringify({ pid: 100 }));
    const now = Date.now();
    const fresh = new BackendLock({ file, pid: 200, probe: probe(true, true), now: () => now });
    expect(fresh.acquire().acquired).toBe(false);

    const later = new BackendLock({
      file,
      pid: 200,
      probe: probe(true, true),
      now: () => now + 61 * 60 * 1000,
    });
    expect(later.acquire()).toMatchObject({ acquired: true });
  });

  it('keeps its own lock young by touching it', () => {
    let now = Date.now();
    const holder = new BackendLock({ file, pid: 100, probe: probe(true, true), now: () => now });
    holder.acquire();
    now += 59 * 60 * 1000;
    holder.touch();
    now += 30 * 60 * 1000;
    const rival = new BackendLock({ file, pid: 200, probe: probe(true, true), now: () => now });
    expect(rival.acquire().acquired).toBe(false);
  });

  it('removes only its own lock on release', () => {
    const lock = new BackendLock({ file, pid: 100, probe: probe(true, true) });
    lock.acquire();
    writeFileSync(file, JSON.stringify({ pid: 300 }));
    lock.release();
    expect(readLockPid(readFileSync(file, 'utf8'))).toBe(300);
  });

  it('removes the file when it still names this process', () => {
    const lock = new BackendLock({ file, pid: 100, probe: probe(true, true) });
    lock.acquire();
    lock.release();
    expect(() => readFileSync(file)).toThrow();
  });
});

describe('BackendLock and the previous generation', () => {
  it('writes the pid as plain digits without a line end', () => {
    new BackendLock({ file, pid: 4711, probe: probe(true, true) }).acquire();
    expect(readFileSync(file, 'utf8')).toBe('4711');
  });

  it('respects the lock of a running previous backend', () => {
    writeFileSync(file, '100');
    const lock = new BackendLock({ file, pid: 200, probe: probe(true, true) });
    expect(lock.acquire()).toMatchObject({ acquired: false, holder: { pid: 100 } });
  });

  it('gives an aged lock back to its live holder when the start fails', () => {
    writeFileSync(file, '100');
    const lock = new BackendLock({
      file,
      pid: 200,
      probe: probe(true, true),
      now: () => Date.now() + 61 * 60 * 1000,
    });
    expect(lock.acquire()).toMatchObject({ acquired: true, tookOver: { pid: 100 } });
    lock.giveBack();
    expect(readFileSync(file, 'utf8')).toBe('100');
  });

  it('simply releases on a failed start when the previous holder was gone', () => {
    writeFileSync(file, '100');
    const lock = new BackendLock({ file, pid: 200, probe: probe(false, undefined) });
    lock.acquire();
    lock.giveBack();
    expect(() => readFileSync(file)).toThrow();
  });
});

describe('readLockPid', () => {
  it('reads leading digits and JSON with pid, and nothing else', () => {
    expect(readLockPid('{"pid": 42}')).toBe(42);
    expect(readLockPid('42\n')).toBe(42);
    expect(readLockPid('42 started')).toBe(42);
    expect(readLockPid('garbage')).toBeNull();
    expect(readLockPid('0')).toBeNull();
  });
});
