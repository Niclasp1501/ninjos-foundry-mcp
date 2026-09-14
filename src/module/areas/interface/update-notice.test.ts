/**
 * The update notice after the rewrite: Gamemaster only, once per version on a
 * device, "Remind me later" and closing never count as consent, a fresh
 * install stays quiet, and an old server brings it back.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { MODULE_ID } from '../../../common/constants.js';
import { PREVIOUS_SERVER_HOOK } from '../../bridge-client.js';
import { parseHtml } from '../../../testing/fake-dom.js';
import { FakeFoundry, type FakeFoundryOptions } from '../../../testing/fake-foundry.js';
import {
  compareVersions,
  decideUpdateNotice,
  earlierVersionTraces,
  installationGuideUrl,
  listenForPreviousServer,
  noticePreviousServer,
  RELEASES_URL,
  resetUpdateNotice,
  showUpdateNotice,
  UPDATE_NOTICE_SETTING,
  updateNoticeContent,
} from './update-notice.js';

let foundry: FakeFoundry;
afterEach(() => {
  foundry?.uninstall();
  resetUpdateNotice();
});

interface SetupOptions extends FakeFoundryOptions {
  register?: boolean;
  /** Keys of this module stored in the world by an earlier version. */
  worldKeys?: string[];
  clientKeys?: string[];
  moduleVersion?: string;
}

function setup(options: SetupOptions = {}): FakeFoundry {
  const { register = true, worldKeys = [], clientKeys = [], moduleVersion = '14.2609.4' } = options;
  foundry = new FakeFoundry({
    modules: [{ id: MODULE_ID, version: moduleVersion }],
    ...options,
  }).install();
  const settings = foundry.game['settings'] as {
    register(ns: string, key: string, config: object): void;
    storage?: unknown;
  };
  if (register) {
    settings.register(MODULE_ID, UPDATE_NOTICE_SETTING, { default: '', scope: 'client' });
  }
  const client = {
    length: clientKeys.length,
    key: (index: number) => clientKeys[index] ?? null,
  };
  const world = { contents: worldKeys.map(key => ({ key, value: '"x"' })) };
  settings.storage = new Map<string, unknown>([
    ['world', world],
    ['client', client],
  ]);
  return foundry;
}

function dialog(answers: unknown[]) {
  const configs: Array<Record<string, unknown>> = [];
  let resolveOpen: (() => void) | undefined;
  const opened = new Promise<void>(resolve => (resolveOpen = resolve));
  return {
    configs,
    opened,
    api: {
      ApplicationV2: class {} as unknown as FoundryInterfaceApplicationClass,
      DialogV2: {
        wait: async (config: Record<string, unknown>) => {
          configs.push(config);
          resolveOpen?.();
          return answers.shift() ?? null;
        },
      },
    },
  };
}

const acknowledged = () =>
  (foundry.game['settings'] as { get(ns: string, key: string): unknown }).get(
    MODULE_ID,
    UPDATE_NOTICE_SETTING
  );

const UPGRADED = { worldKeys: [`${MODULE_ID}.allowWriteOperations`] };

describe('update notice at ready', () => {
  it('is shown once per version for a Gamemaster: "Done" stores the version and it stays away', async () => {
    setup(UPGRADED);
    const first = dialog(['done']);
    await expect(showUpdateNotice(first.api)).resolves.toBe('done');
    expect(first.configs).toHaveLength(1);
    expect(acknowledged()).toBe('14.2609.4');

    const second = dialog(['done']);
    await expect(showUpdateNotice(second.api)).resolves.toBe('skipped');
    expect(second.configs).toEqual([]);
  });

  it('comes back after "Remind me later", Escape or clicking away, and stores nothing', async () => {
    for (const answer of ['later', null]) {
      setup(UPGRADED);
      await expect(showUpdateNotice(dialog([answer]).api)).resolves.toBe('later');
      expect(acknowledged()).toBe('');
      const again = dialog(['later']);
      await expect(showUpdateNotice(again.api)).resolves.toBe('later');
      expect(again.configs).toHaveLength(1);
      foundry.uninstall();
      resetUpdateNotice();
    }
  });

  it('is not shown to players', async () => {
    setup({ ...UPGRADED, users: [{ id: 'p', name: 'Player' }] });
    const { api, configs } = dialog(['done']);
    await expect(showUpdateNotice(api)).resolves.toBe('skipped');
    await expect(noticePreviousServer(api)).resolves.toBe('skipped');
    expect(configs).toEqual([]);
    expect(acknowledged()).toBe('');
  });

  it('stays quiet on a fresh install and remembers the version, so it never appears later', async () => {
    setup();
    const { api, configs } = dialog(['done']);
    await expect(showUpdateNotice(api)).resolves.toBe('fresh');
    expect(configs).toEqual([]);
    expect(acknowledged()).toBe('14.2609.4');
  });

  it('is shown when a version older than the rewrite was acknowledged, but not for later updates', async () => {
    setup({ settings: { [`${MODULE_ID}.${UPDATE_NOTICE_SETTING}`]: '14.2609.3' } });
    await expect(showUpdateNotice(dialog(['later']).api)).resolves.toBe('later');
    foundry.uninstall();

    setup({
      moduleVersion: '14.2610.1',
      settings: { [`${MODULE_ID}.${UPDATE_NOTICE_SETTING}`]: '14.2609.4' },
    });
    const { api, configs } = dialog(['done']);
    await expect(showUpdateNotice(api)).resolves.toBe('skipped');
    expect(configs).toEqual([]);
  });

  it('is not shown when there is nowhere to remember the answer', async () => {
    setup({ ...UPGRADED, register: false });
    const { api, configs } = dialog(['done']);
    await expect(showUpdateNotice(api)).resolves.toBe('skipped');
    expect(configs).toEqual([]);
  });

  it('is a dialog of the module with two buttons, "Remind me later" as default, no rejection on close', async () => {
    setup(UPGRADED);
    const { api, configs } = dialog(['later']);
    await showUpdateNotice(api);
    const config = configs[0] as {
      classes: string[];
      rejectClose: boolean;
      window: { title: string };
      buttons: Array<{ action: string; label: string; default?: boolean }>;
    };
    expect(config.classes).toContain(MODULE_ID);
    expect(config.rejectClose).toBe(false);
    expect(config.window.title).toBe('Update to 14.2609.4: set up the MCP server anew');
    expect(config.buttons.map(button => [button.action, button.label, button.default])).toEqual([
      ['later', 'Remind me later', true],
      ['done', "Done, don't show again", undefined],
    ]);
  });
});

describe('update notice with a server of the previous generation', () => {
  it('opens again although it was dismissed, with the old-server sentence, once per page load', async () => {
    setup({ settings: { [`${MODULE_ID}.${UPDATE_NOTICE_SETTING}`]: '14.2609.4' } });
    const { api, configs } = dialog(['later', 'later']);
    await expect(showUpdateNotice(api)).resolves.toBe('skipped');
    await expect(noticePreviousServer(api)).resolves.toBe('later');
    expect(configs).toHaveLength(1);
    const html = parseHtml(String(configs[0]?.['content']));
    const sentence = html.querySelector('.mcp-update__old-server');
    expect(sentence?.hidden).toBe(false);
    expect(sentence?.textContent).toContain('previous generation is still connected');

    await expect(noticePreviousServer(api)).resolves.toBe('skipped');
    expect(configs).toHaveLength(1);
  });

  it('also opens on a fresh install, and "Done" there stores the version as usual', async () => {
    setup();
    const { api } = dialog(['done']);
    await expect(showUpdateNotice(api)).resolves.toBe('fresh');
    await expect(noticePreviousServer(api)).resolves.toBe('done');
    expect(acknowledged()).toBe('14.2609.4');
  });

  it('reveals the sentence in a notice that is already open', async () => {
    setup(UPGRADED);
    let close: ((answer: unknown) => void) | undefined;
    const configs: Array<Record<string, unknown>> = [];
    const api = {
      ApplicationV2: class {} as unknown as FoundryInterfaceApplicationClass,
      DialogV2: {
        wait: (config: Record<string, unknown>) => {
          configs.push(config);
          return new Promise<unknown>(resolve => (close = resolve));
        },
      },
    };
    const pending = showUpdateNotice(api);
    await Promise.resolve();
    const root = parseHtml(String(configs[0]?.['content']));
    expect(root.querySelector('.mcp-update__old-server')?.hidden).toBe(true);

    await expect(noticePreviousServer(api, root)).resolves.toBe('revealed');
    expect(root.querySelector('.mcp-update__old-server')?.hidden).toBe(false);
    expect(configs).toHaveLength(1);

    close?.('later');
    await expect(pending).resolves.toBe('later');
    await expect(noticePreviousServer(api, root)).resolves.toBe('skipped');
  });

  it('listens for the hook the bridge calls', async () => {
    setup({ settings: { [`${MODULE_ID}.${UPDATE_NOTICE_SETTING}`]: '14.2609.4' } });
    const { api, configs, opened } = dialog(['later']);
    foundry.setGlobal('foundry', { applications: { api } });
    listenForPreviousServer();
    foundry.hooks.callAll(PREVIOUS_SERVER_HOOK);
    await opened;
    expect(configs).toHaveLength(1);
  });
});

describe('update notice content', () => {
  it('names the zip, the setup, the restart, links the releases page in a new tab and says settings stay', () => {
    setup();
    const root = parseHtml(updateNoticeContent('14.2609.4', false));
    const text = root.textContent;
    expect(text).not.toMatch(/ninjos-foundry-mcp\.interface/);
    expect(text).toContain('ninjos-foundry-mcp-server-14.2609.4-win32-x64.zip');
    expect(text).toContain('setup.cmd');
    expect(text).toContain('Quit Claude Desktop or your MCP client completely');
    expect(text).toContain('Your world settings and permissions stay as they are.');

    const download = root.querySelector('a.mcp-update__download');
    expect(download?.getAttribute('href')).toBe(RELEASES_URL);
    expect(download?.getAttribute('target')).toBe('_blank');
    expect(download?.getAttribute('rel')).toBe('noopener');
    expect(download?.getAttribute('aria-label')).toBe('Open download page in a new tab');
    expect(download?.querySelector('i')?.getAttribute('aria-hidden')).toBe('true');
    expect(root.querySelector('section')?.getAttribute('aria-labelledby')).toBe(
      'mcp-update-heading'
    );
    expect(root.querySelector('.mcp-update__old-server')?.getAttribute('role')).toBe('alert');
  });

  it('links the installation guide in the client language', () => {
    setup();
    expect(installationGuideUrl('de')).toBe(
      'https://github.com/Niclasp1501/ninjos-foundry-mcp/blob/main/docs/INSTALLATION.md'
    );
    expect(installationGuideUrl('en')).toBe(
      'https://github.com/Niclasp1501/ninjos-foundry-mcp/blob/main/docs/INSTALLATION.en.md'
    );
    expect(installationGuideUrl('fr')).toMatch(/INSTALLATION\.en\.md$/);
  });

  it('has every text in German and English, different from each other', () => {
    const read = (code: string) =>
      JSON.parse(readFileSync(new URL(`./lang.${code}.json`, import.meta.url), 'utf8')) as {
        [MODULE_ID]: {
          interface: { updateNotice: Record<string, string> };
          settings: Record<string, { name: string; hint: string }>;
        };
      };
    const en = read('en')[MODULE_ID];
    const de = read('de')[MODULE_ID];
    expect(Object.keys(de.interface.updateNotice).sort()).toEqual(
      Object.keys(en.interface.updateNotice).sort()
    );
    for (const key of ['title', 'intro', 'oldServer', 'download', 'later', 'done']) {
      expect(de.interface.updateNotice[key], key).not.toBe(en.interface.updateNotice[key]);
    }
    expect(de.settings[UPDATE_NOTICE_SETTING]?.name).toBeTruthy();
    expect(en.settings[UPDATE_NOTICE_SETTING]?.name).toBeTruthy();
  });
});

describe('update notice decisions', () => {
  it('compares versions part by part and ignores a test suffix', () => {
    expect(compareVersions('14.2609.4', '14.2609.3')).toBeGreaterThan(0);
    expect(compareVersions('14.2609.10', '14.2609.9')).toBeGreaterThan(0);
    expect(compareVersions('13.2612.1', '14.2601.1')).toBeLessThan(0);
    expect(compareVersions('14.2609.4-test.123', '14.2609.4')).toBe(0);
  });

  it('finds traces of an earlier version in world and client storage, but not its own key', () => {
    setup({ clientKeys: [`${MODULE_ID}.${UPDATE_NOTICE_SETTING}`, 'core.language'] });
    expect(earlierVersionTraces()).toBe(false);
    foundry.uninstall();
    setup({ clientKeys: [`${MODULE_ID}.willkommenGesehen`] });
    expect(earlierVersionTraces()).toBe(true);
    foundry.uninstall();
    setup({ worldKeys: ['other-module.x', `${MODULE_ID}.serverHost`] });
    expect(earlierVersionTraces()).toBe(true);
  });

  it('decides per case', () => {
    const base = { isGM: true, acknowledged: '', currentVersion: '14.2609.4', traces: true };
    expect(decideUpdateNotice(base)).toBe('show');
    expect(decideUpdateNotice({ ...base, traces: false })).toBe('fresh');
    expect(decideUpdateNotice({ ...base, isGM: false })).toBe('skip');
    expect(decideUpdateNotice({ ...base, acknowledged: undefined })).toBe('skip');
    expect(decideUpdateNotice({ ...base, acknowledged: '14.2609.4' })).toBe('skip');
    expect(decideUpdateNotice({ ...base, acknowledged: '14.2609.3', traces: false })).toBe('show');
    expect(decideUpdateNotice({ ...base, currentVersion: undefined })).toBe('skip');
  });
});
