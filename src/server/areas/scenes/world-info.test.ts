/**
 * get-world-info from the tool registry to the module handler and back, and
 * the formatting of both answer shapes.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { FakeFoundry } from '../../../testing/fake-foundry.js';
import { formatWorldInfo } from './world-info.js';

let harness: AreaHarness | null = null;
afterEach(() => {
  harness?.close();
  harness = null;
});

const open = () =>
  (harness = createAreaHarness({
    foundry: new FakeFoundry({
      users: [
        { id: 'gm', name: 'Gamemaster', isGM: true, active: true },
        { id: 'p1', name: 'Player One', active: false },
        { id: 'gm2', name: 'Assistant', isGM: true, active: false },
      ],
    }),
  }));

const FORMATTED = {
  id: 'w',
  title: 'World',
  system: { id: 'dnd5e', version: '5.1.0' },
  foundry: { version: '14.350' },
  users: { total: 2, active: 1, gms: 1, players: 1 },
  activeUsers: [{ id: 'gm', name: 'GM', isGM: true }],
};

describe('get-world-info', () => {
  it('reports the world as one JSON text, counting every user of the world', async () => {
    const result = await open().call('get-world-info');
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]?.text ?? '')).toEqual({
      id: 'test-world',
      title: 'Test World',
      system: { id: 'dnd5e', version: '5.1.0' },
      foundry: { version: '14.350' },
      users: { total: 3, active: 1, gms: 2, players: 1 },
      activeUsers: [{ id: 'gm', name: 'Gamemaster', isGM: true }],
    });
  });

  it('turns a refusal of the module into a tool error with its cause', async () => {
    const h = open();
    h.foundry.setUser('p1');
    const result = await h.call('get-world-info');
    expect(result).toEqual({
      content: [
        { type: 'text', text: 'Error: Access denied: only a Gamemaster can use the MCP bridge' },
      ],
      isError: true,
    });
  });

  it('serves the same answer as the resource foundry://world/info', async () => {
    const contents = await open().readResource('foundry://world/info');
    expect(JSON.parse(contents.contents[0]?.text ?? '')).toMatchObject({
      id: 'test-world',
      users: { total: 3 },
    });
  });
});

describe('formatWorldInfo', () => {
  it('formats the raw answer of a module of the previous generation', () => {
    expect(
      formatWorldInfo({
        id: 'w',
        title: 'World',
        system: 'dnd5e',
        systemVersion: '5.1.0',
        foundryVersion: '13.351',
        users: [
          { id: 'gm', name: 'GM', active: true, isGM: true },
          { id: 'p', name: 'P', active: false, isGM: false },
        ],
      })
    ).toEqual({ ...FORMATTED, foundry: { version: '13.351' } });
  });

  it('keeps an answer that is already formatted', () => {
    expect(formatWorldInfo(FORMATTED)).toEqual(FORMATTED);
  });

  it('reads each field in whichever shape it arrives', () => {
    expect(
      formatWorldInfo({
        id: 'w',
        title: 'World',
        system: { id: 'pf2e', version: '7' },
        foundryVersion: '14',
        users: [],
      })
    ).toMatchObject({
      system: { id: 'pf2e', version: '7' },
      foundry: { version: '14' },
      users: { total: 0 },
    });
  });

  it('turns a failure sent as a value into an error', () => {
    expect(() => formatWorldInfo({ success: false, error: 'Access denied' })).toThrow(
      'Access denied'
    );
  });

  it('refuses an answer without world id and title, and shows it', () => {
    expect(() => formatWorldInfo({ world: 'x' })).toThrow(
      'The module answered getWorldInfo in a shape this server does not know (no world id and title): {"world":"x"}'
    );
  });
});
