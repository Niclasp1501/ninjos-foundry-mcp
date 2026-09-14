/**
 * Starting an encounter and moving through its turns.
 *
 * The moves go through Foundry's own methods (nextTurn, previousRound, ...),
 * so the settings of the tracker and the hooks of systems and modules apply.
 * Setting a turn writes `turn` directly. Each answer compares before and
 * after; a move Foundry does not make is reported as unchanged, not as done.
 */
import { QueryError, type HandlerContext, type QueryHandler } from '../../dispatcher.js';
import { requireWorld } from '../../world-ready.js';
import {
  argsOf,
  fail,
  messageOf,
  operation,
  optionalText,
  requiredText,
} from '../tokens-dice/support.js';
import { combatAccess } from './access.js';
import {
  combatSummary,
  currentCombatant,
  findCombat,
  findCombatant,
  nameOf,
  orderSummary,
  recordCombat,
  reread,
  stateOf,
  turnContext,
  turnOrder,
  type Combat,
} from './encounter.js';

const MOVES = {
  'next-turn': 'nextTurn',
  'previous-turn': 'previousTurn',
  'next-round': 'nextRound',
  'previous-round': 'previousRound',
} as const;

export const TURN_ACTIONS = [...Object.keys(MOVES), 'set-turn'] as const;

function position(combat: Combat) {
  const current = currentCombatant(combat);
  return {
    round: combat.round ?? 0,
    turn: typeof combat.turn === 'number' ? combat.turn : null,
    combatant: current ? { id: current.id, name: nameOf(current) } : null,
  };
}

type Position = ReturnType<typeof position>;

export interface StackPackage {
  kind: 'module' | 'system';
  id: string;
}

/**
 * The modules and systems whose files appear in an error stack, in order and
 * each once, so the first is where the error was thrown. Foundry serves their
 * code under /modules/<id>/ and /systems/<id>/.
 */
export function packagesInStack(stack: unknown): StackPackage[] {
  if (typeof stack !== 'string') return [];
  const found: StackPackage[] = [];
  for (const match of stack.matchAll(/\/(modules|systems)\/([^/\s?#)]+)\//g)) {
    const kind = match[1] === 'systems' ? 'system' : 'module';
    const id = match[2] ?? '';
    if (id && !found.some(entry => entry.kind === kind && entry.id === id))
      found.push({ kind, id });
  }
  return found;
}

const at = (place: Position) => `round ${place.round}, turn ${place.turn ?? 'none'}`;

/**
 * Seen in a real world: Combat#nextTurn threw inside the module
 * monks-combat-details without a canvas, and the tool only passed on "Cannot
 * read properties of undefined". Foundry's method stays the way to move, but a
 * failure names the method, the package that threw and whether anything
 * changed. Nothing is faked; a change that happened anyway is logged.
 */
async function foundryMove(
  combat: Combat,
  method: string,
  move: () => Promise<unknown>,
  context: HandlerContext,
  action: string
): Promise<void> {
  const before = position(combat);
  const state = stateOf(combat);
  try {
    await move();
  } catch (error) {
    const packages = packagesInStack(error instanceof Error ? error.stack : undefined);
    const [first, ...others] = packages;
    const where = first
      ? ` in the ${first.kind} "${first.id}"`
      : ' in Foundry itself (no module or system appears in the error stack)';
    const also = others.length
      ? ` The stack also passes through ${others.map(entry => `the ${entry.kind} "${entry.id}"`).join(', ')}.`
      : '';
    const fresh = reread(combat);
    const now = fresh ? position(fresh) : null;
    let outcome: string;
    if (!now) {
      outcome = ` The encounter [${combat.id}] is gone.`;
    } else if (now.round === before.round && now.turn === before.turn) {
      outcome = ` Nothing changed: the encounter is still in ${at(before)}.`;
    } else {
      outcome = ` The encounter moved anyway from ${at(before)} to ${at(now)}, and that change is logged.`;
      recordCombat(context, {
        query: 'changeCombatTurn',
        tool: 'change-combat-turn',
        action: 'update',
        combat,
        summary: `Combat encounter ${combat.id}: ${action} failed in ${method} but moved to ${at(now)}`,
        before: state,
      });
    }
    const hint =
      first?.kind === 'module'
        ? ` That module may need a drawn canvas; deactivating it or drawing the canvas lets Foundry's ${method} run without it.`
        : '';
    throw new QueryError(
      'FOUNDRY_ERROR',
      `Foundry's Combat#${method} threw "${messageOf(error)}"${where}.${also}${outcome}${hint}`
    );
  }
}

export const startCombat: QueryHandler = {
  access: combatAccess('update'),
  run: (raw, context) =>
    operation('start combat', async () => {
      requireWorld();
      const combat = findCombat(argsOf(raw));
      if ((combat.round ?? 0) > 0)
        return {
          success: true,
          changed: false,
          message: `The encounter is already running in round ${combat.round}.`,
          combat: combatSummary(combat),
          currentTurn: turnContext(combat),
        };
      if (!combat.combatants.size)
        fail('NO_COMBATANTS', 'The encounter has no combatants; add-combatants adds tokens first.');
      const before = stateOf(combat);
      const start = combat.startCombat;
      if (typeof start === 'function')
        await foundryMove(combat, 'startCombat', () => start.call(combat), context, 'start');
      else
        await foundryMove(
          combat,
          'update',
          () => combat.update({ round: 1, turn: 0 }),
          context,
          'start'
        );
      const fresh = reread(combat);
      if (!fresh || (fresh.round ?? 0) < 1)
        fail(
          'NOT_APPLIED',
          'Foundry did not start the encounter; a system or module may have prevented it.'
        );
      recordCombat(context, {
        query: 'startCombat',
        tool: 'start-combat',
        action: 'update',
        combat,
        summary: `Started combat encounter ${combat.id}`,
        before,
      });
      const unrolled = fresh.combatants.filter(c => typeof c.initiative !== 'number').map(nameOf);
      return {
        success: true,
        changed: true,
        combat: combatSummary(fresh),
        turnOrder: orderSummary(fresh),
        currentTurn: turnContext(fresh),
        ...(unrolled.length
          ? {
              notes: [
                `Without initiative, sorted last: ${unrolled.join(', ')}. roll-initiative rolls for them.`,
              ],
            }
          : {}),
        ...(fresh.active !== true
          ? {
              warnings: [
                'The encounter is not the active one; the tracker of the players may show another.',
              ],
            }
          : {}),
      };
    }),
};

export const changeCombatTurn: QueryHandler = {
  access: combatAccess('update'),
  run: (raw, context) =>
    operation('change combat turn', async () => {
      requireWorld();
      const args = argsOf(raw);
      const action = requiredText(args, 'action');
      if (!(TURN_ACTIONS as readonly string[]).includes(action))
        fail(
          'INVALID_ARGUMENT',
          `action must be one of ${TURN_ACTIONS.join(', ')}, got "${action}".`
        );
      const targetGiven =
        optionalText(args, 'combatantId') !== undefined ||
        optionalText(args, 'tokenId') !== undefined;
      if (action !== 'set-turn' && targetGiven)
        fail('INVALID_ARGUMENT', 'combatantId and tokenId only work with action "set-turn".');
      const combat = findCombat(args);
      if ((combat.round ?? 0) < 1)
        fail('NOT_STARTED', 'The encounter has not started; start-combat starts it in round 1.');
      const before = position(combat);
      const state = stateOf(combat);

      if (action === 'set-turn') {
        const target = findCombatant(combat, args);
        const index = turnOrder(combat).findIndex(c => c.id === target.id);
        if (index !== combat.turn)
          await foundryMove(
            combat,
            'update',
            () => combat.update({ turn: index }),
            context,
            action
          );
      } else {
        const name = MOVES[action as keyof typeof MOVES];
        const method = combat[name];
        if (typeof method !== 'function') fail('FOUNDRY_API', `Foundry's Combat has no ${name}.`);
        await foundryMove(combat, name, () => method.call(combat), context, action);
      }

      const fresh = reread(combat);
      if (!fresh) fail('NOT_APPLIED', `The encounter [${combat.id}] is gone after the change.`);
      const after = position(fresh);
      const changed = after.round !== before.round || after.turn !== before.turn;
      if (changed)
        recordCombat(context, {
          query: 'changeCombatTurn',
          tool: 'change-combat-turn',
          action: 'update',
          combat,
          summary: `Combat encounter ${combat.id}: ${action} to round ${after.round}, turn ${after.turn ?? 'none'}`,
          before: state,
        });
      return {
        success: true,
        changed,
        action,
        before,
        after,
        ...(changed
          ? {}
          : { message: `Foundry kept round ${after.round}, turn ${after.turn ?? 'none'}.` }),
        combat: combatSummary(fresh),
        turnOrder: orderSummary(fresh),
        currentTurn: turnContext(fresh),
      };
    }),
};
