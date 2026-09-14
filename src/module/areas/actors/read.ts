/**
 * Reading actors: getCharacterInfo (get-character), getCharacterEntity
 * (get-character-entity), listActors (list-characters) and
 * searchCharacterItems (search-character-items).
 *
 * Everything that depends on the game system comes from the adapter registry.
 * Where a generic fallback answered instead, the answer says so in `notes`,
 * so no system is silently treated like another.
 */
import { plainText, sanitize } from '../../../common/areas/actors/sanitize.js';
import { QueryError, type QueryHandler } from '../../dispatcher.js';
import { activeGameSystem, systemAnswer } from '../../game-systems.js';
import { adapterData } from '../../prepared-data.js';
import { requireWorld } from '../../world-ready.js';
import {
  actors,
  descriptionOf,
  idOf,
  inputOf,
  invalid,
  isRecord,
  messageOf,
  quoteList,
  records,
  textOf,
} from './common.js';
import { findActor, findItemOnActor, type ActorMatch } from './lookup.js';

type Data = Record<string, unknown>;

function safely<T>(what: string, run: () => T, fallback: T, notes: string[]): T {
  try {
    return run();
  } catch (error) {
    notes.push(`${what} failed in the adapter of the game system: ${messageOf(error)}`);
    return fallback;
  }
}

function where(match: ActorMatch): Data {
  return match.token ? { via: match.via, token: match.token } : { via: match.via };
}

function gameSystem(): Data {
  const system = activeGameSystem();
  return { id: system.rawId, title: system.title, adapter: system.adapter?.id ?? null };
}

function effectSummary(effect: FoundryActorsEffect): Data {
  const duration = isRecord(effect.duration) ? effect.duration : {};
  const pick = (key: string) => (duration[key] === undefined ? null : sanitize(duration[key]));
  return {
    id: effect.id,
    name: effect.name ?? effect.label ?? '',
    disabled: effect.disabled === true,
    img: effect.img ?? effect.icon ?? null,
    duration: { type: pick('type'), remaining: pick('remaining'), label: pick('label') },
  };
}

function folderName(value: unknown): string | null {
  const id = idOf(value);
  return id ? (game.folders.get(id)?.name ?? null) : null;
}

export const getCharacterInfo: QueryHandler = {
  access: { kind: 'read' },
  run: data => {
    requireWorld();
    const input = inputOf(data);
    const identifier =
      textOf(input['characterId']) || textOf(input['characterName']) || textOf(input['identifier']);
    if (!identifier) throw invalid('characterName is required: an actor id or its exact name.');
    const match = findActor(identifier);
    const actor = match.actor;
    // Stored data with Foundry's prepared values on top; without them a real world showed dnd5e values as null.
    const plain = adapterData(actor);
    const withSystem = input['omitSystem'] !== true;
    const notes: string[] = [];

    const characters = systemAnswer('characters');
    const spells = systemAnswer('spells');
    const system = characters.system;
    const summary = safely(
      'The character summary',
      () => characters.questions.summary(plain),
      { basicInfo: {}, stats: {} },
      notes
    );
    if (characters.fallbackFor.includes('summary')) {
      notes.push(
        `No adapter for the game system "${system.rawId}" reads character values, so basicInfo only holds name, type and image and stats is empty.`
      );
    }
    if (!spells.fromAdapter) {
      notes.push(`No adapter for the game system "${system.rawId}" reads spells; none are listed.`);
    }

    const itemList = records(plain['items']).map(item => {
      const base: Data = {
        id: item['_id'] ?? null,
        name: item['name'] ?? '',
        type: item['type'] ?? '',
      };
      const extra = safely(
        'Item fields',
        () => characters.questions.itemFields?.(item) ?? {},
        {},
        notes
      );
      const entry: Data = { ...base, ...extra };
      if (withSystem) entry['system'] = sanitize(item['system'] ?? {});
      return entry;
    });

    const answer: Data = {
      id: actor.id,
      name: actor.name,
      type: actor.type,
      img: actor.img ?? null,
      hasImage: typeof actor.img === 'string' && actor.img !== '',
      ...where(match),
      basicInfo: sanitize(summary.basicInfo),
      stats: sanitize(summary.stats),
      items: itemList,
      effects: actor.effects.map(effectSummary),
      actions: sanitize(
        safely('Actions', () => characters.questions.actions?.(plain) ?? [], [], notes)
      ),
      spellcasting: sanitize(
        safely('Spellcasting', () => spells.questions.entries(plain), [], notes)
      ),
      gameSystem: gameSystem(),
      notes: [...new Set(notes)],
    };
    // A server of the previous generation builds the values from `system` itself.
    if (withSystem) answer['system'] = sanitize(plain['system'] ?? {});
    return answer;
  },
};

export const listActors: QueryHandler = {
  access: { kind: 'read' },
  run: data => {
    requireWorld();
    const type = textOf(inputOf(data)['type']);
    // A bare list, as servers of either generation read it.
    return actors()
      .filter(actor => !type || actor.type === type)
      .map(actor => ({
        id: actor.id,
        name: actor.name,
        type: actor.type,
        img: actor.img ?? null,
        folder: folderName(actor.folder),
      }));
  },
};

function effectDetail(effect: FoundryActorsEffect): Data {
  const data = sanitize(effect.toObject()) as Data;
  return {
    kind: 'effect',
    ...data,
    ...effectSummary(effect),
    description: effect.description || effect.name || effect.label || '',
  };
}

function findEffect(actor: FoundryActorsActor, identifier: string): FoundryActorsEffect | null {
  const byId = actor.effects.get(identifier);
  if (byId) return byId;
  const lower = identifier.toLowerCase();
  const named = actor.effects.filter(
    effect => (effect.name ?? effect.label ?? '').toLowerCase() === lower
  );
  if (named.length > 1) {
    throw new QueryError(
      'AMBIGUOUS',
      `${named.length} effects on "${actor.name}" are named "${identifier}": ${named.map(e => e.id).join(', ')}. Pass the id instead.`
    );
  }
  return named[0] ?? null;
}

export const getCharacterEntity: QueryHandler = {
  access: { kind: 'read' },
  run: data => {
    requireWorld();
    const input = inputOf(data);
    const characterIdentifier = textOf(input['characterIdentifier']);
    const entityIdentifier = textOf(input['entityIdentifier']);
    if (!characterIdentifier) throw invalid('characterIdentifier is required.');
    if (!entityIdentifier) throw invalid('entityIdentifier is required.');
    const match = findActor(characterIdentifier);
    const actor = match.actor;
    const notes: string[] = [];
    const head = { characterId: actor.id, characterName: actor.name, ...where(match) };

    const item = findItemOnActor(actor, entityIdentifier);
    if (item) {
      const source = item.toObject();
      const characters = systemAnswer('characters');
      const extra = safely(
        'Item fields',
        () => characters.questions.itemFields?.(adapterData(item)) ?? {},
        {},
        notes
      );
      return {
        ...head,
        kind: 'item',
        ...(sanitize(extra) as Data),
        id: item.id,
        name: item.name,
        type: item.type,
        img: item.img ?? null,
        hasImage: typeof item.img === 'string' && item.img !== '',
        description: descriptionOf(source),
        system: sanitize(source['system'] ?? {}),
        effects: sanitize(source['effects'] ?? []),
        flags: sanitize(source['flags'] ?? {}),
        notes,
      };
    }

    const plain = adapterData(actor);
    const characters = systemAnswer('characters');
    const actions = safely('Actions', () => characters.questions.actions?.(plain) ?? [], [], notes);
    const lower = entityIdentifier.toLowerCase();
    const action = actions.filter(
      entry =>
        textOf(entry['name']).toLowerCase() === lower || textOf(entry['id']) === entityIdentifier
    );
    if (action.length > 1) {
      throw new QueryError(
        'AMBIGUOUS',
        `${action.length} actions of "${actor.name}" are named "${entityIdentifier}". Pass the item id behind the action instead.`
      );
    }
    if (action[0]) return { ...head, kind: 'action', ...(sanitize(action[0]) as Data), notes };

    const effect = findEffect(actor, entityIdentifier);
    if (effect) return { ...head, ...effectDetail(effect), notes };

    throw new QueryError(
      'NOT_FOUND',
      `Entity "${entityIdentifier}" not found on character "${actor.name}" (id ${actor.id}). Tried items (id and name), ` +
        `actions (name${characters.fallbackFor.includes('actions') ? '; no adapter lists actions for this system' : ''}) ` +
        `and effects (id and name). The actor has ${actor.items.size} item(s) and ${actor.effects.size} effect(s).`
    );
  },
};

const SEARCH_DEFAULT_LIMIT = 20;
const SEARCH_MAX_LIMIT = 200;

export const searchCharacterItems: QueryHandler = {
  access: { kind: 'read' },
  run: data => {
    requireWorld();
    const input = inputOf(data);
    const identifier = textOf(input['characterIdentifier']);
    if (!identifier) throw invalid('characterIdentifier is required.');
    const query = textOf(input['query']).toLowerCase();
    const type = textOf(input['type']).toLowerCase();
    const categoryName = textOf(input['category']);
    const rawLimit = input['limit'];
    const limit =
      typeof rawLimit === 'number' && Number.isInteger(rawLimit) && rawLimit > 0
        ? Math.min(rawLimit, SEARCH_MAX_LIMIT)
        : SEARCH_DEFAULT_LIMIT;

    const match = findActor(identifier);
    const actor = match.actor;
    const search = systemAnswer('characterSearch');
    const notes: string[] = [];
    if (typeof rawLimit === 'number' && rawLimit > SEARCH_MAX_LIMIT)
      notes.push(`limit ${rawLimit} was lowered to ${SEARCH_MAX_LIMIT}.`);

    let category: { key: string; matches(item: Data): boolean } | null = null;
    if (categoryName) {
      const entry = Object.entries(search.questions.categories).find(
        ([key]) => key.toLowerCase() === categoryName.toLowerCase()
      );
      if (!entry) {
        const known = Object.keys(search.questions.categories);
        throw invalid(
          `The category "${categoryName}" is not known for the game system "${search.system.rawId}". ` +
            (known.length
              ? `Categories: ${quoteList(known)}.`
              : 'Without an adapter for this system there are no categories; leave category out.')
        );
      }
      if (type === 'action' || type === 'effect')
        throw invalid(`category applies to items only, not to type "${type}".`);
      category = { key: entry[0], matches: entry[1].matches };
    }

    const hits: Data[] = [];
    const textMatches = (name: string, description: string) =>
      !query || name.toLowerCase().includes(query) || description.toLowerCase().includes(query);

    if (type === 'effect') {
      for (const effect of actor.effects.contents) {
        const name = effect.name ?? effect.label ?? '';
        if (textMatches(name, effect.description ?? ''))
          hits.push({ ...effectSummary(effect), type: 'effect' });
      }
    } else if (type === 'action') {
      const characters = systemAnswer('characters');
      if (characters.fallbackFor.includes('actions'))
        notes.push(`No adapter for the game system "${search.system.rawId}" lists actions.`);
      const list = safely(
        'Actions',
        () => characters.questions.actions?.(adapterData(actor)) ?? [],
        [],
        notes
      );
      for (const action of list) {
        if (textMatches(textOf(action['name']), textOf(action['description'])))
          hits.push({ type: 'action', ...(sanitize(action) as Data) });
      }
    } else {
      const present = new Set<string>();
      for (const item of actor.items.contents) {
        present.add(item.type);
        if (type && item.type.toLowerCase() !== type) continue;
        const source = item.toObject();
        const description = descriptionOf(source);
        if (!textMatches(item.name, description)) continue;
        if (category && !safely('The category rule', () => category.matches(source), false, notes))
          continue;
        const details = safely(
          'Match details',
          () => search.questions.matchDetails?.(source) ?? {},
          {},
          notes
        );
        hits.push({
          id: item.id,
          name: item.name,
          type: item.type,
          description: plainText(description, 300),
          ...(sanitize(details) as Data),
        });
      }
      if (type && ![...present].some(entry => entry.toLowerCase() === type)) {
        notes.push(
          `The actor has no item of type "${type}". Its item types: ${present.size ? quoteList([...present]) : 'none'}.`
        );
      }
    }

    return {
      characterId: actor.id,
      characterName: actor.name,
      ...where(match),
      query: textOf(input['query']),
      type: textOf(input['type']) || null,
      category: category?.key ?? null,
      matches: hits.slice(0, limit),
      totalMatches: hits.length,
      returned: Math.min(hits.length, limit),
      notes: [...new Set(notes)],
    };
  },
};
