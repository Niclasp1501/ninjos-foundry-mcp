/**
 * A dnd5e world for the tests of the dnd5e area: system dnd5e 5.3.3, the dnd5e
 * setting "rulesVersion", CONFIG.DND5E.languages with labels, a goblin, a
 * wizard, and item compendiums shaped like the SRD packs.
 */
import { GOBLIN, MIRA } from '../../../common/areas/dnd5e/sample-data.js';
import { systemDetector } from '../../../server/game-systems.js';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { FakeFoundry, type FakeFoundryOptions } from '../../../testing/fake-foundry.js';

export interface Dnd5eWorldOptions extends FakeFoundryOptions {
  /** The dnd5e setting "rulesVersion". Default "legacy". */
  rulesVersion?: 'legacy' | 'modern';
  systemVersion?: string;
}

export interface Dnd5eWorld {
  harness: AreaHarness;
  foundry: FakeFoundry;
  close(): void;
}

const spell = (id: string, name: string, level: number, rules = '2014') => ({
  _id: id,
  name,
  type: 'spell',
  system: { level, method: 'spell', source: { rules } },
  _stats: { compendiumSource: null, systemVersion: '5.3.3' },
  folder: 'packFolder',
  sort: 100,
  ownership: { default: 0 },
});

export function openDnd5eWorld(options: Dnd5eWorldOptions = {}): Dnd5eWorld {
  const foundry = new FakeFoundry({
    system: { id: 'dnd5e', version: options.systemVersion ?? '5.3.3' },
    translations: {
      'DND5E.LanguagesCommon': 'Common',
      'DND5E.LanguagesGoblin': 'Goblin',
      'DND5E.LanguagesThievesCant': "Thieves' Cant",
      'DND5E.LanguagesPrimordial': 'Primordial',
      'DND5E.LanguagesAquan': 'Aquan',
    },
    ...options,
  });
  foundry.setGlobal('CONFIG', {
    DND5E: {
      languages: {
        standard: {
          label: 'DND5E.LanguagesStandard',
          selectable: false,
          children: { common: 'DND5E.LanguagesCommon', goblin: 'DND5E.LanguagesGoblin' },
        },
        exotic: {
          label: 'DND5E.LanguagesExotic',
          selectable: false,
          children: {
            primordial: {
              label: 'DND5E.LanguagesPrimordial',
              children: { aquan: 'DND5E.LanguagesAquan' },
            },
          },
        },
        cant: 'DND5E.LanguagesThievesCant',
      },
    },
  });

  systemDetector.invalidate();
  const harness = createAreaHarness({ foundry });
  (
    foundry.game.settings as { register(namespace: string, key: string, config: unknown): void }
  ).register('dnd5e', 'rulesVersion', {
    scope: 'world',
    config: true,
    type: String,
    default: options.rulesVersion ?? 'legacy',
  });

  foundry.seed('Actor', structuredClone(GOBLIN));
  foundry.seed('Actor', structuredClone(MIRA));
  foundry.addPack({
    id: 'dnd5e.spells',
    documentName: 'Item',
    label: 'Spells (SRD)',
    documents: [
      spell('fireball', 'Fireball', 3),
      spell('shield', 'Shield', 1),
      spell('firebolt', 'Fire Bolt', 0),
    ],
  });
  foundry.addPack({
    id: 'dnd5e.spells24',
    documentName: 'Item',
    label: 'Spells',
    documents: [spell('fireball24', 'Fireball', 3, '2024')],
  });
  foundry.addPack({
    id: 'dnd5e.monsterfeatures',
    documentName: 'Item',
    label: 'Monster Features (SRD)',
    documents: [
      {
        _id: 'packTactics',
        name: 'Pack Tactics',
        type: 'feat',
        system: { type: { value: 'monster' } },
      },
      {
        _id: 'bite',
        name: 'Bite',
        type: 'weapon',
        system: { type: { value: 'natural' }, proficient: 1 },
      },
      { _id: 'multi1', name: 'Multiattack', type: 'feat', system: {} },
      { _id: 'multi2', name: 'Multiattack', type: 'feat', system: {} },
    ],
  });
  foundry.addPack({
    id: 'dnd5e.classfeatures',
    documentName: 'Item',
    label: 'Class & Subclass Features (SRD)',
    documents: [
      {
        _id: 'actionSurge',
        name: 'Action Surge',
        type: 'feat',
        system: { type: { value: 'class' } },
      },
    ],
  });
  foundry.addPack({
    id: 'dnd5e.monsters',
    documentName: 'Actor',
    label: 'Monsters (SRD)',
    documents: [structuredClone(GOBLIN)],
  });

  return {
    harness,
    foundry,
    close: () => {
      harness.close();
      systemDetector.invalidate();
    },
  };
}
