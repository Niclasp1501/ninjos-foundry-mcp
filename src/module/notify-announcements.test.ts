import { afterEach, describe, expect, it } from 'vitest';
import { FakeFoundry } from '../testing/fake-foundry.js';
import { defineAnnouncements } from './notify.js';

let foundry: FakeFoundry | null = null;
afterEach(() => {
  foundry?.uninstall();
  foundry = null;
});

describe('defineAnnouncements', () => {
  const messages = {
    notAllowed: { level: 'warn', en: 'You may not make this roll.' },
    rollFailed: { level: 'error', en: 'The roll could not be made: {reason}' },
  } as const;

  it('shows the translated text of the area at the level of its key', () => {
    foundry = new FakeFoundry({
      translations: {
        'ninjos-foundry-mcp.tokens-dice.notify.rollFailed': 'Der Wurf ging nicht: {reason}',
      },
    }).install();
    const notes = defineAnnouncements('tokens-dice', messages);
    expect(notes.announce('rollFailed', { reason: 'keine Formel' })).toBe(
      'Der Wurf ging nicht: keine Formel'
    );
    expect(notes.announce('notAllowed')).toBe('You may not make this roll.');
    expect(foundry.notifications).toEqual([
      { level: 'error', message: 'Der Wurf ging nicht: keine Formel' },
      { level: 'warn', message: 'You may not make this roll.' },
    ]);
    expect(notes.languageKey('notAllowed')).toBe(
      'ninjos-foundry-mcp.tokens-dice.notify.notAllowed'
    );
    expect(notes.keys).toEqual(['notAllowed', 'rollFailed']);
    expect(notes.level('rollFailed')).toBe('error');
  });

  it('uses another group when asked, and the English text without Foundry', () => {
    const notes = defineAnnouncements(
      'maps',
      { done: { level: 'info', en: 'Map {name} done.' } },
      { group: 'messages.jobs' }
    );
    expect(notes.languageKey('done')).toBe('ninjos-foundry-mcp.maps.messages.jobs.done');
    expect(notes.announce('done', { name: 'Cave' })).toBe('Map Cave done.');
  });

  it('refuses a table it could not show honestly', () => {
    expect(() =>
      defineAnnouncements('tokens-dice', { a: { level: 'loud' as 'info', en: 'x' } })
    ).toThrow(/needs a level/);
    expect(() => defineAnnouncements('tokens-dice', { a: { level: 'info', en: ' ' } })).toThrow(
      /English text/
    );
    expect(() => defineAnnouncements('Tokens.Dice', { a: { level: 'info', en: 'x' } })).toThrow(
      /area id/
    );
  });
});
