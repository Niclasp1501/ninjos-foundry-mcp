/**
 * The two WFRP4e queries: updateWfrp4eActor and addWfrp4eItems, under the
 * names a server of the previous generation sends.
 *
 * Rights come from the dispatcher: `Actors` change, and `Scenes` change when
 * the actor is the unlinked copy of a token. The previous generation only
 * checked for a gamemaster, not the write switch or the matrix. Every write
 * is read back before success is reported, and every change is recorded.
 */
import { smallEnough } from '../../../common/change-log.js';
import {
  at,
  idOf,
  isRecord,
  itemsOf,
  sameName,
  systemOf,
  text,
  type Data,
} from '../../../common/areas/wfrp4e-cosmere-traveller/shared.js';
import { skillValue } from '../../../common/areas/wfrp4e-cosmere-traveller/wfrp4e.js';
import {
  characteristicTotals,
  checkAddArguments,
  checkUpdateArguments,
  itemData,
  matchItem,
  orderPacks,
  planUpdate,
  unmatched,
  type AddRequest,
  type Candidate,
  type IndexedPack,
} from '../../../common/areas/wfrp4e-cosmere-traveller/wfrp4e-tools.js';
import { QueryError, type HandlerContext, type QueryHandler } from '../../dispatcher.js';
import { requireGameSystem } from '../../game-systems.js';
import { defineAnnouncements } from '../../notify.js';
import { requireWorld } from '../../world-ready.js';
import { inputOf } from '../actors/common.js';
import { findActor, type ActorMatch } from '../actors/lookup.js';

const ACTOR_UPDATE = { kind: 'write', document: 'Actors', action: 'update' } as const;

export const wfrpNotes = defineAnnouncements('wfrp4e-cosmere-traveller', {
  blankItems: {
    level: 'warn',
    en: '{count} item(s) for {actor} were not in any compendium and were added blank: {names}.',
  },
});

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function invalid(tool: string, problems: readonly string[]): QueryError {
  return new QueryError(
    'INVALID_ARGUMENT',
    `Invalid arguments for ${tool}: ${problems.join('; ')}. Nothing was changed.`
  );
}

/** Writing to the unlinked copy of a token changes the scene that holds it. */
function requireTokenAccess(match: ActorMatch, context: HandlerContext): void {
  if (match.token && !match.token.linked) {
    context.requireAccess(
      { kind: 'write', document: 'Scenes', action: 'update' },
      `"${match.actor.name}" was found as the unlinked token ${match.token.id} on scene "${match.token.sceneName}", whose own copy of the actor would change.`
    );
  }
}

/** Prepared system data when Foundry has it (value and bonus present), else the stored data. */
function preparedSystem(actor: FoundryActorsActor, stored: Data): Data {
  try {
    const prepared = (actor as unknown as { system?: unknown }).system;
    const plain =
      prepared === undefined ? undefined : (JSON.parse(JSON.stringify(prepared)) as unknown);
    if (isRecord(plain) && typeof at(plain, 'characteristics.ws.value') === 'number') return plain;
  } catch {
    // Prepared data that cannot be copied: the stored parts decide.
  }
  return systemOf(stored);
}

export const updateWfrp4eActor: QueryHandler = {
  access: ACTOR_UPDATE,
  run: async (data, context) => {
    const tool = 'wfrp4e-update-actor';
    requireWorld();
    requireGameSystem('wfrp4e', tool);
    const args = inputOf(data);
    const problems = checkUpdateArguments(args);
    if (problems.length) throw invalid(tool, problems);

    const match = findActor(text(args['actor']));
    const actor = match.actor;
    requireTokenAccess(match, context);
    const before = actor.toObject();
    const plan = planUpdate(before, args);
    if (!Object.keys(plan.actor).length && !plan.items.length) {
      throw new QueryError(
        'NOTHING_TO_UPDATE',
        `No valid fields to update on "${actor.name}" (id ${actor.id}). ${plan.warnings.join(' ')} Nothing was changed.`
      );
    }

    // The actor first, then its items: wfrp4e recomputes totals from both.
    try {
      if (Object.keys(plan.actor).length) await actor.update(plan.actor);
      if (plan.items.length) await actor.updateEmbeddedDocuments('Item', plan.items);
    } catch (error) {
      throw new QueryError(
        'FOUNDRY_API',
        `Foundry refused to update "${actor.name}" (id ${actor.id}): ${messageOf(error)}. The actor part may already be written; get-character shows the state.`
      );
    }

    const after = actor.toObject();
    const mismatches = unmatched(plan, after);
    context.recordChange({
      query: 'updateWfrp4eActor',
      tool,
      document: 'Actors',
      action: 'update',
      targets: [{ id: actor.id, uuid: actor.uuid, name: actor.name, documentName: 'Actor' }],
      summary: `Updated ${plan.applied.length} value(s) of "${actor.name}": ${plan.applied.map(change => change.field).join(', ')}.`,
      before: smallEnough(before),
      after: smallEnough(after),
    });
    if (mismatches.length === plan.expected.length) {
      throw new QueryError(
        'NOT_APPLIED',
        `Foundry accepted the update of "${actor.name}", but none of the values reads back as written: ${JSON.stringify(mismatches)}.`
      );
    }
    return {
      success: true,
      actor: { id: actor.id, name: actor.name, via: match.via },
      actorId: actor.id,
      actorName: actor.name,
      applied: plan.applied,
      newCharacteristicTotals: characteristicTotals(preparedSystem(actor, after)),
      warnings: plan.warnings,
      mismatches,
    };
  },
};

interface Planned {
  request: AddRequest;
  data: Data;
  source: string;
  candidate: Candidate | null;
}

export const addWfrp4eItems: QueryHandler = {
  access: ACTOR_UPDATE,
  run: async (data, context) => {
    const tool = 'wfrp4e-add-items';
    requireWorld();
    requireGameSystem('wfrp4e', tool);
    const args = inputOf(data);
    const { requests, problems } = checkAddArguments(args);
    if (problems.length) throw invalid(tool, problems);

    const match = findActor(text(args['actor']));
    const actor = match.actor;
    requireTokenAccess(match, context);

    const warnings: string[] = [];
    const notFound: string[] = [];
    const ambiguous: Array<{ name: string; reason: string; candidates: Candidate[] }> = [];
    const failed: Array<{ name: string; error: string }> = [];
    const skipped: Array<{ name: string; reason: string }> = [];
    const planned: Planned[] = [];

    const itemPacks = game.packs.filter(pack => pack.documentName === 'Item');
    const indexes = new Map<string, IndexedPack | null>();
    const indexOf = async (pack: FoundryCompendium): Promise<IndexedPack | null> => {
      if (indexes.has(pack.collection)) return indexes.get(pack.collection) ?? null;
      let indexed: IndexedPack | null = null;
      try {
        await pack.getIndex();
        indexed = { id: pack.collection, label: pack.title, entries: [...pack.index.values()] };
      } catch (error) {
        warnings.push(
          `The index of compendium "${pack.collection}" could not be read and was skipped: ${messageOf(error)}`
        );
      }
      indexes.set(pack.collection, indexed);
      return indexed;
    };
    const existing = itemsOf(actor.toObject());

    for (const [position, request] of requests.entries()) {
      context.progress({
        progress: position,
        total: requests.length,
        message: `Looking up "${request.name}"`,
      });
      // A skill or career the actor has already would make later name lookups ambiguous: skip it before any lookup.
      const held = existing.find(
        item =>
          ['skill', 'career'].includes(text(item['type'])) &&
          (!request.type || request.type === item['type']) &&
          sameName(item['name'], request.name)
      );
      if (held) {
        skipped.push({
          name: request.name,
          reason: `the actor already has the ${text(held['type'])} "${text(held['name'])}" (id ${idOf(held)})`,
        });
        continue;
      }
      const fragment = request.pack?.toLowerCase();
      const packs = fragment
        ? itemPacks.filter(pack => pack.collection.toLowerCase().includes(fragment))
        : itemPacks;
      if (fragment && !packs.length) {
        failed.push({
          name: request.name,
          error: `no item compendium id contains "${request.pack}"; nothing was created for it (item compendiums: ${itemPacks.map(pack => pack.collection).join(', ') || 'none'})`,
        });
        continue;
      }
      const indexed = (
        await Promise.all(
          orderPacks(packs.map(pack => ({ id: pack.collection, pack }))).map(entry =>
            indexOf(entry.pack)
          )
        )
      ).filter((entry): entry is IndexedPack => entry !== null);
      const found = matchItem(request, indexed);
      if (found.kind === 'ambiguous') {
        ambiguous.push({ name: request.name, reason: found.reason, candidates: found.candidates });
        continue;
      }
      let source: Data | null = null;
      let origin = 'custom (not in compendium)';
      if (found.kind === 'found') {
        try {
          const pack = game.packs.get(found.candidate.packId);
          const loaded = (await pack?.getDocument(found.candidate.id)) as
            { toObject(): Data; uuid?: string } | null | undefined;
          if (!loaded) throw new Error(`entry ${found.candidate.id} could not be loaded`);
          source = loaded.toObject();
          origin = `${found.candidate.packId}${found.grouped ? ' (grouped template)' : ''}`;
          if (found.alsoIn.length)
            warnings.push(
              `"${request.name}" is also in ${found.alsoIn.join(', ')}; taken from ${found.candidate.packId}, which comes first.`
            );
          if (loaded.uuid) source['_stats'] = { compendiumSource: loaded.uuid };
        } catch (error) {
          failed.push({ name: request.name, error: messageOf(error) });
          continue;
        }
      } else {
        notFound.push(request.name);
        warnings.push(
          `"${request.name}" is in no item compendium${request.type ? ` as ${request.type}` : ''}; a blank ${request.type ?? 'trapping'} was added. Fill it on the sheet or check the spelling.`
        );
      }
      const built = itemData(request, source);
      if (source && isRecord(source['_stats'])) built.data['_stats'] = source['_stats'];
      warnings.push(...built.warnings);
      const type = text(built.data['type']);
      const duplicate = existing.find(
        item => item['type'] === type && sameName(item['name'], request.name)
      );
      if (duplicate && (type === 'skill' || type === 'career')) {
        skipped.push({
          name: request.name,
          reason: `the actor already has the ${type} "${text(duplicate['name'])}" (id ${idOf(duplicate)})`,
        });
        continue;
      }
      if (duplicate)
        warnings.push(
          `The actor already had a ${type} named "${text(duplicate['name'])}"; a second one was added.`
        );
      planned.push({
        request,
        data: built.data,
        source: origin,
        candidate: found.kind === 'found' ? found.candidate : null,
      });
    }

    if (!planned.length) {
      throw new QueryError(
        'NOTHING_ADDED',
        `No items could be added to "${actor.name}" (id ${actor.id}). ${JSON.stringify({ ambiguous, failed, skipped, warnings })}`
      );
    }

    const currents = planned.filter(
      entry => entry.data['type'] === 'career' && at(entry.data, 'system.current.value') === true
    );
    if (currents.length > 1) {
      warnings.push(
        `setCurrent was given for ${currents.length} careers; only the last, "${currents[currents.length - 1]?.request.name}", is current.`
      );
      for (const entry of currents.slice(0, -1))
        (entry.data['system'] as Data)['current'] = { value: false };
    }

    const before = new Set(actor.items.map(item => item.id));
    try {
      await actor.createEmbeddedDocuments(
        'Item',
        planned.map(entry => entry.data)
      );
    } catch (error) {
      throw new QueryError(
        'FOUNDRY_API',
        `Foundry refused to add the items to "${actor.name}": ${messageOf(error)}. Nothing was added.`
      );
    }

    // Foundry does not promise the order of created documents: match by name and type, never by position.
    const fresh = actor.toObject();
    const unclaimed = itemsOf(fresh).filter(item => !before.has(idOf(item)));
    const added: Data[] = [];
    const mismatches: string[] = [];
    let chosenCareer: string | null = null;
    for (const entry of planned) {
      const index = unclaimed.findIndex(
        item => item['name'] === entry.data['name'] && item['type'] === entry.data['type']
      );
      const item = index >= 0 ? unclaimed.splice(index, 1)[0] : undefined;
      if (!item) {
        mismatches.push(
          `"${text(entry.data['name'])}" (${text(entry.data['type'])}) was sent but is not on the actor afterwards`
        );
        continue;
      }
      const result: Data = {
        id: idOf(item),
        name: item['name'],
        type: item['type'],
        source: entry.source,
      };
      if (entry.request.advances !== undefined && item['type'] === 'skill') {
        const skill = skillValue(item, systemOf(fresh));
        Object.assign(result, {
          advances: skill.advances,
          total: skill.total,
          characteristic: skill.characteristic,
        });
        if (skill.advances !== entry.request.advances)
          mismatches.push(
            `"${text(item['name'])}" has ${skill.advances} advances instead of ${entry.request.advances}`
          );
      }
      if (
        entry.request.quantity !== undefined &&
        at(entry.data, 'system.quantity.value') !== undefined
      ) {
        const stored = at(item, 'system.quantity.value');
        result['quantity'] = stored;
        if (stored !== entry.request.quantity)
          mismatches.push(
            `"${text(item['name'])}" has quantity ${JSON.stringify(stored)} instead of ${entry.request.quantity}`
          );
      }
      if (item['type'] === 'career') {
        result['current'] = at(item, 'system.current.value') === true;
        if (result['current']) chosenCareer = idOf(item);
      }
      added.push(result);
    }

    if (chosenCareer) {
      const others = actor.items
        .filter(item => item.type === 'career' && item.id !== chosenCareer)
        .filter(item => at(item.toObject(), 'system.current.value') === true)
        .map(item => ({ _id: item.id, 'system.current.value': false }));
      if (others.length) {
        try {
          await actor.updateEmbeddedDocuments('Item', others);
        } catch (error) {
          warnings.push(`The other careers could not be set to not current: ${messageOf(error)}`);
        }
        const still = actor.items.filter(
          item =>
            item.type === 'career' &&
            item.id !== chosenCareer &&
            at(item.toObject(), 'system.current.value') === true
        );
        if (still.length)
          mismatches.push(
            `careers ${still.map(item => `"${item.name}"`).join(', ')} are still current`
          );
      }
    }

    context.recordChange({
      query: 'addWfrp4eItems',
      tool,
      document: 'Actors',
      action: 'update',
      targets: [
        { id: actor.id, uuid: actor.uuid, name: actor.name, documentName: 'Actor' },
        ...added.map(entry => ({
          id: String(entry['id']),
          name: String(entry['name']),
          documentName: 'Item',
        })),
      ],
      summary: `Added ${added.length} item(s) to "${actor.name}".`,
    });
    const blanks = planned.filter(entry => !entry.candidate).map(entry => text(entry.data['name']));
    if (blanks.length)
      wfrpNotes.announce('blankItems', {
        count: blanks.length,
        actor: actor.name,
        names: blanks.join(', '),
      });
    context.progress({ progress: requests.length, total: requests.length, message: 'Items added' });

    return {
      complete: !notFound.length && !ambiguous.length && !failed.length && !mismatches.length,
      summary: `Items for "${actor.name}": ${added.length} added (${blanks.length} blank), ${skipped.length} skipped, ${ambiguous.length} ambiguous, ${failed.length} failed.`,
      actor: { id: actor.id, name: actor.name, via: match.via },
      actorId: actor.id,
      actorName: actor.name,
      added,
      notFound,
      ambiguous,
      failed,
      skipped,
      warnings,
      mismatches,
    };
  },
};
