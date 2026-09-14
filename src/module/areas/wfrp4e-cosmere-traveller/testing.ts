/**
 * Worlds of the three systems for the tests of the wfrp4e-cosmere-traveller area: each with its
 * system id, sample actors from sample-data.ts, and compendiums shaped like
 * those of the system.
 */
import {
  COSMERE_CHASMFIEND,
  COSMERE_SHARDBEARER,
  TRAVELLER_KESSA,
  TRAVELLER_KIAN,
  WFRP_BRUNHILDE,
  WFRP_CORE_ITEMS,
  WFRP_GIANT_RAT,
  WFRP_OTHER_ITEMS,
} from '../../../common/areas/wfrp4e-cosmere-traveller/sample-data.js';
import { systemDetector } from '../../../server/game-systems.js';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { FakeFoundry, type FakeFoundryOptions } from '../../../testing/fake-foundry.js';

export type SystemKind = 'wfrp4e' | 'cosmere' | 'traveller';

export interface SystemWorld {
  harness: AreaHarness;
  foundry: FakeFoundry;
  close(): void;
}

const SYSTEMS: Record<SystemKind, { id: string; version: string }> = {
  wfrp4e: { id: 'wfrp4e', version: '9.3.0' },
  cosmere: { id: 'cosmere-rpg', version: '2.1.0' },
  traveller: { id: 'mgt2e', version: '0.22.2' },
};

export function openSystemWorld(kind: SystemKind, options: FakeFoundryOptions = {}): SystemWorld {
  const foundry = new FakeFoundry({ system: SYSTEMS[kind], ...options });
  systemDetector.invalidate();
  const harness = createAreaHarness({ foundry });
  const copy = <T>(value: T): T => structuredClone(value);

  if (kind === 'wfrp4e') {
    foundry.seed('Actor', copy(WFRP_BRUNHILDE));
    foundry.addPack({
      id: 'homebrew.items',
      documentName: 'Item',
      label: 'Homebrew Items',
      documents: copy(WFRP_OTHER_ITEMS),
    });
    foundry.addPack({
      id: 'wfrp4e-core.items',
      documentName: 'Item',
      label: 'Core Items',
      documents: copy(WFRP_CORE_ITEMS),
    });
    foundry.addPack({
      id: 'wfrp4e-core.bestiary',
      documentName: 'Actor',
      label: 'Core Bestiary',
      documents: [copy(WFRP_GIANT_RAT)],
    });
  } else if (kind === 'cosmere') {
    foundry.seed('Actor', copy(COSMERE_SHARDBEARER));
    foundry.addPack({
      id: 'cosmere-rpg.adversaries',
      documentName: 'Actor',
      label: 'Adversaries',
      documents: [copy(COSMERE_CHASMFIEND), copy(COSMERE_SHARDBEARER)],
    });
  } else {
    foundry.seed('Actor', copy(TRAVELLER_KESSA));
    foundry.addPack({
      id: 'world.creatures',
      documentName: 'Actor',
      label: 'Creatures',
      documents: [copy(TRAVELLER_KIAN), copy(TRAVELLER_KESSA)],
    });
  }

  return {
    harness,
    foundry,
    close: () => {
      harness.close();
      systemDetector.invalidate();
    },
  };
}
