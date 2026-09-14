/**
 * The tools of the journals area. Names and parameters are the ones in
 * the tool directory of the previous generation; the descriptions are written anew and say
 * what this version does, including its decisions.
 *
 * The work happens in the module: the server checks nothing a module of the
 * previous generation would not check as well, and passes the arguments on
 * unchanged. That keeps one place for every rule.
 */
import {
  readOnlyTool,
  writingTool,
  type ToolContext,
  type ToolDefinition,
  type ToolGroup,
  type ToolOutput,
} from '../../tools/types.js';
import type { ToolAnnotations } from '../../control/api.js';
import {
  addPageWithoutModuleQuery,
  ask,
  isRecord,
  listJournals,
  modernNames,
  requirePageName,
  searchWithoutModuleSearch,
  setPageWithoutModuleQuery,
  unknownQuery,
} from './generations.js';

const text = (description: string) => ({ type: 'string', description });
const flag = (description: string) => ({ type: 'boolean', description });
const number = (description: string) => ({ type: 'number', description });
const texts = (description: string) => ({ type: 'array', items: { type: 'string' }, description });

const DRY_RUN = flag(
  'Only report what would change, without writing (default false). Run this first.'
);
const JOURNAL_ID = text('Id of the journal, from list-journals.');
const PAGE_ID = text('Id of the page, from list-journals.');

interface Spec {
  name: string;
  title: string;
  group: ToolGroup;
  query: string;
  description: string;
  properties: Record<string, unknown>;
  required?: string[];
  annotations: ToolAnnotations;
  /** Old answer field names and the name of this version they stand for. */
  aliases?: Readonly<Record<string, string>>;
  /** The data of the query, when it differs from the arguments. */
  prepare?: (args: Record<string, unknown>) => Record<string, unknown>;
  /** A handler of its own, for tools that ask more than one query. */
  run?: (args: Record<string, unknown>, context: ToolContext) => Promise<Record<string, unknown>>;
  /** Asked instead when the module does not know `query` (a module of the previous generation). */
  withOldModule?: (
    args: Record<string, unknown>,
    context: ToolContext
  ) => Promise<Record<string, unknown>>;
}

function tool(spec: Spec): ToolDefinition {
  const inputSchema: Record<string, unknown> = { type: 'object', properties: spec.properties };
  if (spec.required?.length) inputSchema['required'] = spec.required;
  return {
    name: spec.name,
    title: spec.title,
    group: spec.group,
    description: spec.description,
    inputSchema,
    annotations: spec.annotations,
    handler: async (args, context): Promise<ToolOutput> => {
      if (spec.run) return spec.run(args, context);
      let answer: unknown;
      try {
        answer = await ask(context, spec.query, spec.prepare ? spec.prepare(args) : args);
      } catch (error) {
        if (!spec.withOldModule || !unknownQuery(error)) throw error;
        return spec.withOldModule(args, context);
      }
      if (answer === undefined || answer === null) {
        throw new Error(`The module returned no result for ${spec.query}`);
      }
      if (isRecord(answer)) return modernNames(answer, spec.aliases ?? {});
      return typeof answer === 'object' ? (answer as unknown[]) : String(answer);
    },
  };
}

const edit = (title: string, destructive: boolean, idempotent: boolean) =>
  writingTool(title, { destructive, idempotent });

export const JOURNAL_TOOLS: readonly ToolDefinition[] = [
  tool({
    name: 'list-journals',
    title: 'List or read journals',
    group: 'journals',
    query: 'listJournals',
    description:
      'Without journalId: every journal with its pages (id, name, type). With journalId: the content of its first ' +
      'text page and the list of all its pages. With journalId and pageId: the content of that page; for image, ' +
      'video or PDF pages the content is the source address. Content comes in chunks of maxChars characters: when ' +
      'hasMore is true, call again with offset set to nextOffset, and never write a partial chunk back as the whole page.',
    properties: {
      filterQuests: flag(
        'List only journals whose name contains quest, mission, task, adventure, job or contract (default false).'
      ),
      includeContent: flag(
        'Add a preview of the first 150 characters of each journal to the list (default false).'
      ),
      journalId: text('Read this journal instead of listing all of them.'),
      pageId: text('Together with journalId: read this page.'),
      offset: number(
        'Character position to start reading at (default 0). Use nextOffset from the previous chunk.'
      ),
      maxChars: number(
        'Characters per chunk, default 50000, at least 1000, at most 200000. Oversized answers break the bridge.'
      ),
    },
    annotations: readOnlyTool('List or read journals'),
    run: listJournals,
  }),
  tool({
    name: 'search-journals',
    title: 'Search journals',
    group: 'journals',
    query: 'searchJournals',
    description:
      'Find journals by a text, ignoring case, in their names and in the HTML of their text pages. Each hit names ' +
      'the matching pages with a short excerpt, so the page can then be read with list-journals (journalId and pageId). ' +
      'The search runs inside Foundry, in one request.',
    properties: {
      searchQuery: text('The text to look for.'),
      searchType: {
        type: 'string',
        enum: ['title', 'content', 'both'],
        description: 'Search the names, the page content, or both (default both).',
      },
    },
    required: ['searchQuery'],
    annotations: readOnlyTool('Search journals'),
    withOldModule: searchWithoutModuleSearch,
  }),
  tool({
    name: 'journal-create',
    title: 'Create a journal',
    group: 'journals',
    query: 'createCleanJournal',
    description:
      'Create a journal with exactly the given pages, in order, each stored as HTML exactly as sent (headings, images ' +
      'and @UUID links included). No template page is added. Only Gamemasters can see it. With folderName the journal ' +
      'goes into that journal folder (by id or exact name), which is created when it does not exist; without folderName ' +
      'it is created outside any folder. Returns the new journal id.',
    properties: {
      name: text('Name of the journal.'),
      folderName: text(
        'Journal folder to put it in, by id or exact name; created when missing. Omit for no folder.'
      ),
      pages: {
        type: 'array',
        description: 'The pages, in order. At least one.',
        minItems: 1,
        items: {
          type: 'object',
          properties: { name: text('Page name.'), html: text('HTML content, stored as sent.') },
          required: ['name', 'html'],
        },
      },
    },
    required: ['name', 'pages'],
    annotations: edit('Create a journal', false, false),
    // The previous module reads the HTML of a page under `content`.
    prepare: args => ({
      ...args,
      pages: Array.isArray(args['pages'])
        ? args['pages'].map(page => (isRecord(page) ? { ...page, content: page['html'] } : page))
        : args['pages'],
    }),
  }),
  tool({
    name: 'journal-set-page',
    title: 'Replace a page',
    group: 'journals',
    query: 'setJournalPage',
    description:
      'Replace the whole HTML content of a text page with the given HTML, stored as sent. Nothing is appended or ' +
      'wrapped. For content larger than one message, write the first chunk here and add the rest with journal-append-page, ' +
      'or use journal-page-from-file.',
    properties: {
      journalId: JOURNAL_ID,
      pageId: PAGE_ID,
      html: text('The new HTML content of the page.'),
    },
    required: ['journalId', 'pageId', 'html'],
    annotations: edit('Replace a page', true, true),
    withOldModule: setPageWithoutModuleQuery,
  }),
  tool({
    name: 'journal-add-page',
    title: 'Add a page',
    group: 'journals',
    query: 'addJournalPage',
    description: 'Add a new text page at the end of a journal, with the HTML stored as sent.',
    properties: {
      journalId: JOURNAL_ID,
      name: text('Name of the new page.'),
      html: text('HTML content, stored as sent.'),
    },
    required: ['journalId', 'name', 'html'],
    annotations: edit('Add a page', false, false),
    run: async (args, context) => {
      requirePageName(args);
      try {
        return modernNames(
          (await ask(context, 'addJournalPage', args)) as Record<string, unknown>,
          {}
        );
      } catch (error) {
        if (!unknownQuery(error)) throw error;
        return addPageWithoutModuleQuery(args, context);
      }
    },
  }),
  tool({
    name: 'journal-append-page',
    title: 'Append to a page',
    group: 'journals',
    query: 'appendJournalPageContent',
    description:
      'Append HTML to the end of a text page. Meant for content too large for one message: create the page with the ' +
      'first part, then append the rest in pieces of about 40000 characters. The pieces are joined as sent, so cut ' +
      'them between tags. Returns the new length.',
    properties: {
      journalId: JOURNAL_ID,
      pageId: text('The text page to append to.'),
      html: text('The HTML piece to append.'),
    },
    required: ['journalId', 'pageId', 'html'],
    annotations: edit('Append to a page', false, false),
    aliases: { newLength: 'length' },
  }),
  tool({
    name: 'journal-page-from-file',
    title: 'Fill a page from a file',
    group: 'journals',
    query: 'setJournalPageFromFile',
    description:
      "Write an HTML file that is already in Foundry's data directory into a page. The browser fetches the file from " +
      'the Foundry server itself and nothing of it crosses the bridge, so any size works. With pageId that text page is ' +
      'overwritten (an unknown pageId is an error); without it a new text page is added at the end.',
    properties: {
      journalId: JOURNAL_ID,
      path: text(
        'Path of the file relative to the Foundry data directory, e.g. "Bilder/Kampagnen/kap2.html".'
      ),
      pageId: text('Text page to overwrite. Omit to add a new page.'),
      pageName: text('Name of the new page; only used without pageId. Default: the file name.'),
    },
    required: ['journalId', 'path'],
    annotations: edit('Fill a page from a file', true, false),
  }),
  tool({
    name: 'journal-split-page',
    title: 'Split a page at headings',
    group: 'journals',
    query: 'splitJournalPage',
    description:
      'Split a large text page into one page per section, cut at headings, inside Foundry so the content never ' +
      'crosses the bridge. The markup of each section is kept as it was. Content before the first heading becomes a ' +
      'page of its own. The new pages appear right behind the source page, which is kept unless deleteOriginal is true.',
    properties: {
      journalId: JOURNAL_ID,
      pageId: text('The text page to split.'),
      level: number(
        'Split at headings h1 up to this level, 1 to 6 (default 1). Use 2 when sections are h2.'
      ),
      deleteOriginal: flag(
        'Delete the source page afterwards (default false). Check the result first.'
      ),
      namePrefix: text('Put this in front of every new page name, e.g. "Chapter 2:".'),
    },
    required: ['journalId', 'pageId'],
    annotations: edit('Split a page at headings', true, false),
    aliases: {
      created: 'pages',
      originalLength: 'sourceLength',
      deletedOriginal: 'originalDeleted',
    },
  }),
  tool({
    name: 'journal-rename',
    title: 'Rename a journal',
    group: 'journals',
    query: 'renameJournal',
    description: 'Give a journal a new name.',
    properties: { journalId: JOURNAL_ID, newName: text('The new name.') },
    required: ['journalId', 'newName'],
    annotations: edit('Rename a journal', false, true),
    aliases: { journalId: 'id' },
  }),
  tool({
    name: 'journal-delete-page',
    title: 'Delete a page',
    group: 'journals',
    query: 'deleteJournalPage',
    description:
      'Delete one page of a journal for good. Needs the journal permission level "create, change and delete", which is off by default.',
    properties: { journalId: JOURNAL_ID, pageId: PAGE_ID },
    required: ['journalId', 'pageId'],
    annotations: edit('Delete a page', true, true),
    aliases: { deletedPageId: 'pageId' },
  }),
  tool({
    name: 'journal-delete',
    title: 'Delete a journal',
    group: 'journals',
    query: 'deleteJournalEntry',
    description:
      'Delete a whole journal with all its pages for good. Needs the journal permission level "create, change and delete", which is off by default.',
    properties: { journalId: JOURNAL_ID },
    required: ['journalId'],
    annotations: edit('Delete a journal', true, true),
    aliases: { deletedJournalId: 'journalId' },
  }),
  tool({
    name: 'journal-rewrite-images',
    title: 'Point images to local files',
    group: 'journals',
    query: 'rewriteJournalImages',
    description:
      'Replace external image addresses in text pages with local paths, for imported adventures that load their ' +
      'images from a CDN. Every img whose src starts with urlPattern (ignoring case) gets localPrefix followed by the ' +
      'file name of the old address. Runs inside Foundry. Use dryRun first.',
    properties: {
      journalId: JOURNAL_ID,
      pageId: text('Only this text page. Omit for every text page of the journal.'),
      urlPattern: text(
        'The address prefix to replace, taken literally, e.g. "https://cdn.example.com/img/".'
      ),
      localPrefix: text('The folder the file names go under, e.g. "Bilder/Kampagnen/Abenteuer".'),
      dryRun: DRY_RUN,
    },
    required: ['journalId', 'urlPattern', 'localPrefix'],
    annotations: edit('Point images to local files', true, true),
    aliases: { samples: 'examples' },
  }),
  tool({
    name: 'journal-link-tags',
    title: 'Link 5etools tags',
    group: 'journals',
    query: 'linkJournalTags',
    description:
      'Turn leftover 5etools tags, @creature[Name|Source] and @item[Name|Source] with an optional third part as label, ' +
      'into Foundry links to compendium entries. Creatures are looked up in actorPacks, items in itemPacks, in the ' +
      'given order, by name ignoring case; for creatures the id of the official 2024 books is tried as well, so an ' +
      'English tag also finds a translated compendium. Every tag that could not be resolved is listed. Use dryRun first.',
    properties: {
      journalId: JOURNAL_ID,
      pageId: text('Only this text page. Omit for every text page of the journal.'),
      actorPacks: texts('Actor compendium ids searched for @creature tags, first match wins.'),
      itemPacks: texts('Item compendium ids searched for @item tags, first match wins.'),
      dryRun: DRY_RUN,
    },
    required: ['journalId'],
    annotations: edit('Link 5etools tags', true, true),
    aliases: { linked: 'links', samples: 'examples' },
  }),
  tool({
    name: 'world-rewrite-paths',
    title: 'Move a path in the whole world',
    group: 'world',
    query: 'rewriteWorldPaths',
    description:
      'After moving files on disk, replace their old path prefix in every document of the world in one step: scenes ' +
      'with tokens, tiles, drawings, notes, sounds, walls, lights and regions; actors with items and effects; items; ' +
      'journals with pages (image pages and images in text); playlists; roll tables; cards; macros. A prefix only ' +
      'matches where a path begins and up to a path boundary, so "Bilder/Token" never touches "Bilder/Tokenringe", and ' +
      'percent-encoded spellings are found too. Runs inside Foundry. Checks the permission of every kind it would ' +
      'change before writing anything. Always run dryRun first and read the report.',
    properties: {
      from: text(
        'Old path prefix relative to the data directory, at least 3 characters, e.g. "Bilder/Avatare".'
      ),
      to: text('New path prefix, e.g. "Bilder/Portraits".'),
      collections: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['scenes', 'actors', 'items', 'journal', 'playlists', 'tables', 'cards', 'macros'],
        },
        description:
          'Only these collections. Omit for all of them, which is recommended: a partial move leaves broken references.',
      },
      dryRun: DRY_RUN,
    },
    required: ['from', 'to'],
    annotations: edit('Move a path in the whole world', true, false),
    aliases: {
      world: 'worldId',
      totalChanges: 'changes',
      documentsTouched: 'documents',
      samples: 'examples',
    },
  }),
  tool({
    name: 'actor-set-token',
    title: 'Set the token image of an actor',
    group: 'actors',
    query: 'setActorToken',
    description:
      "Set an actor's prototype token image, and optionally its portrait, its token name and the dynamic token ring. " +
      'With ring true the token image also becomes the subject inside the ring, and without ringColor the ring is ' +
      'coloured by disposition: hostile red, neutral blue, friendly green. The actor is found by id or exact name.',
    properties: {
      actorIdentifier: text('Id or exact name of the actor.'),
      tokenImg: text('Path of the token image.'),
      portraitImg: text('Path of the portrait image, when it should change too.'),
      tokenName: text(
        "Name of the prototype token. Without it, placed tokens keep the compendium name; usually pass the actor's name."
      ),
      ring: flag(
        'true switches the dynamic token ring on, false switches it off. Omit to leave it as it is.'
      ),
      ringScale: number(
        'Scale of the image inside the ring. Usually omit it and give the image a transparent margin instead.'
      ),
      ringColor: text('Ring colour as hex, e.g. "#e72124". Omit to colour by disposition.'),
    },
    required: ['actorIdentifier', 'tokenImg'],
    annotations: edit('Set the token image of an actor', true, true),
  }),
  tool({
    name: 'actor-refresh-from-source',
    title: 'Refresh actor items from their source',
    group: 'actors',
    query: 'refreshActorItemsFromSource',
    description:
      'Items on an actor are copies. When their compendium was translated or corrected later, the copies keep the old ' +
      "text. This pulls name, image and description again from each item's source, and never touches mechanics: " +
      'levels, uses, prepared spells, quantity, equipment and attunement stay. Items without a resolvable source are ' +
      'listed and left alone. Always run dryRun first.',
    properties: {
      actorIdentifier: text('Id or exact name of the actor.'),
      fields: {
        type: 'array',
        items: { type: 'string', enum: ['name', 'description', 'img', 'advancement'] },
        description:
          'Fields to refresh. Default name, description and img. advancement is only refreshed when named: it takes the ' +
          'level progression definitions from the source and keeps the choices already made.',
      },
      namePacks: texts(
        'Item compendium ids to find items by name when they have no stored source, in order.'
      ),
      preferPacks: texts(
        'Item compendium ids that win over the stored source when they hold an entry with the same id, as translation ' +
          'modules do. The new source is saved on the item.'
      ),
      dryRun: DRY_RUN,
    },
    required: ['actorIdentifier'],
    annotations: edit('Refresh actor items from their source', true, true),
    aliases: { actor: 'actorName' },
  }),
  tool({
    name: 'folder-rename',
    title: 'Rename a folder',
    group: 'folders',
    query: 'renameFolder',
    description:
      'Rename a sidebar folder, found by its id or exact name, optionally only among folders of one document type. ' +
      'When several folders have that name, the error lists them so the id can be passed instead. Contents stay.',
    properties: {
      folderName: text('Id or exact current name of the folder.'),
      newName: text('The new name.'),
      type: text('Document type of the folder, e.g. "JournalEntry" or "Actor".'),
    },
    required: ['folderName', 'newName'],
    annotations: edit('Rename a folder', false, true),
    aliases: { folderId: 'id' },
  }),
  tool({
    name: 'folder-delete',
    title: 'Delete a folder',
    group: 'folders',
    query: 'deleteFolder',
    description:
      'Delete a sidebar folder, found by its id or exact name. By default its documents and subfolders move up one ' +
      'level. With deleteContents true, all documents and subfolders inside are deleted as well. Needs the folder ' +
      'permission level "create, change and delete", and for deleteContents the same level for the documents inside.',
    properties: {
      folderName: text('Id or exact name of the folder.'),
      type: text('Document type of the folder, e.g. "JournalEntry".'),
      deleteContents: flag('Also delete everything inside, subfolders included (default false).'),
    },
    required: ['folderName'],
    annotations: edit('Delete a folder', true, true),
    aliases: { deletedFolder: 'name' },
  }),
];
