/**
 * What the chat-tables-macros area needs beyond the default fake: roll tables that roll,
 * draw, post and reset, and a chat log that processes a chat command.
 *
 * Rolls take their totals from a queue, so a test decides every result.
 * The draw follows Foundry's rule as the package relies on it: entries that
 * are drawn are skipped, and only a table without replacement marks them.
 */
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import {
  FakeFoundry,
  type DocumentData,
  type FakeDocument,
  type FakeFoundryOptions,
} from '../../../testing/fake-foundry.js';

export interface ChatTablesFake {
  /** Totals the next rolls produce, in order. */
  totals: number[];
  /** Every command the fake chat log processed. */
  processed: Array<{ command: string; options: unknown }>;
  /** The options of every `Roll#evaluate`. */
  evaluations: unknown[];
  /**
   * Methods that never finish. `roll` and `draw` stand for Foundry's own
   * RollTable methods, which hang with Dice So Nice and no canvas in a
   * real world; `evaluate` for a roll that never completes.
   */
  hang: { roll?: boolean; draw?: boolean; evaluate?: boolean; toMessage?: boolean };
}

const never = () => new Promise<never>(() => undefined);

function inRange(range: unknown, total: number): boolean {
  return Array.isArray(range) && total >= Number(range[0]) && total <= Number(range[1]);
}

/** Define the roll table behaviour. Call before seeding tables. */
export function withChatTablesMacros(foundry: FakeFoundry, totals: number[] = []): ChatTablesFake {
  const state: ChatTablesFake = { totals: [...totals], processed: [], evaluations: [], hang: {} };
  const gamemasterIds = () => foundry.users.filter(user => user.isGM).map(user => user.id);

  class FakeRoll {
    formula: string;
    total: number | undefined;
    constructor(formula: string) {
      this.formula = formula;
    }
    async evaluate(options: unknown = {}): Promise<this> {
      state.evaluations.push(options);
      if (state.hang.evaluate) return never();
      const total = state.totals.shift();
      if (total === undefined) throw new Error('The fake has no roll total left; pass totals');
      this.total = total;
      return this;
    }
  }
  foundry.setGlobal('Roll', FakeRoll);

  const post = (data: DocumentData, rollMode: unknown) => {
    const whisper =
      rollMode === 'gmroll' || rollMode === 'blindroll'
        ? gamemasterIds()
        : rollMode === 'selfroll'
          ? [foundry.userId()]
          : [];
    return foundry.createDocument(
      'ChatMessage',
      {
        author: foundry.userId(),
        timestamp: Date.now(),
        style: 0,
        whisper,
        blind: rollMode === 'blindroll',
        ...data,
      },
      null
    );
  };

  foundry.defineDocumentType('RollTable', {
    collection: 'tables',
    embedded: { TableResult: 'results' },
    extend: table => {
      const results = () => table.getEmbeddedCollection('TableResult').contents;
      const rollOnce = () => {
        const total = state.totals.shift();
        if (total === undefined) throw new Error('The fake has no roll total left; pass totals');
        const hits = results().filter(
          result => result['drawn'] !== true && inRange(result['range'], total)
        );
        return { roll: { formula: table['formula'], total }, results: hits };
      };
      const toMessage = async (
        hits: FakeDocument[],
        options: { roll?: unknown; messageOptions?: { rollMode?: unknown } } = {}
      ) =>
        state.hang.toMessage
          ? never()
          : post(
              {
                content: hits
                  .map(hit => String(hit['description'] ?? hit['text'] ?? ''))
                  .join('<br>'),
                rolls: options.roll ? [JSON.stringify(options.roll)] : [],
              },
              options.messageOptions?.rollMode
            );
      // Methods, not data: kept out of toObject() and its structured clone.
      const method = (name: string, value: unknown) =>
        Object.defineProperty(table, name, { value, enumerable: false, writable: true });
      method('roll', async () => (state.hang.roll ? never() : rollOnce()));
      method('toMessage', toMessage);
      method('getResultsForRoll', (value: number) =>
        results().filter(result => result['drawn'] !== true && inRange(result['range'], value))
      );
      method('draw', async (options: { displayChat?: boolean; rollMode?: unknown } = {}) => {
        if (state.hang.draw) return never();
        const outcome = rollOnce();
        if (table['replacement'] === false && outcome.results.length) {
          await table.updateEmbeddedDocuments(
            'TableResult',
            outcome.results.map(result => ({ _id: result.id, drawn: true }))
          );
        }
        if (options.displayChat !== false)
          await toMessage(outcome.results, {
            roll: outcome.roll,
            messageOptions: { rollMode: options.rollMode },
          });
        return outcome;
      });
      method('resetResults', async () =>
        table.updateEmbeddedDocuments(
          'TableResult',
          results()
            .filter(result => result['drawn'] === true)
            .map(result => ({ _id: result.id, drawn: false }))
        )
      );
    },
  });
  return state;
}

/**
 * `ui.chat.processMessage`, set after the harness installed the fake (install
 * replaces `ui`). A command starting with "/fail" fails like an unknown one.
 */
export function installChatLog(foundry: FakeFoundry, state: ChatTablesFake): void {
  const current = (globalThis as Record<string, unknown>)['ui'] as Record<string, unknown>;
  foundry.setGlobal('ui', {
    ...current,
    chat: {
      processMessage: async (command: string, options: { speaker?: unknown } = {}) => {
        state.processed.push({ command, options });
        if (command.startsWith('/fail')) throw new Error(`Unknown chat command: ${command}`);
        return foundry.createDocument(
          'ChatMessage',
          {
            author: foundry.userId(),
            timestamp: Date.now(),
            style: 0,
            speaker: options.speaker ?? {},
            content: command,
            whisper: [],
          },
          null
        );
      },
    },
  });
}

export interface ChatTablesSetup {
  harness: AreaHarness;
  foundry: FakeFoundry;
  fake: ChatTablesFake;
}

/** A harness over a fake with everything above. Seed after this call. */
export function openChatTables(
  options: FakeFoundryOptions = {},
  totals: number[] = []
): ChatTablesSetup {
  const foundry = new FakeFoundry(options);
  const fake = withChatTablesMacros(foundry, totals);
  const harness = createAreaHarness({ foundry });
  installChatLog(foundry, fake);
  return { harness, foundry, fake };
}
