import { afterEach, describe, expect, it } from 'vitest';
import { MODULE_ID } from '../../../common/constants.js';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { FakeFoundry, type FakeFoundryOptions } from '../../../testing/fake-foundry.js';

let harness: AreaHarness | null = null;
afterEach(() => {
  harness?.close();
  harness = null;
});

const open = (options: FakeFoundryOptions = {}) =>
  (harness = createAreaHarness({ foundry: new FakeFoundry(options) }));

describe('getPermissions', () => {
  it('shows the switch and all seven kinds with the defaults', async () => {
    const answer = (await open().query('getPermissions')) as {
      writeOperationsEnabled: boolean;
      kinds: Array<{ document: string; canCreate: boolean; canDelete: boolean }>;
    };
    expect(answer.writeOperationsEnabled).toBe(true);
    expect(answer.kinds.map(k => k.document)).toEqual([
      'Scenes',
      'Playlists',
      'Journals',
      'RollTables',
      'Actors',
      'Folders',
      'Compendiums',
    ]);
    expect(answer.kinds.every(k => k.canCreate && !k.canDelete)).toBe(true);
  });

  it('takes the switch into account', async () => {
    const answer = (await open({
      settings: {
        [`${MODULE_ID}.allowWriteOperations`]: false,
        [`${MODULE_ID}.permPlaylists`]: 'full',
      },
    }).query('getPermissions')) as {
      kinds: Array<{ document: string; level: string; canDelete: boolean }>;
    };
    const playlists = answer.kinds.find(k => k.document === 'Playlists');
    expect(playlists).toMatchObject({ level: 'full', canDelete: false });
  });

  it('shows the modules released for tools and the tools they registered', async () => {
    const h = open({
      settings: { [`${MODULE_ID}.toolProviderModules`]: 'shops, wheel' },
      modules: [{ id: MODULE_ID }],
    });
    const module = (h.foundry.game['modules'] as { get(id: string): Record<string, unknown> }).get(
      MODULE_ID
    );
    module['api'] = {
      listTools: () => [
        { name: 'shop-list', moduleId: 'shops', annotations: { readOnlyHint: true } },
        { name: 'shop-buy', moduleId: 'shops' },
      ],
    };
    const answer = (await h.query('getPermissions')) as { extensionTools: unknown };
    expect(answer.extensionTools).toEqual({
      setting: 'toolProviderModules',
      legacySetting: 'werkzeugModule',
      releasedModules: ['shops', 'wheel'],
      registeredTools: [
        { name: 'shop-list', moduleId: 'shops', readOnly: true },
        { name: 'shop-buy', moduleId: 'shops', readOnly: false },
      ],
    });
  });

  it('reads the compendium release list when the setting exists', async () => {
    const h = open({
      settings: { [`${MODULE_ID}.writableCompendiums`]: 'world.archive, my-module' },
    });
    // The compendiums area registers the setting; registering it here keeps this test independent of it.
    const settings = h.foundry.game['settings'] as {
      register(namespace: string, key: string, config: Record<string, unknown>): void;
    };
    settings.register(MODULE_ID, 'writableCompendiums', { default: '' });
    const answer = (await h.query('getPermissions')) as { compendiumReleaseList: unknown };
    expect(answer.compendiumReleaseList).toEqual({
      setting: 'writableCompendiums',
      mode: 'listed',
      entries: ['world.archive', 'my-module'],
      problem: null,
    });
  });
});
