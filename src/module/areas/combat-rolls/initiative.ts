/**
 * Rolling initiative.
 *
 * The formula is the game system's own, through Foundry's
 * Combatant#getInitiativeRoll, so no adapter is needed and no system is
 * treated like another. Only where that method is missing does the formula
 * come from the arguments or CONFIG.Combat.initiative.
 *
 * Every roll is evaluated before anything is stored, the totals are written in
 * one update, the acting combatant keeps its turn, and every total is read
 * back. Foundry's rollInitiative is not used, because it always posts to the
 * chat; here the chat is only written with `toChat`. A hidden combatant's roll
 * is never posted publicly.
 */
import {
  CombatRuleError,
  selectForInitiative,
  type InitiativeCandidate,
} from '../../../common/areas/combat-rolls/rules.js';
import type { QueryHandler } from '../../dispatcher.js';
import { requireWorld } from '../../world-ready.js';
import {
  argsOf,
  fail,
  finiteNumber,
  isRecord,
  messageOf,
  operation,
  optionalBoolean,
  optionalText,
} from '../tokens-dice/support.js';
import { writeRule } from './access.js';
import {
  checkFormula,
  evaluateRoll,
  postRoll,
  rollClassOf,
  rollDataOf,
  rollModeOf,
  type PostedRoll,
} from './dice.js';
import {
  combatSummary,
  currentCombatant,
  findCombat,
  initiativeOf,
  isNPC,
  keepCurrentTurn,
  nameOf,
  orderSummary,
  recordCombat,
  reread,
  stateOf,
  stringList,
  turnContext,
  type Combatant,
} from './encounter.js';
import { chatTexts } from './texts.js';

function configuredFormula(): string | null {
  const combat = (CONFIG as Record<string, unknown>)['Combat'];
  const initiative = isRecord(combat) ? combat['initiative'] : undefined;
  const formula = isRecord(initiative) ? initiative['formula'] : undefined;
  return typeof formula === 'string' && formula.trim() ? formula : null;
}

export const rollInitiative: QueryHandler = {
  access: data => writeRule('update', data),
  run: (raw, context) =>
    operation('roll initiative', async () => {
      requireWorld();
      const args = argsOf(raw);
      const combat = findCombat(args);
      const scope = optionalText(args, 'scope') ?? 'all';
      if (scope !== 'all' && scope !== 'npcs')
        fail('INVALID_ARGUMENT', `scope must be "all" or "npcs", got "${scope}".`);
      const onlyMissing = optionalBoolean(args, 'onlyMissing') !== false;
      const ids = stringList(args, 'combatantIds');
      const formula = optionalText(args, 'formula')?.trim() || null;
      const toChat = optionalBoolean(args, 'toChat') === true;
      const mode = rollModeOf(args);
      const notes: string[] = [];
      if (ids && (args['scope'] !== undefined || args['onlyMissing'] !== undefined))
        notes.push('scope and onlyMissing were ignored: combatantIds names the combatants.');
      if (!toChat && args['rollMode'] !== undefined)
        notes.push('rollMode was ignored: without toChat nothing is posted.');

      const byId = new Map(combat.combatants.contents.map(c => [c.id, c]));
      const candidates: InitiativeCandidate[] = combat.combatants.contents.map(c => ({
        id: c.id,
        name: nameOf(c),
        initiative: initiativeOf(c),
        isNPC: isNPC(c),
      }));
      let selection;
      try {
        selection = selectForInitiative(candidates, {
          ...(ids ? { ids } : {}),
          scope,
          onlyMissing,
        });
      } catch (error) {
        if (error instanceof CombatRuleError) fail(error.code, error.message);
        throw error;
      }
      const chosen = selection.selected.map(entry => byId.get(entry.id) as Combatant);
      if (!chosen.length)
        return {
          success: true,
          changed: false,
          message:
            'No combatant needed an initiative roll; onlyMissing false rolls again for those that have one.',
          skipped: selection.skipped,
          combat: combatSummary(combat),
        };

      const RollClass = rollClassOf();
      if (formula) checkFormula(RollClass, formula);
      const fallback = formula ?? configuredFormula();
      const withoutMethod = chosen.filter(c => typeof c.getInitiativeRoll !== 'function');
      if (withoutMethod.length && !fallback)
        fail(
          'NO_INITIATIVE_FORMULA',
          `No initiative formula for ${withoutMethod.map(nameOf).join(', ')}: the game system gives none. Pass formula, e.g. "1d20".`
        );

      const rolled: Array<{ combatant: Combatant; roll: FoundryCombatRollsRoll }> = [];
      for (const combatant of chosen) {
        let roll: FoundryCombatRollsRoll;
        try {
          roll =
            typeof combatant.getInitiativeRoll === 'function'
              ? formula
                ? combatant.getInitiativeRoll(formula)
                : combatant.getInitiativeRoll()
              : new RollClass(fallback as string, rollDataOf(combatant.actor));
        } catch (error) {
          return fail(
            'ROLL_FAILED',
            `The initiative roll of "${nameOf(combatant)}" could not be built: ${messageOf(error)}. Nothing was stored.`
          );
        }
        await evaluateRoll(
          roll,
          `The initiative roll of "${nameOf(combatant)}" (nothing was stored)`
        );
        rolled.push({ combatant, roll });
      }

      const before = stateOf(combat);
      const actingId = currentCombatant(combat)?.id ?? null;
      await combat.updateEmbeddedDocuments(
        'Combatant',
        rolled.map(entry => ({ _id: entry.combatant.id, initiative: entry.roll.total }))
      );
      await keepCurrentTurn(combat, actingId);
      const fresh = reread(combat) ?? combat;
      const wrong = rolled.filter(
        entry => fresh.combatants.get(entry.combatant.id)?.initiative !== entry.roll.total
      );
      if (wrong.length)
        fail(
          'NOT_APPLIED',
          `Foundry did not store the initiative of ${wrong.map(e => nameOf(e.combatant)).join(', ')}.`
        );

      const posted = new Map<string, PostedRoll>();
      const problems: string[] = [];
      if (toChat) {
        for (const { combatant, roll } of rolled) {
          const hiddenPublic = combatant.hidden === true && mode === 'publicroll';
          if (hiddenPublic)
            notes.push(`"${nameOf(combatant)}" is hidden, so its roll was posted as gmroll.`);
          try {
            posted.set(
              combatant.id,
              await postRoll(roll, {
                flavor: chatTexts.text('initiativeFlavor', { name: nameOf(combatant) }),
                mode: hiddenPublic ? 'gmroll' : mode,
                speaker: {
                  actor: combatant.actorId ?? null,
                  token: combatant.tokenId ?? null,
                  scene: combatant.sceneId ?? null,
                  alias: nameOf(combatant),
                },
              })
            );
          } catch (error) {
            problems.push(`${nameOf(combatant)}: ${messageOf(error)}`);
          }
        }
      }
      recordCombat(context, {
        query: 'rollInitiative',
        tool: 'roll-initiative',
        action: 'update',
        combat,
        summary: `Rolled initiative for ${rolled.length} combatant(s) in combat encounter ${combat.id}`,
        before,
        withChat: posted.size > 0,
      });
      const results = rolled.map(({ combatant, roll }) => ({
        combatantId: combatant.id,
        name: nameOf(combatant),
        formula: roll.formula,
        total: roll.total ?? null,
        chat: posted.get(combatant.id) ?? null,
      }));
      if (problems.length)
        fail(
          'NOT_APPLIED',
          `Initiative was stored (${results.map(r => `${r.name} ${r.total}`).join(', ')}), but posting failed: ${problems.join(' ')}`
        );
      return {
        success: true,
        changed: true,
        rolled: results,
        skipped: selection.skipped,
        combat: combatSummary(fresh),
        turnOrder: orderSummary(fresh),
        currentTurn: turnContext(fresh),
        ...(notes.length ? { notes } : {}),
      };
    }),
};

export { finiteNumber };
