/**
 * Input schemas of the compendium tools.
 *
 * The contract is kept exactly as the previous generation offered it:
 * parameter names, types, enums, required parameters, defaults and the shape
 * of the range objects. tools.test.ts compares that shape. The descriptions
 * are written anew for this rewrite, in the words of its behaviour: whole
 * names instead of substrings, the default limit of the creature search, no
 * dashes. The schemas are put together from the small builders below, so each
 * parameter reads as one line: name, kind, description.
 *
 * The Pathfinder 2e and Cosmere parameters stay. Their adapters come back
 * (decision of 13.09.2026); until then the module reports them as ignored.
 */

type Schema = Record<string, unknown>;

/** Adds a description when there is one. */
const titled = <T extends Schema>(schema: T, description?: string): T =>
  description === undefined ? schema : { ...schema, description };

const str = (description?: string) => titled({ type: 'string' }, description);
const num = (description?: string) => titled({ type: 'number' }, description);
const bool = (description?: string) => titled({ type: 'boolean' }, description);
const strList = (description?: string) =>
  titled({ type: 'array', items: { type: 'string' } }, description);

/** A parameter object: its members, and the names it cannot do without when given. */
function shape(members: Record<string, Schema>, needs?: string[], more: Schema = {}): Schema {
  return { type: 'object', properties: members, ...(needs ? { required: needs } : {}), ...more };
}

/** Text restricted to fixed words, in the order the contract lists them. */
const oneWordOf = (words: readonly string[], description: string) =>
  titled({ ...str(), enum: [...words] }, description);

/** Several accepted forms for one parameter. */
const anyOf = (forms: Schema[], description?: string) => titled({ oneOf: forms }, description);

/** An object with optional lower and upper numbers. */
const span = (description?: string, lowText?: string, highText?: string) =>
  titled(shape({ min: num(lowText), max: num(highText) }), description);

/** A single number, a number written as text, or a span, as the creature search accepts them. */
const valueTextOrSpan = (what: string, low: string, high: string): Schema[] => [
  num(`One ${what} value`),
  str(`One ${what} value written as text, e.g. "7"`),
  span(
    `Lowest and highest ${what}, e.g. {"min": 3, "max": 8}`,
    `Lowest ${what}, ${low} when left out`,
    `Highest ${what}, ${high} when left out`
  ),
];

const words = (text: string) => text.split(' ');

/** The 14 creature types of D&D 5e the schema has always offered, in their fixed order. */
const KINDS = words(
  'humanoid dragon beast undead fey fiend celestial construct elemental giant monstrosity ooze plant aberration'
);
/**
 * The sizes the schema always offered, then the words of WFRP4e that
 * differ. Only added, so every earlier value stays valid.
 */
const SIZES = words('tiny small medium large huge gargantuan little average enormous monstrous');
const RARITIES = words('common uncommon rare unique');

/**
 * Creature types are free text. The D&D words stay in the description;
 * Pathfinder 2e and the Cosmere RPG know other types, which an enum of D&D words
 * refused before they reached the adapter.
 */
const creatureTypeText = (what: string) =>
  str(
    `${what}. D&D 5e: ${KINDS.join(', ')}. Pathfinder 2e and the Cosmere RPG use their own types, for instance animal or spirit.`
  );

export const listCompendiumsSchema: Schema = shape({});

export const listCompendiumPacksSchema: Schema = shape({
  type: str('Only compendiums holding this document type, for instance Actor or JournalEntry'),
});

export const listCompendiumEntriesSchema: Schema = shape(
  {
    packId: str(
      'Id of the compendium, package and name joined by a dot, for instance world.chapter-one'
    ),
    namePattern: str('Keep only entries whose name contains this text; case does not matter'),
    folderName: str('Keep only entries inside the compendium folder of this name'),
    limit: num('Entries per page: 200 unless given, 1000 at the most'),
    offset: num('Entries to skip; continue with the offset the previous answer named'),
  },
  ['packId']
);

const lowestDefenses = shape(
  {
    phy: num('Physical defense at least'),
    cog: num('Cognitive defense at least'),
    spi: num('Spiritual defense at least'),
  },
  undefined,
  {
    additionalProperties: false,
    description: 'Lowest defenses to accept in the Cosmere RPG; give any of phy, cog and spi',
  }
);

/**
 * The filters of DSA5, WFRP4e and Traveller that neither tool offered,
 * so a client that keeps to the schema never sent them. All optional; the
 * module reports each one the active system does not know as ignored.
 */
const FURTHER_FILTERS: Record<string, Schema> = {
  species: str(
    'Species; a part of the name is enough in WFRP4e and Traveller (DSA5, WFRP4e, Traveller)'
  ),
  culture: str('Culture; a part of the name is enough (DSA5)'),
  profession: str('Profession; a part of the name is enough (DSA5)'),
  experiencePoints: anyOf(
    [
      num('Adventure points'),
      span(undefined, 'Lowest adventure points', 'Highest adventure points'),
    ],
    'Adventure points spent on the character (DSA5)'
  ),
  hasLiturgies: bool('Only creatures with liturgical chants or ceremonies (DSA5)'),
  hasPrayers: bool('Only creatures with prayers (WFRP4e)'),
  hits: anyOf(
    [num('One hits value'), span(undefined, 'Lowest hits', 'Highest hits')],
    'Hits to match (Traveller)'
  ),
  minHits: num('Hits at least this much (Traveller)'),
  hasPsionics: bool('Only creatures with psionics (Traveller)'),
};

/** The Cosmere RPG filters list-creatures-by-criteria always offered, now also for search-compendium. */
const COSMERE_FILTERS: Record<string, Schema> = {
  tier: anyOf(
    [
      num('One tier from 1 to 4'),
      span(
        'Lowest and highest tier, e.g. {"min": 1, "max": 2}',
        'Lowest tier, 1 to 4',
        'Highest tier, 1 to 4'
      ),
    ],
    'Adversary tier in the Cosmere RPG, 1 to 4, the main measure there for building encounters'
  ),
  role: str(
    'Adversary role in the Cosmere RPG such as minion, rival or boss; case does not matter'
  ),
  hasInvestiture: bool('Only adversaries that use Investiture or Surges (Cosmere RPG)'),
  hitPoints: anyOf(
    [num('One health value'), span('Lowest and highest health, e.g. {"min": 20, "max": 60}')],
    'Maximum health to match (Cosmere RPG)'
  ),
  defensesMin: lowestDefenses,
  deflectMin: num('Deflect at least this much (Cosmere RPG)'),
};

const OTHER_SYSTEM_FILTERS: Record<string, Schema> = { ...COSMERE_FILTERS, ...FURTHER_FILTERS };

const searchFilters = titled(
  shape({
    challengeRating: anyOf([
      num('One challenge rating'),
      span(undefined, 'Lowest challenge rating', 'Highest challenge rating'),
    ]),
    creatureType: creatureTypeText('Kind of creature, for instance dragon or undead'),
    size: oneWordOf(SIZES, 'Size category of the creature'),
    alignment: str('Alignment of the creature; a part such as "evil" is enough (D&D 5e)'),
    hasLegendaryActions: bool('Only creatures that have legendary actions'),
    spellcaster: bool('Only creatures able to cast spells (D&D 5e)'),
    level: anyOf(
      [num('One creature level'), span(undefined, 'Lowest level', 'Highest level')],
      'Creature level in Pathfinder 2e, from -1 upwards; experience level 1 to 7 in DSA5'
    ),
    traits: strList('Traits every creature must carry (Pathfinder 2e, WFRP4e)'),
    rarity: oneWordOf(RARITIES, 'Rarity of the creature (Pathfinder 2e)'),
    hasSpells: bool('Only creatures that cast spells'),
    ...OTHER_SYSTEM_FILTERS,
  }),
  'Creature filters for actor compendiums, read by the adapter of the running game system. Together with ' +
    'packType "Actor" and a built creature index they test the real values; without the index the adapter can only ' +
    'judge by names. The answer lists every filter the running system cannot use. list-creatures-by-criteria is ' +
    'the reliable way to filter.'
);

export const searchCompendiumSchema: Schema = shape(
  {
    query: str(
      'Two or more characters. Every word must appear in the entry name; texts inside entries are not searched.'
    ),
    packType: str(
      'Search only compendiums of this document type, for instance Item, Actor or JournalEntry'
    ),
    filters: searchFilters,
    limit: {
      ...num('How many matches to return: 50 unless given, and never more'),
      minimum: 1,
      maximum: 50,
    },
  },
  ['query']
);

export const getCompendiumItemSchema: Schema = shape(
  {
    packId: str('Id of the compendium that holds the entry'),
    itemId: str('Id of the entry inside that compendium'),
    compact: {
      ...bool(
        'Answer with key values, properties and up to five contained items only, leaving out the long description and the raw data'
      ),
      default: false,
    },
  },
  ['packId', 'itemId']
);

export const listCreaturesByCriteriaSchema: Schema = shape(
  {
    challengeRating: anyOf(
      valueTextOrSpan('challenge rating', '0', '30'),
      'Challenge rating to match: one value, the value as text, or lowest and highest. Bounds suit a first survey best.'
    ),
    creatureType: creatureTypeText('Kind of creature to keep'),
    size: oneWordOf(SIZES, 'Size category to keep'),
    hasSpells: bool('Only creatures that cast spells'),
    hasLegendaryActions: bool('Only creatures with legendary actions (D&D 5e)'),
    level: anyOf(
      valueTextOrSpan('level', '-1', '25'),
      'Creature level to match in Pathfinder 2e, from -1 upwards; experience level 1 to 7 in DSA5'
    ),
    traits: strList('Traits every creature must carry (Pathfinder 2e, WFRP4e)'),
    rarity: oneWordOf(RARITIES, 'Rarity to keep (Pathfinder 2e)'),
    ...COSMERE_FILTERS,
    alignment: str('Alignment; a part such as "evil" is enough (D&D 5e)'),
    ...FURTHER_FILTERS,
    limit: {
      ...num('How many creatures to return: 100 unless given, 1000 at the most'),
      ...{ minimum: 1, maximum: 1000, default: 100 },
    },
  },
  []
);

export const createCompendiumSchema: Schema = shape(
  {
    label: str('Name shown in Foundry, for instance "Chapter One: The Sunken Keep"'),
    type: str(
      'Document type it will hold: Actor, Item, Scene, JournalEntry, RollTable, Playlist, Macro, Cards or Adventure'
    ),
  },
  ['label', 'type']
);

const unlockForOneOperation = bool(
  'Lift a lock for this one operation; it is set again afterwards'
);

export const exportToCompendiumSchema: Schema = shape(
  {
    packId: str('Id of the compendium to save into'),
    documentType: str(
      'Type of the world documents: JournalEntry, Scene, Actor, RollTable, Playlist, Item or Macro'
    ),
    names: strList(
      'World documents to save, by whole name (case does not matter) or by id. Leave out to save every document of the type.'
    ),
    folderName: str(
      'Save only documents lying directly in the world folder with exactly this name'
    ),
    unlockIfNeeded: unlockForOneOperation,
  },
  ['packId', 'documentType']
);

export const importFromCompendiumSchema: Schema = shape(
  {
    packId: str('Id of the compendium to copy from, for instance my-module.music'),
    entryName: str(
      'Whole name of the entry, case does not matter; a name shared by several entries is refused with their ids'
    ),
    entryId: str('Id of the entry, instead of entryName'),
    newName: str('Name the copy gets in the world'),
    folderPath: str(
      'World folder for the copy, levels separated by slashes such as "Places/Harbour"; missing levels are created'
    ),
  },
  ['packId']
);

export const organizeCompendiumSchema: Schema = shape(
  {
    packId: str('Id of the compendium'),
    folderName: str('Compendium folder that receives the entries'),
    entryNames: strList('Entries to move, by whole name (case does not matter) or by id'),
    unlockIfNeeded: bool(),
  },
  ['packId', 'folderName', 'entryNames']
);

export const setCompendiumLockSchema: Schema = shape(
  {
    packId: str('Id of the compendium'),
    locked: bool('true to lock it, false to unlock it'),
  },
  ['packId', 'locked']
);

export const deleteCompendiumEntriesSchema: Schema = shape(
  {
    packId: str('Id of the compendium'),
    ids: strList('Ids of the entries to remove, as list-compendium-entries shows them'),
    names: strList(
      'Names in their exact spelling, instead of ids; a name shared by several entries is reported and kept'
    ),
    unlockIfNeeded: unlockForOneOperation,
    dryRun: bool('Only report what would be removed and change nothing. Start with this.'),
    confirmLabel: str(
      'Required only when the selection would remove every entry: the exact label of the compendium'
    ),
  },
  ['packId']
);

export const deleteCompendiumSchema: Schema = shape(
  {
    packId: str('Id of the world compendium to remove'),
    confirmLabel: str('Its exact label, so a mistyped id cannot remove the wrong compendium'),
  },
  ['packId', 'confirmLabel']
);
