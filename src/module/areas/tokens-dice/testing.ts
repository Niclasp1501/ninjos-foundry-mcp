/**
 * What the tokens-dice area needs beyond the default fake:
 *
 * - `token.actor`: the world actor of a linked token, an own actor per
 *   unlinked token (kept, so reading back sees the same one)
 * - optionally `actor.toggleStatusEffect`, Foundry's own way to set a status
 * - `CONFIG.statusEffects`
 * - a `Roll` class with `validate`, `evaluate` and a fixed total
 * - `ChatMessage.create` as Foundry's server handles it: every user may post,
 *   and the author is always the user who posts, whatever the data claims
 *
 * Call before seeding scenes and actors: document types only shape documents
 * created afterwards.
 */
import { FakeDocument, type FakeFoundry } from '../../../testing/fake-foundry.js';

export interface TokensDiceFakeOptions {
  statusEffects?: Array<Record<string, unknown>>;
  /** Give actors Foundry's toggleStatusEffect. Default false. */
  toggleStatusEffect?: boolean;
  /** Total of every evaluated roll. Default 14. */
  rollTotal?: number;
}

export interface TokensDiceFake {
  foundry: FakeFoundry;
  toggleCalls: Array<{ actor: string; statusId: string; active: boolean | undefined }>;
  rolls: string[];
}

export const DEFAULT_STATUS_EFFECTS = [
  { id: 'prone', name: 'EFFECT.StatusProne', img: 'icons/svg/falling.svg' },
  { id: 'blind', name: 'Blind', img: 'icons/svg/blind.svg' },
  { id: 'poisoned', label: 'Poisoned', icon: 'icons/svg/poison.svg' },
];

function method(target: FakeDocument, name: string, value: unknown): void {
  Object.defineProperty(target, name, { value, enumerable: false, configurable: true });
}

export function withTokensDice(
  foundry: FakeFoundry,
  options: TokensDiceFakeOptions = {}
): TokensDiceFake {
  const fake: TokensDiceFake = { foundry, toggleCalls: [], rolls: [] };
  const synthetic = new WeakMap<FakeDocument, FakeDocument>();

  if (options.toggleStatusEffect) {
    foundry.defineDocumentType('Actor', {
      collection: 'actors',
      embedded: { Item: 'items', ActiveEffect: 'effects' },
      extend: actor => {
        method(
          actor,
          'toggleStatusEffect',
          async (statusId: string, opts: { active?: boolean } = {}) => {
            fake.toggleCalls.push({ actor: actor.id, statusId, active: opts.active });
            const effects = actor.getEmbeddedCollection('ActiveEffect');
            const existing = effects.filter(
              effect => Array.isArray(effect['statuses']) && effect['statuses'].includes(statusId)
            );
            const on = opts.active ?? existing.length === 0;
            if (on && existing.length === 0)
              await actor.createEmbeddedDocuments('ActiveEffect', [
                { name: statusId, statuses: [statusId] },
              ]);
            if (!on && existing.length)
              await actor.deleteEmbeddedDocuments(
                'ActiveEffect',
                existing.map(effect => effect.id)
              );
            return on;
          }
        );
      },
    });
  }

  foundry.defineDocumentType('Token', {
    embedded: {},
    extend: token => {
      Object.defineProperty(token, 'actor', {
        enumerable: false,
        configurable: true,
        get: () => {
          const actorId = token['actorId'];
          if (typeof actorId !== 'string' || !actorId) return null;
          const base = foundry.collection('Actor').get(actorId) ?? null;
          if (token['actorLink'] === true || !base) return base;
          let own = synthetic.get(token);
          if (!own) {
            own = new FakeDocument(foundry, 'Actor', base.toObject(), token);
            synthetic.set(token, own);
          }
          return own;
        },
      });
    },
  });

  foundry.setGlobal('CONFIG', { statusEffects: options.statusEffects ?? DEFAULT_STATUS_EFFECTS });

  const total = options.rollTotal ?? 14;
  class FakeRoll {
    formula: string;
    total: number | undefined;
    constructor(formula: string) {
      this.formula = formula;
    }
    static validate(formula: string): boolean {
      return /^[\d\sdD+\-*/().@a-zA-Z]+$/.test(formula) && /\d/.test(formula);
    }
    async evaluate(): Promise<this> {
      if (!FakeRoll.validate(this.formula))
        throw new Error(`Unable to parse the formula ${this.formula}`);
      fake.rolls.push(this.formula);
      this.total = total;
      return this;
    }
  }
  foundry.setGlobal('Roll', FakeRoll);

  const base = foundry.documentClass('ChatMessage');
  foundry.setGlobal('ChatMessage', {
    ...base,
    create: async (data: Record<string, unknown>) => {
      const user = foundry.game.user;
      const message = foundry.seed('ChatMessage', {
        timestamp: Date.now() + foundry.operations.length,
        ...data,
        author: user?.id ?? '',
      });
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

/** Assign a character to a user, as Foundry's user configuration does. */
export function assignCharacter(
  foundry: FakeFoundry,
  userId: string,
  actorId: string | null
): void {
  const user = foundry.users.get(userId);
  if (!user) throw new Error(`No user ${userId}`);
  (user as unknown as Record<string, unknown>)['character'] = actorId;
}
