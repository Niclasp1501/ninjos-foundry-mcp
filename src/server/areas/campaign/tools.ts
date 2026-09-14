/**
 * The four tools of the campaign area. Names and parameters are the ones in
 * the tool directory of the previous generation; the descriptions are written anew and say
 * what this version does.
 *
 * The server builds no HTML. It passes the arguments to the module, which
 * builds the content in the language of the Gamemaster's client and changes
 * pages on the full stored text. Errors keep their cause: there is no
 * rewording into general advice.
 *
 * Every tool here has the same frame (group, writing annotations, a handler
 * that only forwards), so a tool is one row of CAMPAIGN_TABLE below and the
 * parameter schemas are put together from the small builders in `param`.
 */
import { BridgeError } from '../../bridge/foundry-bridge.js';
import { writingTool, type ToolDefinition, type ToolOutput } from '../../tools/types.js';

type Fragment = Record<string, unknown>;

/** JSON Schema fragments for the parameters of this package. */
const param = {
  text: (description: string): Fragment => ({ type: 'string', description }),
  pick: (values: readonly string[], description: string): Fragment => ({
    type: 'string',
    enum: [...values],
    description,
  }),
  /** A character level, which the tool directory bounds to 1..20. */
  level: (description: string): Fragment => ({
    type: 'number',
    minimum: 1,
    maximum: 20,
    description,
  }),
  listOf: (description: string, items: Fragment): Fragment => ({
    type: 'array',
    description,
    items,
  }),
  record: (fields: Record<string, Fragment>, mandatory: readonly string[]): Fragment => ({
    type: 'object',
    properties: fields,
    required: [...mandatory],
  }),
};

const TEMPLATE_NAMES = [
  'five-part-adventure',
  'dungeon-crawl',
  'investigation',
  'sandbox',
  'custom',
];
const PART_KINDS = ['main_part', 'sub_part', 'chapter', 'session', 'optional'];
const QUEST_KINDS = [
  'main',
  'side',
  'personal',
  'mystery',
  'fetch',
  'escort',
  'kill',
  'collection',
];
const DIFFICULTIES = ['easy', 'medium', 'hard', 'deadly'];
const FIGURE_ROLES = ['quest_giver', 'target', 'ally', 'enemy', 'contact'];
const UPDATE_KINDS = ['progress', 'completion', 'failure', 'modification'];

const JOURNAL_ID_HINT = 'Id of the quest journal, from list-journals.';

function tooOldModule(query: string): Error {
  return new Error(
    `The connected Foundry module does not know the query ${query}: it is older than this server. ` +
      'Update the module "ninjos-foundry-mcp" in Foundry. Since this version the module builds the campaign ' +
      'and quest content itself, so the tool cannot run against the previous module.'
  );
}

/** A module without the query refuses with UNKNOWN_QUERY, one of the previous generation with its own sentence. */
function isMissingQuery(problem: unknown): boolean {
  if (!(problem instanceof BridgeError)) return false;
  return (
    problem.moduleCode === 'UNKNOWN_QUERY' || /no handler found for query/i.test(problem.message)
  );
}

/** Ask the module; an older module without the query gets a clear message instead of its raw refusal. */
function forwardTo(query: string): ToolDefinition['handler'] {
  return async (args, context): Promise<ToolOutput> => {
    const reply: unknown = await context.query(query, args).catch((problem: unknown) => {
      throw isMissingQuery(problem) ? tooOldModule(query) : problem;
    });
    if (reply == null) throw new Error(`The module returned no result for ${query}`);
    if (typeof reply !== 'object') return String(reply);
    return reply as Record<string, unknown>;
  };
}

const DASHBOARD_ABOUT =
  'Create a journal that gives an overview of a campaign in several parts: progress, current part, location and ' +
  'quest giver, and for each part its levels, description and a status toggle. Clicking a toggle in Foundry cycles ' +
  'not started, in progress, completed, skipped and saves it on the journal; figures, current part and lock markers ' +
  'follow the saved status whenever the page is shown. A part is locked until the one before it is completed or ' +
  'skipped. The journal is visible to Gamemasters only, named after the campaign and placed in a journal folder ' +
  "with the campaign title (created when missing). Texts are written in the language of the Gamemaster's client.";

const QUEST_ABOUT =
  'Create a quest journal visible to Gamemasters only. Its first page holds the title and description, a background ' +
  'from location, quest giver and key figure, an overview with the given details, rewards and "Status: Active", an ' +
  'adventure hook as read-aloud text, a secret note for the Gamemaster, objectives from the quest type and the given ' +
  'facts, and a section for progress notes. All given values are escaped, so they appear as text. Write richer ' +
  'content yourself into additionalPages, which are stored as sent. Without folderName the journal is created outside ' +
  'any folder. The answer lists the pages with their ids and lengths, not the HTML.';

const LINK_ABOUT =
  'Add a figure with its role to the list of related figures on the first text page of a quest journal. When an actor ' +
  'with this id or exact name exists in the world, the entry is a link to it; otherwise the name is written as text ' +
  'and the answer says so. Several actors with that name are an error listing their ids. The list is created once ' +
  '(in the overview of a page from create-quest-journal, else at the end of the page) and extended afterwards; the ' +
  'same figure in the same role is not added twice. The page is changed as a whole inside Foundry, so nothing of a ' +
  'long page is lost.';

const UPDATE_ABOUT =
  'Write progress into a quest journal. Content that contains HTML tags is stored as sent; plain text is escaped and ' +
  'becomes paragraphs, with single line breaks kept. Markdown is not converted. Three ways:\n' +
  "- Without pageId and newPageName: a section with a heading for the update type and today's date is added to the " +
  'progress notes of the first text page (a completion as read-aloud text, everything else as a secret Gamemaster ' +
  'note). completion and failure also set the status in the overview to Completed or Failed.\n' +
  '- With pageId: the content is appended to the end of that text page, without a heading.\n' +
  '- With newPageName: a new page with a heading and the content as a secret note.\n' +
  'Content with its own heading gets no generated one. Pass pageId or newPageName, not both. Every write is read ' +
  'back and compared in full before success is reported; the answer gives the lengths before and after, not the HTML.';

const customPart = param.record(
  {
    title: param.text('Title of the part.'),
    description: param.text('What happens in this part.'),
    type: param.pick(PART_KINDS, 'Kind of part.'),
    levelStart: param.level('First character level, 1 to 20.'),
    levelEnd: param.level('Last character level, 1 to 20, not below levelStart.'),
    subParts: param.listOf(
      'Sub parts, each with its own status toggle.',
      param.record(
        {
          title: param.text('Title of the sub part.'),
          description: param.text('What happens in it.'),
        },
        ['title', 'description']
      )
    ),
  },
  ['title', 'description', 'type', 'levelStart', 'levelEnd']
);

const extraPage = param.record(
  {
    name: param.text('Page name, e.g. "Player Handout".'),
    content: param.text('HTML content of the page, not empty.'),
  },
  ['name', 'content']
);

interface CampaignRow {
  title: string;
  about: string;
  query: string;
  idempotent: boolean;
  fields: Record<string, Fragment>;
  mandatory: readonly string[];
}

/** One row per tool, keyed by its bound name. */
const CAMPAIGN_TABLE: Record<string, CampaignRow> = {
  'create-campaign-dashboard': {
    title: 'Create a campaign dashboard',
    about: DASHBOARD_ABOUT,
    query: 'createCampaignDashboard',
    idempotent: false,
    fields: {
      campaignTitle: param.text('Title of the campaign, e.g. "The Whisperstone Conspiracy".'),
      campaignDescription: param.text('Short description of the theme and scope of the campaign.'),
      template: param.pick(
        TEMPLATE_NAMES,
        'Structure of the campaign. "custom" requires customParts; the other templates bring fixed parts and ' +
          'refuse customParts.'
      ),
      customParts: param.listOf(
        'The parts of a campaign with template "custom", in order. At least one.',
        customPart
      ),
      defaultQuestGiver: param.text(
        'Name of the figure who gives the party its quests, shown in the overview (optional).'
      ),
      defaultLocation: param.text(
        'Main location or setting of the campaign, shown in the overview (optional).'
      ),
    },
    mandatory: ['campaignTitle', 'campaignDescription', 'template'],
  },
  'create-quest-journal': {
    title: 'Create a quest journal',
    about: QUEST_ABOUT,
    query: 'createQuestJournal',
    idempotent: false,
    fields: {
      questTitle: param.text('Title of the quest, also the name of the journal.'),
      questDescription: param.text('What the quest is about and what it should achieve.'),
      questType: param.pick(
        QUEST_KINDS,
        'Kind of quest (optional). fetch, escort, kill and mystery bring fixed objectives.'
      ),
      difficulty: param.pick(DIFFICULTIES, 'Difficulty (optional).'),
      location: param.text('Where the quest takes place (optional).'),
      questGiver: param.text('Name of the figure who gives the quest to the party (optional).'),
      npcName: param.text(
        'Name of the key figure of the quest: opponent, ally or target (optional).'
      ),
      rewards: param.text('The rewards (optional).'),
      additionalPages: param.listOf(
        'Further pages after the quest page, such as a player handout or Gamemaster notes. Their HTML is stored as sent.',
        extraPage
      ),
      folderName: param.text(
        'Journal folder at the top level to put the journal in, by exact name; created when missing. Omit for no folder.'
      ),
    },
    mandatory: ['questTitle', 'questDescription'],
  },
  'link-quest-to-npc': {
    title: 'Link a figure to a quest',
    about: LINK_ABOUT,
    query: 'linkQuestToNpc',
    idempotent: true,
    fields: {
      journalId: param.text(JOURNAL_ID_HINT),
      npcName: param.text('Exact name or id of the actor to link.'),
      relationship: param.pick(FIGURE_ROLES, 'Role of the figure in the quest.'),
    },
    mandatory: ['journalId', 'npcName', 'relationship'],
  },
  'update-quest-journal': {
    title: 'Update a quest journal',
    about: UPDATE_ABOUT,
    query: 'updateQuestJournal',
    idempotent: false,
    fields: {
      journalId: param.text(JOURNAL_ID_HINT),
      newContent: param.text('The update, as HTML or plain text.'),
      updateType: param.pick(UPDATE_KINDS, 'Kind of update.'),
      pageId: param.text(
        'Append to this text page instead of the first one. Page ids come from list-journals.'
      ),
      newPageName: param.text(
        'Create a new page with this name instead of changing an existing one.'
      ),
    },
    mandatory: ['journalId', 'newContent', 'updateType'],
  },
};

function fromRow(toolName: string): ToolDefinition {
  const row = CAMPAIGN_TABLE[toolName];
  if (!row) throw new Error(`No campaign tool named ${toolName}`);
  return {
    name: toolName,
    title: row.title,
    group: 'campaign',
    description: row.about,
    inputSchema: param.record(row.fields, row.mandatory),
    annotations: writingTool(row.title, { destructive: false, idempotent: row.idempotent }),
    handler: forwardTo(row.query),
  };
}

export const createCampaignDashboardTool = fromRow('create-campaign-dashboard');
export const createQuestJournalTool = fromRow('create-quest-journal');
export const linkQuestToNpcTool = fromRow('link-quest-to-npc');
export const updateQuestJournalTool = fromRow('update-quest-journal');

export const CAMPAIGN_TOOLS: readonly ToolDefinition[] = [
  createCampaignDashboardTool,
  createQuestJournalTool,
  linkQuestToNpcTool,
  updateQuestJournalTool,
];
