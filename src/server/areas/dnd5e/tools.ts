/**
 * The three NPC builder tools on the server.
 *
 * Each checks first that the connected world is dnd5e and says which system
 * it found otherwise; an undetectable system is an
 * error with its cause, never a silent "other". Then it checks the parameters
 * of the chosen kind, asks the module, and passes the answer on with the
 * module's cause in every error: no categorised advice instead of the reason.
 *
 * Towards a module of the previous generation the data carries what that
 * module expects: every default of the schema and `effectiveAbility`. Two of
 * those defaults depend on the rules version of the world, which only the
 * module knows; `serverDefaults` names them, so this generation's module
 * treats them as not given. An older module ignores the field.
 */
import {
  FEATURE_PARAMETERS,
  checkFeatureArguments,
  type FeatureType,
} from '../../../common/areas/dnd5e/feature-data.js';
import {
  CLASS_ABILITY,
  isRecord,
  type SpellcastingClass,
} from '../../../common/areas/dnd5e/rules.js';
import { activeGameSystem, serverSystemAdapters } from '../../game-systems.js';
import { legacyFailure, messageOf, moduleTooOld } from '../../tools/results.js';
import { writingTool, type ToolContext, type ToolDefinition } from '../../tools/types.js';
import { addFeatureSchema, addFeaturesFromCompendiumSchema, createNpcSchema } from './schemas.js';

type Args = Record<string, unknown>;

/** Defaults that stand for "the world decides" in this generation. */
export const RULE_DEPENDENT_DEFAULTS = ['sourceRules', 'compendiumPacks'];

export async function requireDnd5eWorld(context: ToolContext, tool: string): Promise<void> {
  const system = await activeGameSystem(context);
  if (system.detection.problem) {
    throw new Error(
      `${tool} needs a dnd5e world, and the game system could not be detected: ${system.detection.problem}. Nothing was changed.`
    );
  }
  serverSystemAdapters.requireSystem(system, 'dnd5e', tool);
}

async function ask(
  context: ToolContext,
  query: string,
  data: Args,
  operation: string
): Promise<Args> {
  let answer: unknown;
  try {
    answer = await context.query(query, data);
  } catch (error) {
    throw (
      moduleTooOld(query, error, operation) ??
      new Error(`Failed to ${operation}: ${messageOf(error)}`)
    );
  }
  const failure = legacyFailure(answer);
  if (failure !== null) throw new Error(`Failed to ${operation}: ${failure}`);
  return isRecord(answer) ? answer : { answer };
}

/** The given arguments of `keys`, completed by the schema's defaults; the rule dependent ones are named. */
export function withDefaults(schema: Args, keys: readonly string[], args: Args): Args {
  const properties = isRecord(schema['properties']) ? schema['properties'] : {};
  const data: Args = {};
  const filled: string[] = [];
  for (const key of keys) {
    const property = properties[key];
    if (args[key] !== undefined) data[key] = args[key];
    else if (isRecord(property) && property['default'] !== undefined) {
      data[key] = structuredClone(property['default']);
      if (RULE_DEPENDENT_DEFAULTS.includes(key)) filled.push(key);
    }
  }
  if (filled.length) data['serverDefaults'] = filled;
  return data;
}

const propertyNames = (schema: Args) =>
  Object.keys(isRecord(schema['properties']) ? schema['properties'] : {});

export const createNpcTool: ToolDefinition = {
  name: 'dnd5e-create-npc',
  title: 'Create a D&D 5e NPC',
  group: 'systems',
  description:
    '[D&D 5e only] Create one NPC with a complete stat block and no items: type, size, alignment, challenge rating, ability scores, ' +
    'saving throw and skill proficiencies, hit points, armor class, speeds, senses, damage and condition traits, languages, biography ' +
    'and source. It goes into the folder "Foundry MCP Creatures". A name any actor already has (ignoring case) and a challenge rating ' +
    'the rules do not have are refused. Proficiency bonus and experience points are left to dnd5e, which derives them. Every value is ' +
    'read back; the answer lists warnings (e.g. a language that is not a dnd5e key) and anything stored differently. Add attacks, ' +
    'features and spells afterwards with dnd5e-add-feature.',
  inputSchema: createNpcSchema,
  annotations: writingTool('Create a D&D 5e NPC', { destructive: false, idempotent: false }),
  handler: async (args, context) => {
    await requireDnd5eWorld(context, 'dnd5e-create-npc');
    const data = withDefaults(createNpcSchema, propertyNames(createNpcSchema), args);
    return ask(context, 'createNpcActor', data, `create the NPC "${String(args['name'] ?? '')}"`);
  },
};

const FEATURE_QUERY: Readonly<Record<FeatureType, string>> = {
  passive: 'addPassiveFeatureToActor',
  save: 'addSaveFeatureToActor',
  attack: 'addAttackToActor',
  'attack-with-save': 'addAttackWithSaveToActor',
  aura: 'addAuraToActor',
  spellcasting: 'setActorSpellcasting',
  spells: 'addSpellsToActor',
};

export const addFeatureTool: ToolDefinition = {
  name: 'dnd5e-add-feature',
  title: 'Add a D&D 5e feature',
  group: 'systems',
  description:
    '[D&D 5e only] Add one thing to an existing dnd5e NPC or character; featureType chooses what, and each kind reads only its own ' +
    'parameters (the answer names the ignored ones).\n' +
    '- passive: a trait without a roll. Needs featureName.\n' +
    '- save: a feature forcing a saving throw with fixed DC, damage, optional template. Needs featureName, saveAbility, saveDC, damageParts; areaSize with areaType.\n' +
    '- attack: a weapon attack. Needs featureName, attackType, damageParts; rangeFt when ranged. The first damage part is the weapon damage.\n' +
    '- attack-with-save: an attack whose hit also forces a save with its own damage. Needs in addition saveAbility, saveDC, saveDamageParts.\n' +
    '- aura: area damage without attack or save; no lasting aura or effect is created. Needs featureName, damageParts, areaType, areaSize.\n' +
    '- spellcasting: casting ability and caster level of an NPC without class items, per class, level and rules version (2024 paladins ' +
    'and rangers have slots at level 1). dnd5e derives the slots; actors with class items are refused. Needs spellcastingClass, spellcastingLevel.\n' +
    '- spells: copy spells by English name from compendiums. Needs spellNames.\n' +
    'An item name the actor already has (ignoring case) is refused. The actor is found by id, exact name or token id, never by part of ' +
    'a name. Everything written is read back. Run spellcasting before spells.',
  inputSchema: addFeatureSchema,
  annotations: writingTool('Add a D&D 5e feature', { destructive: false, idempotent: false }),
  handler: async (args, context) => {
    const check = checkFeatureArguments(args);
    if (check.problems.length || !check.featureType) {
      throw new Error(
        `Invalid arguments for dnd5e-add-feature: ${check.problems.join('; ')}. Nothing was changed.`
      );
    }
    await requireDnd5eWorld(context, 'dnd5e-add-feature');
    const mode = check.featureType;
    const data: Args = {
      featureType: mode,
      actorIdentifier: args['actorIdentifier'],
      ...withDefaults(addFeatureSchema, FEATURE_PARAMETERS[mode].uses, args),
    };
    // A module of the previous generation needs the ability computed by the server.
    if (mode === 'attack' || mode === 'attack-with-save')
      data['effectiveAbility'] =
        args['abilityModifier'] ?? (args['attackType'] === 'ranged' ? 'dex' : 'str');
    if (mode === 'spellcasting')
      data['effectiveAbility'] =
        args['spellcastingAbility'] ??
        CLASS_ABILITY[args['spellcastingClass'] as SpellcastingClass];

    const answer = await ask(
      context,
      FEATURE_QUERY[mode],
      data,
      `add the ${mode} feature to "${String(args['actorIdentifier'])}"`
    );
    if (mode === 'spells') return importResult(answer, 'spells');
    const moduleIgnored = Array.isArray(answer['ignoredParameters'])
      ? answer['ignoredParameters']
      : [];
    return { ...answer, ignoredParameters: [...new Set([...check.ignored, ...moduleIgnored])] };
  },
};

/** An import that added nothing and found or copied nothing either is an error, with every list. */
export function importResult(answer: Args, what: string): Args {
  const count = (field: string) => (Array.isArray(answer[field]) ? answer[field].length : 0);
  if (count('added') === 0 && (count('notFound') > 0 || count('failed') > 0)) {
    throw new Error(
      `No ${what} were added. ${typeof answer['summary'] === 'string' ? answer['summary'] : ''} ` +
        JSON.stringify({
          notFound: answer['notFound'],
          failed: answer['failed'],
          skipped: answer['skipped'],
          warnings: answer['warnings'],
        })
    );
  }
  return answer;
}

export const addFeaturesFromCompendiumTool: ToolDefinition = {
  name: 'dnd5e-add-features-from-compendium',
  title: 'Add D&D 5e features from compendiums',
  group: 'systems',
  description:
    '[D&D 5e only] Copy class and monster features by English name from item compendiums onto an actor, such as "Pack Tactics", ' +
    '"Multiattack" or "Action Surge". Names match whole and ignoring case; the first compendium in compendiumPacks with the name wins, ' +
    'and two entries of that name in one compendium are reported instead of guessed. Without compendiumPacks the standard compendiums ' +
    "of the world's rules version are searched (2024 class features are part of the class items and cannot be fetched one by one). " +
    'Items the actor already has by name are skipped. Copies keep a link to their entry, never its id. The answer lists added, skipped, ' +
    'not found and failed names; for spells use dnd5e-add-feature with featureType "spells", for homebrew features featureType "passive" and the others.',
  inputSchema: addFeaturesFromCompendiumSchema,
  annotations: writingTool('Add D&D 5e features from compendiums', {
    destructive: false,
    idempotent: false,
  }),
  handler: async (args, context) => {
    await requireDnd5eWorld(context, 'dnd5e-add-features-from-compendium');
    const data = withDefaults(
      addFeaturesFromCompendiumSchema,
      ['actorIdentifier', 'featureNames', 'compendiumPacks'],
      args
    );
    const answer = await ask(
      context,
      'addFeaturesFromCompendium',
      data,
      `add features to "${String(args['actorIdentifier'])}"`
    );
    return importResult(answer, 'features');
  },
};
