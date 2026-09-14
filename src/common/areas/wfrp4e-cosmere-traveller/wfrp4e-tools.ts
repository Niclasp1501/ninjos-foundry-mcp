/**
 * What wfrp4e-update-actor and wfrp4e-add-items decide, without Foundry:
 * checking the arguments, planning the writes, choosing compendium entries.
 * The module handlers only load documents, write, and read back.
 *
 * Rules:
 * - Skills and careers are found by name trimmed and ignoring case; two items
 *   of that name are reported, never guessed between.
 * - A compendium name is never guessed between types: the same name as two
 *   types without `type` is skipped with every candidate.
 * - Two entries of one name and type in one compendium are ambiguous as well.
 *   The same name and type in several compendiums takes the first by
 *   priority (wfrp4e-core first) and names the others.
 * - Created items are matched by name and type, never by position.
 */
import {
  CHARACTERISTIC_KEYS,
  GEAR_TYPES,
  characteristic,
  characteristicsOf,
  wfrp4eAdapter,
  type CharacteristicKey,
} from './wfrp4e.js';
import { at, idOf, isRecord, itemsOf, num, sameName, systemOf, text, type Data } from './shared.js';

const PARTS = ['initial', 'advances', 'modifier'] as const;

function wholeNumber(value: unknown, path: string, problems: string[], min: number | null): void {
  if (value === undefined) return;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    problems.push(`${path}: must be a whole number, got ${JSON.stringify(value)}`);
  } else if (min !== null && value < min) {
    problems.push(`${path}: must be at least ${min}, got ${value}`);
  }
}

/** Every problem of wfrp4e-update-actor arguments; empty when they can be sent. */
export function checkUpdateArguments(args: Data): string[] {
  const problems: string[] = [];
  if (!text(args['actor']).trim()) problems.push('actor: an actor name or id is required');
  const given = ['characteristics', 'wounds', 'skills', 'career', 'movement', 'biography'].filter(
    key => args[key] !== undefined
  );
  if (!given.length) {
    problems.push(
      'Nothing to update: provide characteristics, wounds, skills, career, movement and/or biography.'
    );
    return problems;
  }
  const characteristics = args['characteristics'];
  if (characteristics !== undefined) {
    if (!isRecord(characteristics)) problems.push('characteristics: must be an object');
    else {
      const unknown = Object.keys(characteristics).filter(
        key => !(CHARACTERISTIC_KEYS as readonly string[]).includes(key)
      );
      if (unknown.length)
        problems.push(
          `Unknown characteristic key(s): ${unknown.join(', ')}. Valid keys: ${CHARACTERISTIC_KEYS.join(', ')}.`
        );
      for (const [key, entry] of Object.entries(characteristics)) {
        if (!isRecord(entry) || !PARTS.some(part => entry[part] !== undefined)) {
          problems.push(`characteristics.${key}: set initial, advances and/or modifier`);
          continue;
        }
        wholeNumber(entry['initial'], `characteristics.${key}.initial`, problems, 0);
        wholeNumber(entry['advances'], `characteristics.${key}.advances`, problems, 0);
        wholeNumber(entry['modifier'], `characteristics.${key}.modifier`, problems, null);
      }
    }
  }
  const wounds = args['wounds'];
  if (wounds !== undefined) {
    if (!isRecord(wounds) || (wounds['value'] === undefined && wounds['max'] === undefined))
      problems.push('wounds: set value and/or max');
    else {
      wholeNumber(wounds['value'], 'wounds.value', problems, 0);
      wholeNumber(wounds['max'], 'wounds.max', problems, 0);
    }
  }
  if (args['skills'] !== undefined) {
    if (!Array.isArray(args['skills'])) problems.push('skills: must be a list');
    else
      args['skills'].forEach((skill, index) => {
        if (!isRecord(skill) || !text(skill['name']).trim())
          problems.push(`skills[${index}].name: a skill name is required`);
        else wholeNumber(skill['advances'], `skills[${index}].advances`, problems, 0);
      });
  }
  if (args['career'] !== undefined && !text(args['career']).trim())
    problems.push('career: must name a career item of the actor');
  wholeNumber(args['movement'], 'movement', problems, 0);
  if (args['biography'] !== undefined && typeof args['biography'] !== 'string')
    problems.push('biography: must be a text');
  return problems;
}

export interface AppliedChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface Expected {
  /** Item id, or null for the actor. */
  itemId: string | null;
  path: string;
  value: unknown;
}

export interface UpdatePlan {
  /** Dotted keys for actor.update. */
  actor: Data;
  /** Updates for updateEmbeddedDocuments("Item"). */
  items: Data[];
  applied: AppliedChange[];
  expected: Expected[];
  warnings: string[];
}

function describeItems(items: Data[]): string {
  return items.map(item => `"${text(item['name'])}" (id ${idOf(item)})`).join(', ');
}

/** The writes for wfrp4e-update-actor on this actor data (`toObject()`). */
export function planUpdate(actor: Data, args: Data): UpdatePlan {
  const system = systemOf(actor);
  const items = itemsOf(actor);
  const plan: UpdatePlan = { actor: {}, items: [], applied: [], expected: [], warnings: [] };
  const setActor = (path: string, value: unknown, field: string, from: unknown) => {
    plan.actor[`system.${path}`] = value;
    plan.applied.push({ field, from: from ?? null, to: value });
    plan.expected.push({ itemId: null, path: `system.${path}`, value });
  };

  if (isRecord(args['characteristics'])) {
    for (const [key, entry] of Object.entries(args['characteristics'])) {
      if (!isRecord(entry)) continue;
      for (const part of PARTS) {
        if (typeof entry[part] !== 'number') continue;
        const current = characteristic(system, key as CharacteristicKey);
        setActor(
          `characteristics.${key}.${part}`,
          entry[part],
          `characteristics.${key}.${part}`,
          current[part]
        );
      }
    }
  }
  if (isRecord(args['wounds'])) {
    for (const part of ['value', 'max'] as const) {
      const value = args['wounds'][part];
      if (typeof value === 'number')
        setActor(
          `status.wounds.${part}`,
          value,
          `wounds.${part}`,
          num(at(system, `status.wounds.${part}`))
        );
    }
    if (
      typeof args['wounds']['max'] === 'number' &&
      at(system, 'settings.autoCalc.wounds') !== false
    ) {
      plan.warnings.push(
        'wfrp4e recomputes maximum wounds from the Strength, Toughness and Willpower bonuses while system.settings.autoCalc.wounds is on, ' +
          'so the sheet may show another maximum than the one stored. Set system.settings.autoCalc.wounds to false with manage-actors to keep it.'
      );
    }
  }
  if (typeof args['movement'] === 'number')
    setActor(
      'details.move.value',
      args['movement'],
      'movement',
      num(at(system, 'details.move.value'))
    );
  if (typeof args['biography'] === 'string') {
    const before = text(at(system, 'details.biography.value'));
    plan.actor['system.details.biography.value'] = args['biography'];
    plan.applied.push({
      field: 'biography',
      from: { length: before.length },
      to: { length: args['biography'].length },
    });
    plan.expected.push({
      itemId: null,
      path: 'system.details.biography.value',
      value: args['biography'],
    });
  }

  if (Array.isArray(args['skills'])) {
    const skills = items.filter(item => item['type'] === 'skill');
    for (const request of args['skills']) {
      if (!isRecord(request) || typeof request['advances'] !== 'number') continue;
      const name = text(request['name']);
      const found = skills.filter(item => sameName(item['name'], name));
      if (found.length === 0) {
        plan.warnings.push(
          `Skill "${name}" is not on the actor and was skipped; add it with wfrp4e-add-items.`
        );
        continue;
      }
      if (found.length > 1) {
        plan.warnings.push(
          `Skill "${name}" is on the actor ${found.length} times (${describeItems(found)}) and was skipped; nothing is guessed.`
        );
        continue;
      }
      const skill = found[0] as Data;
      const id = idOf(skill);
      plan.items.push({ _id: id, 'system.advances.value': request['advances'] });
      plan.applied.push({
        field: `skills.${text(skill['name'])}.advances`,
        from: num(at(skill, 'system.advances.value')),
        to: request['advances'],
      });
      plan.expected.push({ itemId: id, path: 'system.advances.value', value: request['advances'] });
    }
  }

  if (typeof args['career'] === 'string') {
    const careers = items.filter(item => item['type'] === 'career');
    const found = careers.filter(item => sameName(item['name'], args['career']));
    if (found.length !== 1) {
      plan.warnings.push(
        found.length
          ? `Career "${args['career']}" is on the actor ${found.length} times (${describeItems(found)}) and was skipped; nothing is guessed.`
          : `Career "${args['career']}" is not on the actor and was skipped; add it with wfrp4e-add-items (setCurrent true). Careers of the actor: ${describeItems(careers) || 'none'}.`
      );
    } else {
      const chosen = idOf(found[0] as Data);
      for (const career of careers) {
        const wanted = idOf(career) === chosen;
        const current = at(career, 'system.current.value') === true;
        if (wanted !== current)
          plan.items.push({ _id: idOf(career), 'system.current.value': wanted });
        plan.expected.push({ itemId: idOf(career), path: 'system.current.value', value: wanted });
      }
      const before = careers.find(career => at(career, 'system.current.value') === true);
      plan.applied.push({
        field: 'career',
        from: before ? text(before['name']) : null,
        to: text((found[0] as Data)['name']),
      });
    }
  }
  return plan;
}

/** Stored values that do not read back as planned. */
export function unmatched(plan: UpdatePlan, readBack: Data): Array<Expected & { stored: unknown }> {
  const items = itemsOf(readBack);
  return plan.expected
    .map(entry => {
      const holder =
        entry.itemId === null ? readBack : items.find(item => idOf(item) === entry.itemId);
      return { ...entry, stored: holder ? (at(holder, entry.path) ?? null) : null };
    })
    .filter(entry => JSON.stringify(entry.stored) !== JSON.stringify(entry.value));
}

/** Value and bonus of each characteristic, from prepared data when given, else by the formula. */
export function characteristicTotals(
  system: Data
): Record<string, { value: number; bonus: number; computed: boolean }> {
  return Object.fromEntries(
    Object.entries(characteristicsOf(system)).map(([key, entry]) => [
      key,
      { value: entry.value, bonus: entry.bonus, computed: entry.computed },
    ])
  );
}

// wfrp4e-add-items -----------------------------------------------------------------------------------

export interface AddRequest {
  name: string;
  type?: string;
  pack?: string;
  advances?: number;
  quantity?: number;
  setCurrent?: boolean;
}

export const MAX_ADD_ITEMS = 50;

export function checkAddArguments(args: Data): { requests: AddRequest[]; problems: string[] } {
  const problems: string[] = [];
  if (!text(args['actor']).trim()) problems.push('actor: an actor name or id is required');
  const list = args['items'];
  if (!Array.isArray(list) || list.length === 0) {
    problems.push('items: list at least one item');
    return { requests: [], problems };
  }
  if (list.length > MAX_ADD_ITEMS)
    problems.push(`items: at most ${MAX_ADD_ITEMS} per call, got ${list.length}`);
  const requests: AddRequest[] = [];
  list.forEach((entry, index) => {
    if (!isRecord(entry) || !text(entry['name']).trim()) {
      problems.push(`items[${index}].name: an item name is required`);
      return;
    }
    wholeNumber(entry['advances'], `items[${index}].advances`, problems, 0);
    wholeNumber(entry['quantity'], `items[${index}].quantity`, problems, 0);
    const request: AddRequest = { name: text(entry['name']).trim() };
    if (text(entry['type']).trim()) request.type = text(entry['type']).trim().toLowerCase();
    if (text(entry['pack']).trim()) request.pack = text(entry['pack']).trim();
    if (typeof entry['advances'] === 'number') request.advances = entry['advances'];
    if (typeof entry['quantity'] === 'number') request.quantity = entry['quantity'];
    if (typeof entry['setCurrent'] === 'boolean') request.setCurrent = entry['setCurrent'];
    requests.push(request);
  });
  return { requests, problems };
}

export interface IndexedPack {
  id: string;
  label: string;
  entries: ReadonlyArray<{ _id: string; name?: string; type?: string }>;
}

/** Item compendiums in search order: wfrp4e-core first, then other wfrp4e ones, then the rest, each in Foundry's order. */
export function orderPacks<T extends { id: string }>(packs: readonly T[]): T[] {
  const priority = wfrp4eAdapter.compendiums?.priority ?? (() => 0);
  return packs
    .map((pack, position) => ({ pack, position, rank: priority(pack.id) }))
    .sort((a, b) => b.rank - a.rank || a.position - b.position)
    .map(entry => entry.pack);
}

/** "Entertain (Taunt)" has the grouped template "Entertain ()". */
export function groupedTemplate(name: string): string | null {
  const match = /^(.*\S)\s*\(([^()]*\S[^()]*)\)\s*$/.exec(name);
  return match ? `${match[1]} ()` : null;
}

export interface Candidate {
  packId: string;
  packLabel: string;
  id: string;
  name: string;
  type: string;
}

export type ItemMatch =
  | { kind: 'found'; candidate: Candidate; grouped: boolean; alsoIn: string[] }
  | { kind: 'ambiguous'; reason: string; candidates: Candidate[] }
  | { kind: 'notFound' };

export function matchItem(request: AddRequest, packs: readonly IndexedPack[]): ItemMatch {
  const lookup = (name: string): Candidate[] =>
    packs.flatMap(pack =>
      pack.entries
        .filter(
          entry =>
            sameName(entry.name, name) &&
            (!request.type || (entry.type ?? '').toLowerCase() === request.type)
        )
        .map(entry => ({
          packId: pack.id,
          packLabel: pack.label,
          id: entry._id,
          name: entry.name ?? name,
          type: entry.type ?? '',
        }))
    );
  let candidates = lookup(request.name);
  let grouped = false;
  if (!candidates.length) {
    const template = groupedTemplate(request.name);
    if (template) {
      candidates = lookup(template);
      grouped = candidates.length > 0;
    }
  }
  if (!candidates.length) return { kind: 'notFound' };
  const types = [...new Set(candidates.map(candidate => candidate.type))];
  if (types.length > 1) {
    return {
      kind: 'ambiguous',
      reason: `"${request.name}" exists as ${types.join(', ')}; pass "type" to choose`,
      candidates,
    };
  }
  const first = candidates[0] as Candidate;
  const inFirstPack = candidates.filter(candidate => candidate.packId === first.packId);
  if (inFirstPack.length > 1) {
    return {
      kind: 'ambiguous',
      reason: `compendium "${first.packId}" has ${inFirstPack.length} entries named "${first.name}" of type ${first.type}`,
      candidates: inFirstPack,
    };
  }
  const alsoIn = [
    ...new Set(candidates.map(candidate => candidate.packId).filter(id => id !== first.packId)),
  ];
  return { kind: 'found', candidate: first, grouped, alsoIn };
}

/** Data of the item to create, from the compendium entry or blank, with the requested extras. */
export function itemData(
  request: AddRequest,
  source: Data | null
): { data: Data; warnings: string[] } {
  const warnings: string[] = [];
  const data: Data = source
    ? {
        name: request.name,
        type: source['type'],
        ...(source['img'] ? { img: source['img'] } : {}),
        system: structuredClone(isRecord(source['system']) ? source['system'] : {}),
        effects: structuredClone(Array.isArray(source['effects']) ? source['effects'] : []),
        flags: structuredClone(isRecord(source['flags']) ? source['flags'] : {}),
      }
    : { name: request.name, type: request.type ?? 'trapping', system: {} };
  const type = text(data['type']);
  const system = data['system'] as Data;
  const nest = (field: string, value: unknown) => {
    system[field] = { ...(isRecord(system[field]) ? system[field] : {}), value };
  };
  if (request.advances !== undefined) {
    if (type === 'skill') nest('advances', request.advances);
    else
      warnings.push(
        `"${request.name}": advances only apply to skills and were ignored for a ${type}.`
      );
  }
  if (request.quantity !== undefined) {
    if ((GEAR_TYPES as readonly string[]).includes(type)) nest('quantity', request.quantity);
    else
      warnings.push(
        `"${request.name}": quantity only applies to ${GEAR_TYPES.join(', ')} and was ignored for a ${type}.`
      );
  }
  if (request.setCurrent !== undefined) {
    if (type === 'career') nest('current', request.setCurrent);
    else
      warnings.push(
        `"${request.name}": setCurrent only applies to careers and was ignored for a ${type}.`
      );
  }
  return { data, warnings };
}
