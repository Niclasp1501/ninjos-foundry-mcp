/**
 * Creature filters: read what the model sent, compare it against index rows.
 *
 * Generic on purpose. An adapter declares its filters; how a range, a text or
 * a minimum compares is the same for every system. Values arrive from models
 * as numbers, numbers in texts, "true" and "false" or JSON in a text, and are
 * accepted in all those forms. Anything that cannot be read is a validation
 * error naming the value; a filter the active system does not know is
 * reported as ignored.
 */
import type { CreatureFilterSpec, CreatureRow } from './adapter.js';

export type FilterValue =
  | { kind: 'exact'; value: number }
  | { kind: 'range'; min: number; max: number }
  | { kind: 'text'; value: string }
  | { kind: 'partialText'; value: string }
  | { kind: 'textList'; values: string[] }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'min'; value: number }
  | { kind: 'minEach'; values: Record<string, number> };

export interface ActiveFilter {
  spec: CreatureFilterSpec;
  value: FilterValue;
}

export interface IgnoredFilter {
  name: string;
  reason: string;
}

export interface FilterReading {
  active: ActiveFilter[];
  ignored: IgnoredFilter[];
  problems: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const fraction = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(value);
    if (fraction) return Number(fraction[1]) / Number(fraction[2]);
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

function shown(value: unknown): string {
  return JSON.stringify(value) ?? String(value);
}

/** Read one value by the kind of its filter. Returns the problem as text when it cannot. */
export function readFilterValue(spec: CreatureFilterSpec, raw: unknown): FilterValue | string {
  const bad = (expected: string) => `${spec.name} must be ${expected}, got ${shown(raw)}`;
  switch (spec.kind) {
    case 'numberOrRange': {
      let value = raw;
      if (typeof value === 'string' && value.trim().startsWith('{')) {
        try {
          value = JSON.parse(value);
        } catch {
          return bad('a number or a range {"min": n, "max": n}');
        }
      }
      const exact = toNumber(value);
      if (exact !== null) return { kind: 'exact', value: exact };
      if (isRecord(value)) {
        const min =
          value['min'] === undefined ? (spec.defaults?.min ?? -Infinity) : toNumber(value['min']);
        const max =
          value['max'] === undefined ? (spec.defaults?.max ?? Infinity) : toNumber(value['max']);
        if (min === null || max === null) return bad('a range whose min and max are numbers');
        if (min > max) return `${spec.name} has min ${min} above max ${max}`;
        return { kind: 'range', min, max };
      }
      return bad('a number or a range {"min": n, "max": n}');
    }
    case 'text':
    case 'partialText':
      return typeof raw === 'string' && raw.trim() !== ''
        ? { kind: spec.kind, value: raw.trim().toLowerCase() }
        : bad('a non-empty text');
    case 'textList': {
      const list = typeof raw === 'string' ? raw.split(',') : raw;
      if (!Array.isArray(list) || list.some(item => typeof item !== 'string'))
        return bad('a list of texts');
      const values = list.map(item => (item as string).trim().toLowerCase()).filter(Boolean);
      return values.length ? { kind: 'textList', values } : bad('a list with at least one text');
    }
    case 'boolean':
      if (raw === true || raw === 'true') return { kind: 'boolean', value: true };
      if (raw === false || raw === 'false') return { kind: 'boolean', value: false };
      return bad('true or false');
    case 'min': {
      const value = toNumber(raw);
      return value === null ? bad('a number') : { kind: 'min', value };
    }
    case 'minEach': {
      if (!isRecord(raw)) return bad('an object of numbers');
      const values: Record<string, number> = {};
      for (const [key, item] of Object.entries(raw)) {
        const value = toNumber(item);
        if (value === null) return `${spec.name}.${key} must be a number, got ${shown(item)}`;
        values[key] = value;
      }
      return { kind: 'minEach', values };
    }
  }
}

/**
 * Split the given filters into the ones the adapter declares and the ones it
 * does not. `why` names the reason for an undeclared filter.
 */
export function readFilters(
  specs: readonly CreatureFilterSpec[],
  input: Readonly<Record<string, unknown>>,
  why: (name: string) => string
): FilterReading {
  const reading: FilterReading = { active: [], ignored: [], problems: [] };
  for (const [name, raw] of Object.entries(input)) {
    if (raw === undefined || raw === null) continue;
    const spec = specs.find(candidate => candidate.name === name);
    if (!spec) {
      reading.ignored.push({ name, reason: why(name) });
      continue;
    }
    const value = readFilterValue(spec, raw);
    if (typeof value === 'string') reading.problems.push(value);
    else reading.active.push({ spec, value });
  }
  return reading;
}

export function matchesFilter(
  filter: ActiveFilter,
  row: Readonly<Record<string, unknown>>
): boolean {
  const field = row[filter.spec.field];
  const value = filter.value;
  switch (value.kind) {
    case 'exact':
      return toNumber(field) === value.value;
    case 'range': {
      const number = toNumber(field);
      return number !== null && number >= value.min && number <= value.max;
    }
    case 'text':
      return typeof field === 'string' && field.trim().toLowerCase() === value.value;
    case 'partialText':
      return typeof field === 'string' && field.toLowerCase().includes(value.value);
    case 'textList': {
      const have = Array.isArray(field)
        ? field.filter(item => typeof item === 'string').map(item => (item as string).toLowerCase())
        : [];
      return value.values.every(wanted => have.includes(wanted));
    }
    case 'boolean':
      return (field === true) === value.value;
    case 'min': {
      const number = toNumber(field);
      return number !== null && number >= value.value;
    }
    case 'minEach':
      return Object.entries(value.values).every(([key, minimum]) => {
        const number = isRecord(field) ? toNumber(field[key]) : null;
        return number !== null && number >= minimum;
      });
  }
}

export function matchesAll(
  filters: readonly ActiveFilter[],
  row: Readonly<CreatureRow> | Readonly<Record<string, unknown>>
): boolean {
  return filters.every(filter => matchesFilter(filter, row));
}

/** The filters as they were understood, for the answer. */
export function describeFilters(filters: readonly ActiveFilter[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const { spec, value } of filters) {
    switch (value.kind) {
      case 'exact':
      case 'text':
      case 'partialText':
      case 'boolean':
      case 'min':
        out[spec.name] = value.value;
        break;
      case 'range':
        out[spec.name] = { min: value.min, max: value.max };
        break;
      case 'textList':
      case 'minEach':
        out[spec.name] = value.values;
        break;
    }
  }
  return out;
}
