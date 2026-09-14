/**
 * The release list as the compendiums area applies it.
 *
 * Reading and interpreting the stored value is the core's job
 * (src/common/compendium-release.ts): the permission overview of the world area
 * reads the same interpretation, so a damaged or unregistered setting releases
 * nothing in both places and names the same problem.
 *
 * Two rules of the previous generation are not in the core yet and stay here,
 * so a list written or read by a module of either generation means the same
 * compendiums:
 * - an entry also matches every compendium whose id starts with it and a dot,
 *   so "world" or "my-module" releases those ids even when the package name
 *   differs
 * - the release window stores the entries separated by a comma and a space
 *
 * Both belong in the core; once the core has them, this file shrinks to
 * the re-export.
 */
import {
  interpretReleaseList,
  releaseListCovers as coreCovers,
  RELEASE_LIST_SETTING,
  type ReleaseList,
} from '../../compendium-release.js';

export { interpretReleaseList, RELEASE_LIST_SETTING, type ReleaseList };

/** Entries trimmed, without empty ones and doubles, joined by comma and space. */
export function serializeReleaseList(entries: readonly string[]): string {
  return interpretReleaseList([...entries]).entries.join(', ');
}

/** Whether a readable, filled list names this compendium: id, package name or id prefix. */
export function releaseListCovers(
  list: ReleaseList,
  packId: string,
  packageName?: string | null
): boolean {
  if (list.mode !== 'listed') return false;
  return (
    coreCovers(list, packId, packageName) ||
    list.entries.some(entry => packId.startsWith(`${entry}.`))
  );
}
