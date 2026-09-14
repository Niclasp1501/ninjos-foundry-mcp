/**
 * The texts of the campaign area: the English fallback table matches lang.en.json,
 * German has the same keys and placeholders, no text has a dash or an emoji,
 * and a translation is used when Foundry has one.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeFoundry } from '../../../testing/fake-foundry.js';
import { CAMPAIGN_EN, ch, ct } from './texts.js';

const read = (code: string) =>
  JSON.parse(readFileSync(new URL(`./lang.${code}.json`, import.meta.url), 'utf8')) as unknown;

function flatten(
  value: unknown,
  prefix = '',
  out = new Map<string, string>()
): Map<string, string> {
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'string') out.set(path, child);
    else flatten(child, path, out);
  }
  return out;
}

const placeholders = (text: string) =>
  [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

let foundry: FakeFoundry | null = null;
afterEach(() => {
  foundry?.uninstall();
  foundry = null;
});

describe('texts of the campaign package', () => {
  const en = flatten(read('en'));
  const de = flatten(read('de'));

  it('has the same English texts as the fallback table', () => {
    expect(Object.fromEntries(flatten(CAMPAIGN_EN))).toEqual(Object.fromEntries(en));
  });

  it('gives German the same keys and placeholders', () => {
    expect([...de.keys()].sort()).toEqual([...en.keys()].sort());
    for (const [key, text] of en)
      expect(placeholders(de.get(key) ?? ''), key).toEqual(placeholders(text));
  });

  it('has no dashes and no emoji', () => {
    for (const [key, text] of [...en, ...de]) {
      expect(text, key).not.toMatch(/[–—]/);
      expect(text, key).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it('uses a translation when Foundry has one and falls back to English otherwise', () => {
    foundry = new FakeFoundry({
      translations: { 'ninjos-foundry-mcp.campaign.status.completed': 'Abgeschlossen' },
    }).install();
    expect(ct('status.completed')).toBe('Abgeschlossen');
    expect(ct('status.skipped')).toBe('Skipped');
    expect(ct('dashboard.part', { number: 2, title: 'X' })).toBe('Part 2: X');
  });

  it('escapes the translation for HTML but inserts values as given', () => {
    foundry = new FakeFoundry({
      translations: { 'ninjos-foundry-mcp.campaign.quest.npcEntry': '{npc} & {role}' },
    }).install();
    expect(ch('quest.npcEntry', { npc: '<b>A</b>', role: 'ally' })).toBe('<b>A</b> &amp; ally');
  });
});
