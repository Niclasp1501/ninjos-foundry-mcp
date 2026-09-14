/**
 * Listing, reading, creating and ending combat encounters.
 *
 * Ending: Foundry's own "End Combat" deletes the encounter. Deleting follows
 * the rule for kinds without a level and is refused, so end-combat stops an
 * encounter instead (round 0, no turn, not active) and keeps combatants and
 * initiatives; `deleteEncounter` asks for the deletion and meets the refusal
 * until encounters have a level.
 */
import type { QueryHandler } from '../../dispatcher.js';
import { requireWorld } from '../../world-ready.js';
import {
  argsOf,
  chooseScene,
  fail,
  operation,
  optionalBoolean,
  sceneInfo,
} from '../tokens-dice/support.js';
import { accessProblemOf, combatAccess, READ_ONLY } from './access.js';
import {
  allCombats,
  combatSummary,
  findCombat,
  orderSummary,
  recordCombat,
  reread,
  stateOf,
  stringList,
  tokensOnScene,
  turnContext,
  type Combat,
} from './encounter.js';

export const listCombats: QueryHandler = {
  access: READ_ONLY,
  run: () =>
    operation('list combats', () => {
      requireWorld();
      const shown = (game.scenes.contents as FoundryTokensDiceScene[]).find(s => s.active === true);
      return {
        combats: allCombats().map(combatSummary),
        activeScene: shown ? { id: shown.id, name: shown.name ?? '' } : null,
      };
    }),
};

export const getCombat: QueryHandler = {
  access: READ_ONLY,
  run: raw =>
    operation('get combat', () => {
      requireWorld();
      const combat = findCombat(argsOf(raw));
      return {
        combat: combatSummary(combat),
        turnOrder: orderSummary(combat),
        currentTurn: turnContext(combat),
      };
    }),
};

function combatClass(): FoundryCombatRollsDocumentClass {
  const candidate = (globalThis as { Combat?: unknown }).Combat as
    FoundryCombatRollsDocumentClass | undefined;
  if (typeof candidate?.create !== 'function')
    fail('FOUNDRY_API', "Foundry's Combat document class is not available");
  return candidate;
}

export const createCombat: QueryHandler = {
  access: data => (argsOf(data)['dryRun'] === true ? READ_ONLY : combatAccess('create')),
  run: (raw, context) =>
    operation('create combat', async () => {
      requireWorld();
      const args = argsOf(raw);
      const unlinked = optionalBoolean(args, 'unlinked') === true;
      const activate = optionalBoolean(args, 'activate') !== false;
      const ids = stringList(args, 'tokenIds') ?? [];
      if (unlinked && (ids.length || args['sceneIdentifier'] !== undefined))
        fail(
          'INVALID_ARGUMENT',
          'An unlinked encounter has no scene: leave out tokenIds and sceneIdentifier.'
        );
      const chosen = unlinked ? null : chooseScene(args);
      const tokens = chosen ? tokensOnScene(chosen.scene, ids, chosen.by) : [];
      const plan = {
        scene: chosen ? sceneInfo(chosen) : null,
        activate,
        combatants: tokens.map(token => ({ tokenId: token.id, name: token.name ?? '' })),
      };
      if (args['dryRun'] === true)
        return {
          dryRun: true,
          ...plan,
          accessProblem: accessProblemOf(context, () => combatAccess('create')),
        };

      const created = await combatClass().create({
        scene: chosen?.scene.id ?? null,
        active: activate,
      });
      const createdId = (created as { id?: unknown } | null)?.id;
      const combat =
        typeof createdId === 'string'
          ? (game.combats.get(createdId) as Combat | undefined)
          : undefined;
      if (!combat)
        fail('NOT_CREATED', 'The new combat encounter does not read back from the world.');
      const where = chosen ? `on scene "${chosen.scene.name ?? ''}"` : 'without scene';
      recordCombat(context, {
        query: 'createCombat',
        tool: 'create-combat',
        action: 'create',
        combat,
        summary: `Created combat encounter ${where}`,
      });

      const warnings: string[] = [];
      if (tokens.length && chosen) {
        try {
          await combat.createEmbeddedDocuments(
            'Combatant',
            tokens.map(token => ({
              tokenId: token.id,
              sceneId: chosen.scene.id,
              actorId: token.actorId ?? null,
              hidden: token.hidden === true,
            }))
          );
        } catch (error) {
          fail(
            'PARTIAL',
            `The encounter [${combat.id}] was created and stays, but its combatants were not added: ` +
              `${error instanceof Error ? error.message : String(error)}. add-combatants can add them.`
          );
        }
        const fresh = reread(combat);
        const missing = tokens.filter(
          token => !fresh?.combatants.some(c => c.tokenId === token.id)
        );
        if (missing.length)
          fail(
            'NOT_APPLIED',
            `The encounter [${combat.id}] was created, but these tokens are not in it after adding: ${missing.map(t => t.id).join(', ')}.`
          );
      }
      if (activate && reread(combat)?.active !== true) {
        await combat.activate?.();
        if (reread(combat)?.active !== true)
          warnings.push('Foundry did not make the new encounter the active one.');
      }
      const final = reread(combat) ?? combat;
      return {
        success: true,
        combat: combatSummary(final),
        turnOrder: orderSummary(final),
        ...(warnings.length ? { warnings } : {}),
      };
    }),
};

export const endCombat: QueryHandler = {
  access: data => {
    const args = argsOf(data);
    if (args['dryRun'] === true) return READ_ONLY;
    return combatAccess(args['deleteEncounter'] === true ? 'delete' : 'update');
  },
  run: (raw, context) =>
    operation('end combat', async () => {
      requireWorld();
      const args = argsOf(raw);
      const remove = optionalBoolean(args, 'deleteEncounter') === true;
      const combat = findCombat(args);
      const summary = combatSummary(combat);
      if (args['dryRun'] === true)
        return {
          dryRun: true,
          combat: summary,
          wouldDelete: remove,
          accessProblem: accessProblemOf(context, () => combatAccess(remove ? 'delete' : 'update')),
        };

      const before = stateOf(combat);
      if (remove) {
        await combat.delete();
        if (reread(combat))
          fail('NOT_APPLIED', `The encounter [${combat.id}] still exists after deleting it.`);
        recordCombat(context, {
          query: 'endCombat',
          tool: 'end-combat',
          action: 'delete',
          combat,
          summary: `Deleted combat encounter ${combat.id}`,
          before,
        });
        return { success: true, deleted: true, combat: summary };
      }

      if (!summary.started && !summary.active)
        return {
          success: true,
          changed: false,
          message: 'The encounter is neither started nor active; nothing to end.',
          combat: summary,
        };
      await combat.update({ round: 0, turn: null, active: false });
      const fresh = reread(combat);
      if (!fresh || (fresh.round ?? 0) !== 0 || fresh.active === true)
        fail('NOT_APPLIED', `Foundry did not store the ended state of encounter [${combat.id}].`);
      recordCombat(context, {
        query: 'endCombat',
        tool: 'end-combat',
        action: 'update',
        combat,
        summary: `Ended combat encounter ${combat.id} after round ${summary.round}`,
        before,
      });
      return {
        success: true,
        changed: true,
        deleted: false,
        combat: combatSummary(fresh),
        note: 'The encounter is stopped and kept with its combatants and initiatives; start-combat starts it again in round 1.',
      };
    }),
};
