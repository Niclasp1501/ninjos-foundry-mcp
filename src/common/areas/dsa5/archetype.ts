/**
 * A hero from an archetype: the customization of create-dsa5-character-from-archetype
 * checked and turned into the fields of the dsa5 data model, without Foundry.
 *
 * The original built the customization and never applied it;
 * here every given value lands in `system.details.<field>.value` and is read back.
 */
import { isRecord, num, text, type Data } from './rules.js';

export const GENDERS = ['male', 'female', 'diverse'] as const;

/** Customization key, the details field it writes, and how it is stored. */
export const CUSTOMIZATION_FIELDS: ReadonlyArray<{
  key: string;
  field: string;
  kind: 'text' | 'number';
}> = [
  { key: 'age', field: 'age', kind: 'number' },
  { key: 'biography', field: 'biography', kind: 'text' },
  { key: 'gender', field: 'gender', kind: 'text' },
  { key: 'eyeColor', field: 'eyecolor', kind: 'text' },
  { key: 'hairColor', field: 'haircolor', kind: 'text' },
  { key: 'height', field: 'height', kind: 'number' },
  { key: 'weight', field: 'weight', kind: 'number' },
  { key: 'species', field: 'species', kind: 'text' },
  { key: 'culture', field: 'culture', kind: 'text' },
  { key: 'profession', field: 'career', kind: 'text' },
];

export interface CheckedCustomization {
  /** details path (without `system.`) to the stored text. */
  values: Record<string, string>;
  problems: string[];
  ignored: string[];
}

/** Every problem at once; nothing is guessed. dsa5 stores all these details as text. */
export function checkCustomization(raw: unknown): CheckedCustomization {
  const result: CheckedCustomization = { values: {}, problems: [], ignored: [] };
  if (raw === undefined || raw === null) return result;
  if (!isRecord(raw)) {
    result.problems.push('customization must be an object');
    return result;
  }
  const known = new Set(CUSTOMIZATION_FIELDS.map(field => field.key));
  for (const key of Object.keys(raw)) if (!known.has(key)) result.ignored.push(key);
  for (const { key, field, kind } of CUSTOMIZATION_FIELDS) {
    const value = raw[key];
    if (value === undefined || value === null) continue;
    if (kind === 'number') {
      const number = num(value);
      if (number === null || number <= 0) {
        result.problems.push(
          `customization.${key} must be a positive number, got ${JSON.stringify(value)}`
        );
        continue;
      }
      if (key === 'age' && (number < 12 || number > 100)) {
        result.problems.push(`customization.age must be from 12 to 100, got ${number}`);
        continue;
      }
      result.values[`details.${field}.value`] = String(number);
      continue;
    }
    if (typeof value !== 'string' || !value.trim()) {
      result.problems.push(`customization.${key} must be a non-empty text`);
      continue;
    }
    if (key === 'gender' && !(GENDERS as readonly string[]).includes(value)) {
      result.problems.push(
        `customization.gender must be one of ${GENDERS.join(', ')}, got "${value}"`
      );
      continue;
    }
    result.values[`details.${field}.value`] = key === 'biography' ? value : value.trim();
  }
  return result;
}

/**
 * The world actor from the stored archetype: without id, folder, sort,
 * ownership and stats of the entry, linked to its origin, with the new name on
 * the actor and its prototype token, and the customization written.
 */
export function heroData(
  archetype: Data,
  options: { name: string; folder: string | null; origin: string; values: Record<string, string> }
): Data {
  const data = structuredClone(archetype);
  for (const key of ['_id', 'folder', 'sort', 'ownership', '_stats']) delete data[key];
  data['name'] = options.name;
  data['folder'] = options.folder;
  data['_stats'] = { compendiumSource: options.origin };
  if (isRecord(data['prototypeToken'])) data['prototypeToken']['name'] = options.name;
  const system: Data = isRecord(data['system']) ? data['system'] : {};
  data['system'] = system;
  for (const [path, value] of Object.entries(options.values)) {
    let node = system;
    const parts = path.split('.');
    for (const part of parts.slice(0, -1)) {
      if (!isRecord(node[part])) node[part] = {};
      node = node[part] as Data;
    }
    node[parts[parts.length - 1] as string] = value;
  }
  return data;
}

/** Stored values that differ from what was written. */
export function customizationMismatches(
  stored: Data,
  values: Record<string, string>
): Array<{ path: string; expected: string; stored: unknown }> {
  const system = isRecord(stored['system']) ? stored['system'] : {};
  return Object.entries(values).flatMap(([path, expected]) => {
    let node: unknown = system;
    for (const part of path.split('.')) node = isRecord(node) ? node[part] : undefined;
    return text(node) === expected
      ? []
      : [{ path: `system.${path}`, expected, stored: node ?? null }];
  });
}
