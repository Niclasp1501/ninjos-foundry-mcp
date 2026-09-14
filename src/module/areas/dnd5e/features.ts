/**
 * The five named features of dnd5e-add-feature: passive, save, attack,
 * attack-with-save and aura. One handler per query name of the previous
 * generation, all built the same way:
 *
 * system, arguments of the featureType, the actor by the one lookup rule of
 * the actors area, no item of the same name (ignoring case), the item with its
 * activities, one embedded create, and a read back of what was written.
 */
import {
  buildFeatureItem,
  checkFeatureArguments,
  type FeatureType,
} from '../../../common/areas/dnd5e/feature-data.js';
import { isRecord } from '../../../common/areas/dnd5e/rules.js';
import { QueryError, type QueryHandler } from '../../dispatcher.js';
import { mismatches, textOf } from '../actors/common.js';
import { findActor } from '../actors/lookup.js';
import {
  abilityScores,
  callData,
  duplicateItem,
  invalid,
  itemNamed,
  requireBuildableActor,
  requireDnd5e,
  worldRules,
} from './common.js';

const TOOL = 'dnd5e-add-feature';

export function featureHandler(mode: FeatureType, query: string): QueryHandler {
  return {
    access: { kind: 'write', document: 'Actors', action: 'update' },
    run: async (data, context) => {
      requireDnd5e(TOOL);
      const input = callData(data);
      if (input['featureType'] === undefined) input['featureType'] = mode;
      if (input['featureType'] !== mode) {
        throw invalid(`The query ${query} adds a "${mode}" feature`, [
          `featureType is ${JSON.stringify(input['featureType'])}`,
        ]);
      }
      const check = checkFeatureArguments(input);
      if (check.problems.length) throw invalid(`Cannot add the ${mode} feature`, check.problems);

      const match = findActor(textOf(input['actorIdentifier']));
      const actor = match.actor;
      requireBuildableActor(actor, TOOL);
      const name = textOf(input['featureName']);
      const existing = itemNamed(actor, name);
      if (existing) throw duplicateItem(actor, name, existing);

      const build = buildFeatureItem(input, {
        abilities: abilityScores(actor),
        worldRules: worldRules(),
      });
      if (build.problems.length)
        throw invalid(`Cannot add the ${mode} feature "${name}"`, build.problems);

      const [created] = await actor.createEmbeddedDocuments('Item', [build.item]);
      const item = created ? actor.items.get(created.id) : undefined;
      if (!item) {
        throw new QueryError(
          'NOT_CREATED',
          `Foundry did not add "${name}" to actor "${actor.name}" (id ${actor.id}): no item came back.`
        );
      }

      const stored = item.toObject();
      const written = isRecord(build.item['system']) ? build.item['system'] : {};
      const storedSystem = isRecord(stored['system']) ? stored['system'] : {};
      const activities = isRecord(written['activities'])
        ? Object.keys(written['activities']).length
        : 0;
      const storedActivities = isRecord(storedSystem['activities'])
        ? Object.keys(storedSystem['activities']).length
        : 0;
      const differences = mismatches(written, storedSystem).map(entry => ({
        ...entry,
        path: `system.${entry.path}`,
      }));
      if (storedActivities !== activities) {
        differences.push({
          path: 'system.activities',
          written: activities,
          stored: storedActivities,
        });
      }

      context.recordChange({
        query,
        tool: TOOL,
        document: 'Actors',
        action: 'update',
        targets: [
          { id: actor.id, uuid: actor.uuid, name: actor.name, documentName: 'Actor' },
          { id: item.id, uuid: item.uuid, name: item.name, documentName: 'Item' },
        ],
        summary: `Added the ${mode} feature "${item.name}" (${item.type}) to actor "${actor.name}".`,
        after: stored,
      });

      return {
        success: true,
        summary: `Added "${item.name}" (${mode}) to "${actor.name}".`,
        actor: {
          id: actor.id,
          name: actor.name,
          via: match.via,
          ...(match.token ? { token: match.token } : {}),
        },
        item: { id: item.id, name: item.name, type: item.type, activities: storedActivities },
        details: build.details,
        warnings: build.warnings,
        ignoredParameters: check.ignored,
        mismatches: differences,
      };
    },
  };
}

export const FEATURE_QUERIES: ReadonlyArray<{ name: string; mode: FeatureType }> = [
  { name: 'addPassiveFeatureToActor', mode: 'passive' },
  { name: 'addSaveFeatureToActor', mode: 'save' },
  { name: 'addAttackToActor', mode: 'attack' },
  { name: 'addAttackWithSaveToActor', mode: 'attack-with-save' },
  { name: 'addAuraToActor', mode: 'aura' },
];
