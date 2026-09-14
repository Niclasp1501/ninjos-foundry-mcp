/**
 * The protection layers of compendium writes, in one place and in one order.
 *
 * 1. "Allow Write Operations" and 2. the permission level: the dispatcher
 *    checks both before any handler runs (src/common/permissions.ts). Where the
 *    document kind is only known from the data (importing), `requireAccess`
 *    asks the same function again for that kind.
 * 3. The release list (`writableCompendiums`).
 * 4. Foundry's lock. A compendium on a filled release list counts as released
 *    for work, so its lock no longer holds the AI back. Otherwise
 *    `unlockIfNeeded` is required. A lifted lock is set again after the
 *    operation in every case, also when it failed, and a lock that could not
 *    be set again is reported in the answer, never only in the console.
 */
import {
  checkAccess,
  levelAllows,
  permissionLevel,
  writeSwitchOn,
  type DocumentKind,
  type WriteAction,
} from '../../../common/permissions.js';
import {
  releaseListCovers,
  RELEASE_LIST_SETTING,
  type ReleaseList,
} from '../../../common/areas/compendiums/release-list.js';
import { releaseDecision } from '../../../common/compendium-release.js';
import type { LockReport, WriteAccessSummary } from '../../../common/areas/compendiums/shapes.js';
import { readReleaseList } from '../../compendium-release.js';
import { QueryError } from '../../dispatcher.js';
import { readSetting } from '../../settings.js';
import { messageOf } from './args.js';

/** Switch and level for a kind the dispatcher could not know in advance. */
export function requireAccess(document: DocumentKind, action: WriteAction): void {
  const decision = checkAccess({ kind: 'write', document, action }, readSetting);
  if (!decision.allowed) throw new QueryError(decision.code, decision.reason);
}

export interface ReleaseState {
  list: ReleaseList;
  entries: string[];
  /** A filled list, or one that cannot be read or is not registered, which releases nothing. */
  filled: boolean;
  /** Why the list could not be read, or null. */
  damaged: string | null;
}

/** The list as the core reads it, fresh from the setting. */
export function releaseState(): ReleaseState {
  const list = readReleaseList();
  return {
    list,
    entries: list.entries,
    filled: list.mode !== 'all-unlocked',
    damaged: list.problem,
  };
}

export function onReleaseList(state: ReleaseState, pack: FoundryCompendiumsPack): boolean {
  return releaseListCovers(state.list, pack.collection, pack.metadata.packageName);
}

export function writeAccessSummary(state: ReleaseState = releaseState()): WriteAccessSummary {
  return {
    writeOperationsEnabled: writeSwitchOn(readSetting),
    level: permissionLevel(readSetting, 'Compendiums'),
    releaseList: state.entries,
    releaseListProblem: state.damaged,
  };
}

function notReleasedReason(state: ReleaseState, pack: FoundryCompendiumsPack): string {
  if (state.list.mode !== 'listed') {
    return (
      releaseDecision(state.list, pack.collection, pack.metadata.packageName).reason ??
      `The release list (setting "${RELEASE_LIST_SETTING}") refuses "${pack.collection}".`
    );
  }
  return (
    `"${pack.collection}" is not on the release list (setting "${RELEASE_LIST_SETTING}"). ` +
    `A Gamemaster can add it, or its package "${pack.metadata.packageName}", in the module settings ` +
    'under "Release compendiums", or clear the list to allow every unlocked compendium.'
  );
}

/** Refuse a compendium that a filled release list does not name. Returns whether it is on the list. */
export function requireReleased(pack: FoundryCompendiumsPack, state = releaseState()): boolean {
  const covered = onReleaseList(state, pack);
  if (state.filled && !covered)
    throw new QueryError('NOT_RELEASED', notReleasedReason(state, pack));
  return covered;
}

/**
 * Every layer for one compendium, without changing anything. Used by
 * list-compendiums, so "editable" means what it says.
 */
export function packWriteState(
  pack: FoundryCompendiumsPack,
  state: ReleaseState
): { writable: boolean; reason: string | null; onList: boolean } {
  const onList = onReleaseList(state, pack);
  let reason: string | null = null;
  if (!writeSwitchOn(readSetting)) {
    reason = '"Allow Write Operations" is off';
  } else if (!levelAllows(permissionLevel(readSetting, 'Compendiums'), 'update')) {
    reason = `the permission level for compendiums is "${permissionLevel(readSetting, 'Compendiums')}" (setting "permCompendiums")`;
  } else if (state.filled && !onList) {
    reason = state.damaged
      ? `the release list could not be read (${state.damaged})`
      : 'not on the release list';
  } else if (pack.locked && !onList) {
    reason = 'locked';
  }
  return { writable: reason === null, reason, onList };
}

/**
 * Release list and lock, without changing anything. Throws what the real
 * operation would throw; a dry run uses this alone.
 */
export function checkWritable(
  pack: FoundryCompendiumsPack,
  options: { unlockIfNeeded: boolean; unlockOffered?: boolean }
): { onList: boolean; locked: boolean } {
  const onList = requireReleased(pack);
  const locked = pack.locked === true;
  if (locked && !onList && !options.unlockIfNeeded) {
    const hint =
      options.unlockOffered === false
        ? 'Unlock it first with set-compendium-lock.'
        : 'Pass unlockIfNeeded: true to lift the lock for this operation only (it is set again afterwards), or unlock it with set-compendium-lock.';
    throw new QueryError('PACK_LOCKED', `"${pack.collection}" is locked. ${hint}`);
  }
  return { onList, locked };
}

async function setLock(pack: FoundryCompendiumsPack, locked: boolean): Promise<string | null> {
  try {
    await pack.configure({ locked });
  } catch (error) {
    return messageOf(error);
  }
  return pack.locked === locked
    ? null
    : `Foundry still reports it as ${pack.locked ? 'locked' : 'unlocked'}`;
}

/**
 * Run a write against a compendium behind the release list and the lock.
 * The lock is lifted only when needed and always set again afterwards.
 */
export async function withWritablePack<T>(
  pack: FoundryCompendiumsPack,
  options: { unlockIfNeeded: boolean },
  run: () => Promise<T>
): Promise<{ value: T; lock: LockReport }> {
  const { locked } = checkWritable(pack, options);
  const lock: LockReport = { wasLocked: locked, lifted: false, restored: null, problem: null };

  if (locked) {
    const problem = await setLock(pack, false);
    if (problem)
      throw new QueryError(
        'LOCK_NOT_LIFTED',
        `The lock of "${pack.collection}" could not be lifted: ${problem}. Nothing was changed.`
      );
    lock.lifted = true;
  }

  let value: T | undefined;
  let failure: unknown = null;
  let failed = false;
  try {
    value = await run();
  } catch (error) {
    failure = error;
    failed = true;
  }

  if (lock.lifted) {
    lock.problem = await setLock(pack, true);
    lock.restored = lock.problem === null;
  }

  if (failed) {
    if (lock.problem) {
      const code = failure instanceof QueryError ? failure.code : 'OPERATION_FAILED';
      throw new QueryError(
        code,
        `${messageOf(failure)} CAUTION: in addition, the lock of "${pack.collection}" could not be set again ` +
          `(${lock.problem}). It is unlocked now; lock it again with set-compendium-lock.`
      );
    }
    throw failure;
  }
  return { value: value as T, lock };
}
