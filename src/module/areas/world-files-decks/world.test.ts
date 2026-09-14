import { afterEach, describe, expect, it } from 'vitest';
import { MODULE_ID } from '../../../common/constants.js';
import { worldFilesDecksArea } from './index.js';
import { receiveNotification, resetNotificationListener, SOCKET_EVENT } from './notifications.js';
import { openWorldFiles, type WorldFilesSetup } from './testing.js';

let setup: WorldFilesSetup | null = null;
afterEach(() => {
  setup?.harness.close();
  setup = null;
});

const SWITCH_OFF = { [`${MODULE_ID}.allowWriteOperations`]: false };
const users = [
  { id: 'gm', name: 'Gamemaster', isGM: true },
  { id: 'alice', name: 'Alice' },
  { id: 'bob', name: 'Bob', active: false },
];

describe('world time', () => {
  it('reads seconds, with the calendar when there is one', async () => {
    setup = openWorldFiles({}, { calendar: true });
    setup.fake.time.worldTime = 90000;
    expect(await setup.harness.query('getWorldTime')).toEqual({
      worldTime: 90000,
      paused: false,
      calendar: {
        name: 'Test calendar',
        components: { day: 1, hour: 1 },
        formatted: 'Day 2, 1:00',
      },
    });
    setup.harness.close();
    setup = openWorldFiles();
    expect(await setup.harness.query('getWorldTime')).toMatchObject({ calendar: null });
  });

  it('advances, reads back and logs', async () => {
    setup = openWorldFiles();
    const answer = await setup.harness.query('advanceWorldTime', { seconds: 3600 });
    expect(answer).toMatchObject({ before: { worldTime: 0 }, after: { worldTime: 3600 } });
    expect(setup.fake.time.worldTime).toBe(3600);
    expect(setup.harness.changeLog.list()[0]).toMatchObject({
      document: 'WorldTime',
      action: 'update',
      before: { worldTime: 0 },
      undoable: true,
    });
  });

  it('runs a dry run with the switch off, but not the real thing', async () => {
    setup = openWorldFiles({ settings: SWITCH_OFF });
    expect(
      await setup.harness.query('advanceWorldTime', { seconds: 60, dryRun: true })
    ).toMatchObject({
      dryRun: true,
      after: { worldTime: 60 },
    });
    expect(setup.fake.time.worldTime).toBe(0);
    await expect(setup.harness.query('advanceWorldTime', { seconds: 60 })).rejects.toMatchObject({
      moduleCode: 'WRITE_DISABLED',
    });
  });

  it('refuses bad amounts and reports a time that reads back differently', async () => {
    setup = openWorldFiles();
    for (const seconds of [0, 1.5, 400_000_000, '60']) {
      await expect(setup.harness.query('advanceWorldTime', { seconds })).rejects.toMatchObject({
        moduleCode: 'INVALID_ARGUMENT',
      });
    }
    setup.fake.time.advance = async seconds => (setup!.fake.time.worldTime += seconds * 2);
    await expect(setup.harness.query('advanceWorldTime', { seconds: 10 })).rejects.toMatchObject({
      moduleCode: 'NOT_APPLIED',
      message: expect.stringContaining('expected 10'),
    });
  });
});

describe('pause', () => {
  it('pauses once and says when nothing changes', async () => {
    setup = openWorldFiles();
    expect(await setup.harness.query('setGamePause', { paused: true })).toEqual({
      paused: true,
      changed: true,
    });
    expect(setup.foundry.game['paused']).toBe(true);
    expect(await setup.harness.query('setGamePause', { paused: true })).toEqual({
      paused: true,
      changed: false,
    });
    expect(setup.harness.changeLog.list()).toHaveLength(1);
  });

  it('reports a pause Foundry did not apply', async () => {
    setup = openWorldFiles();
    setup.foundry.game['togglePause'] = () => undefined;
    await expect(setup.harness.query('setGamePause', { paused: true })).rejects.toMatchObject({
      moduleCode: 'NOT_APPLIED',
    });
  });
});

describe('notifications', () => {
  it('sends to everyone over the socket and shows it to the Gamemaster', async () => {
    setup = openWorldFiles({ users });
    const answer = await setup.harness.query('sendNotification', {
      message: 'Break in five minutes',
      level: 'warn',
    });
    expect(answer).toMatchObject({
      shownHere: true,
      sentTo: [{ id: 'alice', name: 'Alice' }],
      notLoggedIn: [{ id: 'bob', name: 'Bob' }],
    });
    expect(setup.fake.emitted).toEqual([
      {
        event: SOCKET_EVENT,
        payload: {
          type: 'world-files-decks.notify',
          level: 'warn',
          message: 'Break in five minutes',
          sender: 'gm',
          recipients: ['gm', 'alice', 'bob'],
        },
      },
    ]);
    expect(setup.foundry.notifications).toContainEqual({
      level: 'warn',
      message: 'Message from Gamemaster: Break in five minutes',
    });
  });

  it('resolves recipients exactly and refuses markup', async () => {
    setup = openWorldFiles({ users });
    await expect(
      setup.harness.query('sendNotification', { message: 'x', users: ['Ali'] })
    ).rejects.toMatchObject({
      moduleCode: 'NOT_FOUND',
    });
    await expect(
      setup.harness.query('sendNotification', { message: '<b>x</b>' })
    ).rejects.toMatchObject({
      moduleCode: 'INVALID_ARGUMENT',
    });
    expect(setup.fake.emitted).toEqual([]);
  });

  it('sends nothing to other browsers when the manifest has no socket', async () => {
    setup = openWorldFiles({ users }, { socket: false });
    await expect(
      setup.harness.query('sendNotification', { message: 'x', users: ['Alice'] })
    ).rejects.toMatchObject({
      moduleCode: 'NOT_AVAILABLE',
      message: expect.stringContaining('"socket": true'),
    });
    expect(
      await setup.harness.query('sendNotification', { message: 'only me', users: ['gm'] })
    ).toMatchObject({
      shownHere: true,
      sentTo: [],
    });
    expect(setup.fake.emitted).toEqual([]);
  });

  it('is shown by a player browser only when a Gamemaster sent it to that player', async () => {
    setup = openWorldFiles({ users });
    resetNotificationListener();
    await worldFilesDecksArea.ready?.();
    const listener = setup.fake.listeners.get(SOCKET_EVENT)?.[0];
    expect(listener).toBeDefined();
    setup.foundry.setUser('alice');
    const payload = {
      type: 'world-files-decks.notify',
      level: 'info',
      message: 'Hi',
      sender: 'gm',
      recipients: ['alice'],
    };
    // Foundry's server appends the id of the sending user after what the sender passed.
    const deliver = listener as unknown as (...args: unknown[]) => unknown;
    deliver(payload, 'gm');
    expect(setup.foundry.notifications).toEqual([
      { level: 'info', message: 'Message from Gamemaster: Hi' },
    ]);
    expect(receiveNotification({ ...payload, sender: 'bob' }, 'bob')).toBe(false);
    expect(receiveNotification({ ...payload, recipients: ['bob'] }, 'gm')).toBe(false);
    expect(receiveNotification({ ...payload, message: '<img>' }, 'gm')).toBe(false);
    expect(setup.foundry.notifications).toHaveLength(1);
  });

  it('never shows a message that claims a Gamemaster without Foundry confirming the sender', async () => {
    setup = openWorldFiles({ users });
    resetNotificationListener();
    await worldFilesDecksArea.ready?.();
    const deliver = setup.fake.listeners.get(SOCKET_EVENT)?.[0] as unknown as (
      ...args: unknown[]
    ) => unknown;
    setup.foundry.setUser('alice');
    const forged = {
      type: 'world-files-decks.notify',
      level: 'error',
      message: 'Hand over your character sheet',
      sender: 'gm',
      recipients: ['alice'],
    };
    // No id from Foundry: the payload alone proves nothing.
    deliver(forged);
    expect(receiveNotification(forged)).toBe(false);
    // Foundry names the player who sent it.
    deliver(forged, 'bob');
    // The player put the Gamemaster's id in front; Foundry's id comes last and wins.
    deliver(forged, 'gm', 'bob');
    expect(setup.foundry.notifications).toEqual([]);
  });

  it('needs the write switch', async () => {
    setup = openWorldFiles({ users, settings: SWITCH_OFF });
    await expect(setup.harness.query('sendNotification', { message: 'x' })).rejects.toMatchObject({
      moduleCode: 'WRITE_DISABLED',
    });
  });
});

describe('users', () => {
  it('lists role, login, character and viewed scene, nothing about access', async () => {
    setup = openWorldFiles({ users });
    const { foundry, harness } = setup;
    foundry.seed('Actor', { _id: 'hero', name: 'Hero' });
    foundry.seed('Scene', { _id: 's1', name: 'Cellar' });
    Object.assign(foundry.users.get('alice') as object, {
      role: 1,
      character: 'hero',
      viewedScene: 's1',
      password: 'never',
    });
    Object.assign(foundry.users.get('gm') as object, { role: 4 });
    const answer = (await harness.query('listUsers')) as { users: Array<Record<string, unknown>> };
    expect(answer.users[1]).toEqual({
      id: 'alice',
      name: 'Alice',
      role: 1,
      roleName: 'player',
      isGM: false,
      active: true,
      isSelf: false,
      character: { id: 'hero', name: 'Hero' },
      viewedScene: { id: 's1', name: 'Cellar' },
      avatar: null,
    });
    expect(answer.users[0]).toMatchObject({ roleName: 'gamemaster', isSelf: true });
    const active = (await harness.query('listUsers', { onlyActive: true })) as { users: unknown[] };
    expect(active.users).toHaveLength(2);
  });
});
