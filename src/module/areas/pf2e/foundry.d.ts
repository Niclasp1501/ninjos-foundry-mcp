/**
 * What the pf2e area uses of a pf2e actor beyond the core types. Global script
 * without import or export.
 */

interface FoundryPf2eConditionItem extends FoundryDocument {
  name: string;
  type: string;
  system?: unknown;
  update(changes: Record<string, unknown>): Promise<unknown>;
}

interface FoundryPf2eActor extends FoundryDocument {
  name: string;
  type: string;
  items: FoundryCollection<FoundryPf2eConditionItem>;
  increaseCondition?(
    slug: string,
    options?: { value?: number | null; max?: number }
  ): Promise<unknown>;
  decreaseCondition?(slug: string, options?: { forceRemove: boolean }): Promise<unknown>;
}
