/**
 * The welcome window: Gamemaster only, once per device, "Don't show again"
 * respected, clicking away never counts as consent.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { MODULE_ID } from '../../../common/constants.js';
import { FakeFoundry, type FakeFoundryOptions } from '../../../testing/fake-foundry.js';
import { forgeAddress, showWelcome, WELCOME_SETTING, welcomeContent } from './welcome.js';

let foundry: FakeFoundry;
afterEach(() => foundry?.uninstall());

function setup(options: FakeFoundryOptions = {}, register = true): FakeFoundry {
  foundry = new FakeFoundry(options).install();
  if (register) {
    (
      foundry.game['settings'] as { register(ns: string, key: string, config: object): void }
    ).register(MODULE_ID, WELCOME_SETTING, { default: false, scope: 'client' });
  }
  return foundry;
}

function dialog(answer: unknown) {
  const configs: Record<string, unknown>[] = [];
  return {
    configs,
    api: {
      ApplicationV2: class {} as unknown as FoundryInterfaceApplicationClass,
      DialogV2: {
        wait: async (config: Record<string, unknown>) => {
          configs.push(config);
          return answer;
        },
      },
    },
  };
}

const seen = () =>
  (foundry.game['settings'] as { get(ns: string, key: string): unknown }).get(
    MODULE_ID,
    WELCOME_SETTING
  );

describe('welcome window', () => {
  it('remembers "Don\'t show again" and never comes back', async () => {
    setup();
    const first = dialog('nie');
    await expect(showWelcome(first.api)).resolves.toBe('never');
    expect(seen()).toBe(true);
    const second = dialog('nie');
    await expect(showWelcome(second.api)).resolves.toBe('skipped');
    expect(second.configs).toEqual([]);
  });

  it('counts "Later" and closing the window as later, never as consent', async () => {
    for (const answer of ['spaeter', null]) {
      setup();
      await expect(showWelcome(dialog(answer).api)).resolves.toBe('later');
      expect(seen()).toBe(false);
      foundry.uninstall();
    }
  });

  it('is not shown to players', async () => {
    setup({ users: [{ id: 'p', name: 'Player' }] });
    const { api, configs } = dialog('nie');
    await expect(showWelcome(api)).resolves.toBe('skipped');
    expect(configs).toEqual([]);
  });

  it('is not shown when there is nowhere to remember the answer', async () => {
    setup({}, false);
    const { api, configs } = dialog('nie');
    await expect(showWelcome(api)).resolves.toBe('skipped');
    expect(configs).toEqual([]);
  });

  it('is a dialog with the module class, two buttons and no rejection on close', async () => {
    setup();
    const { api, configs } = dialog('spaeter');
    await showWelcome(api);
    const config = configs[0] as {
      classes: string[];
      rejectClose: boolean;
      buttons: Array<{ action: string; label: string }>;
    };
    expect(config.classes).toContain(MODULE_ID);
    expect(config.rejectClose).toBe(false);
    expect(config.buttons.map(button => [button.action, button.label])).toEqual([
      ['nie', "Don't show again"],
      ['spaeter', 'Later'],
    ]);
  });

  it('shows texts, never raw keys, and links the Forge in the reader language', () => {
    setup();
    const html = welcomeContent();
    expect(html).not.toMatch(/MCP\.Willkommen/);
    expect(html).toContain('More modules and web tools by Ninjo');
    expect(html).toContain('aria-hidden="true"');
    expect(forgeAddress('en')).toBe('https://ninjos-forge.web.app/en/modules/foundry-mcp');
    expect(forgeAddress('de')).toBe('https://ninjos-forge.web.app/modules/foundry-mcp');
  });
});
