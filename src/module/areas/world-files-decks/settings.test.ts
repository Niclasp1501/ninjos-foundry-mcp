import { afterEach, describe, expect, it } from 'vitest';
import { MODULE_ID } from '../../../common/constants.js';
import { QueryDispatcher } from '../../dispatcher.js';
import { readSetting } from '../../settings.js';
import { makeSetWorldSetting } from './settings.js';
import { openWorldFiles, type WorldFilesSetup } from './testing.js';

let setup: WorldFilesSetup | null = null;
afterEach(() => {
  setup?.harness.close();
  setup = null;
});

function open(settings: Record<string, unknown> = {}): WorldFilesSetup {
  setup = openWorldFiles({ settings });
  const register = setup.foundry.game.settings as unknown as {
    register(namespace: string, key: string, config: Record<string, unknown>): void;
  };
  register.register('core', 'rollMode', {
    name: 'Roll mode',
    scope: 'client',
    config: true,
    type: String,
    default: 'publicroll',
    choices: { publicroll: 'Public', gmroll: 'GM' },
  });
  register.register('core', 'time', { scope: 'world', config: false, type: Number, default: 0 });
  register.register('somemod', 'apiKey', {
    scope: 'world',
    config: true,
    type: String,
    default: 'sekret',
  });
  register.register('somemod', 'volume', {
    scope: 'world',
    config: true,
    type: Number,
    default: 1,
    range: { min: 0, max: 10, step: 1 },
  });
  register.register('somemod', 'mine', { scope: 'user', config: false, type: String, default: '' });
  return setup;
}

describe('listSettings', () => {
  it('lists core settings with values', async () => {
    const { harness } = open();
    const answer = (await harness.query('listSettings')) as Record<string, unknown>;
    expect(answer['settings']).toEqual([
      expect.objectContaining({
        id: 'core.rollMode',
        name: 'Roll mode',
        scope: 'client',
        type: 'String',
        choices: ['publicroll', 'gmroll'],
        value: 'publicroll',
        writable: false,
      }),
      expect.objectContaining({ id: 'core.time', scope: 'world', value: 0 }),
    ]);
    expect(answer['writableList']).toEqual([]);
  });

  it('hides secrets, skips other scopes, refuses its own module and unknown namespaces', async () => {
    const { harness } = open();
    const answer = (await harness.query('listSettings', { namespaces: ['somemod'] })) as Record<
      string,
      unknown
    >;
    const rows = answer['settings'] as Array<Record<string, unknown>>;
    expect(rows.map(row => row['id'])).toEqual(['somemod.apiKey', 'somemod.volume']);
    expect(rows[0]).not.toHaveProperty('value');
    expect(rows[0]?.['hidden']).toContain('secret');
    expect(JSON.stringify(answer)).not.toContain('sekret');
    expect(answer['otherScopesSkipped']).toBe(1);
    await expect(harness.query('listSettings', { namespaces: [MODULE_ID] })).rejects.toMatchObject({
      moduleCode: 'PERMISSION_DENIED',
    });
    await expect(harness.query('listSettings', { namespaces: ['nope'] })).rejects.toMatchObject({
      moduleCode: 'NOT_FOUND',
      message: expect.stringContaining('somemod'),
    });
  });
});

describe('setWorldSetting', () => {
  it('refuses everything while the list is empty', async () => {
    const { harness } = open();
    await expect(
      harness.query('setWorldSetting', { namespace: 'somemod', key: 'volume', value: 5 })
    ).rejects.toMatchObject({
      moduleCode: 'PERMISSION_DENIED',
      message: expect.stringContaining('list is empty'),
    });
    await expect(
      harness.query('setWorldSetting', {
        namespace: MODULE_ID,
        key: 'allowWriteOperations',
        value: true,
      })
    ).rejects.toMatchObject({
      moduleCode: 'PERMISSION_DENIED',
      message: expect.stringContaining('never changes'),
    });
    expect(game.settings.get('somemod', 'volume')).toBe(1);
  });

  it('writes, checks and reads back a listed world setting', async () => {
    const { harness } = open();
    const dispatcher = new QueryDispatcher({
      isGM: () => true,
      readSetting,
      changeLog: harness.changeLog,
    });
    dispatcher.register(
      'setListed',
      makeSetWorldSetting(['somemod.volume', 'somemod.apiKey', 'core.rollMode'])
    );
    const set = (data: Record<string, unknown>) => dispatcher.dispatch('setListed', data);

    expect(
      await set({ namespace: 'somemod', key: 'volume', value: 4, dryRun: true })
    ).toMatchObject({
      wouldChange: true,
      before: 1,
    });
    expect(await set({ namespace: 'somemod', key: 'volume', value: 4 })).toEqual({
      id: 'somemod.volume',
      before: 1,
      value: 4,
      changed: true,
      dryRun: false,
    });
    expect(harness.changeLog.list()[0]).toMatchObject({
      document: 'Settings',
      before: { 'somemod.volume': 1 },
    });
    expect(await set({ namespace: 'somemod', key: 'volume', value: 4 })).toMatchObject({
      changed: false,
    });
    await expect(set({ namespace: 'somemod', key: 'volume', value: 11 })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    await expect(set({ namespace: 'somemod', key: 'apiKey', value: 'x' })).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    await expect(
      set({ namespace: 'core', key: 'rollMode', value: 'gmroll' })
    ).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      message: expect.stringContaining('client setting'),
    });
    await expect(set({ namespace: 'somemod', key: 'nope', value: 1 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('needs the switch for a real write, not for a dry run', async () => {
    const { harness } = open({ [`${MODULE_ID}.allowWriteOperations`]: false });
    const dispatcher = new QueryDispatcher({
      isGM: () => true,
      readSetting,
      changeLog: harness.changeLog,
    });
    dispatcher.register('setListed', makeSetWorldSetting(['somemod.volume']));
    await expect(
      dispatcher.dispatch('setListed', { namespace: 'somemod', key: 'volume', value: 2 })
    ).rejects.toMatchObject({ code: 'WRITE_DISABLED' });
    expect(
      await dispatcher.dispatch('setListed', {
        namespace: 'somemod',
        key: 'volume',
        value: 2,
        dryRun: true,
      })
    ).toMatchObject({ wouldChange: true });
  });
});
