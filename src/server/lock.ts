/**
 * Only one backend on this PC.
 *
 * A lock file in the system temp directory. An existing lock is taken over
 * when its process is gone, is not a Node process, or the file has not been
 * touched for 60 minutes. The name stays the one of the previous generation,
 * so an old and a new backend exclude each other as well.
 *
 * The age rule exists because process ids are reused: after a reboot another
 * Node process can carry the old id. On its own it would let a second backend
 * start next to one that simply runs longer than an hour, so a running backend
 * touches its lock regularly. The control port is the second guard: a backend
 * that cannot bind it gives the lock back and leaves.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';

export interface ProcessProbe {
  isAlive(pid: number): boolean;
  /** true or false when known, undefined when it cannot be told. */
  isNode(pid: number): boolean | undefined;
}

export interface LockHolder {
  pid: number | null;
  ageMs: number;
}

export type AcquireResult =
  | { acquired: true; tookOver?: LockHolder & { why: string } }
  | { acquired: false; holder: LockHolder };

export interface BackendLockOptions {
  file: string;
  probe?: ProcessProbe;
  maxAgeMs?: number;
  pid?: number;
  now?: () => number;
}

export const systemProcessProbe: ProcessProbe = {
  isAlive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      // EPERM: it exists, it just belongs to someone else.
      return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
  },
  isNode(pid) {
    try {
      if (process.platform === 'win32') {
        const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 5000,
        });
        if (!out.includes(`"${pid}"`)) return undefined;
        return /^"node(?:\.exe)?"/im.test(out.trim());
      }
      const out = execFileSync('ps', ['-p', String(pid), '-o', 'comm='], {
        encoding: 'utf8',
        timeout: 5000,
      }).trim();
      return out ? /(^|\/)node$/.test(out) : undefined;
    } catch {
      return undefined;
    }
  },
};

/**
 * The pid in a lock file.
 *
 * Both generations write the pid as plain decimal digits without a line end.
 * The previous backend reads
 * the leading digits and holds anything else for orphaned, so writing JSON
 * would let it delete the lock of a running backend. JSON with `pid`, written
 * by early builds of this rewrite, is still read.
 */
export function readLockPid(text: string): number | null {
  const trimmed = text.trim();
  const digits = /^\d+/.exec(trimmed);
  if (digits) {
    const pid = Number(digits[0]);
    return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
  }
  try {
    const data = JSON.parse(trimmed) as unknown;
    if (typeof data === 'object' && data !== null && 'pid' in data) {
      const pid = Number((data as { pid: unknown }).pid);
      return Number.isInteger(pid) && pid > 0 ? pid : null;
    }
  } catch {
    // Unreadable content: judged by age alone.
  }
  return null;
}

export class BackendLock {
  private held = false;
  /** A live holder whose lock was taken over only because of its age. */
  private liveHolderTakenOver: number | null = null;
  private readonly probe: ProcessProbe;
  private readonly maxAgeMs: number;
  private readonly pid: number;
  private readonly now: () => number;

  constructor(private readonly options: BackendLockOptions) {
    this.probe = options.probe ?? systemProcessProbe;
    this.maxAgeMs = options.maxAgeMs ?? 60 * 60 * 1000;
    this.pid = options.pid ?? process.pid;
    this.now = options.now ?? Date.now;
  }

  acquire(): AcquireResult {
    let tookOver: (LockHolder & { why: string }) | undefined;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        // Plain digits, no line end: the only form the previous backend recognises.
        writeFileSync(this.options.file, String(this.pid), { flag: 'wx' });
        this.held = true;
        return tookOver ? { acquired: true, tookOver } : { acquired: true };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }

      const holder = this.inspect();
      if (!holder) continue; // vanished between the two calls
      const stale = this.staleReason(holder);
      if (!stale) return { acquired: false, holder };

      try {
        unlinkSync(this.options.file);
      } catch {
        // Someone else removed it first; the next attempt decides.
      }
      tookOver = { ...holder, why: stale.why };
      this.liveHolderTakenOver = stale.holderAlive ? holder.pid : null;
    }

    const holder = this.inspect() ?? { pid: null, ageMs: 0 };
    return { acquired: false, holder };
  }

  /** Show that the holder is still alive, so the age rule never hits a running backend. */
  touch(): void {
    if (!this.held) return;
    try {
      const at = new Date(this.now());
      utimesSync(this.options.file, at, at);
    } catch {
      // Lost the file: nothing to refresh, and nothing better to do about it.
    }
  }

  release(): void {
    if (!this.held) return;
    this.held = false;
    try {
      const pid = readLockPid(readFileSync(this.options.file, 'utf8'));
      // Only remove what is ours. Another backend may have taken over meanwhile.
      if (pid === this.pid) unlinkSync(this.options.file);
    } catch {
      // Already gone.
    }
  }

  /**
   * For a start that failed. When the lock was taken from a process that is
   * still alive (only its age made it look stale, as with a backend of the
   * previous generation that never refreshes its file), that process most
   * likely holds the control port and is the reason for the failure. It gets
   * its lock back instead of running on without one.
   */
  giveBack(): void {
    const previous = this.liveHolderTakenOver;
    if (!this.held || previous === null) {
      this.release();
      return;
    }
    this.held = false;
    try {
      if (readLockPid(readFileSync(this.options.file, 'utf8')) === this.pid) {
        writeFileSync(this.options.file, String(previous));
      }
    } catch {
      // Already gone: nothing to give back.
    }
  }

  private inspect(): LockHolder | null {
    try {
      const stat = statSync(this.options.file);
      const pid = readLockPid(readFileSync(this.options.file, 'utf8'));
      return { pid, ageMs: Math.max(0, this.now() - stat.mtimeMs) };
    } catch {
      return null;
    }
  }

  private staleReason(holder: LockHolder): { why: string; holderAlive: boolean } | null {
    if (holder.pid !== null) {
      if (holder.pid === this.pid)
        return { why: 'the lock names this very process', holderAlive: false };
      if (!this.probe.isAlive(holder.pid))
        return { why: `process ${holder.pid} is not running`, holderAlive: false };
      if (this.probe.isNode(holder.pid) === false)
        return { why: `process ${holder.pid} is not a Node process`, holderAlive: false };
    }
    if (holder.ageMs > this.maxAgeMs) {
      return {
        why: `the lock was not refreshed for ${Math.round(holder.ageMs / 60000)} minutes`,
        holderAlive: holder.pid !== null,
      };
    }
    return null;
  }
}
