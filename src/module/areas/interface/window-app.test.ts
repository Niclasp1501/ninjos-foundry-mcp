/**
 * The Foundry side of the windows, with a stand-in for ApplicationV2: the
 * three settings entries, the window title, the Gamemaster check, and how
 * the form is read (flat, by value, never expanded at dots).
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { MODULE_ID } from '../../../common/constants.js';
import { FakeFoundry } from '../../../testing/fake-foundry.js';
import { interfaceArea } from './index.js';
import { clearInterfaceServices } from './services.js';
import { defineWindow, readForm, registerInterfaceMenus, windowSpecs } from './window-app.js';

class FakeApplication {
  static DEFAULT_OPTIONS = {};
  readonly options: Record<string, unknown>;
  readonly element = { querySelector: () => null, querySelectorAll: () => [] };
  rendered = true;
  position = {};
  renders = 0;
  constructor(options: Record<string, unknown> = {}) {
    this.options = options;
  }
  async render() {
    this.renders += 1;
    return this;
  }
  async close() {
    return this;
  }
  setPosition() {
    return undefined;
  }
  async _renderHTML() {
    return '';
  }
  _replaceHTML() {}
  _onRender() {}
}

const api = {
  ApplicationV2: FakeApplication as unknown as FoundryInterfaceApplicationClass,
  DialogV2: { wait: async () => null },
};

interface Menu {
  key: string;
  config: FoundryInterfaceMenuConfig;
}

let foundry: FakeFoundry;
afterEach(() => {
  foundry?.uninstall();
  clearInterfaceServices();
});

function setupWithMenus(): Menu[] {
  foundry = new FakeFoundry({
    users: [
      { id: 'gm', name: 'Gamemaster', isGM: true },
      { id: 'p1', name: 'Player' },
    ],
  }).install();
  const menus: Menu[] = [];
  (foundry.game['settings'] as Record<string, unknown>)['registerMenu'] = (
    namespace: string,
    key: string,
    config: FoundryInterfaceMenuConfig
  ) => {
    expect(namespace).toBe(MODULE_ID);
    menus.push({ key, config });
  };
  return menus;
}

type TestWindow = FakeApplication & {
  _renderHTML(): Promise<unknown>;
  runAction(name: string): Promise<void>;
};

describe('settings entries', () => {
  it('registers three windows for the Gamemaster only, with texts that exist in both languages', () => {
    const menus = setupWithMenus();
    expect(registerInterfaceMenus(api)).toBe(true);
    expect(menus.map(menu => menu.key)).toEqual([
      'creatureIndexMenu',
      'compendiumReleaseMenu',
      'mapGenerationMenu',
    ]);
    for (const code of ['en', 'de']) {
      const text = readFileSync(new URL(`./lang.${code}.json`, import.meta.url), 'utf8');
      const lang = JSON.parse(text) as Record<
        string,
        Record<string, Record<string, Record<string, Record<string, string>>>>
      >;
      for (const { config } of menus) {
        expect(config.restricted).toBe(true);
        const [, , menu, name] = config.name.split('.');
        const entry = lang[MODULE_ID]?.['interface']?.[menu ?? '']?.[name ?? ''];
        expect(entry?.['name'], `${code} ${config.name}`).toBeTruthy();
        expect(entry?.['label'], `${code} ${config.label}`).toBeTruthy();
        expect(entry?.['hint'], `${code} ${config.hint}`).toBeTruthy();
      }
    }
  });

  it('does nothing outside Foundry', () => {
    foundry = new FakeFoundry().install();
    expect(registerInterfaceMenus(undefined)).toBe(false);
  });
});

describe('window class', () => {
  it('carries the module class for the window fitting, a width from the description and a translated title', () => {
    setupWithMenus();
    const widths = windowSpecs().map(spec => {
      const Window = defineWindow(api, spec) as unknown as typeof FakeApplication & {
        DEFAULT_OPTIONS: {
          classes: string[];
          position: { width: number; height: string };
          window: { resizable: boolean };
        };
      };
      const options = Window.DEFAULT_OPTIONS;
      expect(options.classes).toContain(MODULE_ID);
      expect(options.position.height).toBe('auto');
      expect(options.window.resizable).toBe(true);
      return options.position.width;
    });
    expect(widths).toEqual([560, 620, 560]);

    const spec = windowSpecs()[0];
    if (!spec) throw new Error('no spec');
    const Window = defineWindow(api, spec);
    const opened = new Window() as unknown as TestWindow;
    expect((opened.options['window'] as { title: string }).title).toBe('Creature index');
  });

  it('shows a player only that the window is for the Gamemaster, and runs no action', async () => {
    setupWithMenus();
    const spec = windowSpecs()[0];
    if (!spec) throw new Error('no spec');
    const window = new (defineWindow(api, spec))() as unknown as TestWindow;
    expect(await window._renderHTML()).toContain('mcp-creature-index');

    foundry.setUser('Player');
    expect(await window._renderHTML()).toContain('Only a Gamemaster can use this window.');
    await window.runAction('rebuild');
    expect(foundry.notifications).toEqual([]);
    expect(window.renders).toBe(0);
  });
});

describe('readForm', () => {
  it('reads boxes, lists and selects flat by name and value, ids with dots as they are', () => {
    const root = {
      querySelectorAll: () => [
        { name: 'allowAll', type: 'checkbox', checked: true, value: 'on', dataset: {} },
        {
          name: 'pack',
          type: 'checkbox',
          checked: true,
          value: 'my-mod.npc.v2',
          dataset: { list: 'pack' },
        },
        {
          name: 'pack',
          type: 'checkbox',
          checked: false,
          value: 'world.archive',
          dataset: { list: 'pack' },
        },
        { name: 'mapGenQuality', type: 'select-one', value: 'high' },
      ],
    } as unknown as ParentNode;
    expect(readForm(root)).toEqual({
      flags: { allowAll: true },
      values: { mapGenQuality: 'high' },
      lists: { pack: ['my-mod.npc.v2'] },
    });
  });
});

describe('the area', () => {
  it('brings the welcome switch per device, hidden from the list, and no queries', () => {
    expect(interfaceArea.queries).toEqual([]);
    expect(interfaceArea.settings).toEqual([
      { key: 'willkommenGesehen', kind: Boolean, initial: false, listed: false, scope: 'client' },
    ]);
  });

  it('does not wait at ready for the welcome window to be closed', async () => {
    foundry = new FakeFoundry().install();
    (
      foundry.game['settings'] as { register(ns: string, key: string, config: object): void }
    ).register(MODULE_ID, 'willkommenGesehen', { default: false });
    foundry.setGlobal('foundry', {
      applications: {
        api: {
          ApplicationV2: FakeApplication,
          DialogV2: { wait: () => new Promise(() => undefined) },
        },
      },
    });
    const result = interfaceArea.ready?.();
    expect(result).toBeUndefined();
  });
});
