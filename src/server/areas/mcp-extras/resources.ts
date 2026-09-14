/**
 * The resources of the mcp-extras area.
 *
 * No resource has Foundry logic of its own. Each one reads through the
 * handler of the read tool that already answers the same question, so the
 * text, the handling of older modules and every error cause are the tool's.
 * Two exceptions ask module queries directly: the change log, which has no
 * tool yet (`getChangeLog`), and the world overview, which needs counts and a
 * few names within a character budget instead of the full text of five tools.
 *
 * Resources ignore FOUNDRY_MCP_TOOL_GROUPS: groups keep the tool list short
 * for the model, and a resource only reaches the model when the client
 * attaches it.
 */
import { getCharacterTool } from '../actors/read-tools.js';
import { getCombatTool } from '../combat-rolls/tools.js';
import { listCompendiumEntriesTool, listCompendiumsTool } from '../compendiums/tools.js';
import { getDocumentTool } from '../generic-access/tools.js';
import { JOURNAL_TOOLS } from '../journals/tools.js';
import { getCurrentSceneTool } from '../scenes/scene-tools.js';
import { formatWorldInfo } from '../scenes/world-info.js';
import type {
  ResourceContext,
  ResourceDefinition,
  ResourceTemplateDefinition,
} from '../../tools/resources.js';
import { legacyFailure, messageOf, moduleTooOld, toToolResult } from '../../tools/results.js';
import type { ToolContext, ToolDefinition } from '../../tools/types.js';
import {
  completeActorId,
  completeCombatId,
  completeJournalId,
  completePackId,
  completePageId,
  completeSceneId,
} from './lookup.js';
import { URIS } from './uris.js';

function toolNamed(list: readonly ToolDefinition[], name: string): ToolDefinition {
  const found = list.find(tool => tool.name === name);
  if (!found)
    throw new Error(`The mcp-extras area reads through the tool "${name}", which is missing`);
  return found;
}

const listJournalsTool = toolNamed(JOURNAL_TOOLS, 'list-journals');

/** The text a read tool gives for `args`; its error, with the cause, when it fails. */
export async function readThroughTool(
  tool: ToolDefinition,
  args: Record<string, unknown>,
  context: ResourceContext
): Promise<string> {
  const toolContext: ToolContext = {
    query: (name, data, options) =>
      context.query(name, data, {
        ...(context.signal ? { signal: context.signal } : {}),
        ...(options ?? {}),
      }),
    progress: () => undefined,
    ...(context.signal ? { signal: context.signal } : {}),
  };
  const result = toToolResult(await tool.handler(args, toolContext));
  const text = result.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n\n');
  if (result.isError) throw new Error(text.replace(/^Error: /, ''));
  return text;
}

function throughTool(
  tool: ToolDefinition,
  args: Record<string, unknown>
): (context: ResourceContext) => Promise<string> {
  return context => readThroughTool(tool, args, context);
}

/**
 * The overview is a short summary with a budget, not the output of five read
 * tools. In a first run against a real world it came to about 40,000
 * characters, most of it the journal list
 * as indented JSON. Now each section has counts, a few names with ids and
 * where the details are; the names shrink until the text fits.
 */
export const OVERVIEW_MAX_CHARS = 6000;
/** Names shown per section when the budget allows. */
export const OVERVIEW_NAMES = 12;
const NAME_MAX_CHARS = 80;

type Row = Record<string, unknown>;

interface Listed {
  name: string;
  id: string;
  note?: string;
}

interface Section {
  title: string;
  facts: string[];
  names: Listed[];
  details: string;
}

async function ask(context: ResourceContext, query: string, data: Row): Promise<unknown> {
  let answer: unknown;
  try {
    answer = await context.query(
      query,
      data,
      context.signal ? { signal: context.signal } : undefined
    );
  } catch (error) {
    throw moduleTooOld(query, error) ?? error;
  }
  const failure = legacyFailure(answer);
  if (failure !== null) throw new Error(failure);
  return answer;
}

/** A bare list or a list under one of `keys`, as modules of both generations answer. */
function rowsIn(answer: unknown, keys: readonly string[]): Row[] {
  if (Array.isArray(answer)) return answer.filter(isRecord);
  if (isRecord(answer)) {
    const key = keys.find(entry => Array.isArray(answer[entry]));
    if (key) return (answer[key] as unknown[]).filter(isRecord);
  }
  throw new Error(`the answer holds no list under ${keys.join(' or ')}`);
}

function listed(row: Row, note?: string): Listed {
  return {
    name: str(row['name']) || str(row['title']),
    id: str(row['id']) || str(row['_id']),
    ...(note ? { note } : {}),
  };
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const OVERVIEW_SECTIONS: ReadonlyArray<(context: ResourceContext) => Promise<Section>> = [
  async context => {
    const world = formatWorldInfo(await ask(context, 'getWorldInfo', {}));
    return {
      title: 'World',
      facts: [
        `${world.title} (id ${world.id}), game system ${world.system.id} ${world.system.version}, ` +
          `Foundry ${world.foundry.version}, ${world.users.active} of ${plural(world.users.total, 'user', 'users')} logged in.`,
      ],
      names: [],
      details: 'resource foundry://world/info; tool get-world-info',
    };
  },
  async context => {
    const rows = rowsIn(
      await ask(context, 'list-scenes', { filter: '', include_active_only: false }),
      ['scenes']
    );
    const active = rows.filter(row => row['active'] === true);
    return {
      title: 'Scenes',
      facts: [`${plural(rows.length, 'scene', 'scenes')}, ${active.length} active.`],
      names: [...active, ...rows.filter(row => row['active'] !== true)].map(row =>
        listed(row, row['active'] === true ? 'active' : undefined)
      ),
      details:
        'resources foundry://scene/active and foundry://scene/{sceneId}; tools list-scenes, get-current-scene',
    };
  },
  async context => {
    const rows = rowsIn(await ask(context, 'listJournals', {}), ['journals']);
    const pages = rows.reduce(
      (sum, row) =>
        sum +
        (Array.isArray(row['pages'])
          ? row['pages'].length
          : typeof row['pageCount'] === 'number'
            ? row['pageCount']
            : 0),
      0
    );
    return {
      title: 'Journals',
      facts: [
        `${plural(rows.length, 'journal', 'journals')} with ${plural(pages, 'page', 'pages')}.`,
      ],
      names: rows.map(row => listed(row)),
      details:
        'resources foundry://journal/{journalId} and foundry://journal/{journalId}/page/{pageId}; tools list-journals, search-journals',
    };
  },
  async context => {
    const rows = rowsIn(await ask(context, 'listActors', {}), ['actors']);
    const types = new Map<string, number>();
    for (const row of rows) {
      const type = str(row['type']) || 'unknown';
      types.set(type, (types.get(type) ?? 0) + 1);
    }
    const byType = [...types].sort((a, b) => b[1] - a[1]).map(([type, n]) => `${n} ${type}`);
    return {
      title: 'Actors',
      facts: [
        `${plural(rows.length, 'actor', 'actors')}${byType.length ? `: ${byType.join(', ')}` : ''}.`,
      ],
      names: rows.map(row => listed(row, str(row['type']) || undefined)),
      details: 'resource foundry://actor/{actorId}; tools list-characters, get-character',
    };
  },
  async context => {
    const rows = rowsIn(await ask(context, 'listCombats', {}), ['combats']);
    const active = rows.filter(row => row['active'] === true).length;
    return {
      title: 'Combat encounters',
      facts: [`${plural(rows.length, 'combat encounter', 'combat encounters')}, ${active} active.`],
      names: rows.map(row => ({
        name: `round ${typeof row['round'] === 'number' ? row['round'] : 0}`,
        id: str(row['id']),
        ...(row['active'] === true ? { note: 'active' } : {}),
      })),
      details:
        'resources foundry://combat/active and foundry://combat/{combatId}; tools list-combats, get-combat',
    };
  },
];

function nameLine(entry: Listed): string {
  const name = entry.name || '(no name)';
  const short = name.length > NAME_MAX_CHARS ? `${name.slice(0, NAME_MAX_CHARS - 3)}...` : name;
  return `- ${short}${entry.note ? ` (${entry.note})` : ''} [${entry.id}]`;
}

function renderOverview(
  parts: ReadonlyArray<{ section: Section | null; title: string; error: string | null }>,
  names: number
): string {
  const blocks = parts.map(part => {
    if (!part.section) return `## ${part.title}\n\nNot available: ${part.error ?? 'unknown cause'}`;
    const { section } = part;
    const lines = [...section.facts];
    const shown = section.names.slice(0, names).map(nameLine);
    if (shown.length) {
      lines.push('', ...shown);
      if (section.names.length > shown.length)
        lines.push(`- and ${section.names.length - shown.length} more`);
    }
    lines.push('', `Details: ${section.details}.`);
    return `## ${section.title}\n\n${lines.join('\n')}`;
  });
  return [
    '# World overview',
    '',
    `A summary within ${OVERVIEW_MAX_CHARS} characters: counts and the first names of each part of the world. Each section names the resources and tools that give the details.`,
    '',
    blocks.join('\n\n'),
  ].join('\n');
}

const SECTION_TITLES = ['World', 'Scenes', 'Journals', 'Actors', 'Combat encounters'];

/** Every section that can be read; a section that fails says why. All failing is an error. */
export async function readOverview(context: ResourceContext): Promise<string> {
  const parts = await Promise.all(
    OVERVIEW_SECTIONS.map(async (read, index) => {
      const title = SECTION_TITLES[index] ?? 'Section';
      try {
        return { title, section: await read(context), error: null };
      } catch (error) {
        return { title, section: null, error: messageOf(error) };
      }
    })
  );
  const failed = parts.filter(part => part.error !== null);
  if (failed.length === parts.length) {
    throw new Error(`The world overview could not be read: ${failed[0]?.error ?? 'no section'}`);
  }
  let names = OVERVIEW_NAMES;
  let text = renderOverview(parts, names);
  while (text.length > OVERVIEW_MAX_CHARS && names > 0) {
    names = Math.floor(names / 2);
    text = renderOverview(parts, names);
  }
  if (text.length <= OVERVIEW_MAX_CHARS) return text;
  const note = `\n\n(Shortened to ${OVERVIEW_MAX_CHARS} characters; the tools named above give everything.)`;
  return text.slice(0, OVERVIEW_MAX_CHARS - note.length) + note;
}

export const CHANGE_LIMIT = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function formatChanges(answer: unknown): string {
  const entries = Array.isArray(answer) ? answer.filter(isRecord) : [];
  const origin =
    'The log lives in the browser of the Gamemaster whose module is connected and starts empty whenever that ' +
    'browser loads the world, so it covers the changes the AI made since then, nothing older and nothing done by hand.';
  if (!entries.length) return `No changes are recorded. ${origin}`;

  const counts = new Map<string, number>();
  for (const entry of entries) {
    const key = `${str(entry['action']) || 'other'} ${str(entry['document']) || 'unknown'}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const lines = entries.map(entry => {
    const targets = Array.isArray(entry['targets'])
      ? entry['targets']
          .filter(isRecord)
          .map(target => str(target['name']) || str(target['uuid']) || str(target['id']))
          .filter(Boolean)
      : [];
    const user = isRecord(entry['user']) ? str(entry['user']['name']) : '';
    return (
      `- ${str(entry['at'])} ${str(entry['action'])} ${str(entry['document'])}` +
      (targets.length ? ` (${targets.join(', ')})` : '') +
      `: ${str(entry['summary']) || 'no summary'}` +
      (str(entry['tool']) ? `; tool ${str(entry['tool'])}` : '') +
      (user ? `; by ${user}` : '') +
      (str(entry['undoneAt']) ? `; undone at ${str(entry['undoneAt'])}` : '')
    );
  });
  return [
    `# Recent changes`,
    '',
    `${entries.length} change${entries.length === 1 ? '' : 's'}, newest first, at most ${CHANGE_LIMIT}. ${origin}`,
    '',
    `By kind: ${[...counts].map(([key, n]) => `${n} ${key}`).join(', ')}.`,
    '',
    ...lines,
  ].join('\n');
}

export async function readRecentChanges(context: ResourceContext): Promise<string> {
  let answer: unknown;
  try {
    answer = await context.query(
      'getChangeLog',
      { limit: CHANGE_LIMIT },
      context.signal ? { signal: context.signal } : undefined
    );
  } catch (error) {
    throw (
      moduleTooOld('getChangeLog', error, 'read the change log') ??
      new Error(`Failed to read the change log: ${messageOf(error)}`)
    );
  }
  const failure = legacyFailure(answer);
  if (failure !== null) throw new Error(`Failed to read the change log: ${failure}`);
  return formatChanges(answer);
}

export const MCP_EXTRAS_RESOURCES: readonly ResourceDefinition[] = [
  {
    uri: URIS.worldOverview,
    name: 'world-overview',
    title: 'World overview',
    description:
      'A compact summary of the open world, at most 6000 characters: world, then counts and the first names of scenes, journals, actors and combat encounters, each with the resources and tools that give the details.',
    mimeType: 'text/markdown',
    read: readOverview,
  },
  {
    uri: URIS.activeScene,
    name: 'active-scene',
    title: 'Active scene',
    description:
      'The scene that is active for everyone, with its notes and visible tokens (as get-current-scene).',
    mimeType: 'text/plain',
    read: throughTool(getCurrentSceneTool, { includeTokens: true, includeHidden: false }),
  },
  {
    uri: URIS.compendiums,
    name: 'compendium-index',
    title: 'Compendium index',
    description:
      'Every compendium with type, entry count, lock state and whether the AI may write to it (as list-compendiums).',
    mimeType: 'text/plain',
    read: throughTool(listCompendiumsTool, {}),
  },
  {
    uri: URIS.activeCombat,
    name: 'active-combat',
    title: 'Active combat',
    description:
      'The active combat encounter: turn order, current turn and who comes next (as get-combat).',
    mimeType: 'text/plain',
    read: throughTool(getCombatTool, {}),
  },
  {
    uri: URIS.recentChanges,
    name: 'recent-changes',
    title: 'Recent changes',
    description:
      'Summary of the latest changes the AI made to the world, newest first, from the change log of the connected module.',
    mimeType: 'text/markdown',
    read: readRecentChanges,
  },
];

function variable(variables: Record<string, string>, name: string): string {
  const value = variables[name];
  if (!value) throw new Error(`The resource URI has no ${name}`);
  return value;
}

export const MCP_EXTRAS_TEMPLATES: readonly ResourceTemplateDefinition[] = [
  {
    uriTemplate: URIS.scene,
    name: 'scene',
    title: 'Scene by id',
    description:
      'One scene with its data and its embedded walls, tokens, lights and notes as ids and names (as get-document).',
    mimeType: 'text/plain',
    read: (variables, context) =>
      readThroughTool(
        getDocumentTool,
        { documentType: 'Scene', id: variable(variables, 'sceneId'), embedded: 'summary' },
        context
      ),
    complete: { sceneId: completeSceneId },
  },
  {
    uriTemplate: URIS.journal,
    name: 'journal',
    title: 'Journal by id',
    description:
      'A journal: the content of its first text page and the list of all its pages (as list-journals with journalId).',
    mimeType: 'text/plain',
    read: (variables, context) =>
      readThroughTool(listJournalsTool, { journalId: variable(variables, 'journalId') }, context),
    complete: { journalId: completeJournalId },
  },
  {
    uriTemplate: URIS.journalPage,
    name: 'journal-page',
    title: 'Journal page by id',
    description:
      'One page of a journal with its content (as list-journals with journalId and pageId).',
    mimeType: 'text/plain',
    read: (variables, context) =>
      readThroughTool(
        listJournalsTool,
        { journalId: variable(variables, 'journalId'), pageId: variable(variables, 'pageId') },
        context
      ),
    complete: { journalId: completeJournalId, pageId: completePageId },
  },
  {
    uriTemplate: URIS.actor,
    name: 'actor',
    title: 'Actor by id',
    description:
      'Overview of one actor with the values the game system adapter reads, items, effects and spellcasting (as get-character).',
    mimeType: 'text/plain',
    read: (variables, context) =>
      readThroughTool(getCharacterTool, { identifier: variable(variables, 'actorId') }, context),
    complete: { actorId: completeActorId },
  },
  {
    uriTemplate: URIS.compendium,
    name: 'compendium',
    title: 'Compendium entries',
    description: 'The first 200 entries of one compendium (as list-compendium-entries).',
    mimeType: 'text/plain',
    read: (variables, context) =>
      readThroughTool(
        listCompendiumEntriesTool,
        { packId: variable(variables, 'packId') },
        context
      ),
    complete: { packId: completePackId },
  },
  {
    uriTemplate: URIS.combat,
    name: 'combat',
    title: 'Combat encounter by id',
    description: 'One combat encounter with turn order and current turn (as get-combat).',
    mimeType: 'text/plain',
    read: (variables, context) =>
      readThroughTool(getCombatTool, { combatId: variable(variables, 'combatId') }, context),
    complete: { combatId: completeCombatId },
  },
];
