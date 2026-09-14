/**
 * The query handlers of the campaign area.
 *
 * The content is built here, in the module, not on the server: the texts come
 * in the language of the Gamemaster's client, and every change to a page
 * happens on the full stored page in the browser. Nothing is read in chunks,
 * changed on the server and written back, which lost content of long pages before.
 */
import { MODULE_ID } from '../../../common/constants.js';
import type { QueryHandler } from '../../dispatcher.js';
import { QueryError } from '../../dispatcher.js';
import { requireWorld } from '../../world-ready.js';
import {
  argsOf,
  getJournal,
  getPage,
  isRecord,
  optionalText,
  pageHtml,
  requiredText,
  requireTextPage,
} from '../journals/common.js';
import {
  contentHtml,
  DIFFICULTIES,
  QUEST_TYPES,
  RELATIONSHIPS,
  UPDATE_TYPES,
  dashboardHtml,
  planNpcLink,
  planQuestUpdate,
  questHtml,
  randomId,
  updatePageHtml,
  updateSection,
  type QuestInput,
} from './html.js';
import { addPage, createJournal, firstTextPage, writePage } from './journal.js';
import {
  buildStructure,
  PART_TYPES,
  STRUCTURE_FLAG_KEY,
  TEMPLATES,
  type PartSpec,
} from './model.js';
import { templateParts } from './templates.js';
import { ct, today } from './texts.js';

function invalid(message: string): never {
  throw new QueryError('INVALID_ARGUMENT', message);
}

function choice<T extends string>(
  args: Record<string, unknown>,
  key: string,
  values: readonly T[],
  required: true
): T;
function choice<T extends string>(
  args: Record<string, unknown>,
  key: string,
  values: readonly T[],
  required?: false
): T | undefined;
function choice<T extends string>(
  args: Record<string, unknown>,
  key: string,
  values: readonly T[],
  required = false
): T | undefined {
  const value = args[key];
  if (value === undefined || value === null) {
    if (required) invalid(`${key} is required, one of ${values.join(', ')}`);
    return undefined;
  }
  if (typeof value !== 'string' || !(values as readonly string[]).includes(value))
    invalid(`${key} must be one of ${values.join(', ')}, got ${JSON.stringify(value)}`);
  return value as T;
}

/** An optional text, trimmed; empty counts as not given. */
function optionalTrimmed(args: Record<string, unknown>, key: string): string | undefined {
  const value = optionalText(args, key)?.trim();
  return value ? value : undefined;
}

function level(part: Record<string, unknown>, key: string, where: string): number {
  const value = part[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 20)
    invalid(`${where}.${key} must be a whole number from 1 to 20, got ${JSON.stringify(value)}`);
  return value;
}

function textOf(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim())
    invalid(`${where}.${key} is required and must not be empty`);
  return value.trim();
}

/** The parts of a custom campaign, each checked. */
export function customPartsOf(raw: unknown): PartSpec[] {
  if (!Array.isArray(raw) || raw.length === 0)
    invalid('template "custom" needs customParts with at least one part');
  return raw.map((entry, index) => {
    const where = `customParts[${index}]`;
    if (!isRecord(entry)) invalid(`${where} must be an object`);
    const levelStart = level(entry, 'levelStart', where);
    const levelEnd = level(entry, 'levelEnd', where);
    if (levelStart > levelEnd)
      invalid(`${where}: levelStart ${levelStart} is above levelEnd ${levelEnd}`);
    const type = choice(entry, 'type', PART_TYPES, true);
    const subRaw = entry['subParts'];
    if (subRaw !== undefined && subRaw !== null && !Array.isArray(subRaw))
      invalid(`${where}.subParts must be a list`);
    const subParts = (Array.isArray(subRaw) ? subRaw : []).map((sub, subIndex) => {
      const subWhere = `${where}.subParts[${subIndex}]`;
      if (!isRecord(sub)) invalid(`${subWhere} must be an object`);
      return {
        title: textOf(sub, 'title', subWhere),
        description: textOf(sub, 'description', subWhere),
      };
    });
    return {
      title: textOf(entry, 'title', where),
      description: textOf(entry, 'description', where),
      type,
      levelStart,
      levelEnd,
      subParts,
    };
  });
}

function additionalPagesOf(raw: unknown): Array<{ name: string; html: string }> {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) invalid('additionalPages must be a list');
  return raw.map((entry, index) => {
    const where = `additionalPages[${index}]`;
    if (!isRecord(entry)) invalid(`${where} must be an object with name and content`);
    const content = entry['content'];
    if (typeof content !== 'string' || !content.trim())
      invalid(`${where}.content is required and must not be empty`);
    return { name: textOf(entry, 'name', where), html: content };
  });
}

const CREATE_JOURNALS = { kind: 'write', document: 'Journals', action: 'create' } as const;
const UPDATE_JOURNALS = { kind: 'write', document: 'Journals', action: 'update' } as const;

export const createCampaignDashboard: QueryHandler = {
  access: CREATE_JOURNALS,
  run: async (data, context) => {
    requireWorld();
    const args = argsOf(data);
    const title = requiredText(args, 'campaignTitle').trim();
    const description = requiredText(args, 'campaignDescription').trim();
    const template = choice(args, 'template', TEMPLATES, true);
    const hasCustom = args['customParts'] !== undefined && args['customParts'] !== null;
    if (template !== 'custom' && hasCustom)
      invalid(`customParts is only used with template "custom", not with "${template}"`);
    const parts =
      template === 'custom' ? customPartsOf(args['customParts']) : templateParts(template);

    const structure = buildStructure({
      id: `campaign-${randomId()}`,
      title,
      description,
      template,
      questGiver: optionalTrimmed(args, 'defaultQuestGiver') ?? null,
      location: optionalTrimmed(args, 'defaultLocation') ?? null,
      parts,
    });
    const name = ct('dashboard.journalName', { title });
    const created = await createJournal({
      name,
      pages: [{ name: ct('dashboard.pageName'), html: dashboardHtml(structure, {}, today()) }],
      folderName: title,
      folderContext: title,
      flags: { [MODULE_ID]: { [STRUCTURE_FLAG_KEY]: structure } },
      context,
      query: 'createCampaignDashboard',
      tool: 'create-campaign-dashboard',
    });
    const storedStructure = created.journal.flags?.[MODULE_ID]?.[STRUCTURE_FLAG_KEY];
    if (!isRecord(storedStructure) || storedStructure['id'] !== structure.id) {
      throw new QueryError(
        'VERIFY_FAILED',
        `The dashboard journal ${created.journal.id} was created, but it does not hold the campaign structure afterwards, ` +
          'so its status toggles cannot work. Check the journal before retrying.'
      );
    }
    return {
      success: true,
      campaignId: structure.id,
      dashboardJournalId: created.journal.id,
      dashboardName: name,
      pageId: created.pages[0]?.id ?? null,
      folder: created.folder,
      campaign: structure,
      ...(created.warnings.length ? { warnings: created.warnings } : {}),
      message: `Campaign dashboard "${title}" created successfully with ${structure.parts.length} parts`,
    };
  },
};

export const createQuestJournal: QueryHandler = {
  access: CREATE_JOURNALS,
  run: async (data, context) => {
    requireWorld();
    const args = argsOf(data);
    const quest: QuestInput = {
      title: requiredText(args, 'questTitle').trim(),
      description: requiredText(args, 'questDescription').trim(),
      questType: choice(args, 'questType', QUEST_TYPES),
      difficulty: choice(args, 'difficulty', DIFFICULTIES),
      location: optionalTrimmed(args, 'location'),
      questGiver: optionalTrimmed(args, 'questGiver'),
      npcName: optionalTrimmed(args, 'npcName'),
      rewards: optionalTrimmed(args, 'rewards'),
    };
    const extra = additionalPagesOf(args['additionalPages']);
    const created = await createJournal({
      name: quest.title,
      pages: [{ name: ct('quest.pageName'), html: questHtml(quest, today()) }, ...extra],
      folderName: optionalTrimmed(args, 'folderName'),
      folderContext: quest.title,
      context,
      query: 'createQuestJournal',
      tool: 'create-quest-journal',
    });
    return {
      success: true,
      journalId: created.journal.id,
      journalName: quest.title,
      pageCount: created.pages.length,
      pages: created.pages,
      folder: created.folder,
      ...(created.warnings.length ? { warnings: created.warnings } : {}),
      message: `Quest "${quest.title}" created successfully with ${created.pages.length} page(s)`,
    };
  },
};

/**
 * The query a server of the previous generation sends for create-quest-journal
 * and create-campaign-dashboard, with HTML it built itself.
 */
export const createJournalEntry: QueryHandler = {
  access: CREATE_JOURNALS,
  run: async (data, context) => {
    requireWorld();
    const args = argsOf(data);
    const name = requiredText(args, 'name').trim();
    const content = requiredText(args, 'content');
    const extra = additionalPagesOf(args['additionalPages']);
    const created = await createJournal({
      name,
      pages: [{ name: ct('quest.pageName'), html: content }, ...extra],
      folderName: optionalTrimmed(args, 'folderName'),
      context,
      query: 'createJournalEntry',
    });
    return {
      success: true,
      id: created.journal.id,
      name,
      pageCount: created.pages.length,
      folder: created.folder,
      ...(created.warnings.length ? { warnings: created.warnings } : {}),
    };
  },
};

/** An actor by id or exact name; several with that name is an error, none is null. */
function findActor(identifier: string): FoundryCampaignActor | null {
  const actors = game.actors.contents as FoundryCampaignActor[];
  const byId = actors.find(actor => actor.id === identifier);
  if (byId) return byId;
  const named = actors.filter(actor => actor.name === identifier);
  if (named.length > 1) {
    throw new QueryError(
      'AMBIGUOUS',
      `${named.length} actors are named "${identifier}": ${named.map(actor => actor.id).join(', ')}. ` +
        'Pass the actor id as npcName.'
    );
  }
  return named[0] ?? null;
}

export const linkQuestToNpc: QueryHandler = {
  access: UPDATE_JOURNALS,
  run: async (data, context) => {
    requireWorld();
    const args = argsOf(data);
    const journal = getJournal(requiredText(args, 'journalId'));
    const identifier = requiredText(args, 'npcName').trim();
    const relationship = choice(args, 'relationship', RELATIONSHIPS, true);
    const page = firstTextPage(journal, 'link-quest-to-npc');
    const actor = findActor(identifier);
    const name = actor?.name ?? identifier;
    const role = relationship.replace(/_/g, ' ');
    const plan = planNpcLink(pageHtml(page), {
      name,
      actorUuid: actor?.uuid ?? null,
      relationship,
    });
    const npc = {
      name,
      actorId: actor?.id ?? null,
      actorUuid: actor?.uuid ?? null,
      linked: actor !== null,
    };
    const notes = actor
      ? []
      : [
          `No actor named "${identifier}" is in the world, so the name was written as text without a link.`,
        ];

    if (!plan.changed) {
      return {
        success: true,
        changed: false,
        journalId: journal.id,
        pageId: page.id,
        pageName: page.name,
        npc,
        relationship,
        message: `${name} is already listed in this quest as ${role}; nothing was written`,
      };
    }
    const lengths = await writePage({
      journal,
      page,
      html: plan.html,
      context,
      query: 'linkQuestToNpc',
      tool: 'link-quest-to-npc',
      summary: `Added ${name} as ${role} to page "${page.name}" of "${journal.name}".`,
    });
    return {
      success: true,
      changed: true,
      journalId: journal.id,
      pageId: page.id,
      pageName: page.name,
      placement: plan.placement,
      npc,
      relationship,
      ...lengths,
      ...(notes.length ? { notes } : {}),
      message: `Linked ${name} to quest as ${role}`,
    };
  },
};

function updateArgs(data: unknown): { pageId?: string; newPageName?: string } {
  const args = isRecord(data) ? data : {};
  const text = (key: string) => {
    const value = args[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  };
  const pageId = text('pageId');
  const newPageName = text('newPageName');
  if (pageId && newPageName)
    invalid('Pass either pageId (append to that page) or newPageName (create a page), not both');
  return { ...(pageId ? { pageId } : {}), ...(newPageName ? { newPageName } : {}) };
}

export const updateQuestJournal: QueryHandler = {
  access: data => (updateArgs(data).newPageName ? CREATE_JOURNALS : UPDATE_JOURNALS),
  run: async (data, context) => {
    requireWorld();
    const args = argsOf(data);
    const { pageId, newPageName } = updateArgs(args);
    const journal = getJournal(requiredText(args, 'journalId'));
    const content = requiredText(args, 'newContent');
    const updateType = choice(args, 'updateType', UPDATE_TYPES, true);
    const date = today();
    const query = 'updateQuestJournal';
    const tool = 'update-quest-journal';

    if (newPageName) {
      const html = updatePageHtml(updateType, content, date);
      const page = await addPage({ journal, name: newPageName, html, context, query, tool });
      return {
        success: true,
        updateType,
        createdPage: true,
        journalId: journal.id,
        pageId: page.id,
        pageName: page.name,
        verified: true,
        lengthBefore: 0,
        lengthAfter: pageHtml(page).length,
        message: `New page "${page.name}" created in journal "${journal.name}"`,
      };
    }

    if (pageId) {
      const page = getPage(journal, pageId);
      requireTextPage(page, tool);
      // As described: a chosen page gets the content at its end, without a generated heading.
      const html = pageHtml(page) + contentHtml(content);
      const lengths = await writePage({
        journal,
        page,
        html,
        context,
        query,
        tool,
        summary: `Appended a ${updateType} update to page "${page.name}" of "${journal.name}".`,
      });
      return {
        success: true,
        updateType,
        createdPage: false,
        journalId: journal.id,
        pageId: page.id,
        pageName: page.name,
        placement: 'end',
        statusChanged: false,
        verified: true,
        ...lengths,
        message: `Quest journal updated with ${updateType}`,
      };
    }

    const page = firstTextPage(journal, tool);
    const plan = planQuestUpdate(
      pageHtml(page),
      updateSection(updateType, content, date),
      updateType
    );
    const lengths = await writePage({
      journal,
      page,
      html: plan.html,
      context,
      query,
      tool,
      summary: `Added a ${updateType} update to page "${page.name}" of "${journal.name}".`,
    });
    const notes =
      plan.status && !plan.statusChanged
        ? [
            `The page has no status marker from create-quest-journal, so the status was not set to ${plan.status}.`,
          ]
        : [];
    return {
      success: true,
      updateType,
      createdPage: false,
      journalId: journal.id,
      pageId: page.id,
      pageName: page.name,
      placement: plan.placement,
      statusChanged: plan.statusChanged,
      ...(plan.statusChanged ? { status: plan.status } : {}),
      verified: true,
      ...lengths,
      ...(notes.length ? { notes } : {}),
      message: `Quest journal updated with ${updateType}`,
    };
  },
};

/**
 * Registered in the previous module but never called by any server, and
 * without effect there. It answers for one
 * more version and says that it changed nothing.
 */
export const updateCampaignProgress: QueryHandler = {
  access: { kind: 'read' },
  run: data => {
    const args = isRecord(data) ? data : {};
    return {
      success: true,
      changed: false,
      message:
        'updateCampaignProgress changes nothing: the dashboard saves the status itself when a Gamemaster clicks it in Foundry',
      campaignId: args['campaignId'] ?? null,
      partId: args['partId'] ?? null,
      newStatus: args['newStatus'] ?? null,
    };
  },
};
