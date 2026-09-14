/**
 * One-time notice after the update to the rewritten generation: the MCP
 * server on the PC has to be set up anew with the new server package.
 *
 * Module and server are updated separately. Foundry updates the module on its
 * own, the server only changes when someone runs the new setup. Without this
 * notice a Gamemaster would keep running the old server and never learn why.
 *
 * When it opens, for a Gamemaster only, at ready:
 *
 * - The version acknowledged on this device (client scope, not listed) is
 *   older than the rewrite, or nothing is acknowledged yet and an earlier
 *   version of this module left traces. It does not come back with later
 *   updates, because only the rewrite needs the server set up anew.
 * - Nothing acknowledged and no traces: a fresh install. The current version
 *   is stored silently, so the notice never appears there later.
 * - Whenever the bridge finds a server of the previous generation, once per
 *   page load, even when it was dismissed or the install looked fresh. If the
 *   notice is open at that moment, its old-server sentence is revealed.
 *
 * Traces of an earlier version are settings of this module stored in the
 * world or in this browser, read at setup, before any area can write one.
 * An old install where nobody ever changed a setting leaves none and counts
 * as fresh; the old-server case above still reaches it as soon as that server
 * connects, and a notice shown too often does no harm.
 *
 * Buttons: "Remind me later" only closes; Escape and clicking away count as
 * that, never as consent. "Done, don't show again" stores the version. The
 * download page is a plain link that opens in a new tab.
 */
import { MODULE_ID } from '../../../common/constants.js';
import { PREVIOUS_SERVER_HOOK } from '../../bridge-client.js';
import type { SettingRow } from '../../settings.js';
import { readSetting } from '../../settings.js';
import { foundryApi } from './foundry-access.js';
import { escapeHtml } from './html.js';
import { t } from './texts.js';

export const UPDATE_NOTICE_SETTING = 'updateNoticeVersion';

/** The first version of the rewritten generation; older servers must be set up anew. */
export const REWRITE_VERSION = '14.2609.4';

const REPOSITORY = 'https://github.com/Niclasp1501/ninjos-foundry-mcp';
export const RELEASES_URL = `${REPOSITORY}/releases`;

export const updateNoticeSettingRow: SettingRow = {
  key: UPDATE_NOTICE_SETTING,
  kind: String,
  initial: '',
  listed: false,
  scope: 'client',
};

/** The installation guide in the reader's language: German for German clients, English otherwise. */
export function installationGuideUrl(
  lang: string | undefined = (game.i18n as { lang?: string }).lang
): string {
  const suffix = lang?.toLowerCase().startsWith('de') ? '' : '.en';
  return `${REPOSITORY}/blob/main/docs/INSTALLATION${suffix}.md`;
}

/** Compare two versions part by part as numbers; a suffix such as "-test.1" is ignored. */
export function compareVersions(a: string, b: string): number {
  const parts = (version: string) =>
    (version.split('-')[0] ?? '').split('.').map(part => Number.parseInt(part, 10) || 0);
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

interface SettingsStorage {
  get(scope: string): unknown;
}

function storedKeys(scope: unknown): string[] {
  if (!scope) return [];
  const keys: string[] = [];
  // Client scope: a Storage with length and key(i).
  const storage = scope as { length?: unknown; key?: unknown };
  if (typeof storage.key === 'function' && typeof storage.length === 'number') {
    for (let i = 0; i < storage.length; i++) {
      const key = (storage.key as (index: number) => string | null)(i);
      if (key) keys.push(key);
    }
    return keys;
  }
  // World scope: a collection of setting documents, each with its full key.
  const iterable = (scope as { contents?: unknown }).contents ?? scope;
  if (typeof (iterable as Iterable<unknown>)[Symbol.iterator] !== 'function') return keys;
  for (const entry of iterable as Iterable<unknown>) {
    const document = Array.isArray(entry) ? entry[1] : entry;
    const key = (document as { key?: unknown } | null)?.key;
    if (typeof key === 'string') keys.push(key);
  }
  return keys;
}

/** Does any stored setting of this module show that an earlier version ran here? */
export function earlierVersionTraces(): boolean {
  let storage: SettingsStorage | undefined;
  try {
    storage = (game.settings as { storage?: SettingsStorage }).storage;
  } catch {
    return false;
  }
  if (!storage || typeof storage.get !== 'function') return false;
  const own = `${MODULE_ID}.${UPDATE_NOTICE_SETTING}`;
  for (const scope of ['world', 'client']) {
    let keys: string[];
    try {
      keys = storedKeys(storage.get(scope));
    } catch {
      continue;
    }
    if (keys.some(key => key.startsWith(`${MODULE_ID}.`) && key !== own)) return true;
  }
  return false;
}

export type UpdateNoticeDecision = 'show' | 'fresh' | 'skip';

/** Whether the notice is due at ready, without the old-server case. */
export function decideUpdateNotice(input: {
  isGM: boolean;
  acknowledged: unknown;
  currentVersion: string | undefined;
  traces: boolean;
}): UpdateNoticeDecision {
  if (!input.isGM) return 'skip';
  // Not registered: nowhere to remember the answer.
  if (typeof input.acknowledged !== 'string') return 'skip';
  if (!input.currentVersion || compareVersions(input.currentVersion, REWRITE_VERSION) < 0) {
    return 'skip';
  }
  if (input.acknowledged) {
    return compareVersions(input.acknowledged, REWRITE_VERSION) < 0 ? 'show' : 'skip';
  }
  return input.traces ? 'show' : 'fresh';
}

/** The content of the notice as HTML text. */
export function updateNoticeContent(version: string, oldServer: boolean): string {
  const file = `ninjos-foundry-mcp-server-${version}-win32-x64.zip`;
  const steps = [
    t('updateNotice.step1', { file }),
    t('updateNotice.step2'),
    t('updateNotice.step3'),
    t('updateNotice.step4'),
  ]
    .map(step => `<li>${escapeHtml(step)}</li>`)
    .join('');
  return `
    <section class="mcp-update" aria-labelledby="mcp-update-heading">
      <h2 id="mcp-update-heading">${escapeHtml(t('updateNotice.heading'))}</h2>
      <p>${escapeHtml(t('updateNotice.intro', { version }))}</p>
      <p class="mcp-update__old-server" role="alert"${oldServer ? '' : ' hidden'}>${escapeHtml(t('updateNotice.oldServer'))}</p>
      <h3 id="mcp-update-steps">${escapeHtml(t('updateNotice.stepsHeading'))}</h3>
      <ol aria-labelledby="mcp-update-steps">${steps}</ol>
      <p>${escapeHtml(t('updateNotice.guideIntro'))} <a href="${escapeHtml(installationGuideUrl())}" target="_blank" rel="noopener">${escapeHtml(t('updateNotice.guideLink'))}</a></p>
      <p class="mcp-update__keeps">${escapeHtml(t('updateNotice.keeps'))}</p>
      <p class="mcp-update__download-row">
        <a class="mcp-update__download button" href="${RELEASES_URL}" target="_blank" rel="noopener" aria-label="${escapeHtml(t('updateNotice.downloadLabel'))}">
          <i class="fa-solid fa-download" aria-hidden="true"></i>
          <span>${escapeHtml(t('updateNotice.download'))}</span>
        </a>
      </p>
    </section>`;
}

export type UpdateNoticeOutcome = 'done' | 'later' | 'fresh' | 'skipped' | 'revealed';

interface Root {
  querySelectorAll(selector: string): ArrayLike<{ hidden: boolean }>;
}

/** Traces as they were at setup; read at ready only when setup was not seen. */
let tracesAtSetup: boolean | undefined;
let open = false;
let shownForOldServer = false;

/** Only for tests: forget what this page load has seen. */
export function resetUpdateNotice(): void {
  tracesAtSetup = undefined;
  open = false;
  shownForOldServer = false;
}

function currentVersion(): string | undefined {
  return game.modules.get(MODULE_ID)?.version;
}

async function openNotice(
  api: FoundryInterfaceApi,
  version: string,
  oldServer: boolean
): Promise<'done' | 'later'> {
  open = true;
  if (oldServer) shownForOldServer = true;
  try {
    const answer = await api.DialogV2.wait({
      window: {
        title: t('updateNotice.title', { version }),
        icon: 'fa-solid fa-plug-circle-exclamation',
      },
      classes: [MODULE_ID, 'mcp-update-notice'],
      position: { width: 540 },
      content: updateNoticeContent(version, oldServer),
      buttons: [
        {
          action: 'later',
          label: t('updateNotice.later'),
          icon: 'fa-solid fa-clock',
          default: true,
        },
        { action: 'done', label: t('updateNotice.done'), icon: 'fa-solid fa-check' },
      ],
      rejectClose: false,
    });
    if (answer === 'done') {
      await game.settings.set(MODULE_ID, UPDATE_NOTICE_SETTING, version);
      return 'done';
    }
    return 'later';
  } finally {
    open = false;
  }
}

/** Call at init: remembers at setup whether an earlier version left traces. */
export function watchEarlierVersion(): void {
  Hooks.once('setup', () => {
    tracesAtSetup = earlierVersionTraces();
  });
}

/** The check at ready. Resolves when the notice is closed. */
export async function showUpdateNotice(
  api: FoundryInterfaceApi | undefined = foundryApi()
): Promise<UpdateNoticeOutcome> {
  const version = currentVersion();
  const decision = decideUpdateNotice({
    isGM: game.user?.isGM === true,
    acknowledged: readSetting(UPDATE_NOTICE_SETTING),
    currentVersion: version,
    traces: tracesAtSetup ?? earlierVersionTraces(),
  });
  if (decision === 'skip' || !version) return 'skipped';
  if (decision === 'fresh') {
    await game.settings.set(MODULE_ID, UPDATE_NOTICE_SETTING, version);
    return 'fresh';
  }
  if (!api || open) return 'skipped';
  return openNotice(api, version, false);
}

/**
 * The bridge found a server of the previous generation. Reveals the sentence
 * in an open notice, or opens the notice once per page load.
 */
export async function noticePreviousServer(
  api: FoundryInterfaceApi | undefined = foundryApi(),
  root: Root | undefined = typeof document === 'undefined' ? undefined : document
): Promise<UpdateNoticeOutcome> {
  if (game.user?.isGM !== true) return 'skipped';
  const version = currentVersion();
  if (!version) return 'skipped';
  if (open) {
    shownForOldServer = true;
    for (const element of Array.from(root?.querySelectorAll('.mcp-update__old-server') ?? [])) {
      element.hidden = false;
    }
    return 'revealed';
  }
  if (shownForOldServer || !api) return 'skipped';
  return openNotice(api, version, true);
}

/** Call at ready: listen for the bridge reporting an old server. */
export function listenForPreviousServer(): void {
  Hooks.on(PREVIOUS_SERVER_HOOK, () => {
    noticePreviousServer().catch(error =>
      console.error('ninjos-foundry-mcp | update notice failed', error)
    );
  });
}
