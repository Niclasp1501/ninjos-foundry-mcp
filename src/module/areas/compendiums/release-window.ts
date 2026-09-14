/**
 * The logic behind the window "Release compendiums". The window itself is
 * the interface area; it calls these two
 * functions and draws what they return.
 *
 * - `releaseWindowModel`: every compendium in blocks by origin (world first,
 *   one block per module sorted by title, the system last), each block sorted
 *   by label, with the tick set when its id or its package is on the list.
 * - `saveReleaseList`: stores exactly the chosen entries and reads them back.
 *   A saved restriction that silently turned into "everything allowed" is the
 *   one failure this window must never have again, so a difference after
 *   saving is an error with both lists named.
 */
import { MODULE_ID } from '../../../common/constants.js';
import {
  interpretReleaseList,
  RELEASE_LIST_SETTING,
  serializeReleaseList,
} from '../../../common/areas/compendiums/release-list.js';
import { readReleaseList } from '../../compendium-release.js';
import { onReleaseList, releaseState } from './guard.js';
import { allPacks, packLabel } from './packs.js';

export interface ReleaseWindowPack {
  id: string;
  label: string;
  type: string;
  count: number;
  locked: boolean;
  checked: boolean;
}

export interface ReleaseWindowGroup {
  kind: 'world' | 'module' | 'system';
  packageName: string;
  title: string;
  packs: ReleaseWindowPack[];
}

export interface ReleaseWindowModel {
  /** The upper tick: the list is empty, every unlocked compendium is allowed. */
  allowAllUnlocked: boolean;
  /** Why the stored list could not be read, or null. */
  problem: string | null;
  groups: ReleaseWindowGroup[];
}

const byText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

export function releaseWindowModel(): ReleaseWindowModel {
  const state = releaseState();
  const groups = new Map<string, ReleaseWindowGroup>();

  for (const pack of allPacks()) {
    const packageType = pack.metadata.packageType;
    const kind: ReleaseWindowGroup['kind'] =
      packageType === 'world' ? 'world' : packageType === 'system' ? 'system' : 'module';
    const packageName = pack.metadata.packageName;
    const key = `${kind}:${packageName}`;
    let group = groups.get(key);
    if (!group) {
      const module =
        kind === 'module'
          ? (game.modules.get(packageName) as { title?: string } | undefined)
          : undefined;
      group = { kind, packageName, title: module?.title || packageName, packs: [] };
      groups.set(key, group);
    }
    group.packs.push({
      id: pack.collection,
      label: packLabel(pack),
      type: pack.documentName,
      count: pack.index.size,
      locked: pack.locked === true,
      checked: onReleaseList(state, pack),
    });
  }

  const order = { world: 0, module: 1, system: 2 } as const;
  const sorted = [...groups.values()].sort(
    (a, b) => order[a.kind] - order[b.kind] || byText(a.title, b.title)
  );
  for (const group of sorted) group.packs.sort((a, b) => byText(a.label, b.label));

  return { allowAllUnlocked: !state.filled, problem: state.damaged, groups: sorted };
}

/**
 * Store the chosen ids or package names. An empty choice means every unlocked
 * compendium. Rejects when the stored value reads back differently.
 */
export async function saveReleaseList(
  chosen: readonly string[]
): Promise<{ entries: string[]; allowAllUnlocked: boolean }> {
  const value = serializeReleaseList(chosen);
  const wanted = interpretReleaseList(value).entries;
  await game.settings.set(MODULE_ID, RELEASE_LIST_SETTING, value);

  const back = readReleaseList();
  const same =
    back.problem === null &&
    back.entries.length === wanted.length &&
    wanted.every(entry => back.entries.includes(entry));
  if (!same) {
    throw new Error(
      `The release list was not stored as chosen. Chosen: ${wanted.join(', ') || '(none)'}; ` +
        `stored: ${back.problem ?? (back.entries.join(', ') || '(none)')}`
    );
  }
  return { entries: back.entries, allowAllUnlocked: back.entries.length === 0 };
}
