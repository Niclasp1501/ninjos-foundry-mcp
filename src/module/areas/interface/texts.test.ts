/**
 * The texts of the interface area: the English fallback table matches lang.en.json,
 * both languages carry the same placeholders, and no text has a dash or an
 * emoji. Every message key has a text, and every text under notify a level.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { MODULE_ID } from '../../../common/constants.js';
import { FakeFoundry } from '../../../testing/fake-foundry.js';
import { announce, MESSAGE_LEVELS, messageText } from './messages.js';
import { EN, fallbackFor, t, tr } from './texts.js';

const read = (code: string) =>
  JSON.parse(readFileSync(new URL(`./lang.${code}.json`, import.meta.url), 'utf8')) as Record<
    string,
    unknown
  >;

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

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

let foundry: FakeFoundry | null = null;
afterEach(() => {
  foundry?.uninstall();
  foundry = null;
});

describe('language fragments of the interface package', () => {
  const en = flatten(read('en'));
  const de = flatten(read('de'));

  it('has the same English texts as the fallback table', () => {
    expect(Object.fromEntries(flatten(EN))).toEqual(Object.fromEntries(en));
  });

  it('gives German and English the same placeholders', () => {
    for (const [key, text] of en) {
      expect(de.has(key), key).toBe(true);
      expect(placeholders(de.get(key) ?? ''), key).toEqual(placeholders(text));
    }
  });

  it('has no dashes and no emoji in any text', () => {
    for (const [code, texts] of [
      ['en', en],
      ['de', de],
    ] as const) {
      for (const [key, text] of texts) {
        expect(/[–—]/.test(text), `${code} ${key}`).toBe(false);
        expect(/\p{Extended_Pictographic}/u.test(text), `${code} ${key}`).toBe(false);
      }
    }
  });

  it('has a text for every message and a level for every text under notify', () => {
    const notify = [...en.keys()]
      .filter(key => key.startsWith(`${MODULE_ID}.interface.notify.`))
      .map(key => key.split('.').pop());
    expect(notify.sort()).toEqual(Object.keys(MESSAGE_LEVELS).sort());
  });

  it('keeps the welcome texts under MCP.Willkommen, as in every Ninjo module', () => {
    for (const key of [
      'Untertitel',
      'Einleitung',
      'Punkt1',
      'Punkt2',
      'Punkt3',
      'Start',
      'ForgeZeile',
      'Nie',
      'Spaeter',
    ]) {
      expect(en.has(`MCP.Willkommen.${key}`), key).toBe(true);
    }
  });
});

describe('text lookup', () => {
  it('shows the English text instead of a raw key when a translation is missing', () => {
    foundry = new FakeFoundry().install();
    expect(t('common.failed', { reason: 'disk full' })).toBe('Failed: disk full');
    expect(tr('MCP.Willkommen.Spaeter')).toBe('Later');
    expect(fallbackFor(`${MODULE_ID}.interface.nope`)).toBeUndefined();
  });

  it('uses the translation when there is one, with the same placeholders filled', () => {
    foundry = new FakeFoundry({
      translations: { [`${MODULE_ID}.interface.common.failed`]: 'Fehlgeschlagen: {reason}' },
    }).install();
    expect(t('common.failed', { reason: 'Platte voll' })).toBe('Fehlgeschlagen: Platte voll');
  });

  it('shows a message at the level of its key', () => {
    foundry = new FakeFoundry().install();
    expect(announce('wallsCreated', { count: 12 })).toBe('Walls created: 12.');
    announce('noWalls');
    announce('progressSaveFailed', { reason: 'offline' });
    expect(foundry.notifications).toEqual([
      { level: 'info', message: 'Walls created: 12.' },
      { level: 'warn', message: 'The detection found no usable walls.' },
      { level: 'error', message: 'The campaign progress was not saved: offline' },
    ]);
    expect(messageText('sceneCreated', { name: 'Keep' })).toBe('Scene Keep created.');
  });
});
