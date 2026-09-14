import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROLL_NOTIFY_LEVELS, TOKENS_DICE_EN } from './texts.js';

const read = (code: string) =>
  JSON.parse(readFileSync(new URL(`./lang.${code}.json`, import.meta.url), 'utf8')) as Record<
    string,
    unknown
  >;

function keys(node: unknown, prefix = ''): string[] {
  if (typeof node !== 'object' || node === null) return [prefix];
  return Object.entries(node).flatMap(([key, value]) =>
    keys(value, prefix ? `${prefix}.${key}` : key)
  );
}

describe('texts of the tokens-dice area', () => {
  it('keeps the fallback table equal to lang.en.json', () => {
    expect(read('en')).toEqual(TOKENS_DICE_EN);
  });

  it('has the same keys in German, a level for every notification and no dashes', () => {
    expect(keys(read('de'))).toEqual(keys(read('en')));
    const notify = Object.keys(TOKENS_DICE_EN['ninjos-foundry-mcp']['tokens-dice'].notify);
    expect(Object.keys(ROLL_NOTIFY_LEVELS).sort()).toEqual(notify.sort());
    for (const code of ['de', 'en']) expect(JSON.stringify(read(code))).not.toMatch(/[–—]/);
  });
});
