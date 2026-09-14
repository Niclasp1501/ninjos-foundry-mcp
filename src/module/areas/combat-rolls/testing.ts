/**
 * What the combat-rolls area needs beyond the default fake:
 *
 * - Combat with a sorted `turns`, `activate`, `startCombat` and the four moves
 * - Combatant with `actor`, `token` and optionally `getInitiativeRoll`
 * - Actor with `getRollData` (its `system` data)
 * - a `Roll` class that takes its totals from a queue and reports one die
 * - `ChatMessage.create` that stamps the author, as Foundry's server does
 * - `CONFIG.Combat.initiative.formula`
 *
 * The moves imitate what the tracker does, without its settings. Call before
 * seeding: document types only shape documents created afterwards.
 */
import { compareTurnOrder } from '../../../common/areas/combat-rolls/rules.js';
import type { FakeDocument, FakeFoundry } from '../../../testing/fake-foundry.js';

export interface CombatRollsFakeOptions {
  /** Totals of evaluated rolls, in order; afterwards 10. */
  totals?: number[];
  /** Give combatants Foundry's getInitiativeRoll. Default true. */
  initiativeRoll?: boolean;
  /** CONFIG.Combat.initiative.formula; null for none. Default "1d20". */
  initiativeFormula?: string | null;
  /** Change the data of a chat message before it is stored, e.g. to drop recipients. */
  alterMessage?: (data: Record<string, unknown>) => Record<string, unknown>;
}

export interface CombatRollsFake {
  foundry: FakeFoundry;
  rolls: Array<{ formula: string; data: Record<string, unknown>; options: unknown }>;
}

function hidden(target: FakeDocument, name: string, value: unknown): void {
  Object.defineProperty(target, name, {
    value,
    enumerable: false,
    configurable: true,
    writable: true,
  });
}

export function withCombatRolls(
  foundry: FakeFoundry,
  options: CombatRollsFakeOptions = {}
): CombatRollsFake {
  const fake: CombatRollsFake = { foundry, rolls: [] };
  const totals = [...(options.totals ?? [])];

  class FakeRoll {
    formula: string;
    data: Record<string, unknown>;
    total: number | undefined;
    result: string | undefined;
    dice: Array<Record<string, unknown>> = [];
    constructor(formula: string, data: Record<string, unknown> = {}) {
      this.formula = formula;
      this.data = data;
    }
    static validate(formula: string): boolean {
      return /\d/.test(formula) && /^[\d\sdDkhlx+\-*/().@a-zA-Z]+$/.test(formula);
    }
    async evaluate(evaluateOptions: unknown = {}): Promise<this> {
      if (!FakeRoll.validate(this.formula))
        throw new Error(`Unable to parse the formula ${this.formula}`);
      fake.rolls.push({ formula: this.formula, data: this.data, options: evaluateOptions });
      this.total = totals.length ? (totals.shift() as number) : 10;
      const die = /(\d*)d(\d+)/.exec(this.formula);
      if (die) {
        const count = Number(die[1] || 1);
        this.dice = [
          {
            expression: die[0],
            faces: Number(die[2]),
            number: count,
            total: this.total,
            results: Array.from({ length: count }, (_, index) => ({
              result: index === 0 ? this.total : 0,
              active: true,
            })),
          },
        ];
      }
      this.result = String(this.total);
      return this;
    }
  }
  foundry.setGlobal('Roll', FakeRoll);
  foundry.setGlobal('CONFIG', {
    Combat: {
      initiative: {
        formula: options.initiativeFormula === undefined ? '1d20' : options.initiativeFormula,
      },
    },
  });

  foundry.defineDocumentType('Actor', {
    collection: 'actors',
    embedded: { Item: 'items', ActiveEffect: 'effects' },
    extend: actor => hidden(actor, 'getRollData', () => structuredClone(actor['system'] ?? {})),
  });

  foundry.defineDocumentType('Combatant', {
    extend: combatant => {
      const combat = () => combatant.parent;
      Object.defineProperty(combatant, 'token', {
        enumerable: false,
        configurable: true,
        get: () => {
          const scene = foundry
            .collection('Scene')
            .get(String(combatant['sceneId'] ?? combat()?.['scene']));
          return scene?.getEmbeddedCollection('Token').get(String(combatant['tokenId'])) ?? null;
        },
      });
      Object.defineProperty(combatant, 'actor', {
        enumerable: false,
        configurable: true,
        get: () => foundry.collection('Actor').get(String(combatant['actorId'])) ?? null,
      });
      if (options.initiativeRoll !== false) {
        hidden(combatant, 'getInitiativeRoll', (formula?: string) => {
          const actor = foundry.collection('Actor').get(String(combatant['actorId']));
          const data = (actor?.['system'] ?? {}) as Record<string, unknown>;
          return new FakeRoll(formula ?? '1d20 + @init', data);
        });
      }
    },
  });

  foundry.defineDocumentType('Combat', {
    collection: 'combats',
    embedded: { Combatant: 'combatants' },
    extend: combat => {
      const order = () =>
        combat.getEmbeddedCollection('Combatant').contents.sort((a, b) =>
          compareTurnOrder(
            {
              id: a.id,
              name: String(a['name'] ?? ''),
              initiative: typeof a['initiative'] === 'number' ? a['initiative'] : null,
            },
            {
              id: b.id,
              name: String(b['name'] ?? ''),
              initiative: typeof b['initiative'] === 'number' ? b['initiative'] : null,
            }
          )
        );
      Object.defineProperty(combat, 'turns', { enumerable: false, configurable: true, get: order });
      const round = () => (typeof combat['round'] === 'number' ? combat['round'] : 0);
      const turn = () => (typeof combat['turn'] === 'number' ? combat['turn'] : 0);
      hidden(combat, 'activate', () => combat.update({ active: true }));
      hidden(combat, 'startCombat', () => combat.update({ round: 1, turn: 0 }));
      hidden(combat, 'nextRound', () => combat.update({ round: round() + 1, turn: 0 }));
      hidden(combat, 'previousRound', () =>
        round() <= 1 ? combat.update({ turn: 0 }) : combat.update({ round: round() - 1, turn: 0 })
      );
      hidden(combat, 'nextTurn', () =>
        turn() + 1 >= order().length
          ? combat.update({ round: round() + 1, turn: 0 })
          : combat.update({ turn: turn() + 1 })
      );
      hidden(combat, 'previousTurn', () => {
        if (turn() > 0) return combat.update({ turn: turn() - 1 });
        if (round() <= 1) return Promise.resolve(combat);
        return combat.update({ round: round() - 1, turn: Math.max(order().length - 1, 0) });
      });
    },
  });

  foundry.setGlobal('ChatMessage', {
    ...foundry.documentClass('ChatMessage'),
    create: async (data: Record<string, unknown>) => {
      const user = foundry.game.user;
      const stored = options.alterMessage ? options.alterMessage({ ...data }) : data;
      const rolls = Array.isArray(stored['rolls'])
        ? stored['rolls'].map(roll => JSON.parse(JSON.stringify(roll)))
        : [];
      const message = foundry.seed('ChatMessage', { ...stored, rolls, author: user?.id ?? '' });
      foundry.operations.push({
        action: 'create',
        documentName: 'ChatMessage',
        id: message.id,
        data: message.toObject(),
        userId: user?.id ?? '',
      });
      foundry.hooks.callAll('createChatMessage', message, {}, user?.id ?? '');
      return message;
    },
  });
  return fake;
}
