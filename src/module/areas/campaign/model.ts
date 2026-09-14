/**
 * The campaign dashboard as data: its structure, the status cycle, and the
 * figures the dashboard shows, computed from the saved status of each part.
 *
 * No Foundry and no DOM in here, so every rule is testable on its own.
 */

export const CAMPAIGN_STATUSES = ['not_started', 'in_progress', 'completed', 'skipped'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const PART_TYPES = ['main_part', 'sub_part', 'chapter', 'session', 'optional'] as const;
export type PartType = (typeof PART_TYPES)[number];

export const TEMPLATES = [
  'five-part-adventure',
  'dungeon-crawl',
  'investigation',
  'sandbox',
  'custom',
] as const;
export type CampaignTemplate = (typeof TEMPLATES)[number];

/** Flag scope and key of the saved status, as the previous module stored it. */
export const STATUS_FLAG_SCOPE = 'world';
export const STATUS_FLAG_KEY = 'campaignStatus';

/** Flag key under `flags["ninjos-foundry-mcp"]` for the structure of a dashboard. */
export const STRUCTURE_FLAG_KEY = 'campaign';

/** What every campaign, part and sub part has: a heading and a text. */
type Headed = { title: string; description: string };

/** The level range and kind of a part, shared by its specification and its stored form. */
type PartFrame = { type: PartType; levelStart: number; levelEnd: number };

export type SubPartSpec = Headed;

export type PartSpec = Headed & PartFrame & { subParts: SubPartSpec[] };

/** A stored sub part; `number` reads like "2.1". */
export type CampaignSubPart = Headed & { id: string; number: string };

export type CampaignPart = Headed &
  PartFrame & { id: string; number: number } & {
    subParts: CampaignSubPart[];
  };

type CampaignHead = Headed & {
  id: string;
  template: CampaignTemplate;
  questGiver: string | null;
  location: string | null;
};

export type CampaignStructure = CampaignHead & { version: 1; parts: CampaignPart[] };

export function buildStructure(
  input: CampaignHead & { parts: readonly PartSpec[] }
): CampaignStructure {
  const { id, title, description, template, questGiver, location } = input;
  const parts = input.parts.map((spec, index): CampaignPart => {
    const ordinal = index + 1;
    return {
      id: `part-${ordinal}`,
      number: ordinal,
      title: spec.title,
      description: spec.description,
      type: spec.type,
      levelStart: spec.levelStart,
      levelEnd: spec.levelEnd,
      subParts: spec.subParts.map((child, childIndex) => ({
        id: `part-${ordinal}-${childIndex + 1}`,
        number: `${ordinal}.${childIndex + 1}`,
        title: child.title,
        description: child.description,
      })),
    };
  });
  return { version: 1, id, title, description, template, questGiver, location, parts };
}

/** The key of one part in the saved status, `<campaignId>-<partId>`. */
export function statusKey(campaignId: string, partId: string): string {
  return `${campaignId}-${partId}`;
}

export function isStatus(value: unknown): value is CampaignStatus {
  return typeof value === 'string' && (CAMPAIGN_STATUSES as readonly string[]).includes(value);
}

/** The saved status of a part. Unknown or damaged values count as not started. */
export function readStatus(statuses: unknown, key: string): CampaignStatus {
  if (typeof statuses !== 'object' || statuses === null) return 'not_started';
  const value = (statuses as Record<string, unknown>)[key];
  return isStatus(value) ? value : 'not_started';
}

/** Not started, in progress, completed, skipped, and round again. */
export function nextStatus(status: CampaignStatus): CampaignStatus {
  const index = CAMPAIGN_STATUSES.indexOf(status);
  return CAMPAIGN_STATUSES[(index + 1) % CAMPAIGN_STATUSES.length] as CampaignStatus;
}

export function isDone(status: CampaignStatus): boolean {
  return status === 'completed' || status === 'skipped';
}

type Labelled = { id: string; label: string };

/** A part as the dashboard on the page describes it: ids and the labels shown. */
export type ViewPartInput = Labelled & { subParts: Labelled[] };

type ViewPart = {
  id: string;
  status: CampaignStatus;
  done: boolean;
  locked: boolean;
  /** Label of the part that has to be done first, while locked. */
  requires: string | null;
  subParts: Array<{ id: string; status: CampaignStatus }>;
};

export interface DashboardView {
  parts: ViewPart[];
  /** Done units: sub parts where a part has them, the part otherwise. */
  done: number;
  total: number;
  percent: number;
  current: { kind: 'ready' | 'active' | 'finished'; label: string | null };
}

/**
 * The figures of the dashboard from the saved status.
 *
 * - A part is done when its own status is completed or skipped, or when it has
 *   sub parts and every one of them is.
 * - A part is locked while the part before it is not done.
 * - Progress counts sub parts where a part has them, otherwise the part.
 * - The current part is the first part not done, and within it the first sub
 *   part not done. Nothing started yet: ready to begin. Everything done: finished.
 */
export function computeView(
  owner: string,
  parts: readonly ViewPartInput[],
  statuses: unknown
): DashboardView {
  const tally = { done: 0, total: 0 };
  const statusOf = (id: string) => readStatus(statuses, statusKey(owner, id));
  const rows: ViewPart[] = [];

  parts.forEach((part, index) => {
    const own = statusOf(part.id);
    const children = part.subParts.map(sub => ({ id: sub.id, status: statusOf(sub.id) }));
    const childrenDone = children.filter(sub => isDone(sub.status)).length;
    const finished = isDone(own) || (children.length > 0 && childrenDone === children.length);
    if (children.length === 0) {
      tally.total += 1;
      tally.done += finished ? 1 : 0;
    } else {
      tally.total += children.length;
      tally.done += finished ? children.length : childrenDone;
    }
    const before = rows[index - 1];
    const locked = before !== undefined && !before.done;
    rows.push({
      id: part.id,
      status: own,
      done: finished,
      locked,
      requires: locked ? (parts[index - 1]?.label ?? null) : null,
      subParts: children,
    });
  });

  const started = rows.some(
    row => row.status !== 'not_started' || row.subParts.some(sub => sub.status !== 'not_started')
  );
  const firstOpen = rows.findIndex(row => !row.done);
  let current: DashboardView['current'] = { kind: 'ready', label: null };
  if (rows.length > 0 && firstOpen === -1) current = { kind: 'finished', label: null };
  else if (started) {
    const part = parts[firstOpen] as ViewPartInput;
    const row = rows[firstOpen] as ViewPart;
    const openChild = part.subParts[row.subParts.findIndex(sub => !isDone(sub.status))];
    current = {
      kind: 'active',
      label: openChild ? `${part.label}, ${openChild.label}` : part.label,
    };
  }

  const { done, total } = tally;
  return {
    parts: rows,
    done,
    total,
    percent: total ? Math.round((done * 100) / total) : 0,
    current,
  };
}
