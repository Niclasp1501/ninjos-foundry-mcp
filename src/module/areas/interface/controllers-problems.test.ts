/**
 * Half-good results from the packages behind the windows: an index that was
 * built but not stored, creatures that were skipped, a stored release list
 * that cannot be read. None of them may look like a plain success.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { FakeFoundry } from '../../../testing/fake-foundry.js';
import {
  CompendiumReleaseController,
  CreatureIndexController,
  EMPTY_FORM,
  moduleSettings,
} from './controllers.js';
import type { PackInfo } from './release-model.js';

let foundry: FakeFoundry;
afterEach(() => foundry?.uninstall());

const host = () => ({ refresh: () => undefined, close: () => undefined });

describe('creature index built with problems', () => {
  it('names skipped creatures and an index that was not stored', async () => {
    foundry = new FakeFoundry().install();
    const window = new CreatureIndexController(host(), {
      service: () => ({
        rebuild: async () => ({
          creatures: 90,
          packs: 2,
          failed: 3,
          storeProblem: 'upload refused',
        }),
      }),
      settings: moduleSettings,
    });
    await window.action('rebuild', EMPTY_FORM);
    expect(foundry.notifications.slice(1)).toEqual([
      { level: 'info', message: 'Creature index built: 90 creatures from 2 compendiums.' },
      { level: 'warn', message: 'Creatures skipped while building the index: 3.' },
      {
        level: 'warn',
        message:
          'The creature index was built but not stored: upload refused. It is built again on the next search.',
      },
    ]);
    expect(window.render()).toContain('mcp-window__status--error');
  });

  it('reports a clean rebuild as a plain success', async () => {
    foundry = new FakeFoundry().install();
    const window = new CreatureIndexController(host(), {
      service: () => ({
        rebuild: async () => ({ creatures: 5, packs: 1, failed: 0, storeProblem: null }),
      }),
      settings: moduleSettings,
    });
    await window.action('rebuild', EMPTY_FORM);
    expect(foundry.notifications.map(n => n.level)).toEqual(['info', 'info']);
    expect(window.render()).toContain('mcp-window__status--ok');
  });
});

describe('damaged release list', () => {
  const packs: PackInfo[] = [
    {
      id: 'world.archive',
      label: 'Archive',
      type: 'JournalEntry',
      count: 1,
      locked: false,
      packageType: 'world',
      packageName: 'world',
    },
  ];

  it('is named, and not shown as "allow all"', () => {
    foundry = new FakeFoundry().install();
    const html = new CompendiumReleaseController(host(), {
      service: () => ({
        read: () => [],
        problem: () => 'the stored text is not a list: [oops',
        write: async () => undefined,
      }),
      packs: () => packs,
      titleOf: (_kind, name) => name,
    }).render();
    expect(html).toContain('role="alert"');
    expect(html).toContain(
      'The stored release list could not be read: the stored text is not a list: [oops.'
    );
    expect(html).toMatch(/name="allowAll" data-release="all">/);
    expect(html).not.toContain('is-dimmed');
  });
});
