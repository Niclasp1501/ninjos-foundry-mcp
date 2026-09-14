/**
 * The compendium release list as the module reads it right now. The rules
 * live in src/common/compendium-release.ts; this only reads the setting.
 */
import {
  interpretReleaseList,
  releaseDecision,
  RELEASE_LIST_SETTING,
  type ReleaseDecision,
  type ReleaseList,
} from '../common/compendium-release.js';
import { readSetting } from './settings.js';

export function readReleaseList(): ReleaseList {
  return interpretReleaseList(readSetting(RELEASE_LIST_SETTING));
}

/** The release list's answer for one compendium, read fresh. */
export function compendiumRelease(packId: string, packageName?: string | null): ReleaseDecision {
  return releaseDecision(readReleaseList(), packId, packageName);
}
