/**
 * Planning the entries of a new roll table: ranges, weights, formula, and
 * everything wrong with them. Pure, so it is tested without Foundry.
 *
 * Decisions:
 * - Overlapping ranges are refused. Two entries on the same number make one
 *   roll draw both, which is almost never meant and never visible afterwards.
 * - Gaps are created, but reported. A gap can be deliberate ("nothing
 *   happens"), and a reported gap is not a silent one.
 * - A formula that cannot reach an entry, or reaches a number without one, is
 *   reported as well.
 */

export interface PlannedResult {
  text: string;
  range: [number, number];
  weight: number;
}

export interface RollTablePlan {
  results: PlannedResult[];
  formula: string;
  formulaDerived: boolean;
  warnings: string[];
}

export class PlanError extends Error {
  override readonly name = 'PlanError';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function span([from, to]: readonly [number, number]): string {
  return from === to ? String(from) : `${from}-${to}`;
}

function label(index: number, result: PlannedResult): string {
  const text = result.text.length > 40 ? `${result.text.slice(0, 37)}...` : result.text;
  return `entry ${index + 1} "${text}" (${span(result.range)})`;
}

/** Numbers from `from` to `to` joined into spans, for messages. */
function spans(numbers: number[]): string {
  const out: string[] = [];
  for (const n of numbers) {
    const last = out.length ? out[out.length - 1] : undefined;
    const match = last?.match(/^(-?\d+)(?:-(-?\d+))?$/);
    const end = match ? Number(match[2] ?? match[1]) : NaN;
    if (match && end + 1 === n) out[out.length - 1] = `${match[1]}-${n}`;
    else out.push(String(n));
  }
  return out.join(', ');
}

/** The lowest and highest result of a plain `NdM` formula, or null for anything else. */
export function formulaBounds(formula: string): [number, number] | null {
  const match = formula.trim().match(/^(\d*)\s*d\s*(\d+)$/i);
  if (!match) return null;
  const count = match[1] ? Number(match[1]) : 1;
  const faces = Number(match[2]);
  if (count < 1 || faces < 1) return null;
  return [count, count * faces];
}

export function planRollTable(input: { results: unknown; formula?: unknown }): RollTablePlan {
  if (!Array.isArray(input.results) || input.results.length === 0)
    throw new PlanError('results needs at least one entry');

  const results: PlannedResult[] = [];
  let highest = 0;
  input.results.forEach((raw, index) => {
    const at = `results[${index}]`;
    if (!isRecord(raw)) throw new PlanError(`${at} must be an object with a text`);
    const text = typeof raw['text'] === 'string' ? raw['text'].trim() : '';
    if (!text) throw new PlanError(`${at}.text must be a text that is not empty`);

    let range: [number, number];
    if (raw['range'] === undefined || raw['range'] === null) {
      range = [highest + 1, highest + 1];
    } else {
      const given = raw['range'];
      if (
        !Array.isArray(given) ||
        given.length !== 2 ||
        !given.every(n => typeof n === 'number' && Number.isInteger(n))
      ) {
        throw new PlanError(
          `${at}.range must be exactly two whole numbers [from, to], got ${JSON.stringify(given)}`
        );
      }
      const [from, to] = given as [number, number];
      if (from > to) throw new PlanError(`${at}.range starts after it ends: [${from}, ${to}]`);
      range = [from, to];
    }

    let weight = 1;
    if (raw['weight'] !== undefined && raw['weight'] !== null) {
      const w = raw['weight'];
      if (typeof w !== 'number' || !Number.isInteger(w) || w < 1)
        throw new PlanError(
          `${at}.weight must be a whole number of at least 1, got ${JSON.stringify(w)}`
        );
      weight = w;
    }

    highest = Math.max(highest, range[1]);
    results.push({ text, range, weight });
  });

  const order = results
    .map((result, index) => ({ result, index }))
    .sort((a, b) => a.result.range[0] - b.result.range[0] || a.index - b.index);

  const overlaps: string[] = [];
  const gaps: number[] = [];
  for (let i = 1; i < order.length; i += 1) {
    const current = order[i] as (typeof order)[number];
    // The entry before that reaches furthest is the one an overlap is with.
    const previous = order
      .slice(0, i)
      .reduce((a, b) => (b.result.range[1] > a.result.range[1] ? b : a));
    const [from] = current.result.range;
    const reach = previous.result.range[1];
    if (from <= reach) {
      overlaps.push(
        `${label(previous.index, previous.result)} and ${label(current.index, current.result)} both cover ` +
          span([from, Math.min(reach, current.result.range[1])])
      );
    } else {
      for (let n = reach + 1; n < from; n += 1) gaps.push(n);
    }
  }
  if (overlaps.length) {
    throw new PlanError(
      `Ranges overlap: ${overlaps.join('; ')}. Each number may belong to one entry only, otherwise one roll ` +
        'draws several entries.'
    );
  }

  const givenFormula = typeof input.formula === 'string' ? input.formula.trim() : '';
  const lowest = (order[0] as (typeof order)[number]).result.range[0];
  const warnings: string[] = [];
  let formula = givenFormula;
  if (!formula) {
    if (highest < 1) {
      throw new PlanError(
        `No formula can be derived: the highest range ends at ${highest}. Pass a formula.`
      );
    }
    formula = `1d${highest}`;
  }

  if (gaps.length) {
    warnings.push(`No entry covers ${spans(gaps)}; a roll there draws nothing.`);
  }

  const bounds = formulaBounds(formula);
  if (bounds) {
    const [min, max] = bounds;
    const uncovered: number[] = [];
    for (let n = min; n < Math.min(lowest, max + 1); n += 1) uncovered.push(n);
    for (let n = Math.max(highest + 1, min); n <= max; n += 1) uncovered.push(n);
    if (uncovered.length)
      warnings.push(`The formula ${formula} can roll ${spans(uncovered)}, where no entry is.`);
    const unreachable = results
      .map((result, index) => ({ result, index }))
      .filter(({ result }) => result.range[1] < min || result.range[0] > max);
    if (unreachable.length) {
      warnings.push(
        `The formula ${formula} (${min}-${max}) can never roll ` +
          unreachable.map(({ result, index }) => label(index, result)).join(', ') +
          '.'
      );
    }
  } else {
    warnings.push(
      `The formula "${formula}" is not a plain dice formula like 2d6, so the ranges were not compared with it.`
    );
  }

  return { results, formula, formulaDerived: !givenFormula, warnings };
}
