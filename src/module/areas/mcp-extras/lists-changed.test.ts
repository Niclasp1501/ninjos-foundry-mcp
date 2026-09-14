/**
 * The module part of the mcp-extras area: changes by hand in Foundry reach the server
 * as one gathered request mcpListsChanged.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { MODULE_ID } from '../../../common/constants.js';
import { FakeFoundry } from '../../../testing/fake-foundry.js';
import { ServerRequestError } from '../../server-requests.js';
import {
  ListsChangedReporter,
  stopWatchingListChanges,
  watchForListChanges,
  type ListsChangedOptions,
} from './lists-changed.js';

type Sent = { tools?: true; resources?: string[] };

let foundry: FakeFoundry | null = null;
afterEach(() => {
  stopWatchingListChanges();
  foundry?.uninstall?.();
  foundry = null;
});

function reporter(options: ListsChangedOptions = {}) {
  const sent: Sent[] = [];
  const warnings: string[] = [];
  const instance = new ListsChangedReporter({
    gatherMs: 10,
    available: () => true,
    send: async change => {
      sent.push(change);
    },
    warn: message => warnings.push(message),
    ...options,
  });
  return { instance, sent, warnings };
}

function world(user: 'gm' | 'alice' = 'gm') {
  foundry = new FakeFoundry({
    users: [
      { id: 'gm', name: 'Gamemaster', isGM: true, active: true },
      { id: 'alice', name: 'Alice', active: true },
    ],
  });
  foundry.install();
  if (user === 'alice') foundry.setUser('alice');
  return foundry;
}

describe('ListsChangedReporter', () => {
  it('gathers changes of a moment into one request with each prefix once', async () => {
    const { instance, sent } = reporter();
    instance.note({ resources: ['foundry://journal/', 'foundry://world/'] });
    instance.note({ resources: ['foundry://journal/'] });
    instance.note({ tools: true });
    await instance.settled();
    expect(sent).toEqual([{ tools: true, resources: ['foundry://journal/', 'foundry://world/'] }]);
  });

  it('sends nothing without a bridge that takes requests, and nothing for an empty change', async () => {
    const { instance, sent } = reporter({ available: () => false });
    instance.note({ tools: true });
    instance.note({});
    await instance.settled();
    expect(sent).toEqual([]);
  });

  it('stays quiet when the server is too old, and warns about any other failure', async () => {
    const old = reporter({
      send: async () => {
        throw new ServerRequestError('SERVER_TOO_OLD', 'no requests');
      },
    });
    old.instance.note({ tools: true });
    await old.instance.settled();
    expect(old.warnings).toEqual([]);

    const broken = reporter({
      send: async () => {
        throw new Error('bridge broke');
      },
    });
    broken.instance.note({ tools: true });
    await broken.instance.settled();
    expect(broken.warnings).toEqual([
      `${MODULE_ID} | Could not tell the server about a change in Foundry`,
    ]);
  });
});

describe('watchForListChanges', () => {
  it('reports a journal created by hand with the journal and world prefixes', async () => {
    const f = world();
    const { instance, sent } = reporter();
    watchForListChanges(instance);
    f.hooks.callAll('createJournalEntry', { id: 'j1' }, {}, 'gm');
    f.hooks.callAll('updateJournalEntryPage', { id: 'p1' }, {}, {}, 'gm');
    await instance.settled();
    expect(sent).toEqual([{ resources: ['foundry://journal/', 'foundry://world/'] }]);
  });

  it('asks the server to compare its tool list when the release list of tool modules changes', async () => {
    const f = world();
    const { instance, sent } = reporter();
    watchForListChanges(instance);
    const registrations = () =>
      f.hooks.calls.filter(call => call.name === `${MODULE_ID}.registerTools`);
    const before = registrations().length;
    f.hooks.callAll('updateSetting', { key: `${MODULE_ID}.toolProviderModules`, value: 'my-mod' });
    f.hooks.callAll('updateSetting', { key: 'core.time', value: 1 });
    await instance.settled();
    expect(sent).toEqual([{ tools: true, resources: ['foundry://world/'] }]);
    // The hook only runs when a module is released; the setting in the fake stays empty.
    expect(registrations().length).toBe(before);
  });

  it('does not listen in a player browser', async () => {
    const f = world('alice');
    const { instance, sent } = reporter();
    watchForListChanges(instance);
    f.hooks.callAll('createActor', { id: 'a1' }, {}, 'alice');
    await instance.settled();
    expect(sent).toEqual([]);
  });
});
