/**
 * createDsa5CharacterFromArchetype: one hero as a copy of an archetype from an
 * actor compendium, with the customization really written and read back.
 *
 * Everything that can refuse is checked before the first write: the system,
 * the arguments, the compendium and its document type, the entry and its
 * actor type, and a name another actor has already. With addToWorld false the
 * hero is only prepared and shown; nothing is written.
 */
import {
  checkCustomization,
  customizationMismatches,
  heroData,
} from '../../../common/areas/dsa5/archetype.js';
import { isRecord, sameName } from '../../../common/areas/dsa5/rules.js';
import { QueryError, type QueryHandler } from '../../dispatcher.js';
import { requireGameSystem } from '../../game-systems.js';
import { defineAnnouncements } from '../../notify.js';
import { requireWorld } from '../../world-ready.js';
import { actors, documentClass, idOf, inputOf, quoteList, textOf } from '../actors/common.js';
import { ACTOR_FOLDER, resolveFolder } from '../actors/folders.js';

export const QUERY = 'createDsa5CharacterFromArchetype';
export const TOOL = 'create-dsa5-character-from-archetype';
/** Archetypes are heroes; other actor types are refused, as the listing offers only these. */
const ARCHETYPE_TYPES = ['character'];

export const dsa5Notes = defineAnnouncements('dsa5', {
  characterCreated: {
    level: 'info',
    en: 'DSA5 hero "{name}" created from the archetype "{archetype}".',
  },
});

const invalid = (problems: readonly string[]) =>
  new QueryError(
    'INVALID_ARGUMENT',
    `Cannot create the DSA5 character: ${problems.join('; ')}. Nothing was changed.`
  );

export const createDsa5CharacterFromArchetype: QueryHandler = {
  access: data =>
    inputOf(data)['addToWorld'] === false
      ? { kind: 'read' }
      : { kind: 'write', document: 'Actors', action: 'create' },
  run: async (data, context) => {
    requireWorld();
    requireGameSystem('dsa5', TOOL);
    const input = inputOf(data);
    const packId = textOf(input['archetypePackId']);
    const entryId = textOf(input['archetypeId']);
    const name = textOf(input['characterName']).trim();
    const addToWorld = input['addToWorld'] !== false;
    const problems: string[] = [];
    if (!packId) problems.push('archetypePackId is required');
    if (!entryId) problems.push('archetypeId is required: the id list-dsa5-archetypes shows');
    if (!name) problems.push('characterName must be a non-empty text');
    const customization = checkCustomization(input['customization']);
    problems.push(...customization.problems);
    if (problems.length) throw invalid(problems);

    const pack = game.packs.get(packId);
    if (!pack) {
      const actorPacks = game.packs
        .filter(entry => entry.documentName === 'Actor')
        .map(entry => entry.collection);
      throw new QueryError(
        'NOT_FOUND',
        `Compendium "${packId}" not found. Actor compendiums: ${actorPacks.length ? quoteList(actorPacks) : 'none'}. Nothing was changed.`
      );
    }
    if (pack.documentName !== 'Actor')
      throw new QueryError(
        'WRONG_DOCUMENT_TYPE',
        `Compendium "${packId}" holds ${pack.documentName} documents, not actors. Nothing was changed.`
      );
    const entry = (await pack.getDocument(entryId)) as FoundryActorsLoadedEntry | null | undefined;
    if (!entry)
      throw new QueryError(
        'NOT_FOUND',
        `Archetype "${entryId}" not found in compendium "${packId}". list-dsa5-archetypes shows the ids. Nothing was changed.`
      );
    const source = entry.toObject();
    const archetypeName = textOf(source['name']) || entry.name || entryId;
    const actorType = textOf(source['type']);
    if (!ARCHETYPE_TYPES.includes(actorType))
      throw new QueryError(
        'WRONG_ACTOR_TYPE',
        `"${archetypeName}" is an actor of type "${actorType}", not an archetype of a hero (type "character"). ` +
          'Use create-actor-from-compendium for NPCs and creatures. Nothing was changed.'
      );
    const taken = actors().filter(actor => sameName(actor.name, name));
    if (taken.length)
      throw new QueryError(
        'ALREADY_EXISTS',
        `An actor named "${name}" exists already: ${taken.map(actor => `"${actor.name}" (id ${actor.id})`).join(', ')}; ` +
          'names are compared ignoring case. Choose another characterName. Nothing was changed.'
      );

    const origin = entry.uuid ?? `Compendium.${packId}.Actor.${entryId}`;
    const archetype = {
      id: entryId,
      name: archetypeName,
      packId,
      packLabel: pack.metadata.label || pack.title || packId,
    };
    const answerBase = {
      archetype,
      customization: Object.fromEntries(
        Object.entries(customization.values).map(([path, value]) => [`system.${path}`, value])
      ),
      ignoredCustomization: customization.ignored,
    };

    if (!addToWorld) {
      const prepared = heroData(source, {
        name,
        folder: null,
        origin,
        values: customization.values,
      });
      return {
        success: true,
        created: false,
        summary: `DSA5 Character "${name}" prepared from archetype "${archetypeName}", not added to the world (addToWorld false).`,
        ...answerBase,
        prepared: {
          name: prepared['name'],
          type: prepared['type'],
          details: isRecord(prepared['system']) ? (prepared['system']['details'] ?? null) : null,
          items: Array.isArray(prepared['items']) ? prepared['items'].length : 0,
        },
      };
    }

    const folder = await resolveFolder(ACTOR_FOLDER, 'Actor', {
      context,
      query: QUERY,
      tool: TOOL,
    });
    const made = await documentClass('Actor').create(
      heroData(source, { name, folder: folder.id, origin, values: customization.values })
    );
    const id = idOf(Array.isArray(made) ? made[0] : made);
    const actor = id ? actors().get(id) : undefined;
    if (!actor)
      throw new QueryError(
        'NOT_CREATED',
        `Foundry did not create the DSA5 character "${name}" from "${archetypeName}": it is not in the world when read back.`
      );
    const stored = actor.toObject();
    const mismatches = customizationMismatches(stored, customization.values);
    context.recordChange({
      query: QUERY,
      tool: TOOL,
      document: 'Actors',
      action: 'create',
      targets: [{ id: actor.id, uuid: actor.uuid, name: actor.name, documentName: 'Actor' }],
      summary: `Created the DSA5 character "${actor.name}" from the archetype "${archetypeName}" (${packId}).`,
    });
    if (stored['name'] !== name || mismatches.length) {
      throw new QueryError(
        'NOT_APPLIED',
        `The DSA5 character was created as "${actor.name}" (id ${actor.id}), but does not read back as written: ` +
          `${JSON.stringify({ name: stored['name'] === name ? undefined : { expected: name, stored: stored['name'] }, mismatches })}. ` +
          'Check it in Foundry or delete it.'
      );
    }
    dsa5Notes.announce('characterCreated', { name: actor.name, archetype: archetypeName });
    return {
      success: true,
      created: true,
      summary: `DSA5 Character "${actor.name}" created from archetype "${archetypeName}"`,
      actor: { id: actor.id, name: actor.name, type: actor.type },
      folder: { id: folder.id, path: folder.path },
      createdFolders: folder.created,
      ...answerBase,
      tokensPlaced: 0,
    };
  },
};
