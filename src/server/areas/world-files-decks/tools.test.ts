/**
 * The tools of the world-files-decks area from the registry to the module handlers and back.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { MODULE_AREAS } from '../../../module/areas/index.js';
import {
  openWorldFiles,
  putFile,
  type WorldFilesSetup,
} from '../../../module/areas/world-files-decks/testing.js';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { worldFilesDecksArea } from './index.js';

let setup: WorldFilesSetup | null = null;
let plain: AreaHarness | null = null;
afterEach(() => {
  setup?.harness.close();
  plain?.close();
  setup = null;
  plain = null;
});

const text = (result: { content: Array<{ type: string; text?: string }> }) =>
  result.content[0]?.text ?? '';

describe('registration', () => {
  it('offers 22 tools in kebab-case with groups and annotations, and no dashes as sentence dashes', async () => {
    setup = openWorldFiles();
    const tools = worldFilesDecksArea.tools ?? [];
    expect(tools).toHaveLength(22);
    const listed = (await setup.harness.tools.list()).filter(tool =>
      tools.some(own => own.name === tool.name)
    );
    expect(listed).toHaveLength(22);
    for (const tool of tools) {
      expect(tool.name).toMatch(/^[a-z]+(-[a-z]+)+$/);
      expect(tool.description).not.toMatch(/[–—]/);
    }
    const byName = new Map(tools.map(tool => [tool.name, tool]));
    for (const name of [
      'get-world-time',
      'list-users',
      'browse-files',
      'find-missing-files',
      'list-settings',
      'get-card-stack',
    ]) {
      expect(byName.get(name)?.annotations.readOnlyHint).toBe(true);
    }
    expect(byName.get('delete-card-stack')?.annotations).toMatchObject({
      destructiveHint: true,
      idempotentHint: true,
    });
    expect(byName.get('upload-file')?.annotations.destructiveHint).toBe(true);
    expect(byName.get('set-game-pause')?.annotations).toMatchObject({
      readOnlyHint: false,
      idempotentHint: true,
    });
    expect(new Set(tools.map(tool => tool.group))).toEqual(
      new Set(['world', 'users', 'files', 'cards'])
    );
  });
});

describe('tool texts', () => {
  it('reads and advances the time', async () => {
    setup = openWorldFiles({}, { calendar: true });
    expect(text(await setup.harness.call('advance-world-time', { seconds: 86400 }))).toBe(
      [
        'World time advanced.',
        'Before: 0 seconds, Day 1, 0:00, calendar "Test calendar"',
        'After: 86400 seconds, Day 2, 0:00, calendar "Test calendar"',
      ].join('\n')
    );
    expect(text(await setup.harness.call('get-world-time', {}))).toContain('The game is running.');
    const invalid = await setup.harness.call('advance-world-time', { seconds: 1.5 });
    expect(invalid.isError).toBe(true);
  });

  it('sends a notification and lists users', async () => {
    setup = openWorldFiles({
      users: [
        { id: 'gm', name: 'Gamemaster', isGM: true },
        { id: 'a', name: 'Alice' },
      ],
    });
    expect(
      text(await setup.harness.call('send-notification', { message: 'Hi', users: ['Alice'] }))
    ).toBe(
      'Notification (info) sent.\nSent to the logged in users: Alice.\nSent to the other browsers over the module socket; whether they showed it cannot be read back.'
    );
    expect(text(await setup.harness.call('list-users', {}))).toContain('[a] Alice: ');
  });

  it('browses, uploads and finds missing files', async () => {
    setup = openWorldFiles();
    putFile(setup.fake, 'worlds/test-world/maps/a.png');
    setup.foundry.seed('Actor', { _id: 'x', name: 'X', img: 'worlds/test-world/maps/gone.png' });
    expect(
      text(
        await setup.harness.call('upload-file', {
          path: 'worlds/test-world/maps',
          name: 'n.txt',
          text: 'hi',
        })
      )
    ).toBe('Wrote worlds/test-world/maps/n.txt (2 bytes), read back in its folder.');
    expect(
      text(await setup.harness.call('browse-files', { path: 'worlds/test-world/maps' }))
    ).toContain('  worlds/test-world/maps/n.txt');
    const missing = text(await setup.harness.call('find-missing-files', {}));
    expect(missing).toContain('1 missing of 1 checked files');
    expect(missing).toContain('Actor.x "X" img');
  });

  it('draws cards and names the refusal to delete a stack', async () => {
    setup = openWorldFiles();
    setup.foundry.seed('Cards', {
      _id: 'd',
      name: 'Deck',
      type: 'deck',
      cards: [{ _id: 'c', name: 'Ace', sort: 1 }],
    });
    setup.foundry.seed('Cards', { _id: 'h', name: 'Hand', type: 'hand' });
    expect(text(await setup.harness.call('draw-cards', { from: 'Deck', to: 'Hand' }))).toBe(
      [
        'Drew 1 card(s):',
        '  [c] Ace (from Deck)',
        'From: [d] Deck (deck, 1 cards, 0 available, 1 drawn)',
        'Into: [h] Hand (hand, 1 cards, 1 available)',
      ].join('\n')
    );
    const refused = await setup.harness.call('delete-card-stack', { stackId: 'h' });
    expect(refused.isError).toBe(true);
    expect(text(refused)).toMatch(
      /Failed to delete card stack: Deleting card stacks is not permitted/
    );
  });

  it('says the list of writable settings is empty', async () => {
    setup = openWorldFiles();
    (
      setup.foundry.game.settings as unknown as { register(n: string, k: string, c: object): void }
    ).register('core', 'time', {
      scope: 'world',
      type: Number,
      default: 0,
    });
    expect(text(await setup.harness.call('list-settings', {}))).toBe(
      '1 of 1 settings:\ncore.time [world, Number]: 0\nNo world setting may be changed by the AI yet; the list of writable settings is empty.'
    );
  });

  it('says the module is too old when it lacks the query', async () => {
    plain = createAreaHarness({
      moduleAreas: MODULE_AREAS.filter(area => area.id !== 'world-files-decks'),
    });
    const result = await plain.call('get-world-time', {});
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('does not know the query "getWorldTime"');
  });
});
