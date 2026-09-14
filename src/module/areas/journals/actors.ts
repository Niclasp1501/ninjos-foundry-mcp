/**
 * The two actor tools that live in this package: the token image with its
 * ring, and refreshing embedded items from their source.
 *
 * Both work on data shapes, not on a game system: the description of an item
 * is `system.description.value` and its level progression
 * `system.advancement` wherever an item has them. Where a source or an item
 * lacks such a field, that is reported, never guessed.
 */
import type { QueryHandler } from '../../dispatcher.js';
import { QueryError } from '../../dispatcher.js';
import { requireWorld } from '../../world-ready.js';
import {
  argsOf,
  findByIdOrName,
  isRecord,
  optionalBoolean,
  optionalNumber,
  optionalText,
  optionalTextList,
  requiredText,
  smallEnough,
  valueAt,
  verifyFailed,
} from './common.js';
import { loadPacks } from './repair.js';

function findActor(identifier: string): FoundryDocument {
  return findByIdOrName(
    game.actors.contents,
    identifier,
    'Actor',
    actor => `"${actor.name ?? ''}" (${actor.id})`
  );
}

/** Ring colours by CONST.TOKEN_DISPOSITIONS; secret (-2) is left to Foundry. */
export const RING_COLORS: Readonly<Record<string, string>> = {
  '-1': '#e72124',
  '0': '#3b82f6',
  '1': '#33bc4e',
};

export const setActorToken: QueryHandler = {
  access: { kind: 'write', document: 'Actors', action: 'update' },
  run: async (data, context) => {
    requireWorld();
    const args = argsOf(data);
    const actor = findActor(requiredText(args, 'actorIdentifier'));
    const tokenImg = requiredText(args, 'tokenImg').trim();
    const portraitImg = optionalText(args, 'portraitImg')?.trim();
    const tokenName = optionalText(args, 'tokenName')?.trim();
    const ring = optionalBoolean(args, 'ring');
    const ringScale = optionalNumber(args, 'ringScale');
    const ringColor = optionalText(args, 'ringColor')?.trim();
    if (ringColor !== undefined && !/^#[0-9a-fA-F]{6}$/.test(ringColor)) {
      throw new QueryError(
        'INVALID_ARGUMENT',
        `ringColor must be a hex colour like "#e72124", got "${ringColor}"`
      );
    }
    if (ringScale !== undefined && ringScale <= 0) {
      throw new QueryError(
        'INVALID_ARGUMENT',
        `ringScale must be greater than 0, got ${ringScale}`
      );
    }

    const source = actor.toObject();
    const changes: Record<string, unknown> = { 'prototypeToken.texture.src': tokenImg };
    if (portraitImg) changes['img'] = portraitImg;
    if (tokenName) changes['prototypeToken.name'] = tokenName;
    if (ring === true) {
      changes['prototypeToken.ring.enabled'] = true;
      changes['prototypeToken.ring.subject.texture'] = tokenImg;
    } else if (ring === false) {
      changes['prototypeToken.ring.enabled'] = false;
    }
    if (ringScale !== undefined) changes['prototypeToken.ring.subject.scale'] = ringScale;
    if (ringColor !== undefined && ring !== false) {
      changes['prototypeToken.ring.colors.ring'] = ringColor;
    } else if (ring === true) {
      const color = RING_COLORS[String(valueAt(source, 'prototypeToken.disposition'))];
      if (color) changes['prototypeToken.ring.colors.ring'] = color;
    }

    const before = Object.fromEntries(
      Object.keys(changes).map(key => [key, valueAt(source, key) ?? null])
    );
    await actor.update(changes);

    const fresh = (game.actors.get(actor.id) ?? actor).toObject();
    const wrong = Object.entries(changes).filter(([key, value]) => valueAt(fresh, key) !== value);
    if (wrong.length) {
      verifyFailed(
        `Actor ${actor.id} reads back differently for ${wrong.map(([key]) => key).join(', ')}`
      );
    }

    context.recordChange({
      query: 'setActorToken',
      tool: 'actor-set-token',
      document: 'Actors',
      action: 'update',
      targets: [{ id: actor.id, uuid: actor.uuid, name: actor.name ?? '' }],
      summary: `Set the token image of "${actor.name ?? actor.id}".`,
      before,
      after: changes,
    });
    return {
      success: true,
      actorId: actor.id,
      name: actor.name ?? '',
      tokenImg,
      ringEnabled: valueAt(fresh, 'prototypeToken.ring.enabled') === true,
      ringColor: valueAt(fresh, 'prototypeToken.ring.colors.ring') ?? null,
    };
  },
};

const REFRESH_FIELDS = ['name', 'img', 'description', 'advancement'] as const;
type RefreshField = (typeof REFRESH_FIELDS)[number];
const DEFAULT_FIELDS: readonly RefreshField[] = ['name', 'img', 'description'];

const DESCRIPTION = 'system.description.value';
const ADVANCEMENT = 'system.advancement';
const COMPENDIUM_SOURCE = '_stats.compendiumSource';
const LEGACY_SOURCE = 'flags.core.sourceId';

/**
 * Take the definition of every advancement entry from the source and keep
 * the choices (`value`) the item already made. Entries only the item has are
 * kept at the end, and named.
 */
export function mergeAdvancement(
  source: unknown,
  target: unknown
): { merged: unknown; kept: string[] } | null {
  const entriesOf = (value: unknown): Array<[string, Record<string, unknown>]> | null => {
    if (Array.isArray(value)) {
      if (!value.every(entry => isRecord(entry) && typeof entry['_id'] === 'string')) return null;
      return value.map(entry => [
        (entry as Record<string, unknown>)['_id'] as string,
        entry as Record<string, unknown>,
      ]);
    }
    if (isRecord(value)) {
      if (!Object.values(value).every(isRecord)) return null;
      return Object.entries(value) as Array<[string, Record<string, unknown>]>;
    }
    return null;
  };
  const from = entriesOf(source);
  const onItem = entriesOf(target ?? (Array.isArray(source) ? [] : {}));
  if (!from || !onItem || Array.isArray(source) !== Array.isArray(target ?? source)) return null;

  const existing = new Map(onItem);
  const sourceIds = new Set(from.map(([id]) => id));
  const merged = from.map(([id, entry]): [string, Record<string, unknown>] => {
    const own = existing.get(id);
    return [id, own && 'value' in own ? { ...entry, value: own['value'] } : { ...entry }];
  });
  const kept = onItem.filter(([id]) => !sourceIds.has(id));
  const all = [...merged, ...kept];
  return {
    merged: Array.isArray(source) ? all.map(([, entry]) => entry) : Object.fromEntries(all),
    kept: kept.map(([id]) => id),
  };
}

export const refreshActorItemsFromSource: QueryHandler = {
  access: { kind: 'write', document: 'Actors', action: 'update' },
  run: async (data, context) => {
    requireWorld();
    const args = argsOf(data);
    const actor = findActor(requiredText(args, 'actorIdentifier'));
    const dryRun = optionalBoolean(args, 'dryRun') ?? false;
    const requested = optionalTextList(args, 'fields');
    if (requested && !requested.length) {
      throw new QueryError(
        'INVALID_ARGUMENT',
        `fields must name at least one of ${REFRESH_FIELDS.join(', ')}`
      );
    }
    const unknownFields = (requested ?? []).filter(
      field => !(REFRESH_FIELDS as readonly string[]).includes(field)
    );
    if (unknownFields.length) {
      throw new QueryError(
        'INVALID_ARGUMENT',
        `Unknown field(s) ${unknownFields.join(', ')}; allowed: ${REFRESH_FIELDS.join(', ')}`
      );
    }
    const fields = (requested as RefreshField[] | undefined) ?? [...DEFAULT_FIELDS];
    const namePacks = await loadPacks(optionalTextList(args, 'namePacks') ?? [], 'Item');
    const preferPacks = await loadPacks(optionalTextList(args, 'preferPacks') ?? [], 'Item');

    const collection = (actor as unknown as { items?: FoundryCollection<FoundryDocument> }).items;
    const items = collection ? [...collection.contents] : [];
    const updates: Array<Record<string, unknown>> = [];
    const befores: Array<Record<string, unknown>> = [];
    const changes: Array<Record<string, unknown>> = [];
    const unresolved: Array<{ itemId: string; itemName: string; reason: string }> = [];
    const skippedFields: Array<{ itemId: string; field: string; reason: string }> = [];
    let unchanged = 0;

    for (const [index, item] of items.entries()) {
      if (items.length > 20 && index % 20 === 0) {
        context.progress({ progress: index, total: items.length, message: 'resolving sources' });
      }
      const data = item.toObject();
      const stored =
        typeof valueAt(data, COMPENDIUM_SOURCE) === 'string' && valueAt(data, COMPENDIUM_SOURCE)
          ? { uuid: valueAt(data, COMPENDIUM_SOURCE) as string, via: 'compendiumSource' }
          : typeof valueAt(data, LEGACY_SOURCE) === 'string' && valueAt(data, LEGACY_SOURCE)
            ? { uuid: valueAt(data, LEGACY_SOURCE) as string, via: 'sourceId' }
            : null;

      let uuid = stored?.uuid ?? null;
      let via = stored?.via ?? null;
      let redirected = false;
      if (stored) {
        const storedId = stored.uuid.split('.').at(-1) ?? '';
        for (const lookup of preferPacks) {
          if (!lookup.ids.has(storedId)) continue;
          const candidate = `Compendium.${lookup.pack.collection}.Item.${storedId}`;
          if (candidate !== stored.uuid) {
            uuid = candidate;
            via = 'preferPacks';
            redirected = true;
          }
          break;
        }
      }

      let source = uuid ? await fromUuid(uuid) : null;
      if (!source) {
        const key = String(data['name'] ?? '').toLowerCase();
        for (const lookup of namePacks) {
          const entry = lookup.byName.get(key);
          if (!entry) continue;
          uuid = `Compendium.${lookup.pack.collection}.Item.${entry._id}`;
          source = await fromUuid(uuid);
          if (source) {
            via = 'namePacks';
            break;
          }
        }
      }
      if (!source || !uuid) {
        unresolved.push({
          itemId: item.id,
          itemName: String(data['name'] ?? ''),
          reason: stored ? 'source not found in world' : 'no source (hand-made?)',
        });
        continue;
      }

      const from = source.toObject();
      const update: Record<string, unknown> = {};
      const before: Record<string, unknown> = {};
      const set = (key: string, value: unknown) => {
        if (JSON.stringify(valueAt(data, key)) === JSON.stringify(value)) return;
        update[key] = value;
        before[key] = valueAt(data, key) ?? null;
      };
      const changedFields: string[] = [];
      for (const field of fields) {
        const size = Object.keys(update).length;
        if (field === 'name' || field === 'img') {
          if (typeof from[field] === 'string') set(field, from[field]);
          else skippedFields.push({ itemId: item.id, field, reason: 'the source has none' });
        } else if (field === 'description') {
          const text = valueAt(from, DESCRIPTION);
          if (typeof text === 'string') set(DESCRIPTION, text);
          else
            skippedFields.push({
              itemId: item.id,
              field,
              reason: `the source has no ${DESCRIPTION}`,
            });
        } else {
          const result = mergeAdvancement(valueAt(from, ADVANCEMENT), valueAt(data, ADVANCEMENT));
          if (result) {
            set(ADVANCEMENT, result.merged);
            if (result.kept.length) {
              skippedFields.push({
                itemId: item.id,
                field,
                reason: `entries only on the item were kept: ${result.kept.join(', ')}`,
              });
            }
          } else {
            skippedFields.push({
              itemId: item.id,
              field,
              reason: `the source or the item has no usable ${ADVANCEMENT}`,
            });
          }
        }
        if (Object.keys(update).length > size) changedFields.push(field);
      }
      if (redirected && Object.keys(update).length) {
        update[COMPENDIUM_SOURCE] = uuid;
        before[COMPENDIUM_SOURCE] = valueAt(data, COMPENDIUM_SOURCE) ?? null;
      }

      if (!changedFields.length) {
        unchanged += 1;
        continue;
      }
      updates.push({ _id: item.id, ...update });
      befores.push({ _id: item.id, ...before });
      changes.push({
        itemId: item.id,
        itemName: String(data['name'] ?? ''),
        fields: changedFields,
        source: uuid,
        via,
      });
    }

    const warnings: string[] = [];
    if (!dryRun && updates.length) {
      await actor.updateEmbeddedDocuments('Item', updates);
      const freshItems = (
        game.actors.get(actor.id) as unknown as
          { items?: FoundryCollection<FoundryDocument> } | undefined
      )?.items;
      const wrong: string[] = [];
      for (const update of updates) {
        const id = update['_id'] as string;
        const fresh = freshItems?.get(id)?.toObject();
        for (const [key, value] of Object.entries(update)) {
          if (key === '_id') continue;
          if (JSON.stringify(valueAt(fresh, key)) === JSON.stringify(value)) continue;
          if (key === COMPENDIUM_SOURCE)
            warnings.push(`Foundry did not keep the new source of item ${id}`);
          else wrong.push(`${id} ${key}`);
        }
      }
      if (wrong.length)
        verifyFailed(
          `Items of actor ${actor.id} read back differently: ${wrong.slice(0, 5).join(', ')}`
        );

      context.recordChange({
        query: 'refreshActorItemsFromSource',
        tool: 'actor-refresh-from-source',
        document: 'Actors',
        action: 'update',
        targets: updates.map(update => ({ id: update['_id'] as string })),
        summary: `Refreshed ${updates.length} items of "${actor.name ?? actor.id}" from their source.`,
        before: smallEnough(befores),
      });
    }

    const result: Record<string, unknown> = {
      success: true,
      actorId: actor.id,
      actorName: actor.name ?? '',
      actor: actor.name ?? '',
      dryRun,
      fields,
      refreshed: changes.length,
      unchanged,
      changes,
      unresolved,
    };
    if (skippedFields.length) result['skippedFields'] = skippedFields;
    if (warnings.length) result['warnings'] = warnings;
    return result;
  },
};
