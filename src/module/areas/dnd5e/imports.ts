/**
 * addSpellsToActor and addFeaturesFromCompendium: named items copied from
 * compendiums onto an actor.
 *
 * - Names match exactly, ignoring case, never in part.
 * - The first compendium in the given order that has the name wins. Two
 *   entries of that name in the same compendium are ambiguous and reported,
 *   never guessed between.
 * - An entry of the wrong kind (a feature named like the spell) is reported.
 * - The same duplicate rule as for built features: any item of the actor with
 *   the name, ignoring case.
 * - A copy has no id, folder, sort or ownership of its entry, and links its
 *   origin through `_stats.compendiumSource`. Every copy is read back.
 * - Without compendiumPacks the standard compendiums of the world's rules
 *   version are searched, and the answer says which.
 */
import { STANDARD_PACKS, sameName, type RulesVersion } from '../../../common/areas/dnd5e/rules.js';
import type { QueryHandler } from '../../dispatcher.js';
import { textList, textOf } from '../actors/common.js';
import { findActor } from '../actors/lookup.js';
import {
  callData,
  invalid,
  itemNamed,
  messageOf,
  requireBuildableActor,
  requireDnd5e,
  worldRules,
} from './common.js';

interface LoadedEntry {
  id: string;
  uuid: string;
  name?: string;
  type?: string;
  toObject(): Record<string, unknown>;
}

interface ImportKind {
  query: string;
  tool: string;
  namesField: 'spellNames' | 'featureNames';
  what: string;
  types: readonly string[];
  defaults: (rules: RulesVersion) => string[];
}

const MAX_NAMES = 50;

export const SPELL_IMPORT: ImportKind = {
  query: 'addSpellsToActor',
  tool: 'dnd5e-add-feature',
  namesField: 'spellNames',
  what: 'spell',
  types: ['spell'],
  defaults: rules => STANDARD_PACKS[rules].spells,
};

export const FEATURE_IMPORT: ImportKind = {
  query: 'addFeaturesFromCompendium',
  tool: 'dnd5e-add-features-from-compendium',
  namesField: 'featureNames',
  what: 'feature',
  types: ['feat', 'weapon'],
  defaults: rules => STANDARD_PACKS[rules].features,
};

export function importHandler(kind: ImportKind): QueryHandler {
  return {
    access: { kind: 'write', document: 'Actors', action: 'update' },
    run: async (data, context) => {
      requireDnd5e(kind.tool);
      const input = callData(data);
      const names = textList(input[kind.namesField]);
      if (!names.length)
        throw invalid(`Cannot add ${kind.what}s`, [
          `${kind.namesField} must list at least one name`,
        ]);
      if (names.length > MAX_NAMES)
        throw invalid(`Cannot add ${kind.what}s`, [
          `${kind.namesField} has ${names.length} names, at most ${MAX_NAMES} per call`,
        ]);

      const warnings: string[] = [];
      const givenPacks =
        input['compendiumPacks'] === undefined ? null : textList(input['compendiumPacks']);
      const rules = worldRules() ?? '2014';
      const packIds = givenPacks?.length ? givenPacks : kind.defaults(rules);
      if (!givenPacks?.length) {
        warnings.push(
          `No compendiumPacks given: searched the standard ${kind.what} compendiums of the ${rules} rules (${packIds.join(', ')}).`
        );
      }

      const packs: FoundryCompendium[] = [];
      for (const id of packIds) {
        const pack = game.packs.get(id);
        if (!pack) warnings.push(`Compendium "${id}" does not exist and was skipped.`);
        else if (pack.documentName !== 'Item')
          warnings.push(
            `Compendium "${id}" holds ${pack.documentName} documents, not items, and was skipped.`
          );
        else if (!packs.includes(pack)) packs.push(pack);
      }
      if (!packs.length) {
        const available = game.packs
          .filter(pack => pack.documentName === 'Item')
          .map(pack => pack.collection);
        throw invalid(`Cannot add ${kind.what}s`, [
          `none of the compendiums ${packIds.map(id => `"${id}"`).join(', ')} is an item compendium of this world`,
          `standard ids: 2014 ${kind.defaults('2014').join(', ')}; 2024 ${kind.defaults('2024').join(', ')}`,
          `item compendiums here: ${available.slice(0, 30).join(', ') || 'none'}`,
        ]);
      }

      const match = findActor(textOf(input['actorIdentifier']));
      const actor = match.actor;
      requireBuildableActor(actor, kind.tool);

      const added: Array<Record<string, unknown>> = [];
      const skipped: Array<{ name: string; reason: string }> = [];
      const notFound: string[] = [];
      const failed: Array<{ name: string; error: string }> = [];

      const indexes = new Map<FoundryCompendium, FoundryCompendiumIndexEntry[]>();
      for (const pack of packs) {
        try {
          await pack.getIndex();
          indexes.set(pack, [...pack.index.values()]);
        } catch (error) {
          warnings.push(
            `The index of compendium "${pack.collection}" could not be read and was skipped: ${messageOf(error)}`
          );
        }
      }

      const seen: string[] = [];
      for (const [position, name] of names.entries()) {
        context.progress({
          progress: position,
          total: names.length,
          message: `Adding ${kind.what} "${name}"`,
        });
        if (seen.some(other => sameName(other, name))) {
          skipped.push({ name, reason: 'duplicate in input' });
          continue;
        }
        seen.push(name);
        const existing = itemNamed(actor, name);
        if (existing) {
          skipped.push({
            name,
            reason: `already on actor as "${existing.name}" (id ${existing.id}, type ${existing.type})`,
          });
          continue;
        }

        let chosen: { pack: FoundryCompendium; entry: FoundryCompendiumIndexEntry } | null = null;
        const wrongType: string[] = [];
        for (const [pack, entries] of indexes) {
          const named = entries.filter(entry => sameName(entry.name, name));
          const fitting = named.filter(entry => kind.types.includes(entry.type ?? ''));
          wrongType.push(
            ...named
              .filter(entry => !fitting.includes(entry))
              .map(entry => `${entry.type ?? '?'} in ${pack.collection}`)
          );
          if (fitting.length > 1) {
            failed.push({
              name,
              error: `ambiguous: ${fitting.length} entries of compendium "${pack.collection}" are named so (ids ${fitting.map(entry => entry._id).join(', ')}); none was added`,
            });
            chosen = null;
            break;
          }
          if (fitting.length === 1) {
            chosen = { pack, entry: fitting[0] as FoundryCompendiumIndexEntry };
            break;
          }
        }
        if (failed.some(entry => entry.name === name)) continue;
        if (!chosen) {
          notFound.push(name);
          if (wrongType.length)
            warnings.push(
              `"${name}" exists only as ${wrongType.join(', ')}, which is not a ${kind.types.join(' or ')}.`
            );
          continue;
        }

        try {
          const loaded = (await chosen.pack.getDocument(chosen.entry._id)) as
            LoadedEntry | null | undefined;
          if (!loaded) throw new Error(`entry ${chosen.entry._id} could not be loaded`);
          const copy = loaded.toObject();
          for (const field of ['_id', 'folder', 'sort', 'ownership', '_stats']) delete copy[field];
          copy['_stats'] = { compendiumSource: loaded.uuid };
          const [created] = await actor.createEmbeddedDocuments('Item', [copy]);
          const item = created ? actor.items.get(created.id) : undefined;
          if (!item) throw new Error('Foundry returned no item');
          added.push({
            name: item.name,
            itemId: item.id,
            type: item.type,
            packId: chosen.pack.collection,
            packLabel: chosen.pack.title,
            sourceId: chosen.entry._id,
            source: loaded.uuid,
          });
        } catch (error) {
          failed.push({ name, error: messageOf(error) });
        }
      }
      context.progress({
        progress: names.length,
        total: names.length,
        message: `Done with ${names.length} ${kind.what} name(s)`,
      });

      if (added.length) {
        context.recordChange({
          query: kind.query,
          tool: kind.tool,
          document: 'Actors',
          action: 'update',
          targets: [
            { id: actor.id, uuid: actor.uuid, name: actor.name, documentName: 'Actor' },
            ...added.map(entry => ({
              id: String(entry['itemId']),
              name: String(entry['name']),
              documentName: 'Item',
            })),
          ],
          summary: `Copied ${added.length} ${kind.what}(s) from compendiums onto "${actor.name}".`,
        });
      }

      return {
        // Never `success: false` without `error`: every server reads that as a refusal and loses the lists.
        complete: !notFound.length && !failed.length,
        summary:
          `${kind.what[0]?.toUpperCase()}${kind.what.slice(1)}s for "${actor.name}": ${added.length} added, ${skipped.length} skipped, ` +
          `${notFound.length} not found, ${failed.length} failed.`,
        actor: { id: actor.id, name: actor.name, via: match.via },
        added,
        skipped,
        notFound,
        failed,
        warnings,
        packsSearched: [...indexes.keys()].map(pack => pack.collection),
        rules,
      };
    },
  };
}
