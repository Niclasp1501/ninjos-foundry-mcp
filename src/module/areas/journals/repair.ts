/**
 * Repairing imported content: external image addresses to local paths, and
 * leftover 5etools tags to Foundry links.
 */
import type { QueryHandler } from '../../dispatcher.js';
import { QueryError } from '../../dispatcher.js';
import { requireWorld } from '../../world-ready.js';
import {
  argsOf,
  getJournal,
  getPage,
  isTextPage,
  notFound,
  optionalBoolean,
  optionalText,
  optionalTextList,
  orderedPages,
  packsOf,
  pageHtml,
  requiredText,
  requireTextPage,
  smallEnough,
} from './common.js';
import { checkStored } from './write.js';

const EXAMPLE_LIMIT = 5;

/** The text pages a repair works on: the one named, or all of them. */
function targetPages(journal: FoundryJournalsEntry, pageId: string | undefined, what: string) {
  if (pageId !== undefined) {
    const page = getPage(journal, pageId);
    requireTextPage(page, what);
    return [page];
  }
  const pages = orderedPages(journal).filter(isTextPage);
  if (!pages.length)
    notFound(`Journal "${journal.name}" (${journal.id}) has no text page to work on`);
  return pages;
}

interface PagePlan {
  page: FoundryJournalsPage;
  before: string;
  after: string;
  count: number;
}

/** Write the planned pages in one update, then read every one of them back. */
async function applyPlans(journal: FoundryJournalsEntry, plans: PagePlan[]): Promise<void> {
  if (!plans.length) return;
  await journal.updateEmbeddedDocuments(
    'JournalEntryPage',
    plans.map(plan => ({ _id: plan.page.id, 'text.content': plan.after }))
  );
  const fresh = getJournal(journal.id);
  for (const plan of plans) {
    checkStored(`Page "${plan.page.name}"`, plan.after, pageHtml(getPage(fresh, plan.page.id)));
  }
}

export interface ImageRewrite {
  html: string;
  count: number;
  examples: string[];
  skipped: string[];
}

/** Replace the src of every img whose address starts with the pattern, ignoring case. */
export function rewriteImages(html: string, urlPattern: string, localPrefix: string): ImageRewrite {
  const pattern = urlPattern.toLowerCase();
  const prefix = localPrefix.replace(/\/+$/, '');
  let count = 0;
  const examples: string[] = [];
  const skipped: string[] = [];
  const out = html.replace(/<img\b[^>]*>/gi, tag =>
    tag.replace(
      /(\ssrc\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i,
      (attribute, lead: string, double?: string, single?: string, bare?: string) => {
        const src = double ?? single ?? bare ?? '';
        if (!src.toLowerCase().startsWith(pattern)) return attribute;
        const fileName = src.split(/[?#]/)[0]?.split('/').at(-1) ?? '';
        if (!fileName) {
          skipped.push(src);
          return attribute;
        }
        const next = `${prefix}/${fileName}`;
        count += 1;
        examples.push(`${src} -> ${next}`);
        const quote = double !== undefined ? '"' : single !== undefined ? "'" : '';
        return `${lead}${quote}${next}${quote}`;
      }
    )
  );
  return { html: out, count, examples, skipped };
}

export const rewriteJournalImages: QueryHandler = {
  access: { kind: 'write', document: 'Journals', action: 'update' },
  run: async (data, context) => {
    requireWorld();
    const args = argsOf(data);
    const journal = getJournal(requiredText(args, 'journalId'));
    const urlPattern = requiredText(args, 'urlPattern');
    const localPrefix = requiredText(args, 'localPrefix');
    const dryRun = optionalBoolean(args, 'dryRun') ?? false;
    const pages = targetPages(journal, optionalText(args, 'pageId'), 'journal-rewrite-images');

    const plans: PagePlan[] = [];
    const examples: string[] = [];
    const skipped: Array<{ pageId: string; src: string; reason: string }> = [];
    for (const page of pages) {
      const before = pageHtml(page);
      const result = rewriteImages(before, urlPattern, localPrefix);
      examples.push(...result.examples);
      for (const src of result.skipped) {
        skipped.push({ pageId: page.id, src, reason: 'the address has no file name' });
      }
      if (result.count) plans.push({ page, before, after: result.html, count: result.count });
    }

    if (!dryRun) {
      await applyPlans(journal, plans);
      if (plans.length) {
        context.recordChange({
          query: 'rewriteJournalImages',
          tool: 'journal-rewrite-images',
          document: 'Journals',
          action: 'update',
          targets: plans.map(plan => ({
            id: plan.page.id,
            uuid: plan.page.uuid,
            name: plan.page.name,
          })),
          summary: `Rewrote image addresses starting with ${urlPattern} in "${journal.name}".`,
          before: smallEnough(
            plans.map(plan => ({ _id: plan.page.id, 'text.content': plan.before }))
          ),
        });
      }
    }

    const shown = examples.slice(0, EXAMPLE_LIMIT);
    return {
      success: true,
      journalId: journal.id,
      dryRun,
      pagesChecked: pages.length,
      pagesChanged: plans.map(plan => ({
        id: plan.page.id,
        name: plan.page.name,
        replacements: plan.count,
      })),
      replacements: plans.reduce((sum, plan) => sum + plan.count, 0),
      examples: shown,
      skipped,
      samples: shown,
    };
  },
};

interface PackLookup {
  pack: FoundryJournalsPack;
  byName: Map<string, FoundryJournalsIndexEntry>;
  ids: Set<string>;
}

/** Load the named packs in order. An unknown pack or one of another document type is an error. */
export async function loadPacks(
  ids: readonly string[],
  documentName: string
): Promise<PackLookup[]> {
  const packs = ids.length ? packsOf() : null;
  const lookups: PackLookup[] = [];
  for (const id of ids) {
    const pack = packs?.get(id);
    if (!pack) notFound(`Compendium pack not found: ${id}`);
    if (pack.documentName !== documentName) {
      throw new QueryError(
        'INVALID_ARGUMENT',
        `Compendium pack ${id} holds ${pack.documentName} documents, not ${documentName}`
      );
    }
    const byName = new Map<string, FoundryJournalsIndexEntry>();
    const ids = new Set<string>();
    for (const entry of await pack.getIndex({ fields: ['name'] })) {
      ids.add(entry._id);
      const key = (entry.name ?? '').toLowerCase();
      if (key && !byName.has(key)) byName.set(key, entry);
    }
    lookups.push({ pack, byName, ids });
  }
  return lookups;
}

/**
 * The id the official 2024 books give a creature: "mm" and the English name
 * with only letters, digits and spaces kept, every word starting upper case
 * and going on lower case, cut or padded at the end with "0" to Foundry's 16
 * characters.
 */
export function officialCreatureId(name: string): string {
  const words = name
    .replace(/[^A-Za-z0-9 ]+/g, '')
    .split(/ +/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
  return `mm${words.join('')}`.slice(0, 16).padEnd(16, '0');
}

export function compendiumLink(pack: FoundryJournalsPack, id: string, label: string): string {
  return `@UUID[Compendium.${pack.collection}.${pack.documentName}.${id}]{${label}}`;
}

export const linkJournalTags: QueryHandler = {
  access: { kind: 'write', document: 'Journals', action: 'update' },
  run: async (data, context) => {
    requireWorld();
    const args = argsOf(data);
    const journal = getJournal(requiredText(args, 'journalId'));
    const dryRun = optionalBoolean(args, 'dryRun') ?? false;
    const pages = targetPages(journal, optionalText(args, 'pageId'), 'journal-link-tags');
    const actorPacks = await loadPacks(optionalTextList(args, 'actorPacks') ?? [], 'Actor');
    const itemPacks = await loadPacks(optionalTextList(args, 'itemPacks') ?? [], 'Item');

    const resolve = (
      kind: string,
      name: string
    ): { pack: FoundryJournalsPack; entry: FoundryJournalsIndexEntry } | null => {
      const lookups = kind === 'creature' ? actorPacks : itemPacks;
      const key = name.toLowerCase();
      for (const lookup of lookups) {
        const entry = lookup.byName.get(key);
        if (entry) return { pack: lookup.pack, entry };
      }
      if (kind === 'creature') {
        const id = officialCreatureId(name);
        for (const lookup of lookups) {
          if (!lookup.ids.has(id)) continue;
          const entry = [...lookup.byName.values()].find(candidate => candidate._id === id) ?? {
            _id: id,
          };
          return { pack: lookup.pack, entry };
        }
      }
      return null;
    };

    const plans: PagePlan[] = [];
    const examples: string[] = [];
    const unresolved = new Set<string>();
    for (const page of pages) {
      const before = pageHtml(page);
      let count = 0;
      const after = before.replace(
        /@(creature|item)\[([^\]]*)\]/gi,
        (tag, rawKind: string, inner: string) => {
          const kind = rawKind.toLowerCase();
          const parts = inner.split('|');
          const name = (parts[0] ?? '').trim();
          const label = parts[2]?.trim();
          const hit = name ? resolve(kind, name) : null;
          if (!hit) {
            unresolved.add(`${kind}: ${name || '(empty name)'}`);
            return tag;
          }
          count += 1;
          const link = compendiumLink(hit.pack, hit.entry._id, label || hit.entry.name || name);
          examples.push(`${tag} -> ${link}`);
          return link;
        }
      );
      if (count) plans.push({ page, before, after, count });
    }

    if (!dryRun) {
      await applyPlans(journal, plans);
      if (plans.length) {
        context.recordChange({
          query: 'linkJournalTags',
          tool: 'journal-link-tags',
          document: 'Journals',
          action: 'update',
          targets: plans.map(plan => ({
            id: plan.page.id,
            uuid: plan.page.uuid,
            name: plan.page.name,
          })),
          summary: `Turned 5etools tags into compendium links in "${journal.name}".`,
          before: smallEnough(
            plans.map(plan => ({ _id: plan.page.id, 'text.content': plan.before }))
          ),
        });
      }
    }

    const links = plans.reduce((sum, plan) => sum + plan.count, 0);
    const shown = examples.slice(0, EXAMPLE_LIMIT);
    return {
      success: true,
      journalId: journal.id,
      dryRun,
      pagesChecked: pages.length,
      pagesChanged: plans.map(plan => ({
        id: plan.page.id,
        name: plan.page.name,
        links: plan.count,
      })),
      links,
      unresolved: [...unresolved].sort(),
      examples: shown,
      linked: links,
      samples: shown,
    };
  },
};
