/**
 * setActorSpellcasting: dnd5e-add-feature with featureType "spellcasting".
 *
 * dnd5e 5.x derives spell slots; writing slot maxima does nothing but hide the
 * derivation behind overrides. What an NPC without class items stores is its
 * spellcasting ability and its caster level (`attributes.spell.level`, before
 * dnd5e 5.1 `details.spellLevel`); dnd5e turns that level into slots of the
 * methods its spells use. So exactly those two values are written, per rules
 * version, and read back.
 *
 * Multiclass safe: slots of an actor with class items come from those items.
 * Such an actor is refused instead of receiving values that would contradict
 * its classes, and slot overrides are never touched, only reported.
 */
import {
  ABILITY_KEYS,
  CLASS_ABILITY,
  SPELLCASTING_CLASSES,
  describeSlots,
  isRecord,
  planSpellcasting,
  versionAtLeast,
  type AbilityKey,
  type RulesVersion,
  type SpellcastingClass,
} from '../../../common/areas/dnd5e/rules.js';
import { checkFeatureArguments } from '../../../common/areas/dnd5e/feature-data.js';
import { QueryError, type QueryHandler } from '../../dispatcher.js';
import { textOf, valueAt } from '../actors/common.js';
import { findActor } from '../actors/lookup.js';
import { callData, invalid, requireDnd5e, worldRules } from './common.js';

const TOOL = 'dnd5e-add-feature';

export const setActorSpellcasting: QueryHandler = {
  access: { kind: 'write', document: 'Actors', action: 'update' },
  run: async (data, context) => {
    const system = requireDnd5e(TOOL);
    const input: Record<string, unknown> = { ...callData(data), featureType: 'spellcasting' };
    const check = checkFeatureArguments(input);
    const problems = [...check.problems];

    const spellClass = input['spellcastingClass'];
    if (
      spellClass !== undefined &&
      !(SPELLCASTING_CLASSES as readonly unknown[]).includes(spellClass)
    )
      problems.push(`spellcastingClass must be one of ${SPELLCASTING_CLASSES.join(', ')}`);
    const level = input['spellcastingLevel'];
    if (
      level !== undefined &&
      (typeof level !== 'number' || !Number.isInteger(level) || level < 1 || level > 20)
    )
      problems.push('spellcastingLevel must be a whole number from 1 to 20');
    const rulesGiven = input['sourceRules'];
    if (rulesGiven !== undefined && rulesGiven !== '2014' && rulesGiven !== '2024')
      problems.push('sourceRules must be "2014" or "2024"');
    const abilityGiven = input['spellcastingAbility'] ?? input['effectiveAbility'];
    if (abilityGiven !== undefined && !(ABILITY_KEYS as readonly unknown[]).includes(abilityGiven))
      problems.push(`spellcastingAbility must be one of ${ABILITY_KEYS.join(', ')}`);
    if (problems.length) throw invalid('Cannot set up spellcasting', problems);

    const rules: RulesVersion =
      rulesGiven === '2014' || rulesGiven === '2024' ? rulesGiven : (worldRules() ?? '2014');
    const cls = spellClass as SpellcastingClass;
    const plan = planSpellcasting(
      cls,
      level as number,
      rules,
      (abilityGiven as AbilityKey | undefined) ?? CLASS_ABILITY[cls]
    );

    const match = findActor(textOf(input['actorIdentifier']));
    const actor = match.actor;
    const classes = actor.items.filter(item => item.type === 'class');
    if (classes.length) {
      throw new QueryError(
        'HAS_CLASSES',
        `Actor "${actor.name}" (id ${actor.id}) has class items (${classes.map(item => `"${item.name}"`).join(', ')}); dnd5e derives its spell slots and ` +
          'spellcasting ability from them, per class and level, also for multiclass characters. Nothing was changed. Change the level of the class item instead.'
      );
    }
    if (actor.type !== 'npc') {
      throw new QueryError(
        'WRONG_ACTOR_TYPE',
        `Spellcasting without class items exists only for dnd5e NPCs; "${actor.name}" is a "${actor.type}". Nothing was changed. Add a class item instead.`
      );
    }

    const source = actor.toObject();
    const levelPath = versionAtLeast(system.version, 5, 1)
      ? 'attributes.spell.level'
      : 'details.spellLevel';
    const before = {
      spellcasting: valueAt(source, 'system.attributes.spellcasting') ?? null,
      casterLevel: valueAt(source, `system.${levelPath}`) ?? null,
    };

    const warnings = [...plan.warnings];
    const spells =
      isRecord(source['system']) && isRecord(source['system']['spells'])
        ? source['system']['spells']
        : {};
    const overrides = Object.entries(spells)
      .filter(([, slot]) => isRecord(slot) && typeof slot['override'] === 'number')
      .map(([key, slot]) => `${key} = ${String((slot as Record<string, unknown>)['override'])}`);
    if (overrides.length) {
      warnings.push(
        `The actor has slot overrides (${overrides.join(', ')}); they win over the derived slots and were left unchanged.`
      );
    }
    const methods = new Set(
      actor.items
        .filter(item => item.type === 'spell')
        .map(item => (isRecord(item.system) ? textOf(item.system['method']) : ''))
        .filter(Boolean)
    );
    if (plan.kind === 'pact' && [...methods].some(method => method !== 'pact')) {
      warnings.push(
        'Some spells of the actor are not pact spells; dnd5e gives an NPC slots for the methods its spells use, so those get leveled slots from the same caster level.'
      );
    }
    if (plan.kind === 'leveled' && methods.has('pact')) {
      warnings.push(
        'The actor has pact spells; dnd5e gives them pact slots from the same caster level.'
      );
    }

    await actor.update({
      'system.attributes.spellcasting': plan.ability,
      [`system.${levelPath}`]: plan.casterLevel,
    });
    const stored = actor.toObject();
    const storedAbility = valueAt(stored, 'system.attributes.spellcasting');
    const storedLevel = valueAt(stored, `system.${levelPath}`);
    if (storedAbility !== plan.ability || storedLevel !== plan.casterLevel) {
      throw new QueryError(
        'NOT_APPLIED',
        `dnd5e did not keep the spellcasting of "${actor.name}": wrote ability ${plan.ability} and ${levelPath} ${plan.casterLevel}, ` +
          `read back ${JSON.stringify(storedAbility)} and ${JSON.stringify(storedLevel)}.`
      );
    }

    context.recordChange({
      query: 'setActorSpellcasting',
      tool: TOOL,
      document: 'Actors',
      action: 'update',
      targets: [{ id: actor.id, uuid: actor.uuid, name: actor.name, documentName: 'Actor' }],
      summary: `Set the spellcasting of "${actor.name}" to ${cls} ${String(level)} (${rules} rules).`,
      before,
      after: { spellcasting: plan.ability, casterLevel: plan.casterLevel },
    });

    const slots = plan.kind === 'pact' ? { pact: plan.pact } : plan.slots;
    return {
      success: true,
      summary: `Spellcasting of "${actor.name}": ${cls} level ${String(level)}, ${plan.ability.toUpperCase()}, ${describeSlots(plan)} (${rules} rules).`,
      actor: { id: actor.id, name: actor.name, via: match.via },
      spellcasting: {
        class: cls,
        level,
        rules,
        ability: plan.ability,
        kind: plan.kind,
        casterLevel: plan.casterLevel,
        written: {
          'system.attributes.spellcasting': plan.ability,
          [`system.${levelPath}`]: plan.casterLevel,
        },
        slots,
        slotsText: describeSlots(plan),
        derivedBy:
          'dnd5e derives the slots from the caster level; these are the numbers of the rules tables.',
      },
      warnings,
      ignoredParameters: check.ignored,
    };
  },
};
