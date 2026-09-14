import { afterEach, describe, expect, it } from 'vitest';
import { FakeFoundry } from '../testing/fake-foundry.js';
import { changeLog, extensionTools, registeredExtensionTools } from './core-services.js';

let foundry: FakeFoundry | null = null;
afterEach(() => {
  foundry?.uninstall();
  foundry = null;
});

describe('core services', () => {
  it('can be imported without Foundry and reads settings only when asked', () => {
    // No FakeFoundry is installed here: creating the instances touched nothing.
    expect(changeLog.list()).toEqual([]);
    expect(extensionTools.releasedModules()).toEqual([]);
  });

  it('lets an area read the registered tools directly instead of through the public API', () => {
    foundry = new FakeFoundry({
      settings: { 'ninjos-foundry-mcp.toolProviderModules': 'other-module' },
    }).install();
    // The fake answers only registered settings, as Foundry does.
    game.settings.register('ninjos-foundry-mcp', 'toolProviderModules', {
      scope: 'world',
      config: false,
      type: String,
      default: '',
    } as unknown as FoundrySettingConfig);

    const result = extensionTools.registerTool('other-module', {
      name: 'other-read',
      description: 'Reads something.',
      annotations: { readOnlyHint: true },
      handler: async () => ({}),
    });
    expect(result).toEqual({ accepted: true });

    expect(registeredExtensionTools()).toEqual([
      expect.objectContaining({
        name: 'other-read',
        moduleId: 'other-module',
        annotations: { readOnlyHint: true },
      }),
    ]);
  });
});
