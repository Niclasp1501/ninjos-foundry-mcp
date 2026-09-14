import { afterEach, describe, expect, it } from 'vitest';
import { SystemAdapterRegistry, type SystemAdapter } from '../common/game-systems.js';
import { FakeFoundry } from '../testing/fake-foundry.js';
import { installAreaAdapters, type ModuleArea } from './areas.js';
import { QueryError } from './dispatcher.js';
import {
  activeGameSystem,
  moduleSystemAdapters,
  requireGameSystem,
  requireSystemQuestions,
  systemAnswer,
} from './game-systems.js';

let foundry: FakeFoundry | null = null;
const removers: Array<() => void> = [];
afterEach(() => {
  foundry?.uninstall();
  foundry = null;
  for (const remove of removers.splice(0)) remove();
});

const sample: SystemAdapter = {
  id: 'sample',
  title: 'Sample System',
  spells: { itemTypes: ['power'], entries: () => [] },
};

describe('game systems in the module', () => {
  it('reads the system of the world on every call', () => {
    foundry = new FakeFoundry({ system: { id: 'Homebrew', version: '0.9' } }).install();
    expect(activeGameSystem()).toMatchObject({
      id: 'homebrew',
      rawId: 'Homebrew',
      version: '0.9',
      adapter: null,
    });
    foundry.game.system = { id: 'sample', version: '1' };
    removers.push(moduleSystemAdapters.register(sample, 'test'));
    expect(activeGameSystem()).toMatchObject({ id: 'sample', title: 'Sample System' });
  });

  it('refuses with a query error code the server passes on', () => {
    foundry = new FakeFoundry({ system: { id: 'homebrew', version: '1' } }).install();
    let caught: unknown;
    try {
      requireSystemQuestions('spells', 'Reading spells');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(QueryError);
    expect(caught).toMatchObject({ code: 'SYSTEM_NOT_SUPPORTED' });
    expect(() => requireGameSystem('sample', 'sample-tool')).toThrow(
      /Detected game system: "homebrew"/
    );
    expect(systemAnswer('spells')).toMatchObject({ fromAdapter: false });
  });

  it('installs the adapters of the areas and names both owners on a clash', () => {
    const registry = new SystemAdapterRegistry();
    const areas: ModuleArea[] = [
      { id: 'one', adapters: [sample] },
      { id: 'two', adapters: [{ id: 'SAMPLE', title: 'Other' }] },
    ];
    expect(() => installAreaAdapters(areas, registry)).toThrow(
      'The game system adapter "SAMPLE" of area "two" is already registered by area "one"'
    );
  });
});
