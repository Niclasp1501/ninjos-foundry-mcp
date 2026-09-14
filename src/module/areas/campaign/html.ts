/**
 * The HTML of dashboards and quest pages, and the places where later tools
 * write into a stored page.
 *
 * Every value that comes from the caller or the world goes through
 * `escapeHtml`. Only `additionalPages` and HTML sent to update-quest-journal
 * stay as sent: the tool descriptions ask for HTML there.
 *
 * Changes to a stored page never re-serialise it. The page text is kept
 * character for character, and new markup is inserted at a position found in
 * that text, so nothing a Gamemaster wrote by hand is normalised away.
 */
import { escapeHtml } from '../interface/html.js';
import {
  computeView,
  type CampaignStatus,
  type CampaignStructure,
  type DashboardView,
  type ViewPartInput,
} from './model.js';
import { ch, ct } from './texts.js';

export { escapeHtml };

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** A random id of letters and digits, as Foundry ids look. */
export function randomId(length = 16): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => ID_ALPHABET[byte % ID_ALPHABET.length]).join('');
}

/** A Foundry secret block: only users who may edit the page see it. */
export function secretSection(inner: string): string {
  return `<section class="secret" id="secret-${randomId()}">${inner}</section>`;
}

/** Whether a text contains at least one HTML tag. */
export function looksLikeHtml(text: string): boolean {
  return /<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>/i.test(text);
}

export function hasHeading(html: string): boolean {
  return /<h[1-6][\s>]/i.test(html);
}

/** Plain text as paragraphs: a blank line starts a paragraph, a single line break stays one. */
export function textToHtml(text: string): string {
  return text
    .trim()
    .split(/\r?\n[ \t]*\r?\n/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean)
    .map(paragraph => `<p>${paragraph.split(/\r?\n/).map(escapeHtml).join('<br>')}</p>`)
    .join('');
}

/** Content for a page: HTML as sent, plain text escaped into paragraphs. Markdown is not converted. */
export function contentHtml(content: string): string {
  return looksLikeHtml(content) ? content : textToHtml(content);
}

// ---------------------------------------------------------------------------
// Finding an element in stored HTML
// ---------------------------------------------------------------------------

export interface ElementRange {
  /** Index of `<` of the opening tag. */
  start: number;
  /** Index just after `>` of the opening tag. */
  openEnd: number;
  /** Index of `<` of the closing tag. */
  closeStart: number;
  /** Index just after `>` of the closing tag. */
  end: number;
}

/**
 * The first element that carries `attribute` (optionally with exactly `value`),
 * with its matching closing tag. Nested elements of the same name are counted.
 * Null when there is none or its closing tag is missing.
 */
export function findElement(html: string, attribute: string, value?: string): ElementRange | null {
  const valuePart =
    value === undefined
      ? '(?:=(?:"[^"]*"|\'[^\']*\'|[^\\s>]*))?'
      : `="${escapeRegExp(escapeHtml(value))}"`;
  const open = new RegExp(
    `<([a-zA-Z][a-zA-Z0-9]*)\\b[^>]*?\\s${escapeRegExp(attribute)}${valuePart}(?=[\\s/>])[^>]*>`,
    'g'
  );
  const match = open.exec(html);
  if (!match) return null;
  const tag = (match[1] as string).toLowerCase();
  const start = match.index;
  const openEnd = start + match[0].length;
  const tags = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  tags.lastIndex = openEnd;
  let depth = 1;
  for (let token = tags.exec(html); token; token = tags.exec(html)) {
    if (token[1]) depth -= 1;
    else if (!token[0].endsWith('/>')) depth += 1;
    if (depth === 0) {
      return { start, openEnd, closeStart: token.index, end: token.index + token[0].length };
    }
  }
  return null;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function insertAt(html: string, index: number, addition: string): string {
  return html.slice(0, index) + addition + html.slice(index);
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

/** Labels of every part and sub part, in the client's language. */
export function partLabels(structure: CampaignStructure): ViewPartInput[] {
  return structure.parts.map(part => ({
    id: part.id,
    label: ct('dashboard.part', { number: part.number, title: part.title }),
    subParts: part.subParts.map(sub => ({
      id: sub.id,
      label: ct('dashboard.subPart', { number: sub.number, title: sub.title }),
    })),
  }));
}

export function progressText(view: DashboardView): string {
  return ct('dashboard.progress', { done: view.done, total: view.total, percent: view.percent });
}

export function currentText(view: DashboardView): string {
  if (view.current.kind === 'ready') return ct('dashboard.ready');
  if (view.current.kind === 'finished') return ct('dashboard.finished');
  return ct('dashboard.current', { part: view.current.label ?? '' });
}

export function statusText(status: CampaignStatus): string {
  return ct(`status.${status}`);
}

function levelsText(start: number, end: number): string {
  return start === end
    ? ct('dashboard.level', { level: start })
    : ct('dashboard.levels', { start, end });
}

function toggle(id: string, status: CampaignStatus): string {
  return (
    `<span class="ninjo-campaign-toggle" data-campaign-toggle="${escapeHtml(id)}" ` +
    `data-campaign-status="${status}">${escapeHtml(statusText(status))}</span>`
  );
}

/**
 * The dashboard page as it is stored. Figures, locks and toggles show the
 * state passed in; the module sets them again from the saved status each time
 * the page is shown (dashboard-sheet.ts).
 */
export function dashboardHtml(
  structure: CampaignStructure,
  statuses: unknown,
  createdOn: string
): string {
  const labels = partLabels(structure);
  const view = computeView(structure.id, labels, statuses);
  const out: string[] = [];
  out.push(
    `<div class="ninjo-campaign-dashboard" data-campaign-dashboard="${escapeHtml(structure.id)}">`
  );
  out.push(`<h1>${escapeHtml(structure.title)}</h1>`);
  out.push(textToHtml(structure.description));
  out.push(`<h2>${ch('dashboard.overview')}</h2>`);
  out.push(`<p data-campaign-figure="progress">${escapeHtml(progressText(view))}</p>`);
  out.push(`<p data-campaign-figure="current">${escapeHtml(currentText(view))}</p>`);
  if (structure.location)
    out.push(`<p>${ch('dashboard.location', { location: escapeHtml(structure.location) })}</p>`);
  if (structure.questGiver)
    out.push(`<p>${ch('dashboard.questGiver', { name: escapeHtml(structure.questGiver) })}</p>`);

  out.push(`<h2>${ch('dashboard.partsHeading')}</h2>`);
  out.push(`<p><em>${ch('dashboard.partsHint')}</em></p>`);
  structure.parts.forEach((part, index) => {
    const state = view.parts[index];
    const label = labels[index] as ViewPartInput;
    out.push(`<div class="ninjo-campaign-part" data-campaign-part="${escapeHtml(part.id)}">`);
    // The first part is never locked, so it carries no lock marker.
    const lock =
      index > 0
        ? `<span class="ninjo-campaign-lock" data-campaign-lock>${ch('dashboard.locked')} </span>`
        : '';
    out.push(`<h3>${lock}${escapeHtml(label.label)}</h3>`);
    out.push(
      `<p class="ninjo-campaign-meta">${toggle(part.id, state?.status ?? 'not_started')} · ` +
        `${escapeHtml(levelsText(part.levelStart, part.levelEnd))} · ${ch(`dashboard.partType.${part.type}`)}</p>`
    );
    out.push(textToHtml(part.description));
    if (index > 0) {
      const previous = labels[index - 1] as ViewPartInput;
      out.push(
        `<p class="ninjo-campaign-requires" data-campaign-requires><em>${ch('dashboard.requires', {
          part: escapeHtml(previous.label),
        })}</em></p>`
      );
    }
    part.subParts.forEach((sub, subIndex) => {
      const subLabel = label.subParts[subIndex];
      out.push(
        `<div class="ninjo-campaign-subpart" data-campaign-part="${escapeHtml(sub.id)}">` +
          `<h4>${escapeHtml(subLabel?.label ?? sub.title)}</h4>` +
          `<p class="ninjo-campaign-meta">${toggle(sub.id, state?.subParts[subIndex]?.status ?? 'not_started')}</p>` +
          `${textToHtml(sub.description)}</div>`
      );
    });
    out.push('</div>');
  });

  out.push(
    secretSection(
      `<h2>${ch('dashboard.gmNote')}</h2>` +
        `<p>${ch('dashboard.created', { date: escapeHtml(createdOn) })}</p>` +
        `<p>${ch('dashboard.campaignId', { id: escapeHtml(structure.id) })}</p>`
    )
  );
  out.push('</div>');
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Quest page
// ---------------------------------------------------------------------------

export const QUEST_TYPES = [
  'main',
  'side',
  'personal',
  'mystery',
  'fetch',
  'escort',
  'kill',
  'collection',
] as const;
export type QuestType = (typeof QUEST_TYPES)[number];

export const DIFFICULTIES = ['easy', 'medium', 'hard', 'deadly'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const RELATIONSHIPS = ['quest_giver', 'target', 'ally', 'enemy', 'contact'] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];

export const QUEST_STATUSES = ['active', 'completed', 'failed'] as const;
export type QuestStatus = (typeof QUEST_STATUSES)[number];

export interface QuestInput {
  title: string;
  description: string;
  questType?: QuestType | undefined;
  difficulty?: Difficulty | undefined;
  location?: string | undefined;
  questGiver?: string | undefined;
  npcName?: string | undefined;
  rewards?: string | undefined;
}

const FIXED_OBJECTIVES: Partial<Record<QuestType, readonly string[]>> = {
  fetch: ['fetch1', 'fetch2', 'fetch3'],
  escort: ['escort1', 'escort2', 'escort3'],
  kill: ['kill1', 'kill2', 'kill3'],
  mystery: ['mystery1', 'mystery2', 'mystery3'],
};

/** The objectives, from the quest type and the facts given. No guessing from words of the description. */
export function questObjectives(quest: QuestInput): string[] {
  const fixed = quest.questType ? FIXED_OBJECTIVES[quest.questType] : undefined;
  const list: string[] = [];
  const npc = quest.npcName ? escapeHtml(quest.npcName) : null;
  const location = quest.location ? escapeHtml(quest.location) : null;
  if (fixed) {
    list.push(...fixed.map(key => ch(`quest.objective.${key}`)));
  } else {
    if (npc) list.push(ch('quest.objective.npc1', { name: npc }));
    if (location) list.push(ch('quest.objective.npc2', { location }));
    if (npc) list.push(ch('quest.objective.npc3', { name: npc }));
    else {
      const words = quest.description.trim().split(/\s+/);
      const summary = words.slice(0, 15).join(' ') + (words.length > 15 ? ' ...' : '');
      list.push(ch('quest.objective.main', { summary: escapeHtml(summary) }));
    }
  }
  list.push(
    quest.questGiver
      ? ch('quest.objective.reportGiver', { name: escapeHtml(quest.questGiver) })
      : ch('quest.objective.reportDefault')
  );
  if (quest.rewards) list.push(ch('quest.objective.claim'));
  return list;
}

function item(labelKey: string, valueHtml: string): string {
  return `<li><strong>${ch(labelKey)}:</strong> ${valueHtml}</li>`;
}

export function questStatusMarker(status: QuestStatus): string {
  return `<span data-campaign-quest-status="${status}">${ch(`quest.statusValue.${status}`)}</span>`;
}

/** The first page of a quest journal. */
export function questHtml(quest: QuestInput, createdOn: string): string {
  const out: string[] = ['<div class="ninjo-campaign-quest" data-campaign-quest>'];
  out.push(`<h1>${escapeHtml(quest.title)}</h1>`);
  out.push(textToHtml(quest.description));

  const background: string[] = [];
  if (quest.location)
    background.push(ch('quest.backgroundLocation', { location: escapeHtml(quest.location) }));
  if (quest.questGiver)
    background.push(ch('quest.backgroundGiver', { name: escapeHtml(quest.questGiver) }));
  if (quest.npcName)
    background.push(ch('quest.backgroundNpc', { name: escapeHtml(quest.npcName) }));
  if (background.length) {
    out.push(`<h2>${ch('quest.background')}</h2>`);
    out.push(`<p>${background.join(' ')}</p>`);
    out.push(`<p><em>${ch('quest.adjust')}</em></p>`);
  }

  const details: string[] = [];
  if (quest.questType) details.push(item('quest.type', ch(`quest.questType.${quest.questType}`)));
  if (quest.difficulty)
    details.push(item('quest.difficulty', ch(`quest.difficultyValue.${quest.difficulty}`)));
  if (quest.location) details.push(item('quest.location', escapeHtml(quest.location)));
  if (quest.npcName) details.push(item('quest.keyFigure', escapeHtml(quest.npcName)));
  const status: string[] = [];
  if (quest.rewards) status.push(item('quest.rewards', escapeHtml(quest.rewards)));
  status.push(item('quest.status', questStatusMarker('active')));
  status.push(item('quest.created', escapeHtml(createdOn)));
  out.push('<div class="ninjo-campaign-columns" data-campaign-overview>');
  if (details.length) {
    out.push(
      `<div class="ninjo-campaign-column"><h3>${ch('quest.details')}</h3><ul>${details.join('')}</ul></div>`
    );
  }
  out.push(
    `<div class="ninjo-campaign-column" data-campaign-overview-status><h3>${ch('quest.statusColumn')}</h3>` +
      `<ul>${status.join('')}</ul></div>`
  );
  out.push('</div>');

  out.push(`<h2>${ch('quest.hook')}</h2>`);
  const hook = quest.questGiver
    ? ch('quest.hookGiver', { name: escapeHtml(quest.questGiver) })
    : quest.location
      ? ch('quest.hookRumour', { place: escapeHtml(quest.location) })
      : ch('quest.hookRumourAnywhere');
  out.push(`<blockquote class="ninjo-campaign-readaloud"><p>${hook}</p></blockquote>`);

  const advice: string[] = [];
  if (quest.difficulty)
    advice.push(
      ch('quest.gmDifficulty', { difficulty: ch(`quest.difficultyValue.${quest.difficulty}`) })
    );
  if (quest.questType)
    advice.push(ch('quest.gmType', { type: ch(`quest.questType.${quest.questType}`) }));
  advice.push(ch('quest.gmAdvice'));
  out.push(
    secretSection(`<p><strong>${ch('quest.gmNote')}</strong></p><p>${advice.join(' ')}</p>`)
  );

  out.push(`<h2>${ch('quest.objectives')}</h2>`);
  out.push(
    `<ul>${questObjectives(quest)
      .map(entry => `<li>${entry}</li>`)
      .join('')}</ul>`
  );

  out.push(`<h2>${ch('quest.progressNotes')}</h2>`);
  out.push(
    `<div class="ninjo-campaign-progress" data-campaign-progress>${secretSection(
      `<p>${ch('quest.progressPlaceholder')}</p>`
    )}</div>`
  );
  out.push('</div>');
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// link-quest-to-npc
// ---------------------------------------------------------------------------

export interface NpcLink {
  /** Shown name. */
  name: string;
  /** uuid of the actor when one was found, null for a name only. */
  actorUuid: string | null;
  relationship: Relationship;
}

export type NpcPlacement = 'list' | 'overview' | 'quest' | 'end';

export interface NpcLinkPlan {
  html: string;
  changed: boolean;
  placement: NpcPlacement | 'already';
}

function npcKey(link: NpcLink): string {
  return link.actorUuid ?? `name:${link.name}`;
}

export function npcEntryHtml(link: NpcLink): string {
  // Brackets and braces would end the link markup early; they are left out of the label only.
  const label = escapeHtml(link.name.replace(/[[\]{}]/g, ''));
  const npc = link.actorUuid ? `@UUID[${link.actorUuid}]{${label}}` : escapeHtml(link.name);
  return (
    `<li data-campaign-npc="${escapeHtml(npcKey(link))}" data-campaign-role="${link.relationship}">` +
    `${ch('quest.npcEntry', { npc, role: ch(`quest.relationship.${link.relationship}`) })}</li>`
  );
}

/**
 * Where a related NPC goes: into the existing list, else at the end of the
 * status column of the overview, else at the end of the quest block, else at
 * the end of the page. There is always a place, so the page never stays
 * unchanged while the tool reports success. The same NPC in the same role is
 * not added twice.
 */
export function planNpcLink(html: string, link: NpcLink): NpcLinkPlan {
  const marker = `data-campaign-npc="${escapeHtml(npcKey(link))}" data-campaign-role="${link.relationship}"`;
  if (html.includes(marker)) return { html, changed: false, placement: 'already' };

  const entry = npcEntryHtml(link);
  const list = findElement(html, 'data-campaign-npc-list');
  if (list)
    return { html: insertAt(html, list.closeStart, entry), changed: true, placement: 'list' };

  const block =
    `<div class="ninjo-campaign-npcs" data-campaign-npcs><h3>${ch('quest.relatedNpcs')}</h3>` +
    `<ul data-campaign-npc-list>${entry}</ul></div>`;
  const column = findElement(html, 'data-campaign-overview-status');
  if (column)
    return { html: insertAt(html, column.closeStart, block), changed: true, placement: 'overview' };
  const quest = findElement(html, 'data-campaign-quest');
  if (quest)
    return { html: insertAt(html, quest.closeStart, block), changed: true, placement: 'quest' };
  return { html: html + block, changed: true, placement: 'end' };
}

// ---------------------------------------------------------------------------
// update-quest-journal
// ---------------------------------------------------------------------------

export type UpdateType = 'progress' | 'completion' | 'failure' | 'modification';
export const UPDATE_TYPES = ['progress', 'completion', 'failure', 'modification'] as const;

export type UpdatePlacement = 'progress' | 'quest' | 'end';

export interface QuestUpdatePlan {
  html: string;
  placement: UpdatePlacement;
  /** The status the marker was set to, null when the update type sets none. */
  status: QuestStatus | null;
  /** False when a status was due but the page has no marker for it. */
  statusChanged: boolean;
}

export function statusForUpdate(type: UpdateType): QuestStatus | null {
  if (type === 'completion') return 'completed';
  if (type === 'failure') return 'failed';
  return null;
}

/** The heading an update gets, unless the content brings its own. */
export function updateHeading(type: UpdateType, date: string): string {
  return ct(`update.${type}`, { date });
}

/** The section added to the first text page: completion as read-aloud text, everything else as a secret note. */
export function updateSection(type: UpdateType, content: string, date: string): string {
  const html = contentHtml(content);
  const heading = hasHeading(html) ? '' : `<h3>${escapeHtml(updateHeading(type, date))}</h3>`;
  const body =
    type === 'completion'
      ? `<blockquote class="ninjo-campaign-readaloud">${html}</blockquote>`
      : secretSection(html);
  return `<div class="ninjo-campaign-update" data-campaign-update="${type}">${heading}${body}</div>`;
}

/** A new page for an update: its heading and the content as a secret note. */
export function updatePageHtml(type: UpdateType, content: string, date: string): string {
  const html = contentHtml(content);
  const heading = hasHeading(html) ? '' : `<h2>${escapeHtml(updateHeading(type, date))}</h2>`;
  return `${heading}${secretSection(html)}`;
}

/**
 * Insert an update: at the end of the progress notes, else at the end of the
 * quest block, else at the end of the page. On completion and failure the
 * status marker of the overview changes.
 */
export function planQuestUpdate(html: string, section: string, type: UpdateType): QuestUpdatePlan {
  const status = statusForUpdate(type);
  let text = html;
  let statusChanged = false;
  if (status) {
    const marker = /<span\b[^>]*\sdata-campaign-quest-status="[^"]*"[^>]*>[\s\S]*?<\/span>/.exec(
      text
    );
    if (marker) {
      text =
        text.slice(0, marker.index) +
        questStatusMarker(status) +
        text.slice(marker.index + marker[0].length);
      statusChanged = true;
    }
  }
  const progress = findElement(text, 'data-campaign-progress');
  if (progress)
    return {
      html: insertAt(text, progress.closeStart, section),
      placement: 'progress',
      status,
      statusChanged,
    };
  const quest = findElement(text, 'data-campaign-quest');
  if (quest)
    return {
      html: insertAt(text, quest.closeStart, section),
      placement: 'quest',
      status,
      statusChanged,
    };
  return { html: text + section, placement: 'end', status, statusChanged };
}
