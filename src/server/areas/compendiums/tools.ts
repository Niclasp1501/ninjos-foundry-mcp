/**
 * The twelve compendium tools of the behaviour description, plus
 * list-compendium-packs. Each asks the module with the query name a server of
 * the previous generation used, so an installed module answers as well.
 */
import { DETAILED_ANSWER } from '../../../common/areas/compendiums/shapes.js';
import { BridgeError } from '../../bridge/foundry-bridge.js';
import { legacyFailure } from '../../tools/results.js';
import {
  readOnlyTool,
  writingTool,
  type ToolContext,
  type ToolDefinition,
  type ToolOutput,
} from '../../tools/types.js';
import {
  formatCompendiumList,
  formatCreate,
  formatCreatures,
  formatDeleteCompendium,
  formatDeleteEntries,
  formatDocumentFull,
  formatEntries,
  formatExport,
  formatImport,
  formatLock,
  formatOrganize,
  formatPacks,
  formatSearch,
  isRecord,
} from './format.js';
import * as schema from './schemas.js';

type Args = Record<string, unknown>;

function output(value: unknown): ToolOutput {
  if (typeof value === 'string' || Array.isArray(value) || isRecord(value)) return value;
  return JSON.stringify(value ?? null);
}

/**
 * The module's answer. A module of the previous generation refuses without a
 * Gamemaster by returning `{ error, success: false }` as a normal value; that
 * is a tool error with its cause, checked here before any formatter could
 * read the object as an answer.
 */
async function askModule(context: ToolContext, query: string, data: Args): Promise<unknown> {
  const raw = await context.query(query, data);
  const failure = legacyFailure(raw);
  if (failure !== null) throw new Error(failure);
  return raw;
}

function ask(
  query: string,
  format: (raw: unknown, args: Args) => unknown,
  dataOf: (args: Args) => Args = args => args
) {
  return async (args: Args, context: ToolContext): Promise<ToolOutput> =>
    output(format(await askModule(context, query, dataOf(args)), args));
}

export const listCompendiumsTool: ToolDefinition = {
  name: 'list-compendiums',
  title: 'List compendiums',
  group: 'compendiums',
  description:
    'List every compendium with its type, entry count, lock state and whether the AI can write to it right now. ' +
    '"Editable" takes all layers into account: the write switch, the permission level for compendiums, the release ' +
    'list and the lock. An unlocked compendium can be written to no matter who ships it, unless the release list is ' +
    'filled. Call this before exporting to find the right pack id.',
  inputSchema: schema.listCompendiumsSchema,
  annotations: readOnlyTool('List compendiums'),
  handler: ask('listCompendiums', formatCompendiumList),
};

export const listCompendiumPacksTool: ToolDefinition = {
  name: 'list-compendium-packs',
  title: 'List compendium packs',
  group: 'compendiums',
  description:
    'List all compendium packs with id, label, document type, game system and whether they are private, optionally ' +
    'filtered by document type. availableTypes names every type that occurs, also when a filter is set.',
  inputSchema: schema.listCompendiumPacksSchema,
  annotations: readOnlyTool('List compendium packs'),
  // Asked without a type: the filter and availableTypes are made here, the same for either module generation.
  handler: ask('getAvailablePacks', formatPacks, () => ({})),
};

export const listCompendiumEntriesTool: ToolDefinition = {
  name: 'list-compendium-entries',
  title: 'List compendium entries',
  group: 'compendiums',
  description:
    'List what actually sits inside a compendium: ids, names, types and folders. list-compendiums only gives counts, so ' +
    'this is the way to check whether an archive holds what it should, to find duplicates, or to get the ids needed for ' +
    'later work. Reads the index only, never the full documents, and returns at most 1000 entries per call; when more ' +
    'follow, the answer says so with the next offset. Read only: it changes nothing and works at any permission level.',
  inputSchema: schema.listCompendiumEntriesSchema,
  annotations: readOnlyTool('List compendium entries'),
  handler: ask('listCompendiumEntries', formatEntries),
};

export const searchCompendiumTool: ToolDefinition = {
  name: 'search-compendium',
  title: 'Search compendiums',
  group: 'compendiums',
  description:
    'Search the names of compendium entries across all compendiums except scene compendiums. Every word of the query ' +
    'has to occur in the name; descriptions are not searched. Exact name matches come first. Creature filters need ' +
    'the adapter of the active game system: with packType "Actor" and the creature index they check real values, ' +
    'otherwise they are an estimate from names, and filters the system does not know are reported as ignored. For ' +
    'accurate filtering use list-creatures-by-criteria, and inspect single entries with get-compendium-item.',
  inputSchema: schema.searchCompendiumSchema,
  annotations: readOnlyTool('Search compendiums'),
  handler: ask('searchCompendium', formatSearch, args => ({
    ...args,
    [DETAILED_ANSWER.field]: DETAILED_ANSWER.value,
  })),
};

function unknownQuery(error: unknown): boolean {
  if (!(error instanceof BridgeError)) return false;
  return (
    error.moduleCode === 'UNKNOWN_QUERY' ||
    /no handler|unknown query|not registered/i.test(error.message)
  );
}

export const getCompendiumItemTool: ToolDefinition = {
  name: 'get-compendium-item',
  title: 'Get compendium item',
  group: 'compendiums',
  description:
    'Retrieve one compendium entry in full: name, type, description, image, system data, contained items and effects ' +
    'and the whole document. compact returns key values, properties and at most five contained items instead, which is ' +
    'enough to decide between candidates.',
  inputSchema: schema.getCompendiumItemSchema,
  annotations: readOnlyTool('Get compendium item'),
  handler: async (args, context) => {
    try {
      return output(await askModule(context, 'getCompendiumItem', args));
    } catch (error) {
      // A module of the previous generation has no getCompendiumItem. It answers
      // getCompendiumDocumentFull, which reads `documentId`; compact is made here.
      if (!unknownQuery(error)) throw error;
      const raw = await askModule(context, 'getCompendiumDocumentFull', {
        packId: args['packId'],
        documentId: args['itemId'],
        itemId: args['itemId'],
      });
      return output(formatDocumentFull(raw, args['compact'] === true));
    }
  },
};

export const listCreaturesByCriteriaTool: ToolDefinition = {
  name: 'list-creatures-by-criteria',
  title: 'List creatures by criteria',
  group: 'compendiums',
  description:
    'Creature discovery for encounter building: a long list of creatures matching criteria, with little data per ' +
    'creature, so you can choose by name and fetch details with get-compendium-item only for the final selection. ' +
    'The filters are understood by the adapter of the active game system (D&D 5e: challenge rating, creature type, ' +
    'size, alignment, spells, legendary actions; Pathfinder 2e: level, traits, rarity; DSA5: experience level, species, ' +
    'culture, profession; WFRP4e: species, traits, prayers; Traveller: hits, psionics; Cosmere RPG: tier, role, ' +
    'defenses) and checked against the creature index. Filters the active system does not know ' +
    'are reported as ignored. Without an adapter for the system, filtering is refused and a call without filters lists ' +
    'every actor by name.',
  inputSchema: schema.listCreaturesByCriteriaSchema,
  annotations: readOnlyTool('List creatures by criteria'),
  handler: ask('listCreaturesByCriteria', formatCreatures),
};

export const createCompendiumTool: ToolDefinition = {
  name: 'create-compendium',
  title: 'Create compendium',
  group: 'compendiums',
  description:
    'Create a new world compendium, for example to archive a finished chapter of a campaign. Choose the document type ' +
    'it will hold. Needs the compendium permission on "create and change".',
  inputSchema: schema.createCompendiumSchema,
  annotations: writingTool('Create compendium', { destructive: false, idempotent: false }),
  handler: ask('createCompendium', formatCreate),
};

export const exportToCompendiumTool: ToolDefinition = {
  name: 'export-to-compendium',
  title: 'Export to compendium',
  group: 'compendiums',
  description:
    'Copy documents from the world into a compendium, to archive finished material. Select by name or id, or by the ' +
    'world folder they sit in; without either, everything of that type is copied. Ids are kept, so a document already ' +
    'in the compendium is overwritten instead of duplicated. A locked compendium is refused unless unlockIfNeeded is ' +
    'set; then the lock is lifted for this operation only and set again afterwards. The answer lists new, overwritten, ' +
    'skipped and, marked CAUTION, lost entries.',
  inputSchema: schema.exportToCompendiumSchema,
  annotations: writingTool('Export to compendium', { destructive: true, idempotent: true }),
  handler: ask('exportToCompendium', formatExport),
};

export const importFromCompendiumTool: ToolDefinition = {
  name: 'import-from-compendium',
  title: 'Import from compendium',
  group: 'compendiums',
  description:
    'Copy a document out of a compendium into the world: playlists, scenes, journals, actors, roll tables, items, ' +
    'macros, cards. Always assigns a FRESH id, so it can never overwrite an existing world document. That is the ' +
    'difference to dragging an entry out by hand, which keeps the id and silently replaces whatever carries it. ' +
    'Names are matched as a whole; an ambiguous name is refused with the ids.',
  inputSchema: schema.importFromCompendiumSchema,
  annotations: writingTool('Import from compendium', { destructive: false, idempotent: false }),
  handler: ask('importFromCompendium', formatImport),
};

export const organizeCompendiumTool: ToolDefinition = {
  name: 'organize-compendium',
  title: 'Organize compendium',
  group: 'compendiums',
  description:
    'Sort entries of a compendium into a folder, creating the folder if needed. Entries are named exactly (ignoring ' +
    'case) or by id; names not found and ambiguous names are reported and left where they are. Same lock rules as ' +
    'export-to-compendium.',
  inputSchema: schema.organizeCompendiumSchema,
  annotations: writingTool('Organize compendium', { destructive: false, idempotent: true }),
  handler: ask('organizeCompendium', formatOrganize),
};

export const setCompendiumLockTool: ToolDefinition = {
  name: 'set-compendium-lock',
  title: 'Lock or unlock compendium',
  group: 'compendiums',
  description:
    'Lock or unlock a compendium. Which ones may be touched follows the module settings: by default every compendium, ' +
    'or only the ones on the release list if it has been filled in.',
  inputSchema: schema.setCompendiumLockSchema,
  annotations: writingTool('Lock or unlock compendium', { destructive: false, idempotent: true }),
  handler: ask('setCompendiumLock', formatLock),
};

export const deleteCompendiumEntriesTool: ToolDefinition = {
  name: 'delete-compendium-entries',
  title: 'Delete compendium entries',
  group: 'compendiums',
  description:
    'Remove named entries from a compendium, by id or by exact name. Only what is explicitly named is removed; there is ' +
    'deliberately no "empty this pack". Always run with dryRun first: it reports exactly what would go, what was not ' +
    'found and which names are ambiguous, without touching anything. Names are matched in their exact spelling, never ' +
    'as a part, and an ambiguous name is reported rather than guessed. If the selection covers every entry, confirmLabel ' +
    'is required as well. Needs the compendium permission on "create, change and delete".',
  inputSchema: schema.deleteCompendiumEntriesSchema,
  annotations: writingTool('Delete compendium entries', { destructive: true, idempotent: true }),
  handler: ask('deleteCompendiumEntries', formatDeleteEntries),
};

export const deleteCompendiumTool: ToolDefinition = {
  name: 'delete-compendium',
  title: 'Delete compendium',
  group: 'compendiums',
  description:
    'Remove a world compendium and everything in it. This cannot be undone, so it is off by default: the compendium ' +
    'permission has to stand on "create, change and delete". The exact label must be passed as confirmLabel. ' +
    'Compendiums of a module or of the game system cannot be removed this way.',
  inputSchema: schema.deleteCompendiumSchema,
  annotations: writingTool('Delete compendium', { destructive: true, idempotent: true }),
  handler: ask('deleteCompendium', formatDeleteCompendium),
};

export const COMPENDIUM_TOOLS: readonly ToolDefinition[] = [
  listCompendiumsTool,
  listCompendiumPacksTool,
  listCompendiumEntriesTool,
  searchCompendiumTool,
  getCompendiumItemTool,
  listCreaturesByCriteriaTool,
  createCompendiumTool,
  exportToCompendiumTool,
  importFromCompendiumTool,
  organizeCompendiumTool,
  setCompendiumLockTool,
  deleteCompendiumEntriesTool,
  deleteCompendiumTool,
];
