/**
 * How long the server waits for the module to answer a query.
 *
 * The limit is a limit on silence, not on total duration: every progress
 * message from the module starts it again. A module of the previous generation
 * sends none, so for it the limit is the total duration, as before.
 */
import { shortQueryName } from './constants.js';

export const DEFAULT_QUERY_TIMEOUT_MS = 30_000;

const MINUTE = 60_000;

/**
 * Queries known to work through hundreds of documents. Measured on 30.08.2026:
 * backing up 902 scenes took about 135 seconds.
 *
 * The names follow the list of the previous server.
 * A longer limit is
 * compatible in both directions, so this list may only grow:
 * - `rewriteWorldPaths` is the name the tool really sends; the previous server
 *   listed `worldRewritePaths`, which nobody sends, and gave the tool 30 s.
 *   Both are here.
 * - `importFromCompendium` was missing, `createActorFromCompendium` is an
 *   addition of this rewrite.
 * - `rebuildEnhancedCreatureIndex` has no query yet (the rebuild runs in the
 *   browser only). It gets its 10 minutes when a query for it exists.
 */
const LONG_QUERIES: Readonly<Record<string, number>> = {
  exportToCompendium: 10 * MINUTE,
  deleteCompendiumEntries: 5 * MINUTE,
  'delete-compendium-entries': 5 * MINUTE,
  restoreScene: 5 * MINUTE,
  rewriteWorldPaths: 5 * MINUTE,
  worldRewritePaths: 5 * MINUTE,
  createActors: 2 * MINUTE,
  createActorFromCompendium: 2 * MINUTE,
  getEnhancedCreatureIndex: 2 * MINUTE,
  importFromCompendium: 2 * MINUTE,
  listCompendiumEntries: MINUTE,
  'list-compendium-entries': MINUTE,
};

/**
 * The limit for one query. FOUNDRY_QUERY_TIMEOUT (`defaultMs`) never shortens
 * a long limit. Unlike the previous server it may lengthen one: whoever raises
 * the general limit above a fixed one wants more time, not less.
 */
export function queryTimeoutMs(name: string, defaultMs: number = DEFAULT_QUERY_TIMEOUT_MS): number {
  const long = LONG_QUERIES[shortQueryName(name)];
  return long !== undefined ? Math.max(long, defaultMs) : defaultMs;
}

function seconds(ms: number): string {
  return ms % 1000 === 0 ? `${ms / 1000} s` : `${(ms / 1000).toFixed(1)} s`;
}

/**
 * The text for a query that ran out of time. It must say that the work may
 * well have finished: on 30.08.2026 a completed export was thrown away because
 * the message read like a failure.
 */
export function timeoutMessage(name: string, ms: number): string {
  return (
    `Foundry did not answer "${shortQueryName(name)}" within ${seconds(ms)} of silence. ` +
    'This does NOT mean the work failed: the module keeps working in the browser. ' +
    'Check the actual state in the world (for example count the documents) before retrying or drawing conclusions.'
  );
}
