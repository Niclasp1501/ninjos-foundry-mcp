/**
 * Game system adapters: the questions the core asks about the active system.
 *
 * Most tools know nothing about game systems. Some need to know what a
 * creature is, where hit points live, what a spell looks like, how a roll is
 * built. That knowledge lives in one adapter per system, registered by the
 * area that owns it (dnd5e, pf2e, dsa5, wfrp4e-cosmere-traveller). The core
 * itself holds no system id and no field path of any system.
 *
 * A system neutral package (actors, tokens-dice, compendiums) asks the
 * registry and gets one of two things:
 *
 * - `answer(system, area)`: the adapter's answers, completed by the generic
 *   fallbacks below. `fallbackFor` names every question a fallback answered,
 *   so a result can say so instead of pretending to know the system.
 * - `require(system, area, what)`: the adapter's answers only, or the error
 *   "<what> is not supported for the game system x".
 *
 * Adapters take plain data (`document.toObject()`, index rows), never Foundry
 * objects, so the same adapter runs in the module and on the server, and its
 * tests need no Foundry. Everything here is free of Foundry and of Node.
 */

/** A document as plain data, e.g. `actor.toObject()` or a compendium index row. */
export type AdapterDocument = Readonly<Record<string, unknown>>;

/**
 * Set to true on a document whose `system` holds the values Foundry prepared
 * (armor class, maxima, modifiers) over the stored ones. The module sets it
 * (`src/module/prepared-data.ts`); plain `toObject()` data and index rows never
 * carry it. An adapter that otherwise computes derived values reads them from
 * the data first when it is set.
 */
export const PREPARED_DATA_KEY = 'preparedData';

export function isPreparedData(document: AdapterDocument | null | undefined): boolean {
  return document?.[PREPARED_DATA_KEY] === true;
}

export interface NumberRange {
  min: number;
  max: number;
}

// 2.1 Who are you? -----------------------------------------------------------

/** Derived from what the adapter implements, so they cannot claim what it does not do. */
export interface AdapterCapabilities {
  creatureIndex: boolean;
  characterStats: boolean;
  spells: boolean;
  powerMeasure: boolean;
}

// 2.2 to 2.6 Creatures --------------------------------------------------------

/**
 * How a filter compares. The comparison itself is generic; an adapter only
 * declares which filters exist.
 * - `numberOrRange`: a number, a number in a text, `{min, max}` or that as JSON
 *   text; a single value compares exactly, missing bounds come from `defaults`
 * - `text`: the same text ignoring case
 * - `partialText`: contains the text, ignoring case
 * - `textList`: every listed text occurs in the row's list, ignoring case
 * - `boolean`: true or false, also as text
 * - `min`: the row value is at least the given number
 * - `minEach`: an object of numbers; each named row value is at least that
 */
export type CreatureFilterKind =
  'numberOrRange' | 'text' | 'partialText' | 'textList' | 'boolean' | 'min' | 'minEach';

export interface CreatureFilterSpec {
  /** Parameter name, e.g. "level". */
  name: string;
  kind: CreatureFilterKind;
  /** Field of the index row it compares. */
  field: string;
  /** Bounds of a range whose `min` or `max` is missing. */
  defaults?: NumberRange;
  /** Allowed values, for the description of the filter. */
  values?: readonly string[];
}

/** One creature in the index: the common fields the core fills, plus the adapter's. */
export type CreatureRow = Record<string, unknown> & {
  id: string;
  name: string;
  type: string;
  packId: string;
  packLabel: string;
  img: string | null;
};

export interface CreatureQuestions {
  /** Raise when rows change shape; a stored index of another version is rebuilt. */
  indexVersion: number;
  /** 2.2 Actor types that belong in the index. Absent: every actor of an actor compendium. */
  actorTypes?: readonly string[];
  /** 2.2 Actor types whose change in a compendium discards the index. Absent: `actorTypes`. */
  invalidatingTypes?: readonly string[];
  /** 2.2 Actor types create-actor-from-compendium may copy. Absent: every type. */
  copyableTypes?: readonly string[];
  /**
   * 2.3 The system fields of one row, from the full document. Fill the
   * standard values for missing fields. A thrown error keeps the creature with
   * the common fields only, and is counted.
   */
  row(document: AdapterDocument): Record<string, unknown>;
  /** 2.4 The measure of power. Absent: sorted by name only. */
  power?: { name: string; field: string; range: NumberRange | null };
  /** 2.5 Filters of the creature search. The neutral filters are always added in front. */
  filters: readonly CreatureFilterSpec[];
  /** 2.5 A readable line for the filters that are set. */
  describeFilters?(filters: Readonly<Record<string, unknown>>): string;
  /** 2.6 Fields shown per creature in the result list. */
  listFields?(row: CreatureRow): Record<string, unknown>;
  /** 2.6 One line, e.g. "Level 5 dragon from Bestiary". */
  summary?(row: CreatureRow): string;
}

// 2.7 Compendium search ---------------------------------------------------------

export interface CompendiumStatsQuestions {
  /** Extra index fields to load for actor entries. */
  indexFields?: readonly string[];
  /** Key values of an actor from its index entry or data, or null. */
  actorStats(entry: AdapterDocument): Record<string, unknown> | null;
  /**
   * Filters only search-compendium offers, on top of the creature
   * filters, e.g. an older name for the same field. Compared against index rows.
   */
  searchFilters?: readonly CreatureFilterSpec[];
  /**
   * A score for a compendium index entry (with `indexFields`) and the
   * filters as understood, or null when the entry is ruled out. Used only when
   * the creature index is off or failed; the answer calls it an estimate.
   * Absent: every entry stays in with the same score.
   */
  estimate?(entry: AdapterDocument, filters: Readonly<Record<string, unknown>>): number | null;
}

// 2.8 Characters -----------------------------------------------------------------

export interface CharacterSummary {
  /** Head values: hit points or their equivalent, defence, level or rank, class, origin. */
  basicInfo: Record<string, unknown>;
  /** Attributes, skills, saves in the language of the system. */
  stats: Record<string, unknown>;
}

export interface CharacterQuestions {
  summary(actor: AdapterDocument): CharacterSummary;
  /** Extra fields that matter per item (quantity, equipped, traits...). */
  itemFields?(item: AdapterDocument): Record<string, unknown>;
  /** Actions, variants and toggles, where the system knows them. */
  actions?(actor: AdapterDocument): Array<Record<string, unknown>>;
}

// 2.9 Spells ------------------------------------------------------------------------

export interface SpellInfo {
  id: string;
  name: string;
  level?: number | null;
  prepared?: boolean;
  expended?: boolean;
  traits?: string[];
  cost?: string | null;
  range?: string | null;
  target?: string | null;
  area?: string | null;
}

export interface SpellcastingEntry {
  id: string;
  name: string;
  /** e.g. prepared, spontaneous, focus, arcane, divine, ritual. */
  kind: string;
  tradition?: string | null;
  ability?: string | null;
  dc?: number | null;
  attack?: number | null;
  /** Slots or resource by name, e.g. level1, pact, rank3, asp. */
  slots?: Record<string, { value: number; max: number }>;
  spells: SpellInfo[];
}

export interface SpellQuestions {
  /** Item types that are spells. */
  itemTypes: readonly string[];
  /** The spellcasting of an actor; `actor.items` holds its items as plain data. */
  entries(actor: AdapterDocument): SpellcastingEntry[];
}

// 2.10 Searching inside a character -----------------------------------------------

export interface CharacterSearchQuestions {
  itemTypes: {
    spells: readonly string[];
    equipment: readonly string[];
    features: readonly string[];
    actions: readonly string[];
  };
  /** Values of `category` and their rule. A category that is not listed is refused. */
  categories: Readonly<
    Record<string, { description: string; matches(item: AdapterDocument): boolean }>
  >;
  /** Range, target and cost of a hit. */
  matchDetails?(item: AdapterDocument): Record<string, unknown>;
}

// 2.11 Using an item ----------------------------------------------------------------

export interface ItemUseRequest {
  consume?: boolean;
  spellLevel?: number;
}

export interface ItemUsePlan {
  /** Method of the Foundry item to call. */
  method: string;
  /** Options for it. Never wait for a dialog. */
  options: Record<string, unknown>;
  /**
   * Every argument of the call, when the method takes more than the
   * options, e.g. `[options, { configure: false }]` for dnd5e's `Item5e#use`,
   * or none at all. When given, it replaces the single `options` argument.
   */
  args?: readonly unknown[];
}

export interface ItemUseQuestions {
  /** The plan, or null for the generic methods. */
  plan(item: AdapterDocument, request: ItemUseRequest): ItemUsePlan | null;
}

/** Tried in this order without an adapter plan; the last resort is a plain chat message. */
export const GENERIC_ITEM_USE_METHODS: readonly string[] = ['use', 'toChat', 'roll'];

// 2.12 Conditions ---------------------------------------------------------------------

export interface ConditionInfo {
  id: string;
  name: string;
  img?: string | null;
  description?: string | null;
  /** Whatever else Foundry's list carries for this condition. */
  [field: string]: unknown;
}

/** A condition set on an actor, with its level when the condition has levels. */
export interface ActiveConditionState {
  /** The id of the condition in `CONFIG.statusEffects`, or the system's slug for it. */
  id: string;
  level: number | null;
}

/** One call on the actor, e.g. `{ method: 'increaseCondition', args: ['frightened', { value: 2 }] }`. */
export interface ActorCall {
  method: string;
  args: readonly unknown[];
}

export interface ConditionQuestions {
  /**
   * Data of the active effect that sets the condition. Optional:
   * without it the registry fills the generic effect and names `effectData` in
   * `fallbackFor`, so a system whose own `toggleStatusEffect` does the work
   * (dnd5e, pf2e) says nothing here.
   */
  effectData?(condition: ConditionInfo): Record<string, unknown>;
  /** Whether an effect is this condition, for removing it. */
  matchesEffect?(effect: AdapterDocument, condition: ConditionInfo): boolean;
  /**
   * The conditions set on an actor, from `actor.toObject()` with its
   * items and effects. A system that keeps conditions as items (pf2e) answers
   * here, because matching effects cannot see them.
   */
  activeOn?(actor: AdapterDocument): ActiveConditionState[];
  /**
   * Whether a condition has levels. `max` is its highest level, or
   * null when the rules set none (frightened in pf2e). The whole answer is
   * null for a condition without levels.
   */
  levels?(condition: ConditionInfo): { max: number | null } | null;
  /**
   * The calls on the actor that bring a condition from its current
   * state on `actor` (plain data) to `level`; 0 removes it. An empty list means
   * nothing is left to do. Asked again after the calls, at most once more, so
   * a system that creates a condition without its level can be followed up.
   */
  levelPlan?(condition: ConditionInfo, level: number, actor: AdapterDocument): ActorCall[];
}

// 2.13 Roll requests ----------------------------------------------------------------------

export interface RollRequest {
  rollType: string;
  rollTarget?: string;
  rollModifier?: string;
}

export interface RollPlan {
  formula: string;
  /** Label of the button. */
  label: string;
}

export interface RollQuestions {
  types: ReadonlyArray<{ id: string; description: string; targets?: readonly string[] }>;
  /** The formula from the roll data of the actor (plain data), or of no actor. */
  plan(request: RollRequest, actor: AdapterDocument | null): RollPlan;
}

// 2.14, 2.15 Actor data ------------------------------------------------------------------------

export interface ActorDataQuestions {
  /** Bring free `system` data into the shape the system's data model needs. Unknown keys stay. */
  normalize?(
    system: Record<string, unknown>,
    context: { actorType: string; mode: 'create' | 'update' }
  ): Record<string, unknown>;
  /** Text for manage-actors describe. */
  schemaNotes?(): string;
}

// 2.16 World items --------------------------------------------------------------------------------

export interface WorldItemQuestions {
  /** Allowed values of enumerated fields per item type, read from the system's CONFIG. */
  enums(config: unknown): Record<string, Record<string, readonly string[]>>;
  /** A note for describe, e.g. that wrong values are silently ignored by the system. */
  note?(): string;
}

// 2.18 Compendiums ----------------------------------------------------------------------------------

export interface CompendiumDefaultQuestions {
  /** Default compendium ids per document name, e.g. `{ Item: [...] }`. */
  defaults?: Readonly<Record<string, readonly string[]>>;
  /** Higher first when names are searched across compendiums. */
  priority?(packId: string): number;
}

/** Everything an adapter can answer. Only `id` and `title` are required. */
export interface SystemAdapter {
  /** Adapter id, e.g. the Foundry system id it is built for. */
  id: string;
  /** Display name. */
  title: string;
  /** Whether it also takes over another Foundry system id. The own id always matches, ignoring case. */
  handles?(systemId: string): boolean;
  creatures?: CreatureQuestions;
  compendiumStats?: CompendiumStatsQuestions;
  characters?: CharacterQuestions;
  spells?: SpellQuestions;
  characterSearch?: CharacterSearchQuestions;
  itemUse?: ItemUseQuestions;
  conditions?: ConditionQuestions;
  rolls?: RollQuestions;
  actorData?: ActorDataQuestions;
  worldItems?: WorldItemQuestions;
  compendiums?: CompendiumDefaultQuestions;
  /**
   * 2.17 Names of the tools only this system has. The owning area registers
   * them as usual; each checks the system with `requireSystem` first.
   */
  tools?: readonly string[];
}

export type QuestionArea = Exclude<keyof SystemAdapter, 'id' | 'title' | 'handles' | 'tools'>;

export interface SystemInfo {
  /** Foundry system id in lower case, or "unknown". */
  id: string;
  /** As Foundry reports it. */
  rawId: string;
  version: string | null;
  adapter: SystemAdapter | null;
  /** The adapter's title, or the raw id. */
  title: string;
  capabilities: AdapterCapabilities;
}

export interface SystemAnswer<K extends QuestionArea> {
  system: SystemInfo;
  questions: NonNullable<SystemAdapter[K]>;
  /** Whether the adapter answers this area at all. */
  fromAdapter: boolean;
  /** Questions of the area a generic fallback answered. */
  fallbackFor: string[];
}

/** Throws; lets the module turn refusals into QueryError with a code. */
export type SystemFail = (
  code: 'SYSTEM_NOT_SUPPORTED' | 'WRONG_SYSTEM' | 'INVALID_ARGUMENT',
  message: string
) => never;

export class SystemNotSupportedError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'SystemNotSupportedError';
  }
}

const throwError: SystemFail = (code, message) => {
  throw new SystemNotSupportedError(code, message);
};

/** Always offered, with or without an adapter. */
export const NEUTRAL_CREATURE_FILTERS: readonly CreatureFilterSpec[] = [
  { name: 'name', kind: 'partialText', field: 'name' },
  { name: 'actorType', kind: 'text', field: 'type' },
  { name: 'packId', kind: 'text', field: 'packId' },
];

export function capabilitiesOf(adapter: SystemAdapter | null): AdapterCapabilities {
  return {
    creatureIndex: !!adapter?.creatures,
    characterStats: !!adapter?.characters,
    spells: !!adapter?.spells,
    powerMeasure: !!adapter?.creatures?.power,
  };
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function statusesOf(effect: AdapterDocument): string[] {
  const statuses = effect['statuses'];
  if (Array.isArray(statuses)) return statuses.filter((s): s is string => typeof s === 'string');
  return [];
}

type GenericAnswers = { [K in QuestionArea]-?: NonNullable<SystemAdapter[K]> };

/**
 * What the core offers without an adapter. None of it knows a field path of
 * any system; where only system knowledge would help, the answer is empty or
 * a refusal that names the system, never a guess shaped like one system.
 */
export function genericAnswers(system: SystemInfo, fail: SystemFail = throwError): GenericAnswers {
  const name = system.rawId;
  return {
    creatures: {
      indexVersion: 0,
      row: () => ({}),
      filters: [],
      listFields: () => ({}),
      summary: row => `${row.type} from ${row.packLabel}`,
    },
    compendiumStats: { actorStats: () => null },
    characters: {
      summary: actor => {
        const basicInfo: Record<string, unknown> = {};
        for (const key of ['name', 'type', 'img'])
          if (actor[key] !== undefined) basicInfo[key] = actor[key];
        return { basicInfo, stats: {} };
      },
      itemFields: item => ({
        id: text(item['id']) ?? text(item['_id']) ?? null,
        name: text(item['name']) ?? null,
        type: text(item['type']) ?? null,
      }),
    },
    spells: { itemTypes: [], entries: () => [] },
    characterSearch: {
      itemTypes: { spells: [], equipment: [], features: [], actions: [] },
      categories: {},
    },
    itemUse: { plan: () => null },
    conditions: {
      effectData: condition => ({
        name: condition.name,
        img: condition.img ?? null,
        statuses: [condition.id],
      }),
      matchesEffect: (effect, condition) =>
        statusesOf(effect).includes(condition.id) || effect['name'] === condition.name,
    },
    rolls: {
      types: [
        {
          id: 'custom',
          description:
            'A free formula in rollTarget, e.g. "2d6+1". Other roll types need an adapter for the game system.',
        },
      ],
      plan: request => {
        if (request.rollType !== 'custom') {
          fail(
            'SYSTEM_NOT_SUPPORTED',
            `The roll type "${request.rollType}" is not supported for the game system "${name}": building it needs ` +
              'an adapter that knows the rolls of this system. Use rollType "custom" with a formula in rollTarget.'
          );
        }
        const formula = (request.rollTarget ?? '').trim();
        if (!formula)
          fail('INVALID_ARGUMENT', 'A custom roll needs its formula in rollTarget, e.g. "1d100".');
        const modifier = (request.rollModifier ?? '').trim();
        const joined = !modifier
          ? formula
          : /^[+-]/.test(modifier)
            ? `${formula}${modifier}`
            : `${formula}+${modifier}`;
        return { formula: joined, label: 'Custom roll' };
      },
    },
    actorData: {
      normalize: data => data,
      schemaNotes: () =>
        `No system-specific actor schema notes are available for the game system "${name}".`,
    },
    worldItems: {
      enums: () => ({}),
      note: () => `No enum schema is available for the game system "${name}".`,
    },
    compendiums: { defaults: {}, priority: () => 0 },
  };
}

export interface SystemAdapterRegistryOptions {
  /** How refusals are thrown. Default: SystemNotSupportedError. */
  fail?: SystemFail;
}

export class SystemAdapterRegistry {
  readonly #entries: Array<{ adapter: SystemAdapter; owner: string }> = [];
  readonly #fail: SystemFail;

  constructor(options: SystemAdapterRegistryOptions = {}) {
    this.#fail = options.fail ?? throwError;
  }

  /**
   * Register an adapter. The same adapter object again is accepted, so a list
   * of areas can be installed twice (tests do). Another adapter with the same
   * id stops with both owners named. Returns a remover.
   */
  register(adapter: SystemAdapter, owner = 'unknown'): () => void {
    if (!adapter.id.trim()) throw new Error(`The game system adapter of area "${owner}" has no id`);
    const existing = this.#entries.find(
      entry => entry.adapter.id.toLowerCase() === adapter.id.toLowerCase()
    );
    if (existing && existing.adapter !== adapter) {
      throw new Error(
        `The game system adapter "${adapter.id}" of area "${owner}" is already registered by area "${existing.owner}"`
      );
    }
    if (!existing) this.#entries.push({ adapter, owner });
    return () => {
      const index = this.#entries.findIndex(entry => entry.adapter === adapter);
      if (index >= 0) this.#entries.splice(index, 1);
    };
  }

  list(): SystemAdapter[] {
    return this.#entries.map(entry => entry.adapter);
  }

  /** First an adapter whose id is the system id (ignoring case), then one that takes it over. */
  find(systemId: string): SystemAdapter | null {
    const lower = systemId.toLowerCase();
    return (
      this.#entries.find(entry => entry.adapter.id.toLowerCase() === lower)?.adapter ??
      this.#entries.find(entry => entry.adapter.handles?.(systemId) === true)?.adapter ??
      null
    );
  }

  /** Everything the core knows about a system id. An empty or missing id is "unknown". */
  describe(systemId: string | null | undefined, version: string | null = null): SystemInfo {
    const raw = (systemId ?? '').trim();
    const adapter = raw ? this.find(raw) : null;
    return {
      id: raw ? raw.toLowerCase() : 'unknown',
      rawId: raw || 'unknown',
      version,
      adapter,
      title: adapter?.title ?? (raw || 'unknown'),
      capabilities: capabilitiesOf(adapter),
    };
  }

  /** The adapter's answers for an area, completed by the generic fallbacks. */
  answer<K extends QuestionArea>(system: SystemInfo, area: K): SystemAnswer<K> {
    const generic = genericAnswers(system, this.#fail)[area] as unknown as Record<string, unknown>;
    const own = system.adapter?.[area] as unknown as Record<string, unknown> | undefined;
    if (!own) {
      const questions =
        area === 'creatures' ? { ...generic, filters: [...NEUTRAL_CREATURE_FILTERS] } : generic;
      return {
        system,
        questions: questions as unknown as NonNullable<SystemAdapter[K]>,
        fromAdapter: false,
        fallbackFor: Object.keys(generic),
      };
    }
    const merged: Record<string, unknown> = { ...generic };
    const fallbackFor: string[] = [];
    for (const key of Object.keys(generic)) if (own[key] === undefined) fallbackFor.push(key);
    for (const [key, value] of Object.entries(own)) if (value !== undefined) merged[key] = value;
    if (area === 'creatures') {
      const ownFilters = (own['filters'] as readonly CreatureFilterSpec[] | undefined) ?? [];
      const taken = new Set(ownFilters.map(filter => filter.name));
      merged['filters'] = [
        ...NEUTRAL_CREATURE_FILTERS.filter(f => !taken.has(f.name)),
        ...ownFilters,
      ];
    }
    return {
      system,
      questions: merged as unknown as NonNullable<SystemAdapter[K]>,
      fromAdapter: true,
      fallbackFor,
    };
  }

  /** The adapter's answers only, or a refusal naming the system and what is missing. */
  require<K extends QuestionArea>(
    system: SystemInfo,
    area: K,
    what: string
  ): NonNullable<SystemAdapter[K]> {
    const own = system.adapter?.[area];
    if (own) return own as NonNullable<SystemAdapter[K]>;
    if (!system.adapter) {
      const known = this.list().map(adapter => adapter.id);
      this.#fail(
        'SYSTEM_NOT_SUPPORTED',
        `${what} is not supported for the game system "${system.rawId}": Ninjo's Foundry MCP has no adapter for it ` +
          (known.length
            ? `(adapters exist for ${known.join(', ')}).`
            : '(no adapter is registered).')
      );
    }
    return this.#fail(
      'SYSTEM_NOT_SUPPORTED',
      `${what} is not supported for the game system "${system.rawId}": its adapter "${system.adapter.title}" does not answer it.`
    );
  }

  /** For a tool that belongs to one system (2.17): refuse in any other, naming the detected one. */
  requireSystem(system: SystemInfo, adapterId: string, what: string): void {
    if (system.adapter?.id.toLowerCase() === adapterId.toLowerCase()) return;
    this.#fail(
      'WRONG_SYSTEM',
      `${what} requires the game system "${adapterId}". Detected game system: "${system.rawId}".`
    );
  }
}
