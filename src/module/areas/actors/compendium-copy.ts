/**
 * createActorFromCompendium: world actors as copies of one compendium entry,
 * each with its own name, optionally placed in the active scene.
 *
 * Everything that can refuse is checked before the first actor is written:
 * arguments, the limit, the active scene for addToScene, the pack, the entry,
 * the actor type the adapter allows to copy, and the permission for the scene
 * (declared in `access`). Before, the actors were created and only placing the
 * tokens failed.
 */
import {
  PLACEMENT_KINDS,
  type PlacementKind,
  type Point,
} from '../../../common/areas/actors/placement.js';
import type { Access } from '../../../common/permissions.js';
import { QueryError, type QueryHandler } from '../../dispatcher.js';
import { systemAnswer } from '../../game-systems.js';
import { requireWorld } from '../../world-ready.js';
import {
  COMPENDIUM_COPY_LIMIT,
  actors,
  documentClass,
  dropRemoteTokenImage,
  idOf,
  inputOf,
  invalid,
  isRecord,
  maxActorsPerRequest,
  messageOf,
  quoteList,
  records,
  requireActiveScene,
  requireWithinLimit,
  textList,
  textOf,
} from './common.js';
import { CREATURE_FOLDER, resolveFolder } from './folders.js';
import { placeActorTokens, type PlacedToken } from './tokens.js';

const QUERY = 'createActorFromCompendium';
const TOOL = 'create-actor-from-compendium';

function copyData(
  source: Record<string, unknown>,
  name: string,
  folder: string | null,
  origin: string
): Record<string, unknown> {
  const data = structuredClone(source);
  for (const key of ['_id', 'folder', 'sort', 'ownership', '_stats']) delete data[key];
  data['name'] = name;
  data['folder'] = folder;
  // Foundry's own link to the entry a document came from.
  data['_stats'] = { compendiumSource: origin };
  const token = data['prototypeToken'];
  if (isRecord(token)) {
    token['name'] = name;
    dropRemoteTokenImage(token);
  }
  return data;
}

export const createActorFromCompendium: QueryHandler = {
  access: data => {
    const create: Access = { kind: 'write', document: 'Actors', action: 'create' };
    return inputOf(data)['addToScene'] === true
      ? [create, { kind: 'write', document: 'Scenes', action: 'update' }]
      : create;
  },
  run: async (data, context) => {
    requireWorld();
    const input = inputOf(data);
    const packId = textOf(input['packId']);
    const entryId = textOf(input['itemId']) || textOf(input['documentId']);
    if (!packId) throw invalid('packId is required.');
    if (!entryId)
      throw invalid('itemId is required: the id of the entry, as search-compendium shows it.');
    const custom = textList(input['customNames']);
    const names = custom.length ? custom : textList(input['names']);
    if (!names.length) throw invalid('names needs at least one non-empty name.');

    const quantity = input['quantity'] === undefined ? names.length : Number(input['quantity']);
    if (!Number.isInteger(quantity) || quantity < 1)
      throw invalid(`quantity must be a whole number from 1 to ${COMPENDIUM_COPY_LIMIT}.`);
    requireWithinLimit(
      quantity,
      'Actors to create from a compendium',
      Math.min(COMPENDIUM_COPY_LIMIT, maxActorsPerRequest())
    );

    const addToScene = input['addToScene'] === true;
    const placement = isRecord(input['placement']) ? input['placement'] : {};
    const kind = (textOf(placement['type']) || 'grid') as PlacementKind;
    if (!PLACEMENT_KINDS.includes(kind))
      throw invalid(`placement.type must be one of ${quoteList([...PLACEMENT_KINDS])}.`);
    const coordinates: Point[] = records(placement['coordinates']).map(point => ({
      x: Number(point['x']),
      y: Number(point['y']),
    }));
    const scene = addToScene ? requireActiveScene('addToScene') : null;
    if (addToScene && kind === 'coordinates' && coordinates.length < quantity) {
      throw invalid(
        `placement "coordinates" needs one point per actor: ${quantity} actor(s), ${coordinates.length} point(s). Nothing was created.`
      );
    }

    const pack = game.packs.get(packId);
    if (!pack) {
      const actorPacks = game.packs
        .filter(entry => entry.documentName === 'Actor')
        .map(entry => entry.collection);
      throw new QueryError(
        'NOT_FOUND',
        `Compendium pack "${packId}" not found. Actor compendiums: ${actorPacks.length ? quoteList(actorPacks) : 'none'}.`
      );
    }
    if (pack.documentName !== 'Actor') {
      throw new QueryError(
        'WRONG_DOCUMENT_TYPE',
        `Compendium "${packId}" holds ${pack.documentName} documents, not actors. Use import-from-compendium for other documents.`
      );
    }
    const entry = (await pack.getDocument(entryId)) as FoundryActorsLoadedEntry | null | undefined;
    if (!entry) {
      throw new QueryError(
        'NOT_FOUND',
        `Document "${entryId}" not found in compendium "${packId}". list-compendium-entries shows the ids.`
      );
    }
    const source = entry.toObject();
    const originalName = textOf(source['name']) || entry.name || entryId;
    const actorType = textOf(source['type']);
    const creatures = systemAnswer('creatures');
    const copyable = creatures.questions.copyableTypes;
    if (copyable && !copyable.includes(actorType)) {
      throw new QueryError(
        'WRONG_ACTOR_TYPE',
        `"${originalName}" is an actor of type "${actorType}", which the adapter "${creatures.system.title}" does not copy. ` +
          `Types it copies: ${quoteList([...copyable])}. Nothing was created.`
      );
    }

    const ignoredNames = names.length > quantity ? names.slice(quantity) : [];
    const folder = await resolveFolder(CREATURE_FOLDER, 'Actor', {
      context,
      query: QUERY,
      tool: TOOL,
    });
    const origin = entry.uuid ?? `Compendium.${packId}.Actor.${entryId}`;
    const ActorClass = documentClass('Actor');
    const label = pack.metadata.label || pack.title || packId;

    const created: Array<Record<string, unknown>> = [];
    const createdActors: FoundryActorsActor[] = [];
    const errors: string[] = [];
    for (let index = 0; index < quantity; index += 1) {
      const requested = names[index] ?? `${names[0] as string} ${index + 1}`;
      context.progress({ progress: index, total: quantity, message: `Creating "${requested}"` });
      try {
        const made = await ActorClass.create(copyData(source, requested, folder.id, origin));
        const id = idOf(Array.isArray(made) ? made[0] : made);
        const actor = id ? actors().get(id) : undefined;
        if (!actor) throw new Error('it is not in the world when read back');
        created.push({
          id: actor.id,
          name: actor.name,
          requestedName: requested,
          originalName,
          type: actor.type,
          pack: packId,
          packLabel: label,
        });
        createdActors.push(actor);
        context.recordChange({
          query: QUERY,
          tool: TOOL,
          document: 'Actors',
          action: 'create',
          targets: [{ id: actor.id, uuid: actor.uuid, name: actor.name }],
          summary: `Created actor "${actor.name}" as a copy of "${originalName}" from ${packId}.`,
        });
      } catch (error) {
        errors.push(`"${requested}": ${messageOf(error)}`);
      }
    }
    context.progress({ progress: quantity, total: quantity });

    if (!created.length) {
      throw new QueryError(
        'NOT_CREATED',
        `None of the ${quantity} actor(s) from "${originalName}" could be created. ${errors.join('; ')}`
      );
    }

    let tokens: PlacedToken[] = [];
    const warnings: string[] = [];
    if (scene) {
      try {
        tokens = await placeActorTokens(
          scene,
          createdActors,
          { kind, coordinates, hidden: false },
          { context, query: QUERY, tool: TOOL, warnings }
        );
      } catch (error) {
        errors.push(
          `Tokens could not be placed in scene "${scene.name}": ${messageOf(error)} The actors exist without tokens.`
        );
      }
    }

    const summary = `Created ${created.length} of ${quantity} requested actors`;
    const lines = [
      `${summary} from "${originalName}" (${label}) in folder "${folder.path}".`,
      ...(scene ? [`Tokens placed in the active scene "${scene.name}": ${tokens.length}.`] : []),
      ...(ignoredNames.length
        ? [`Names beyond quantity ${quantity}, not used: ${quoteList(ignoredNames)}.`]
        : []),
      ...errors.map(error => `Problem: ${error}`),
      ...warnings.map(warning => `Warning: ${warning}`),
    ];
    return {
      success: true,
      summary,
      totalCreated: created.length,
      totalRequested: quantity,
      actors: created,
      folder: { id: folder.id, path: folder.path },
      createdFolders: folder.created,
      tokensPlaced: tokens.length,
      tokenIds: tokens.map(token => token.id),
      tokens,
      scene: scene ? { id: scene.id, name: scene.name } : null,
      ignoredNames,
      errors,
      ...(warnings.length ? { warnings } : {}),
      message: lines.join('\n'),
    };
  },
};
