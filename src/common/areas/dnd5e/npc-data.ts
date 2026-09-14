/**
 * The source data of a new dnd5e NPC from the arguments of dnd5e-create-npc.
 *
 * Pure: the module passes what only Foundry knows (system version, language
 * table), and gets back the data, the problems that refuse the call and the
 * warnings. Warnings are computed here and nowhere else, so the answer never
 * carries a second, differing list.
 *
 * Deliberately never written: proficiency bonus and experience points. dnd5e
 * derives both from the challenge rating, and a stored value would hide the
 * derivation.
 */
import {
  ABILITY_KEYS,
  CONDITION_KEYS,
  CREATURE_TYPE_KEYS,
  DAMAGE_TYPE_KEYS,
  SIZE_KEYS,
  VALID_CRS,
  formatCr,
  isRecord,
  num,
  parseCr,
  quote,
  skillFor,
  versionAtLeast,
  type Data,
  type RulesVersion,
} from './rules.js';

/** Language keys and the lower case labels that point at them. */
export interface LanguageTable {
  keys: readonly string[];
  byLabel: Readonly<Record<string, string>>;
}

export interface NpcContext {
  /** Version of the dnd5e system, e.g. "5.3.3"; decides where senses and speeds live. */
  systemVersion: string | null;
  languages: LanguageTable;
  /** The world's rules version, used when sourceRules is not given. */
  worldRules?: RulesVersion | null;
}

export interface NpcBuild {
  data: Data;
  cr: number | null;
  problems: string[];
  warnings: string[];
}

const SPEEDS = ['walk', 'fly', 'swim', 'climb', 'burrow'] as const;
const SENSES = ['darkvision', 'blindsight', 'tremorsense', 'truesight'] as const;

function texts(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
    : [];
}

/** Known keys go into `value`, the rest into `custom`, with one warning naming them. */
export function splitTrait(
  given: readonly string[],
  known: readonly string[],
  what: string,
  warnings: string[],
  byLabel: Readonly<Record<string, string>> = {}
): { value: string[]; custom: string } {
  const value: string[] = [];
  const custom: string[] = [];
  for (const entry of given) {
    const lower = entry.trim().toLowerCase();
    const key = known.includes(lower) ? lower : byLabel[lower];
    if (key) {
      if (!value.includes(key)) value.push(key);
    } else custom.push(entry.trim());
  }
  if (custom.length) {
    warnings.push(
      `${what} ${quote(custom)} ${custom.length === 1 ? 'is' : 'are'} not a key of dnd5e and went into the custom text, where the sheet shows ${custom.length === 1 ? 'it' : 'them'} but no rule applies ${custom.length === 1 ? 'it' : 'them'}. Known: ${known.join(', ')}.`
    );
  }
  return { value, custom: custom.join('; ') };
}

export function resolveLanguages(
  given: readonly string[],
  table: LanguageTable,
  warnings: string[]
): { value: string[]; custom: string } {
  return splitTrait(given, table.keys, 'Language(s)', warnings, table.byLabel);
}

export function buildNpcData(args: Data, context: NpcContext): NpcBuild {
  const problems: string[] = [];
  const warnings: string[] = [];

  const name = typeof args['name'] === 'string' ? args['name'].trim() : '';
  if (!name) problems.push('name must be a non-empty text');

  const typeGiven =
    typeof args['creatureType'] === 'string' ? args['creatureType'].trim().toLowerCase() : '';
  const type: Data = {
    value: '',
    subtype: typeof args['creatureSubtype'] === 'string' ? args['creatureSubtype'].trim() : '',
    swarm: '',
    custom: '',
  };
  if ((CREATURE_TYPE_KEYS as readonly string[]).includes(typeGiven)) type['value'] = typeGiven;
  else if (typeGiven === 'swarm') {
    type['value'] = 'custom';
    type['custom'] = 'Swarm';
    warnings.push(
      'dnd5e has no creature type "swarm": a swarm is a size of tiny creatures of another type (details.type.swarm). ' +
        'The type was stored as the custom text "Swarm"; set the type of its members instead, e.g. "beast", to let rules see it.'
    );
  } else {
    problems.push(
      `creatureType must be one of ${CREATURE_TYPE_KEYS.join(', ')}, got ${JSON.stringify(args['creatureType'])}`
    );
  }

  const sizeGiven = typeof args['size'] === 'string' ? args['size'].trim().toLowerCase() : '';
  const size = SIZE_KEYS[sizeGiven] ?? Object.values(SIZE_KEYS).find(key => key === sizeGiven);
  if (!size)
    problems.push(
      `size must be one of ${Object.keys(SIZE_KEYS).join(', ')}, got ${JSON.stringify(args['size'])}`
    );

  const cr = parseCr(args['cr']);
  if (cr === null) {
    problems.push(
      `cr must be a challenge rating of the rules (0, 1/8, 1/4, 1/2 or a whole number from 1 to 30), got ${JSON.stringify(args['cr'])}`
    );
  }

  const hp = num(args['hpAverage']);
  if (hp === null || hp < 1 || !Number.isInteger(hp))
    problems.push(
      `hpAverage must be a whole number of at least 1, got ${JSON.stringify(args['hpAverage'])}`
    );
  const hpFormula = typeof args['hpFormula'] === 'string' ? args['hpFormula'].trim() : '';
  if (!hpFormula) problems.push('hpFormula must be a dice formula such as "2d6" or "3d8+9"');
  else if (!/^[\dd+\-*/()\s]+$/i.test(hpFormula))
    problems.push(`hpFormula "${hpFormula}" is not a dice formula such as "3d8+9"`);

  const acMode = args['acMode'];
  let ac: Data = { calc: 'default' };
  if (acMode === 'flat') {
    const value = num(args['acValue']);
    if (value === null || value < 0 || value > 30)
      problems.push(
        `acMode "flat" needs acValue from 0 to 30, got ${JSON.stringify(args['acValue'])}`
      );
    else ac = { calc: 'flat', flat: value };
  } else if (acMode === 'default') {
    if (args['acValue'] !== undefined)
      warnings.push(
        'acValue was ignored: acMode "default" lets dnd5e calculate the armor class. Use acMode "flat" to set it.'
      );
  } else problems.push(`acMode must be "default" or "flat", got ${JSON.stringify(acMode)}`);

  const abilities: Data = {};
  const givenAbilities = isRecord(args['abilities']) ? args['abilities'] : {};
  const saves = texts(args['savingThrows']).map(save => save.toLowerCase());
  for (const bad of saves.filter(save => !(ABILITY_KEYS as readonly string[]).includes(save)))
    problems.push(`savingThrows contains "${bad}", valid: ${ABILITY_KEYS.join(', ')}`);
  for (const key of ABILITY_KEYS) {
    const score = num(givenAbilities[key]);
    if (score === null || score < 1 || score > 30 || !Number.isInteger(score))
      problems.push(
        `abilities.${key} must be a whole number from 1 to 30, got ${JSON.stringify(givenAbilities[key])}`
      );
    abilities[key] = { value: score ?? 10, proficient: saves.includes(key) ? 1 : 0 };
  }

  const skills: Data = {};
  const skillList = Array.isArray(args['skills']) ? args['skills'] : [];
  for (const [index, entry] of skillList.entries()) {
    const skill =
      isRecord(entry) && typeof entry['skill'] === 'string' ? skillFor(entry['skill']) : null;
    const level = isRecord(entry) ? entry['proficiency'] : undefined;
    if (!skill) {
      problems.push(
        `skills[${index}].skill ${JSON.stringify(isRecord(entry) ? entry['skill'] : entry)} is not one of the 18 skills`
      );
      continue;
    }
    if (level !== 'proficient' && level !== 'expert') {
      problems.push(
        `skills[${index}].proficiency must be "proficient" or "expert", got ${JSON.stringify(level)}`
      );
      continue;
    }
    skills[skill.key] = { value: level === 'expert' ? 2 : 1 };
  }

  const speeds: Data = {};
  for (const speed of SPEEDS) {
    const key = `${speed}Speed`;
    const fallback = speed === 'walk' ? 30 : 0;
    const value = args[key] === undefined ? fallback : num(args[key]);
    if (value === null || value < 0)
      problems.push(`${key} must be 0 or more feet, got ${JSON.stringify(args[key])}`);
    speeds[speed] = value ?? fallback;
  }
  const hover = args['hover'] === true;
  if (hover && !speeds['fly'])
    warnings.push(
      'hover is set without a fly speed; the sheet shows hover, but the creature cannot fly.'
    );

  const ranges: Data = {};
  for (const sense of SENSES) {
    const value = args[sense] === undefined ? 0 : num(args[sense]);
    if (value === null || value < 0)
      problems.push(`${sense} must be 0 or more feet, got ${JSON.stringify(args[sense])}`);
    ranges[sense] = value ? value : null;
  }
  const special = typeof args['specialSenses'] === 'string' ? args['specialSenses'].trim() : '';

  const rulesGiven = args['sourceRules'];
  if (rulesGiven !== undefined && rulesGiven !== '2014' && rulesGiven !== '2024')
    problems.push(`sourceRules must be "2014" or "2024", got ${JSON.stringify(rulesGiven)}`);
  const rules: RulesVersion =
    rulesGiven === '2024' || rulesGiven === '2014' ? rulesGiven : (context.worldRules ?? '2014');

  // dnd5e 6.0 moved speeds under movement.speeds; 5.3 moved senses under senses.ranges.
  const movement: Data = versionAtLeast(context.systemVersion, 6)
    ? { speeds: speeds, units: 'ft', hover }
    : { ...speeds, units: 'ft', hover };
  const senses: Data = versionAtLeast(context.systemVersion, 5, 3)
    ? { ranges, units: 'ft', special }
    : { ...ranges, units: 'ft', special };

  const trait = (field: string, known: readonly string[], what: string) =>
    splitTrait(texts(args[field]), known, what, warnings);

  const data: Data = {
    name,
    type: 'npc',
    system: {
      abilities,
      attributes: {
        ac,
        hp: { value: hp ?? 1, max: hp ?? 1, formula: hpFormula },
        movement,
        senses,
      },
      details: {
        cr: cr ?? 0,
        type,
        alignment: typeof args['alignment'] === 'string' ? args['alignment'].trim() : '',
        biography: { value: typeof args['biography'] === 'string' ? args['biography'] : '' },
      },
      // dnd5e 4.0 moved the source of an NPC to the top level (npc.mjs of 5.3.3 migrates details.source there).
      source: {
        book: typeof args['sourceBook'] === 'string' ? args['sourceBook'] : '',
        page: typeof args['sourcePage'] === 'string' ? args['sourcePage'] : '',
        rules,
      },
      traits: {
        size: size ?? 'med',
        languages: {
          ...resolveLanguages(texts(args['languages']), context.languages, warnings),
          ...(typeof args['languagesCustom'] === 'string' && args['languagesCustom'].trim()
            ? {
                custom: joinCustom(
                  texts(args['languages']),
                  context.languages,
                  args['languagesCustom'].trim()
                ),
              }
            : {}),
        },
        di: trait('damageImmunities', DAMAGE_TYPE_KEYS, 'Damage immunity'),
        dr: trait('damageResistances', DAMAGE_TYPE_KEYS, 'Damage resistance'),
        dv: trait('damageVulnerabilities', DAMAGE_TYPE_KEYS, 'Damage vulnerability'),
        ci: trait('conditionImmunities', CONDITION_KEYS, 'Condition immunity'),
      },
      skills,
    },
  };
  return { data, cr, problems, warnings };
}

/** Unknown languages and the free text together, without a second warning. */
function joinCustom(given: readonly string[], table: LanguageTable, free: string): string {
  const unknown = given
    .map(entry => entry.trim())
    .filter(entry => {
      const lower = entry.toLowerCase();
      return !table.keys.includes(lower) && !table.byLabel[lower];
    });
  return [...unknown, free].join('; ');
}

/** A short line of the NPC for the answer. */
export function describeNpc(args: Data, cr: number | null): Record<string, string> {
  const abilities = isRecord(args['abilities']) ? args['abilities'] : {};
  return {
    type: String(args['creatureType'] ?? ''),
    size: String(args['size'] ?? ''),
    cr: formatCr(cr),
    hp: `${String(args['hpAverage'] ?? '')} (${String(args['hpFormula'] ?? '')})`,
    ac: args['acMode'] === 'flat' ? String(args['acValue']) : 'calculated by dnd5e',
    abilities: ABILITY_KEYS.map(
      key => `${key.toUpperCase()} ${String(abilities[key] ?? '?')}`
    ).join(', '),
  };
}

export { VALID_CRS };
