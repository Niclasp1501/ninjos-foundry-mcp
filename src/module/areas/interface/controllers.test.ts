/**
 * The three settings windows without a browser: what they show when the
 * package behind them is missing, what they store, and which message
 * appears. Never a silent click.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { MODULE_ID } from '../../../common/constants.js';
import { FakeFoundry } from '../../../testing/fake-foundry.js';
import {
  CompendiumReleaseController,
  CreatureIndexController,
  EMPTY_FORM,
  MapGenerationController,
  moduleSettings,
  type FormSnapshot,
} from './controllers.js';
import type { PackInfo } from './release-model.js';
import {
  clearInterfaceServices,
  InterfaceServiceError,
  provideInterfaceService,
  type CompendiumReleaseService,
  type MapService,
} from './services.js';

let foundry: FakeFoundry;
afterEach(() => {
  foundry?.uninstall();
  clearInterfaceServices();
});

function setup(): FakeFoundry {
  foundry = new FakeFoundry().install();
  return foundry;
}

function register(key: string, initial: unknown): void {
  (
    foundry.game['settings'] as { register(ns: string, key: string, config: object): void }
  ).register(MODULE_ID, key, { default: initial });
}

function host() {
  const state = {
    refreshes: 0,
    closes: 0,
    refresh: () => void state.refreshes++,
    close: () => void state.closes++,
  };
  return state;
}

const form = (partial: Partial<FormSnapshot>): FormSnapshot => ({ ...EMPTY_FORM, ...partial });

describe('window "Creature index"', () => {
  it('says the service is missing and disables its controls, instead of doing nothing on a click', async () => {
    setup();
    const h = host();
    const window = new CreatureIndexController(h);
    const html = window.render();
    expect(html).toContain(
      'Not available yet: the creature index comes with the compendium tools.'
    );
    expect(html).toMatch(/data-action="rebuild" disabled/);
    expect(html).toMatch(/data-action="save" disabled/);

    await window.action('rebuild', EMPTY_FORM);
    expect(window.render()).toContain('mcp-window__status--error');
    expect(foundry.notifications).toEqual([]);
  });

  it('reports the start, the end and the numbers of a rebuild, in the window and as a message', async () => {
    setup();
    let calls = 0;
    provideInterfaceService('creatureIndex', {
      rebuild: async () => {
        calls += 1;
        return { creatures: 812, packs: 4 };
      },
    });
    const window = new CreatureIndexController(host());
    const first = window.action('rebuild', EMPTY_FORM);
    await window.action('rebuild', EMPTY_FORM); // a second click while busy does nothing
    await first;
    expect(calls).toBe(1);
    expect(foundry.notifications).toEqual([
      { level: 'info', message: 'Rebuilding the creature index.' },
      { level: 'info', message: 'Creature index built: 812 creatures from 4 compendiums.' },
    ]);
    expect(window.render()).toContain('Creature index built: 812 creatures from 4 compendiums.');
  });

  it('shows the cause when the rebuild fails', async () => {
    setup();
    const window = new CreatureIndexController(host(), {
      service: () => ({
        rebuild: async () => {
          throw new Error('the world folder is read only');
        },
      }),
      settings: moduleSettings,
    });
    await window.action('rebuild', EMPTY_FORM);
    expect(foundry.notifications.at(-1)).toEqual({
      level: 'error',
      message: 'The creature index could not be built: the world folder is read only',
    });
  });

  it('stores both settings, reads them back and stays open', async () => {
    setup();
    register('enableEnhancedCreatureIndex', true);
    register('autoRebuildIndex', true);
    const h = host();
    const window = new CreatureIndexController(h);
    expect(window.render()).not.toContain('these settings come with the compendium tools.');
    await window.action(
      'save',
      form({ flags: { enableEnhancedCreatureIndex: false, autoRebuildIndex: true } })
    );
    expect(moduleSettings.read('enableEnhancedCreatureIndex')).toBe(false);
    expect(moduleSettings.read('autoRebuildIndex')).toBe(true);
    expect(foundry.notifications).toEqual([
      { level: 'info', message: 'Creature index settings saved.' },
    ]);
    expect(h.closes).toBe(0);
  });

  it('reports a setting that did not stick as an error', async () => {
    setup();
    const stored: Record<string, unknown> = {
      enableEnhancedCreatureIndex: true,
      autoRebuildIndex: true,
    };
    const window = new CreatureIndexController(host(), {
      service: () => undefined,
      settings: { read: key => stored[key], write: async () => undefined },
    });
    await window.action('save', form({ flags: { enableEnhancedCreatureIndex: false } }));
    expect(foundry.notifications.at(-1)?.level).toBe('error');
    expect(foundry.notifications.at(-1)?.message).toContain('enableEnhancedCreatureIndex');
  });
});

describe('window "Release compendiums"', () => {
  const packs: PackInfo[] = [
    {
      id: 'world.archive',
      label: 'Archive',
      type: 'JournalEntry',
      count: 5,
      locked: false,
      packageType: 'world',
      packageName: 'world',
    },
    {
      id: 'my-mod.npc.v2',
      label: '<b>NPCs</b>',
      type: 'Actor',
      count: 7,
      locked: true,
      packageType: 'module',
      packageName: 'my-mod',
    },
  ];

  function release(initial: string[], options: { sticky?: boolean } = {}) {
    let stored = [...initial];
    const writes: string[][] = [];
    const service: CompendiumReleaseService = {
      read: () => stored,
      write: async entries => {
        writes.push([...entries]);
        if (options.sticky !== false) stored = [...entries];
      },
    };
    return { service, writes };
  }

  it('says the release list is missing and disables every box', () => {
    setup();
    const html = new CompendiumReleaseController(host(), {
      service: () => undefined,
      packs: () => packs,
      titleOf: (_kind, name) => name,
    }).render();
    expect(html).toContain('the release list comes with the compendium tools.');
    expect(html).toMatch(/value="world\.archive" aria-label="Release Archive" disabled/);
  });

  it('shows the stored selection ticked, escapes labels, and names the lock', () => {
    setup();
    const { service } = release(['my-mod.npc.v2']);
    const html = new CompendiumReleaseController(host(), {
      service: () => service,
      packs: () => packs,
      titleOf: () => 'My Module',
    }).render();
    expect(html).toMatch(
      /value="my-mod\.npc\.v2" aria-label="Release &lt;b&gt;NPCs&lt;\/b&gt;" checked/
    );
    expect(html).not.toContain('<b>NPCs</b>');
    expect(html).toMatch(/name="allowAll" data-release="all">/);
    expect(html).toContain('<legend>My Module</legend>');
    expect(html).toContain('<th scope="col">Release</th>');
    expect(html).toContain('fa-lock" aria-hidden="true"></i> locked');
  });

  it('stores exactly the ticked selection, reports the count and closes', async () => {
    setup();
    const { service, writes } = release([]);
    const h = host();
    const window = new CompendiumReleaseController(h, {
      service: () => service,
      packs: () => packs,
      titleOf: () => '',
    });
    await window.action(
      'save',
      form({ flags: { allowAll: true }, lists: { pack: ['my-mod.npc.v2'] } })
    );
    expect(writes).toEqual([['my-mod.npc.v2']]);
    expect(foundry.notifications).toEqual([
      { level: 'info', message: 'Release list saved, entries: 1.' },
    ]);
    expect(h.closes).toBe(1);
  });

  it('stores an empty list when nothing is ticked and says what that means', async () => {
    setup();
    const { service, writes } = release(['world.archive']);
    const h = host();
    await new CompendiumReleaseController(h, {
      service: () => service,
      packs: () => packs,
      titleOf: () => '',
    }).action('save', form({ flags: { allowAll: true } }));
    expect(writes).toEqual([[]]);
    expect(foundry.notifications[0]?.message).toContain('every compendium that is not locked');
    expect(h.closes).toBe(1);
  });

  it('stays open with an error when the stored list is not the chosen one', async () => {
    setup();
    const { service } = release(['world.archive'], { sticky: false });
    const h = host();
    const window = new CompendiumReleaseController(h, {
      service: () => service,
      packs: () => packs,
      titleOf: () => '',
    });
    await window.action('save', form({ lists: { pack: ['my-mod.npc.v2'] } }));
    expect(h.closes).toBe(0);
    expect(foundry.notifications).toEqual([
      {
        level: 'error',
        message:
          'The release list was not saved: The release list was not stored as chosen. Stored now: world.archive',
      },
    ]);
  });
});

describe('window "Map generation"', () => {
  function service(overrides: Partial<MapService> = {}): MapService {
    return {
      status: async () => ({ state: 'stopped' }),
      start: async () => ({ state: 'running' }),
      stop: async () => ({ state: 'stopped', detail: 'ComfyUI service stopped successfully' }),
      ...overrides,
    };
  }

  function map(mapService: MapService | undefined, h = host()) {
    return new MapGenerationController(h, { service: () => mapService, settings: moduleSettings });
  }

  it('without the map package: every service button disabled and a clear note', () => {
    setup();
    const html = map(undefined).render();
    expect(html).toContain('the map service comes with the map generator.');
    expect(html).toMatch(/data-action="check" disabled/);
    expect(html).toMatch(/data-action="start" disabled/);
    expect(html).toContain('these settings come with the map generator.');
  });

  it('checks the service when it opens and shows the state', async () => {
    setup();
    const window = map(service({ status: async () => ({ state: 'running' }) }));
    window.opened();
    await new Promise(resolve => setTimeout(resolve, 0));
    const html = window.render();
    expect(html).toContain('<strong>State:</strong> running');
    expect(html).toMatch(/data-action="start" disabled/);
    expect(foundry.notifications).toEqual([]);
  });

  it('cannot start a generator that is switched off on the server', async () => {
    setup();
    const window = map(service({ status: async () => ({ state: 'disabled' }) }));
    await window.action('check', EMPTY_FORM);
    const html = window.render();
    expect(html).toMatch(/data-action="start" disabled/);
    expect(html).toMatch(/data-action="stop" disabled/);
    expect(html).toContain('COMFYUI_ENABLED=true');
  });

  it('reports a service that already runs', async () => {
    setup();
    await map(service({ start: async () => ({ state: 'running', alreadyRunning: true }) })).action(
      'start',
      EMPTY_FORM
    );
    expect(foundry.notifications.map(n => n.message)).toEqual([
      'Starting the map service.',
      'The map service is already running.',
    ]);
  });

  it('warns when the bridge to the server is missing', async () => {
    setup();
    const window = map(
      service({
        start: async () => {
          throw new InterfaceServiceError('BRIDGE_MISSING', 'not connected');
        },
      })
    );
    await window.action('start', EMPTY_FORM);
    expect(foundry.notifications.at(-1)).toEqual({
      level: 'warn',
      message:
        'The MCP server is not connected, so the map service cannot be controlled from here.',
    });
    expect(window.render()).toContain('mcp-mapgen__state--error');
  });

  it('shows the words of the server after stopping, and a start that failed as an error', async () => {
    setup();
    await map(service()).action('stop', EMPTY_FORM);
    expect(foundry.notifications.at(-1)?.message).toBe(
      'Map service: ComfyUI service stopped successfully'
    );
    await map(
      service({ start: async () => ({ state: 'error', detail: 'ComfyUI installation not found' }) })
    ).action('start', EMPTY_FORM);
    expect(foundry.notifications.at(-1)).toEqual({
      level: 'error',
      message: 'The map service did not start: ComfyUI installation not found',
    });
  });

  it('applies autostart and quality, refuses an unknown quality, and stays open', async () => {
    setup();
    register('mapGenAutoStart', false);
    register('mapGenQuality', 'low');
    const h = host();
    const window = map(undefined, h);
    await window.action(
      'apply',
      form({ flags: { mapGenAutoStart: true }, values: { mapGenQuality: 'high' } })
    );
    expect(moduleSettings.read('mapGenAutoStart')).toBe(true);
    expect(moduleSettings.read('mapGenQuality')).toBe('high');
    await window.action(
      'apply',
      form({ flags: { mapGenAutoStart: true }, values: { mapGenQuality: 'ultra' } })
    );
    expect(moduleSettings.read('mapGenQuality')).toBe('high');
    expect(foundry.notifications.map(n => n.message)).toEqual([
      'Map generation settings saved.',
      'Map generation settings saved.',
    ]);
    expect(h.closes).toBe(0);
    expect(window.render()).toContain('<option value="high" selected>');
  });
});
