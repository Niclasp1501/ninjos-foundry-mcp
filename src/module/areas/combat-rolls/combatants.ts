/**
 * Adding, removing and changing combatants.
 *
 * Combatants belong to their encounter, so every change here is a change of
 * the encounter, also removing one (as removing a token changes its scene in
 * the tokens-dice area). Every id is resolved before the first write; one miss stops
 * all. Each write is read back before it counts as done.
 */
import type { QueryHandler } from '../../dispatcher.js';
import { requireWorld } from '../../world-ready.js';
import {
  argsOf,
  chooseScene,
  fail,
  finiteNumber,
  operation,
  optionalBoolean,
  sceneInfo,
} from '../tokens-dice/support.js';
import { accessProblemOf, combatAccess, writeRule } from './access.js';
import {
  combatSummary,
  currentCombatant,
  findCombat,
  findCombatant,
  findCombatants,
  keepCurrentTurn,
  nameOf,
  orderSummary,
  recordCombat,
  reread,
  sceneOfCombat,
  stateOf,
  stringList,
  tokensOnScene,
  turnContext,
} from './encounter.js';

export const addCombatants: QueryHandler = {
  access: data => writeRule('update', data),
  run: (raw, context) =>
    operation('add combatants', async () => {
      requireWorld();
      const args = argsOf(raw);
      const combat = findCombat(args);
      const ids = stringList(args, 'tokenIds') ?? [];
      if (!ids.length) fail('INVALID_ARGUMENT', 'tokenIds must name at least one token.');
      const linked = sceneOfCombat(combat);
      const chosen = linked ? { scene: linked, by: 'parameter' as const } : chooseScene(args);
      if (linked && args['sceneIdentifier'] !== undefined) {
        const named = chooseScene(args);
        if (named.scene.id !== linked.id)
          fail(
            'SCENE_MISMATCH',
            `The encounter [${combat.id}] belongs to the scene "${linked.name ?? ''}" [${linked.id}], not "${named.scene.name ?? ''}". Its combatants come from its own scene.`
          );
      }
      const tokens = tokensOnScene(chosen.scene, ids, chosen.by);
      const present = (tokenId: string) =>
        combat.combatants.some(
          c => c.tokenId === tokenId && (c.sceneId ?? chosen.scene.id) === chosen.scene.id
        );
      const already = tokens.filter(token => present(token.id));
      const toAdd = tokens.filter(token => !present(token.id));
      const alreadyInCombat = already.map(token => ({ tokenId: token.id, name: token.name ?? '' }));
      if (args['dryRun'] === true)
        return {
          dryRun: true,
          combat: combatSummary(combat),
          scene: sceneInfo(chosen),
          wouldAdd: toAdd.map(token => ({ tokenId: token.id, name: token.name ?? '' })),
          alreadyInCombat,
          accessProblem: accessProblemOf(context, () => combatAccess('update')),
        };
      if (!toAdd.length)
        return {
          success: true,
          changed: false,
          message: 'Every token is already in the encounter.',
          alreadyInCombat,
        };

      const before = stateOf(combat);
      await combat.createEmbeddedDocuments(
        'Combatant',
        toAdd.map(token => ({
          tokenId: token.id,
          sceneId: chosen.scene.id,
          actorId: token.actorId ?? null,
          hidden: token.hidden === true,
        }))
      );
      const fresh = reread(combat) ?? combat;
      const added = toAdd.map(token => ({
        token,
        combatant: fresh.combatants.find(c => c.tokenId === token.id),
      }));
      const missing = added.filter(entry => !entry.combatant);
      if (missing.length)
        fail(
          'NOT_APPLIED',
          `These tokens are not in the encounter after adding: ${missing.map(e => e.token.id).join(', ')}.`
        );
      recordCombat(context, {
        query: 'addCombatants',
        tool: 'add-combatants',
        action: 'update',
        combat,
        summary: `Added ${toAdd.length} combatant(s) to combat encounter ${combat.id}`,
        before,
      });
      return {
        success: true,
        changed: true,
        added: added.map(entry => ({
          combatantId: entry.combatant?.id ?? null,
          tokenId: entry.token.id,
          name: entry.combatant ? nameOf(entry.combatant) : (entry.token.name ?? ''),
        })),
        alreadyInCombat,
        combat: combatSummary(fresh),
        turnOrder: orderSummary(fresh),
      };
    }),
};

export const removeCombatants: QueryHandler = {
  access: data => writeRule('update', data),
  run: (raw, context) =>
    operation('remove combatants', async () => {
      requireWorld();
      const args = argsOf(raw);
      const combat = findCombat(args);
      const targets = findCombatants(combat, args);
      const listed = targets.map(c => ({
        combatantId: c.id,
        name: nameOf(c),
        tokenId: c.tokenId ?? null,
      }));
      if (args['dryRun'] === true)
        return {
          dryRun: true,
          combat: combatSummary(combat),
          wouldRemove: listed,
          accessProblem: accessProblemOf(context, () => combatAccess('update')),
        };
      const before = stateOf(combat);
      await combat.deleteEmbeddedDocuments(
        'Combatant',
        targets.map(c => c.id)
      );
      const fresh = reread(combat) ?? combat;
      const left = targets.filter(c => fresh.combatants.get(c.id));
      if (left.length)
        fail(
          'NOT_APPLIED',
          `Still in the encounter after removing: ${left.map(c => c.id).join(', ')}.`
        );
      recordCombat(context, {
        query: 'removeCombatants',
        tool: 'remove-combatants',
        action: 'update',
        combat,
        summary: `Removed ${targets.length} combatant(s) from combat encounter ${combat.id}`,
        before,
      });
      return {
        success: true,
        removed: listed,
        combat: combatSummary(fresh),
        turnOrder: orderSummary(fresh),
        currentTurn: turnContext(fresh),
      };
    }),
};

export const updateCombatant: QueryHandler = {
  access: combatAccess('update'),
  run: (raw, context) =>
    operation('update combatant', async () => {
      requireWorld();
      const args = argsOf(raw);
      const combat = findCombat(args);
      const combatant = findCombatant(combat, args);
      const wanted: Record<string, unknown> = {};
      if (args['initiative'] !== undefined) {
        const value = args['initiative'];
        if (value !== null && !finiteNumber(value))
          fail('INVALID_ARGUMENT', 'initiative must be a number, or null to clear it.');
        wanted['initiative'] = value;
      }
      const hidden = optionalBoolean(args, 'hidden');
      const defeated = optionalBoolean(args, 'defeated');
      if (hidden !== undefined) wanted['hidden'] = hidden;
      if (defeated !== undefined) wanted['defeated'] = defeated;
      if (!Object.keys(wanted).length)
        fail('INVALID_ARGUMENT', 'Nothing to change: pass initiative, hidden or defeated.');

      const stored = combatant as unknown as Record<string, unknown>;
      const current = (key: string) =>
        key === 'initiative'
          ? finiteNumber(stored[key])
            ? stored[key]
            : null
          : stored[key] === true;
      const changes = Object.fromEntries(
        Object.entries(wanted).filter(([key, value]) => current(key) !== value)
      );
      const name = nameOf(combatant);
      if (!Object.keys(changes).length)
        return {
          success: true,
          changed: false,
          message: `"${name}" already has these values.`,
          combatant: { id: combatant.id, name },
        };

      const before = stateOf(combat);
      const actingId = currentCombatant(combat)?.id ?? null;
      await combatant.update(changes);
      if ('initiative' in changes) await keepCurrentTurn(combat, actingId);
      const fresh = reread(combat) ?? combat;
      const after = fresh.combatants.get(combatant.id) as unknown as
        Record<string, unknown> | undefined;
      if (!after)
        fail('NOT_APPLIED', `Combatant "${name}" [${combatant.id}] is gone after the change.`);
      const readBack = (key: string) =>
        key === 'initiative' ? (finiteNumber(after[key]) ? after[key] : null) : after[key] === true;
      const differing = Object.entries(changes).filter(([key, value]) => readBack(key) !== value);
      if (differing.length === Object.keys(changes).length)
        fail(
          'NOT_APPLIED',
          `Foundry stored none of the changes to "${name}": ${differing.map(([k]) => k).join(', ')}.`
        );
      recordCombat(context, {
        query: 'updateCombatant',
        tool: 'update-combatant',
        action: 'update',
        combat,
        summary: `Changed ${Object.keys(changes).join(', ')} of combatant ${name} in combat encounter ${combat.id}`,
        before,
      });
      const notes =
        'defeated' in changes
          ? [
              'Only the combatant flag changed. A defeated condition on the token is separate: toggle-token-condition sets it.',
            ]
          : [];
      return {
        success: true,
        changed: true,
        combatant: { id: combatant.id, name },
        applied: Object.fromEntries(Object.keys(changes).map(key => [key, readBack(key)])),
        ...(differing.length
          ? {
              warnings: differing.map(
                ([key, value]) =>
                  `${key}: asked ${JSON.stringify(value)}, stored ${JSON.stringify(readBack(key))}`
              ),
            }
          : {}),
        combat: combatSummary(fresh),
        turnOrder: orderSummary(fresh),
        ...(notes.length ? { notes } : {}),
      };
    }),
};
