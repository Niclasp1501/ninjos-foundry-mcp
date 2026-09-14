/**
 * A pf2e world for the tests of the pf2e area: system pf2e, a goblin, a
 * caster, a fighter, a hazard in a compendium, and actors whose
 * increaseCondition and decreaseCondition behave like pf2e's: a condition is
 * an item, a valued one is clamped to at least 1, lowering to 0 removes it.
 */
import {
  CAVE_WORM_CASTER,
  GOBLIN_WARRIOR,
  SPIKED_PIT,
  VALERIA,
} from '../../../common/areas/pf2e/sample-data.js';
import { isValued } from '../../../common/areas/pf2e/conditions.js';
import { systemDetector } from '../../../server/game-systems.js';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import {
  DEFAULT_DOCUMENT_TYPES,
  FakeFoundry,
  type FakeDocument,
  type FakeFoundryOptions,
} from '../../../testing/fake-foundry.js';

export interface Pf2eWorld {
  harness: AreaHarness;
  foundry: FakeFoundry;
  close(): void;
}

export interface Pf2eWorldOptions extends FakeFoundryOptions {
  /** Leave increaseCondition and decreaseCondition away, as on an actor of another system. */
  withoutConditionMethods?: boolean;
  /** Make increaseCondition create the condition without its value, to test the second write. */
  ignoreValueOnCreate?: boolean;
}

type Item = FakeDocument & {
  update(changes: Record<string, unknown>): Promise<unknown>;
  delete(): Promise<unknown>;
};

function define(target: FakeDocument, name: string, value: unknown): void {
  Object.defineProperty(target, name, {
    value,
    enumerable: false,
    configurable: true,
    writable: true,
  });
}

function conditionMethods(actor: FakeDocument, options: Pf2eWorldOptions): void {
  const items = () => (actor['items'] as { contents: Item[] }).contents;
  const find = (slug: string) =>
    items().find(
      item =>
        item['type'] === 'condition' &&
        (item['system'] as { slug?: string } | undefined)?.slug === slug
    );
  const create = actor['createEmbeddedDocuments'] as (
    name: string,
    data: unknown[]
  ) => Promise<unknown>;
  define(
    actor,
    'increaseCondition',
    async (slug: string, { value }: { value?: number | null } = {}) => {
      const existing = find(slug);
      const valued = isValued(slug);
      if (existing) {
        const current = (existing['system'] as { value: { value: number | null } }).value.value;
        if (current !== null)
          await existing.update({ 'system.value.value': Math.max(current + (value ?? 1), 1) });
        return existing;
      }
      const start = options.ignoreValueOnCreate ? 1 : Math.max(value ?? 1, 1);
      const name = slug.replace(/(^|-)\w/g, letter => letter.toUpperCase());
      return create.call(actor, 'Item', [
        {
          name,
          type: 'condition',
          system: {
            slug,
            value: { isValued: valued, value: valued ? start : null },
            references: { children: [], overriddenBy: [], overrides: [] },
          },
        },
      ]);
    }
  );
  define(
    actor,
    'decreaseCondition',
    async (slug: string, { forceRemove }: { forceRemove: boolean } = { forceRemove: false }) => {
      const existing = find(slug);
      if (!existing) return;
      const current = (existing['system'] as { value: { value: number | null } }).value.value;
      if (forceRemove || current === null || current <= 1) await existing.delete();
      else await existing.update({ 'system.value.value': current - 1 });
    }
  );
}

export function openPf2eWorld(options: Pf2eWorldOptions = {}): Pf2eWorld {
  const actorSpec = DEFAULT_DOCUMENT_TYPES['Actor'];
  const foundry = new FakeFoundry({
    system: { id: 'pf2e', version: '7.4.1' },
    documentTypes: {
      Actor: {
        ...actorSpec,
        extend: actor => {
          if (!options.withoutConditionMethods) conditionMethods(actor, options);
        },
      },
    },
    ...options,
  });
  foundry.setGlobal('CONFIG', {
    PF2E: {
      weaponGroups: { sword: 'Sword', knife: 'Knife' },
      rarityTraits: { common: 'Common', rare: 'Rare' },
    },
  });
  systemDetector.invalidate();
  const harness = createAreaHarness({ foundry });

  for (const actor of [GOBLIN_WARRIOR, CAVE_WORM_CASTER, VALERIA])
    foundry.seed('Actor', structuredClone(actor));
  foundry.addPack({
    id: 'pf2e.pathfinder-monster-core',
    documentName: 'Actor',
    label: 'Monster Core',
    documents: [structuredClone(GOBLIN_WARRIOR), structuredClone(CAVE_WORM_CASTER)],
  });
  foundry.addPack({
    id: 'pf2e.hazards',
    documentName: 'Actor',
    label: 'Hazards',
    documents: [structuredClone(SPIKED_PIT)],
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
