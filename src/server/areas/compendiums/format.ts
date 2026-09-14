/**
 * The texts the model reads for the compendium tools.
 *
 * Two rules from the behaviour description decide the shape:
 * - **What continues or went wrong stands in the text**, not only in a field.
 *   Models overlook fields: a first page was once taken for the whole
 *   archive, and a half failed deletion counted as done.
 * - **A lost entry is never listed as skipped.** It stands apart, marked CAUTION.
 *
 * Every reader accepts both generations of the module. The previous one
 * answers with other field names (`compendiums` instead of `packs`,
 * `documentType`, counts where this generation has lists, names where it has
 * entries, `pack` as text); those answers are formatted into the same texts.
 * Only an answer of a truly unknown shape is passed on unchanged as JSON.
 */
import { LISTED_IN_TEXT, SEARCH_LIMIT } from '../../../common/areas/compendiums/shapes.js';

type Rec = Record<string, unknown>;
/** The tool arguments, for what an answer of the previous generation does not repeat. */
type Args = Record<string, unknown>;

export function isRecord(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const rec = (value: unknown): Rec => (isRecord(value) ? value : {});
const str = (value: unknown): string =>
  typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
const num = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const list = (value: unknown): Rec[] => (Array.isArray(value) ? value.filter(isRecord) : []);
const texts = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
/** Entries of a list holding records or, from the previous generation, plain names. */
const refs = (value: unknown): Rec[] =>
  Array.isArray(value)
    ? value.flatMap(item =>
        isRecord(item) ? [item] : typeof item === 'string' ? [{ name: item }] : []
      )
    : [];

/** The compendium an answer is about: its own fields first, then the arguments. */
function packIdOf(data: Rec, args: Args): string {
  return (
    str(data['packId']) ||
    (typeof data['pack'] === 'string' ? data['pack'] : '') ||
    str(args['packId'])
  );
}

/** Names with ids, at most LISTED_IN_TEXT of them, then "... and n more". */
export function listed(
  entries: readonly Rec[],
  extra: (entry: Rec) => string = () => ''
): string[] {
  const lines = entries.slice(0, LISTED_IN_TEXT).map(entry => {
    const id = str(entry['id']);
    return `- ${str(entry['name']) || '(no name)'}${id ? ` [${id}]` : ''}${extra(entry)}`;
  });
  if (entries.length > LISTED_IN_TEXT)
    lines.push(`... and ${entries.length - LISTED_IN_TEXT} more`);
  return lines;
}

/** The sentence about the lock, or nothing when it was not touched. */
export function lockLines(raw: unknown, packId: string): string[] {
  const lock = rec(raw);
  if (lock['lifted'] !== true) return [];
  if (lock['restored'] === true)
    return ['The lock was lifted for this operation and set again afterwards.'];
  return [
    `CAUTION: the lock of "${packId}" was lifted for this operation and could NOT be set again` +
      `${lock['problem'] ? ` (${str(lock['problem'])})` : ''}. The compendium is unlocked now; lock it again with set-compendium-lock.`,
  ];
}

function origin(pack: Rec): string {
  const type = str(pack['packageType']);
  if (type === 'world') return 'world';
  return `${type} ${str(pack['packageName'])}`.trim();
}

function packLine(pack: Rec, suffix = ''): string {
  const from = origin(pack);
  return `- ${str(pack['label'])} [${str(pack['id'])}] ${str(pack['type'])}, ${num(pack['count'])} entries${from ? ` (${from})` : ''}${suffix}`;
}

export function formatCompendiumList(raw: unknown): unknown {
  const data = rec(raw);
  const source = Array.isArray(data['packs'])
    ? data['packs']
    : Array.isArray(data['compendiums'])
      ? data['compendiums']
      : null;
  if (!source) return raw;
  const packs: Rec[] = list(source).map(pack => ({
    ...pack,
    count: isCount(pack['count']) ? pack['count'] : num(pack['entries']),
  }));
  if (!packs.length) return 'No compendiums present.';

  const locked = packs.filter(pack => pack['locked'] === true);
  const unlocked = packs.filter(pack => pack['locked'] !== true);
  if (!isRecord(data['writeAccess'])) {
    // The previous generation: `writable` only means "not locked", and the
    // module knows nothing of the other layers, so the two old blocks stay.
    const editable = packs.filter(pack =>
      typeof pack['writable'] === 'boolean' ? pack['writable'] : pack['locked'] !== true
    );
    const rest = packs.filter(pack => !editable.includes(pack));
    return [
      `Unlocked, so editable (${editable.length}):`,
      ...editable.map(pack => packLine(pack)),
      `Locked (${rest.length}), unlock before editing:`,
      ...rest.map(pack => packLine(pack)),
    ].join('\n');
  }

  const access = rec(data['writeAccess']);
  const lines = [`${packs.length} compendiums.`];
  const releaseList = texts(access['releaseList']);
  let nothing: string | null = null;
  if (access['writeOperationsEnabled'] === false)
    nothing = '"Allow Write Operations" is off in the module settings';
  else if (access['level'] === 'read')
    nothing = 'the permission level for compendiums is "read only" (setting "permCompendiums")';

  if (access['releaseListProblem']) {
    lines.push(
      `The release list could not be read (${str(access['releaseListProblem'])}), so no compendium counts as released.`
    );
  } else if (releaseList.length) {
    lines.push(
      `The release list is filled (${releaseList.join(', ')}): only compendiums on it can be written, and their lock does not hold the AI back.`
    );
  } else {
    lines.push('The release list is empty: every unlocked compendium can be written.');
  }

  if (nothing) {
    lines.push(`Nothing is editable right now: ${nothing}.`);
    lines.push(`Unlocked (${unlocked.length}):`, ...unlocked.map(pack => packLine(pack)));
    lines.push(`Locked (${locked.length}):`, ...locked.map(pack => packLine(pack)));
    return lines.join('\n');
  }

  const editable = packs.filter(pack => pack['writable'] === true);
  const lockedOnly = packs.filter(
    pack => pack['writable'] !== true && pack['notWritableReason'] === 'locked'
  );
  const held = packs.filter(
    pack => pack['writable'] !== true && pack['notWritableReason'] !== 'locked'
  );
  lines.push(
    `Editable (${editable.length}):`,
    ...editable.map(pack =>
      packLine(pack, pack['locked'] === true ? ', locked but released through the list' : '')
    )
  );
  lines.push(
    `Locked (${lockedOnly.length}), unlock before editing (set-compendium-lock, or unlockIfNeeded for one operation):`,
    ...lockedOnly.map(pack => packLine(pack))
  );
  if (held.length)
    lines.push(
      `Not writable (${held.length}):`,
      ...held.map(pack => packLine(pack, `: ${str(pack['notWritableReason'])}`))
    );
  return lines.join('\n');
}

/**
 * list-compendium-packs. Modules of both generations answer with a bare list
 * of every pack; the type filter and the available types are made here, so
 * `availableTypes` names every type also when a filter is set.
 */
export function formatPacks(raw: unknown, args: Args = {}): unknown {
  const all = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw['packs'])
      ? raw['packs']
      : null;
  if (!all) return raw;
  const packs = list(all);
  const type = typeof args['type'] === 'string' ? args['type'].trim() : '';
  const chosen = type
    ? packs.filter(pack => str(pack['type']).toLowerCase() === type.toLowerCase())
    : packs;
  return {
    packs: chosen,
    total: chosen.length,
    filter: type || null,
    availableTypes: [...new Set(packs.map(pack => str(pack['type'])).filter(Boolean))].sort(),
  };
}

export function formatEntries(raw: unknown, args: Args = {}): unknown {
  const data = rec(raw);
  if (!Array.isArray(data['entries'])) return raw;
  const entries = list(data['entries']);
  const type = str(data['type']) || str(data['documentType']);
  const total = num(data['total']);
  const offset = num(data['offset']);
  const packageType = str(data['packageType']);
  const namePattern = str(data['namePattern'] ?? args['namePattern']);
  const folderName = str(data['folderName'] ?? args['folderName']);
  const filters = [
    namePattern ? `name containing "${namePattern}"` : '',
    folderName ? `in the folder "${folderName}"` : '',
  ].filter(Boolean);

  // A module of the previous generation does not say how many entries the
  // whole pack holds, only how many match.
  const count = isCount(data['totalInPack'])
    ? `${data['totalInPack']} entries${filters.length ? `, ${total} of them ${filters.join(' and ')}` : ''}`
    : `${total} entries${filters.length ? ` ${filters.join(' and ')}` : ''}`;
  const lines = [
    `${str(data['label'])} [${packIdOf(data, args)}] (${type}${packageType ? `, ${packageType}` : ''}${data['locked'] === true ? ', locked' : ''}): ${count}.`,
  ];
  if (data['folderFound'] === false) {
    const folders = texts(data['folders']);
    lines.push(
      `There is no folder "${folderName}" in this compendium. Folders: ${folders.join(', ') || '(none)'}.`
    );
  }
  if (!entries.length) {
    if (total > 0) lines.push(`No entries at offset ${offset}; there are ${total}.`);
    return lines.join('\n');
  }
  lines.push(`Showing ${offset + 1} to ${offset + entries.length}:`);
  for (const entry of entries) {
    const entryType = str(entry['type']);
    lines.push(
      `- ${str(entry['name']) || '(no name)'} [${str(entry['id'])}]${entryType && entryType !== type ? ` (${entryType})` : ''}` +
        `${entry['folder'] ? ` in "${str(entry['folder'])}"` : ''}`
    );
  }
  if (data['hasMore'] === true) {
    const next = isCount(data['nextOffset']) ? data['nextOffset'] : offset + entries.length;
    lines.push(
      `MORE ENTRIES FOLLOW: ${Math.max(total - offset - entries.length, 0)} are not shown. Call list-compendium-entries again with offset ${next} before drawing conclusions about the whole compendium.`
    );
  }
  return lines.join('\n');
}

/**
 * search-compendium. This generation answers with a report; the previous one
 * with a bare list it does not cut to the limit, so it is cut here.
 */
export function formatSearch(raw: unknown, args: Args = {}): unknown {
  if (!Array.isArray(raw)) return withWarnings(raw);
  const wanted =
    typeof args['limit'] === 'number' ? Math.trunc(args['limit']) : SEARCH_LIMIT.fallback;
  const limit = Math.min(Math.max(wanted, 1), SEARCH_LIMIT.max);
  const results = raw.slice(0, limit);
  return withWarnings({
    query: args['query'] ?? null,
    results,
    totalFound: raw.length,
    showing: results.length,
    hasMore: raw.length > results.length,
    notes: [
      'The Foundry module answered in the form of the previous generation: totalFound counts only the matches it returned, and filters it did not apply are not reported.',
    ],
  });
}

/**
 * list-creatures-by-criteria. Both generations wrap the answer under
 * `response`; a bare list is taken as the creatures themselves.
 */
export function formatCreatures(raw: unknown): unknown {
  const inner = isRecord(raw) && 'response' in raw ? raw['response'] : raw;
  if (Array.isArray(inner))
    return withWarnings({
      creatures: inner,
      totalFound: inner.length,
      showing: inner.length,
    });
  return withWarnings(inner);
}

/**
 * The answer of getCompendiumDocumentFull, which a module of the previous
 * generation offers instead of getCompendiumItem, in the shape
 * get-compendium-item gives: full, or compact with key facts only.
 */
export function formatDocumentFull(raw: unknown, compact: boolean): unknown {
  if (!isRecord(raw) || typeof raw['type'] !== 'string') return raw;
  const items = list(raw['items']);
  const effects = list(raw['effects']);
  const pack = isRecord(raw['pack'])
    ? raw['pack']
    : { id: str(raw['pack']), label: str(raw['packLabel']) };
  if (!compact) return { ...raw, pack, mode: 'full' };
  return {
    id: raw['id'] ?? null,
    name: raw['name'] ?? null,
    type: raw['type'],
    pack,
    img: raw['img'] ?? null,
    mode: 'compact',
    items: items.slice(0, 5).map(item => ({
      id: str(item['id'] ?? item['_id']),
      name: str(item['name']),
      type: str(item['type']),
    })),
    itemCount: items.length,
    effectCount: effects.length,
  };
}

export function formatCreate(raw: unknown): unknown {
  const data = rec(raw);
  if (typeof data['id'] !== 'string') return raw;
  const lines = [
    `Compendium "${str(data['label'])}" created (${str(data['type'])}).`,
    `Id: ${data['id']}`,
  ];
  if (data['releaseListFilled'] === true && data['onReleaseList'] !== true)
    lines.push(
      'Note: the release list is filled and does not name it, so it cannot be written to until a Gamemaster adds it under "Release compendiums".'
    );
  return lines.join('\n');
}

const EXPORT_LISTS = ['exported', 'replaced', 'skipped', 'lost'] as const;

export function formatExport(raw: unknown, args: Args = {}): unknown {
  const data = rec(raw);
  // This generation: entries with ids and reasons under *Entries. The previous
  // one: the four lists under their plain names, of names or of entries.
  const detailed = Array.isArray(data['exportedEntries']);
  if (!detailed && !EXPORT_LISTS.some(name => Array.isArray(data[name]))) return raw;
  const pick = (name: (typeof EXPORT_LISTS)[number]) =>
    refs(detailed ? data[`${name}Entries`] : data[name]);
  const exported = pick('exported');
  const replaced = pick('replaced');
  const skipped = pick('skipped');
  const lost = pick('lost');
  const packId = packIdOf(data, args);
  const label = str(data['label']);
  const documentType = str(data['documentType']) || str(args['documentType']);
  const saved = exported.length + replaced.length;

  const lines = [
    `Saved into ${label ? `"${label}" [${packId}]` : `"${packId}"`}: ${saved}` +
      `${isCount(data['selected']) ? ` of ${data['selected']}` : ''} ${documentType ? `${documentType} ` : ''}documents.`,
  ];
  if (lost.length) {
    lines.push(
      `CAUTION: ${lost.length} entries are LOST from the compendium: the old version was removed and the new one could not be written. ` +
        'Check with list-compendium-entries and save them again one by one:',
      ...listed(lost, entry => (entry['reason'] ? `: ${str(entry['reason'])}` : ''))
    );
  }
  if (exported.length) lines.push(`Newly created (${exported.length}):`, ...listed(exported));
  if (replaced.length)
    lines.push(
      `Overwrote the existing version (${replaced.length}):`,
      ...listed(replaced, entry =>
        entry['rewrittenBecause']
          ? ` (removed and written again, because overwriting failed: ${str(entry['rewrittenBecause'])})`
          : ''
      )
    );
  if (skipped.length)
    lines.push(
      `Skipped (${skipped.length}):`,
      ...listed(skipped, entry => (entry['reason'] ? `: ${str(entry['reason'])}` : ''))
    );
  const notFound = texts(data['notFound']);
  if (notFound.length)
    lines.push(
      `Not found in the world, so not saved: ${notFound.map(name => `"${name}"`).join(', ')}`
    );
  for (const note of texts(data['notes'])) lines.push(`Note: ${note}.`);
  lines.push(...lockLines(data['lock'], packId));
  return lines.join('\n');
}

export function formatImport(raw: unknown): unknown {
  const data = rec(raw);
  if (typeof data['id'] !== 'string') return raw;
  const pack = data['pack'];
  const from = isRecord(pack)
    ? str(pack['label']) || str(pack['id'])
    : str(data['packLabel']) || str(pack);
  const lines = [
    `${str(data['type'])} "${str(data['name'])}" imported from ${from}.`,
    `New id: ${data['id']}`,
  ];
  const folders = texts(data['createdFolders']);
  if (folders.length) lines.push(`Created folders: ${folders.join(' / ')}`);
  if (data['folderId']) lines.push(`Folder id: ${str(data['folderId'])}`);
  return lines.join('\n');
}

function missesLines(data: Rec): string[] {
  const lines: string[] = [];
  const grouped = rec(data['notFound']);
  const ids = Array.isArray(data['notFoundIds'])
    ? texts(data['notFoundIds'])
    : texts(grouped['ids']);
  const names = Array.isArray(data['notFoundNames'])
    ? texts(data['notFoundNames'])
    : texts(grouped['names']);
  // One list of ids and names together, when nothing tells them apart.
  const mixed =
    !Array.isArray(data['notFoundIds']) && !Array.isArray(data['notFoundNames'])
      ? texts(data['notFound'])
      : [];
  if (ids.length) lines.push(`NOT FOUND, ids (${ids.length}): ${ids.join(', ')}`);
  if (names.length)
    lines.push(`NOT FOUND, names (${names.length}): ${names.map(name => `"${name}"`).join(', ')}`);
  if (mixed.length)
    lines.push(`NOT FOUND (${mixed.length}): ${mixed.map(name => `"${name}"`).join(', ')}`);
  for (const hint of list(data['spellingHints']))
    lines.push(
      `  "${str(hint['name'])}" exists only in another spelling: ${texts(hint['candidates'])
        .map(name => `"${name}"`)
        .join(', ')}`
    );
  const ambiguous = list(data['ambiguous']);
  if (ambiguous.length) {
    lines.push(`AMBIGUOUS, left untouched (${ambiguous.length}); pass one of the ids instead:`);
    for (const item of ambiguous)
      lines.push(`- "${str(item['name'])}": ${texts(item['ids']).join(', ')}`);
  }
  return lines;
}

export function formatOrganize(raw: unknown, args: Args = {}): unknown {
  const data = rec(raw);
  const detailed = Array.isArray(data['movedEntries']);
  if (!detailed && !Array.isArray(data['moved'])) return raw;
  const moved = refs(detailed ? data['movedEntries'] : data['moved']);
  const folder = data['folder'];
  const folderName = isRecord(folder) ? str(folder['name']) : str(folder);
  const created = data['folderCreated'] === true || rec(folder)['created'] === true;
  const packId = packIdOf(data, args);
  const lines = [
    `Moved in "${str(data['label']) || packId}" to "${folderName}"${created ? ' (folder created)' : ''}: ${moved.length} entries`,
    ...listed(moved),
  ];
  const already = list(data['alreadyInFolder']);
  if (already.length) lines.push(`Already in that folder (${already.length}):`, ...listed(already));
  const notMoved = list(data['notMoved']);
  if (notMoved.length)
    lines.push(
      `NOT MOVED although Foundry reported no error (${notMoved.length}):`,
      ...listed(notMoved)
    );
  lines.push(...missesLines(data), ...lockLines(data['lock'], packId));
  return lines.join('\n');
}

export function formatLock(raw: unknown, args: Args = {}): unknown {
  const data = rec(raw);
  if (typeof data['locked'] !== 'boolean') return raw;
  const state = data['locked'] ? 'locked' : 'unlocked';
  const name = str(data['label']) || packIdOf(data, args);
  return data['changed'] === false
    ? `"${name}" was already ${state}; nothing changed.`
    : `"${name}" is now ${state}.`;
}

export function formatDeleteEntries(raw: unknown, args: Args = {}): unknown {
  const data = rec(raw);
  const packId = packIdOf(data, args);
  const label = str(data['label']) || packId;
  const entries = refs(data['entries']);

  // `wouldDelete` and `deleted` are counts with the entries under `entries`;
  // a list in their place is read as the entries themselves.
  const wouldDelete = data['wouldDelete'];
  if (data['dryRun'] === true && (isCount(wouldDelete) || Array.isArray(wouldDelete))) {
    const would = Array.isArray(wouldDelete) ? refs(wouldDelete) : entries;
    const count = isCount(wouldDelete) ? wouldDelete : would.length;
    const lines = [
      `Dry run for "${label}" [${packId}]: ${count} of ${num(data['totalInPack'])} entries would be removed. Nothing was changed.`,
      ...listed(would),
      ...missesLines(data),
    ];
    if (data['requiresConfirmLabel'] === true)
      lines.push(
        `The selection covers EVERY entry. The real call needs confirmLabel "${label}"${data['confirmLabelMissing'] === true ? ', which was not given' : ''}.`
      );
    return lines.join('\n');
  }

  const deletedField = data['deleted'];
  if (!isCount(deletedField) && !Array.isArray(deletedField)) return raw;
  const deleted = Array.isArray(deletedField) ? refs(deletedField) : entries;
  const count = isCount(deletedField) ? deletedField : deleted.length;
  const lines = [
    `Removed from "${label}" [${packId}]: ${count} entries. ${num(data['totalInPack'])} remain.`,
    ...listed(deleted),
  ];
  const notDeleted = list(data['notDeleted']);
  if (notDeleted.length)
    lines.push(
      `NOT REMOVED (${notDeleted.length})${data['failure'] ? `, because ${str(data['failure'])}` : ''}:`,
      ...listed(notDeleted)
    );
  lines.push(...missesLines(data), ...lockLines(data['lock'], packId));
  return lines.join('\n');
}

export function formatDeleteCompendium(raw: unknown): unknown {
  const data = rec(raw);
  if (typeof data['label'] !== 'string') return raw;
  return `Compendium "${data['label']}" deleted, with ${num(data['entries'])} entries.`;
}

/**
 * Answers that stay JSON (search, creature list, item, packs) get what went
 * wrong or was ignored in front, so it is the first thing the model reads.
 */
export function withWarnings(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const warnings: string[] = [];
  for (const filter of list(raw['ignoredFilters']))
    warnings.push(`Filter "${str(filter['name'])}" was IGNORED: ${str(filter['reason'])}`);
  if (raw['fallback'] === true && raw['fallbackReason']) warnings.push(str(raw['fallbackReason']));
  for (const note of texts(raw['notes'])) warnings.push(note);
  const index = rec(raw['index']);
  if (index['problem']) warnings.push(str(index['problem']));
  if (num(index['failed']) > 0)
    warnings.push(
      `${num(index['failed'])} creatures could not be read completely and carry only their names.`
    );
  if (raw['hasMore'] === true)
    warnings.push(
      `Only ${num(raw['showing'])} of ${num(raw['totalFound'])} matches are shown; narrow the search or raise limit.`
    );
  return warnings.length ? { warnings, ...raw } : raw;
}
