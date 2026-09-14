/**
 * A dsa5 world for the tests of the dsa5 area: system dsa5 8.1.5, the hero
 * Alrik with skills, weapons, a spell and a level 2 condition, a wolf, a
 * scene with Alrik's linked token, the conditions of CONFIG.statusEffects in
 * the shape of config-dsa5.js, a roll class with dice, and two actor
 * compendiums: archetypes of the dsa5 system and a world compendium.
 */
import { ALRIK, ARCHETYPES, WOLF } from '../../../common/areas/dsa5/sample-data.js';
import { systemDetector } from '../../../server/game-systems.js';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { FakeFoundry, type FakeFoundryOptions } from '../../../testing/fake-foundry.js';
import { withCombatRolls, type CombatRollsFake } from '../combat-rolls/testing.js';
import { withTokensDice } from '../tokens-dice/testing.js';

export const DSA5_STATUS_EFFECTS = [
  { id: 'dead', name: 'CONDITION.defeated', img: 'icons/svg/skull.svg' },
  {
    id: 'inpain',
    name: 'CONDITION.inpain',
    img: 'icons/svg/blood.svg',
    system: {
      condition: { value: 1, max: 4 },
      changes: [{ key: 'system.condition.inpain', type: 'add', value: 1 }],
    },
  },
  { id: 'prone', name: 'CONDITION.prone', img: 'icons/svg/falling.svg' },
];

export interface Dsa5World {
  harness: AreaHarness;
  foundry: FakeFoundry;
  rolls: CombatRollsFake;
  close(): void;
}

export function openDsa5World(options: FakeFoundryOptions = {}): Dsa5World {
  const foundry = new FakeFoundry({
    system: { id: 'dsa5', version: '8.1.5' },
    translations: { 'CONDITION.inpain': 'Schmerz', 'CONDITION.prone': 'Liegend' },
    ...options,
  });
  withTokensDice(foundry, { statusEffects: DSA5_STATUS_EFFECTS });
  const rolls = withCombatRolls(foundry, { totals: [7] });
  foundry.setGlobal('CONFIG', {
    statusEffects: DSA5_STATUS_EFFECTS,
    Combat: { initiative: { formula: '1d6' } },
    DSA5: { skillGroups: { body: 'SKILL.body' } },
  });

  systemDetector.invalidate();
  const harness = createAreaHarness({ foundry });

  foundry.seed('Actor', structuredClone(ALRIK));
  foundry.seed('Actor', structuredClone(WOLF));
  foundry.seed('Scene', {
    _id: 'scene1',
    name: 'Gareth',
    active: true,
    tokens: [{ _id: 'tok1', name: 'Alrik', x: 0, y: 0, actorId: ALRIK._id, actorLink: true }],
  });
  foundry.addPack({
    id: 'dsa5-core.archetypes',
    documentName: 'Actor',
    label: 'Archetypen',
    system: 'dsa5',
    documents: structuredClone(ARCHETYPES),
  });
  foundry.addPack({
    id: 'world.heroes',
    documentName: 'Actor',
    label: 'Eigene Helden',
    documents: [
      { ...structuredClone(ARCHETYPES[1]), _id: 'ownHero00000001', name: 'Eigener Held' },
    ],
  });

  return {
    harness,
    foundry,
    rolls,
    close: () => {
      harness.close();
      systemDetector.invalidate();
    },
  };
}
