/**
 * Waiting for a running backend before its files are replaced.
 *
 * The backend holds the lock file of both generations and ends by itself a
 * minute after the last client closed (FOUNDRY_MCP_IDLE_SHUTDOWN_MS). Setup
 * therefore asks people to close their Claude apps and waits; it never kills a
 * backend, because that would cut the bridge of a session someone still uses.
 * The ports 31414 to 31416 are not probed: the lock names the process.
 */
import { readFileSync } from 'node:fs';
import { readLockPid, type ProcessProbe } from '../lock.js';

export interface BackendWaitOptions {
  lockFile: string;
  probe: ProcessProbe;
  timeoutMs: number;
  intervalMs?: number;
  sleep: (ms: number) => Promise<void>;
  /** Called once, when the first look finds a running backend. */
  onWaiting?: (pid: number) => void;
}

/** The pid of a live backend holding the lock, or null. */
export function runningBackend(lockFile: string, probe: ProcessProbe): number | null {
  let text: string;
  try {
    text = readFileSync(lockFile, 'utf8');
  } catch {
    return null;
  }
  const pid = readLockPid(text);
  if (pid === null || !probe.isAlive(pid)) return null;
  return probe.isNode(pid) === false ? null : pid;
}

export async function waitForBackendEnd(
  options: BackendWaitOptions
): Promise<{ ended: boolean; pid: number | null }> {
  const interval = options.intervalMs ?? 1000;
  let pid = runningBackend(options.lockFile, options.probe);
  if (pid === null) return { ended: true, pid: null };
  options.onWaiting?.(pid);
  for (let waited = 0; waited < options.timeoutMs; waited += interval) {
    await options.sleep(interval);
    pid = runningBackend(options.lockFile, options.probe);
    if (pid === null) return { ended: true, pid: null };
  }
  return { ended: false, pid };
}
