/**
 * The status toggles of a campaign dashboard in Foundry.
 *
 * Only journal sheets are hooked, not every application.
 * A dashboard is recognised by the campaign structure in the journal's flags
 * and the matching block on the page, not by the journal name.
 *
 * Each time the page is shown, progress figure, current part, lock markers
 * and toggles are set from the saved status, so none of them stays at the
 * state of creation. A click changes the status of one part, saves it on the
 * journal under `flags.world.campaignStatus` (the key the previous module
 * used), reads it back and shows the result. Only a Gamemaster can change it.
 *
 * The page is reached through `CampaignElement`, a narrow slice of the DOM,
 * so the rules run in tests without a browser.
 */
import { MODULE_ID } from '../../../common/constants.js';
import { announce } from '../interface/index.js';
import { currentText, partLabels, progressText, statusText } from './html.js';
import {
  computeView,
  nextStatus,
  readStatus,
  statusKey,
  STATUS_FLAG_KEY,
  STATUS_FLAG_SCOPE,
  STRUCTURE_FLAG_KEY,
  type CampaignStatus,
  type CampaignStructure,
} from './model.js';
import { ct } from './texts.js';

export interface CampaignEvent {
  type: string;
  target: unknown;
  key?: string;
  preventDefault(): void;
}

export interface CampaignElement {
  textContent: string | null;
  hidden: boolean;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  querySelector(selector: string): CampaignElement | null;
  querySelectorAll(selector: string): Iterable<CampaignElement>;
  closest(selector: string): CampaignElement | null;
  matches(selector: string): boolean;
  addEventListener(type: string, listener: (event: CampaignEvent) => void): void;
}

/** Render hooks of the journal sheets: ApplicationV2 (Foundry 13 and later) and the older sheets. */
export const JOURNAL_SHEET_HOOKS = [
  'renderJournalEntrySheet',
  'renderJournalEntryPageSheet',
  'renderJournalSheet',
  'renderJournalPageSheet',
] as const;

const ROOT = '[data-campaign-dashboard]';
const TOGGLE = '[data-campaign-toggle]';
const BOUND = 'data-campaign-bound';

/** The journal a sheet shows: the entry itself, or the parent of a page. */
export function journalOfSheet(app: unknown): FoundryCampaignJournal | null {
  const sheet = app as FoundryCampaignSheet | null | undefined;
  const document = sheet?.document ?? sheet?.object ?? null;
  if (!document) return null;
  if (document.documentName === 'JournalEntry') return document as FoundryCampaignJournal;
  if (
    document.documentName === 'JournalEntryPage' &&
    document.parent?.documentName === 'JournalEntry'
  )
    return document.parent as FoundryCampaignJournal;
  return null;
}

/** The campaign structure stored on a dashboard journal, or null when it is none or damaged. */
export function structureOf(journal: FoundryCampaignJournal): CampaignStructure | null {
  const value = journal.flags?.[MODULE_ID]?.[STRUCTURE_FLAG_KEY] as
    Partial<CampaignStructure> | undefined;
  if (!value || value.version !== 1 || typeof value.id !== 'string' || !Array.isArray(value.parts))
    return null;
  const partsOk = value.parts.every(
    part =>
      typeof part?.id === 'string' &&
      typeof part.title === 'string' &&
      Array.isArray(part.subParts) &&
      part.subParts.every(sub => typeof sub?.id === 'string' && typeof sub.title === 'string')
  );
  return partsOk ? (value as CampaignStructure) : null;
}

export function statusesOf(journal: FoundryCampaignJournal): unknown {
  return journal.flags?.[STATUS_FLAG_SCOPE]?.[STATUS_FLAG_KEY];
}

function partIds(structure: CampaignStructure): Set<string> {
  return new Set(structure.parts.flatMap(part => [part.id, ...part.subParts.map(sub => sub.id)]));
}

function labelOf(structure: CampaignStructure, id: string): string {
  for (const part of partLabels(structure)) {
    if (part.id === id) return part.label;
    const sub = part.subParts.find(entry => entry.id === id);
    if (sub) return sub.label;
  }
  return id;
}

function findAll(element: CampaignElement, selector: string): CampaignElement[] {
  return [...(element.matches(selector) ? [element] : []), ...element.querySelectorAll(selector)];
}

function showToggle(toggle: CampaignElement, label: string, status: CampaignStatus): void {
  toggle.setAttribute('data-campaign-status', status);
  toggle.textContent = statusText(status);
  toggle.setAttribute('role', 'button');
  toggle.setAttribute('tabindex', '0');
  toggle.setAttribute(
    'aria-label',
    ct('status.toggle', { part: label, status: statusText(status) })
  );
}

/** Set figures, current part, locks and toggles of one dashboard block from the statuses. */
export function applyView(
  root: CampaignElement,
  structure: CampaignStructure,
  statuses: unknown
): void {
  const labels = partLabels(structure);
  const view = computeView(structure.id, labels, statuses);
  const progress = root.querySelector('[data-campaign-figure="progress"]');
  if (progress) progress.textContent = progressText(view);
  const current = root.querySelector('[data-campaign-figure="current"]');
  if (current) current.textContent = currentText(view);

  structure.parts.forEach((part, index) => {
    const state = view.parts[index];
    const label = labels[index];
    if (!state || !label) return;
    const block = root.querySelector(`[data-campaign-part="${part.id}"]`);
    if (block) {
      const lock = block.querySelector('[data-campaign-lock]');
      if (lock) lock.hidden = !state.locked;
      const requires = block.querySelector('[data-campaign-requires]');
      if (requires) requires.hidden = !state.locked;
    }
    const toggle = root.querySelector(`[data-campaign-toggle="${part.id}"]`);
    if (toggle) showToggle(toggle, label.label, state.status);
    part.subParts.forEach((sub, subIndex) => {
      const subToggle = root.querySelector(`[data-campaign-toggle="${sub.id}"]`);
      const subState = state.subParts[subIndex];
      if (subToggle && subState)
        showToggle(subToggle, label.subParts[subIndex]?.label ?? sub.title, subState.status);
    });
  });
}

/** Save the status of one part on the journal and read it back. Throws with the cause. */
export async function saveStatus(
  journal: FoundryCampaignJournal,
  structure: CampaignStructure,
  partId: string,
  status: CampaignStatus
): Promise<unknown> {
  if (!partIds(structure).has(partId))
    throw new Error(`the part ${partId} is not in this campaign`);
  const key = statusKey(structure.id, partId);
  await journal.update({ [`flags.${STATUS_FLAG_SCOPE}.${STATUS_FLAG_KEY}.${key}`]: status });
  const stored = (game.journal.get(journal.id) as FoundryCampaignJournal | undefined) ?? journal;
  const statuses = statusesOf(stored);
  if (readStatus(statuses, key) !== status)
    throw new Error('the journal does not hold the new status afterwards');
  return statuses;
}

/** What one click or key press on a toggle does. Resolves when saving is over. */
export async function toggleStatus(
  root: CampaignElement,
  toggle: CampaignElement,
  journal: FoundryCampaignJournal,
  structure: CampaignStructure
): Promise<void> {
  const partId = toggle.getAttribute('data-campaign-toggle');
  if (!partId) return;
  if (!game.user?.isGM) {
    announce('gmOnlyProgress');
    return;
  }
  const before = statusesOf(journal);
  const next = nextStatus(readStatus(before, statusKey(structure.id, partId)));
  showToggle(toggle, labelOf(structure, partId), next);
  let saved: unknown;
  try {
    saved = await saveStatus(journal, structure, partId, next);
  } catch (error) {
    applyView(root, structure, before);
    announce('progressSaveFailed', { reason: reasonText(error) });
    return;
  }
  try {
    applyView(root, structure, saved);
  } catch (error) {
    announce('progressUpdateFailed', { reason: reasonText(error) });
  }
}

function reasonText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

/** Set up every dashboard block inside a rendered sheet. Returns how many were found. */
export function enhanceDashboards(
  element: CampaignElement,
  journal: FoundryCampaignJournal
): number {
  const structure = structureOf(journal);
  if (!structure) return 0;
  let count = 0;
  for (const root of findAll(element, ROOT)) {
    if (root.getAttribute('data-campaign-dashboard') !== structure.id) continue;
    count += 1;
    applyView(root, structure, statusesOf(journal));
    if (root.getAttribute(BOUND)) continue;
    root.setAttribute(BOUND, 'true');
    const handle = (event: CampaignEvent) => {
      if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
      const target = event.target as Partial<CampaignElement> | null;
      const toggle = typeof target?.closest === 'function' ? target.closest(TOGGLE) : null;
      if (!toggle) return;
      event.preventDefault();
      // The journal is looked up again: the sheet may show an older copy of it.
      const current =
        (game.journal.get(journal.id) as FoundryCampaignJournal | undefined) ?? journal;
      void toggleStatus(root, toggle, current, structureOf(current) ?? structure);
    };
    root.addEventListener('click', handle);
    root.addEventListener('keydown', handle);
  }
  return count;
}

/** The element of a render hook: an HTMLElement for ApplicationV2, a jQuery object for older sheets. */
function elementOf(html: unknown): CampaignElement | null {
  if (html && typeof (html as CampaignElement).querySelectorAll === 'function')
    return html as CampaignElement;
  const first = (html as { 0?: unknown } | null | undefined)?.[0];
  if (first && typeof (first as CampaignElement).querySelectorAll === 'function')
    return first as CampaignElement;
  return null;
}

export function onJournalSheetRender(app: unknown, html: unknown): void {
  const journal = journalOfSheet(app);
  const element = elementOf(html);
  if (!journal || !element) return;
  try {
    enhanceDashboards(element, journal);
  } catch (error) {
    console.error(`${MODULE_ID} | campaign dashboard could not be shown`, error);
  }
}

export function installDashboardHooks(): void {
  for (const name of JOURNAL_SHEET_HOOKS) Hooks.on(name, onJournalSheetRender);
}
