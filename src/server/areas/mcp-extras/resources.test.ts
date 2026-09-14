/**
 * The resources of the mcp-extras area from the register through the read tools of
 * other packages to the module handlers of a fake Foundry, and back.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { FakeFoundry } from '../../../testing/fake-foundry.js';
import type { ResourceContext } from '../../tools/resources.js';
import { formatChanges, OVERVIEW_MAX_CHARS, readRecentChanges } from './resources.js';

let harness: AreaHarness | null = null;
afterEach(() => {
  harness?.close();
  harness = null;
});

function open(): AreaHarness {
  harness = createAreaHarness({ foundry: new FakeFoundry() });
  const f = harness.foundry;
  f.seed('Scene', { _id: 's1', name: 'Cave of Echoes', active: true, width: 2000, height: 1000 });
  f.seed('Scene', { _id: 's2', name: 'Tower', active: false, width: 1000, height: 1000 });
  f.seed('JournalEntry', {
    _id: 'lore',
    name: 'Lore of the Coast',
    pages: [
      {
        _id: 'p1',
        name: 'Intro',
        type: 'text',
        text: { content: '<p>Hello world</p>' },
        sort: 100,
      },
      {
        _id: 'p3',
        name: 'Secrets',
        type: 'text',
        text: { content: '<p>The dragon sleeps</p>' },
        sort: 300,
      },
    ],
  });
  f.seed('Actor', { _id: 'a1', name: 'Bandit Chief', type: 'npc' });
  return harness;
}

const read = async (h: AreaHarness, uri: string) =>
  (await h.readResource(uri)).contents[0]?.text ?? '';

const contextOf = (h: AreaHarness) => ({
  query: (name: string, data?: unknown) => h.query(name, data),
  arguments: {},
});

describe('mcp-extras resources', () => {
  it('lists the fixed resources next to the world information of the scenes area', () => {
    const uris = open()
      .resources.list()
      .map(resource => resource.uri);
    expect(uris).toEqual(
      expect.arrayContaining([
        'foundry://world/info',
        'foundry://world/overview',
        'foundry://scene/active',
        'foundry://compendiums',
        'foundry://combat/active',
        'foundry://changes/recent',
      ])
    );
    for (const listed of [...open().resources.list(), ...open().resources.listTemplates()]) {
      expect(listed.description ?? '', listed.name).not.toMatch(/[–—]/);
    }
  });

  it('reads the active scene through get-current-scene', async () => {
    expect(await read(open(), 'foundry://scene/active')).toContain('Cave of Echoes');
  });

  it('reads a journal and one of its pages through list-journals', async () => {
    const h = open();
    expect(await read(h, 'foundry://journal/lore')).toContain('Hello world');
    const page = await read(h, 'foundry://journal/lore/page/p3');
    expect(page).toContain('The dragon sleeps');
    expect(page).not.toContain('Hello world');
  });

  it('reads an actor through get-character', async () => {
    expect(await read(open(), 'foundry://actor/a1')).toContain('Bandit Chief');
  });

  it('puts the world, scenes, journals and actors into one overview', async () => {
    const overview = await read(open(), 'foundry://world/overview');
    expect(overview).toContain('## World');
    expect(overview).toContain('Test World');
    expect(overview).toContain('Tower');
    expect(overview).toContain('Lore of the Coast');
    expect(overview).toContain('Bandit Chief');
    expect(overview).toContain('## Combat encounters');
  });

  it('keeps the overview compact in a large world: counts, a few names, pointers', async () => {
    const h = open();
    for (let index = 0; index < 300; index += 1) {
      h.foundry.seed('JournalEntry', {
        _id: `j${index}`,
        name: `Chronicle ${index} of the long winter in the northern marches`,
        pages: [
          {
            _id: `p${index}`,
            name: 'Session notes',
            type: 'text',
            text: { content: '<p>Much happened.</p>' },
            sort: 100,
          },
        ],
      });
    }
    for (let index = 0; index < 40; index += 1)
      h.foundry.seed('Actor', { _id: `a${index + 2}`, name: `Villager ${index}`, type: 'npc' });

    const overview = await read(h, 'foundry://world/overview');
    expect(OVERVIEW_MAX_CHARS).toBeLessThanOrEqual(8000);
    expect(overview.length).toBeLessThanOrEqual(OVERVIEW_MAX_CHARS);
    expect(overview).toContain('301 journals');
    expect(overview).toContain('41 actors');
    expect(overview).toContain('2 scenes');
    expect(overview).toContain('Cave of Echoes (active)');
    expect(overview).toMatch(/and \d+ more/);
    expect(overview).toContain('list-journals');
    expect(overview).toContain('foundry://journal/{journalId}');
    expect(overview).not.toMatch(/\{\n\s+"/);
    expect(overview).not.toMatch(/[–—]/);
  });

  it('passes the cause of a failed read on', async () => {
    await expect(open().readResource('foundry://journal/missing')).rejects.toThrow(/missing/);
  });

  it('refuses a player like every query does', async () => {
    harness = createAreaHarness({
      foundry: new FakeFoundry({
        users: [
          { id: 'gm', name: 'Gamemaster', isGM: true },
          { id: 'p1', name: 'Player' },
        ],
      }),
    });
    harness.foundry.setUser('p1');
    await expect(harness.readResource('foundry://world/overview')).rejects.toThrow(
      /The world overview could not be read: .*Access denied/
    );
  });

  it('says that a module without the change log query is too old', async () => {
    await expect(open().readResource('foundry://changes/recent')).rejects.toThrow(
      /does not know the query "getChangeLog", so it is older than this server/
    );
  });

  it('completes scene, journal, page and actor ids through the module', async () => {
    const h = open();
    const context = contextOf(h);
    const complete = (uriTemplate: string, name: string, value: string, given = {}) =>
      h.resources.complete(uriTemplate, { argument: { name, value }, arguments: given }, context);
    expect((await complete('foundry://scene/{sceneId}', 'sceneId', 'tow')).values).toEqual(['s2']);
    expect((await complete('foundry://journal/{journalId}', 'journalId', 'lo')).values).toEqual([
      'lore',
    ]);
    expect(
      (
        await complete('foundry://journal/{journalId}/page/{pageId}', 'pageId', 'sec', {
          journalId: 'lore',
        })
      ).values
    ).toEqual(['p3']);
    expect((await complete('foundry://actor/{actorId}', 'actorId', 'bandit')).values).toEqual([
      'a1',
    ]);
  });
});

describe('recent changes', () => {
  it('summarises the log by kind, newest first, with targets, tool and user', async () => {
    const entries = [
      {
        id: 'c2',
        at: '2026-09-14T10:02:00.000Z',
        query: 'journalAddPage',
        tool: 'journal-add-page',
        document: 'Journals',
        action: 'update',
        targets: [{ id: 'lore', name: 'Lore of the Coast' }],
        summary: 'Added the page "Harbour".',
        undoable: true,
        user: { id: 'gm', name: 'Gamemaster' },
      },
      {
        id: 'c1',
        at: '2026-09-14T10:01:00.000Z',
        query: 'createScene',
        document: 'Scenes',
        action: 'create',
        targets: [{ uuid: 'Scene.s9' }],
        summary: '',
        undoable: true,
        undoneAt: '2026-09-14T10:05:00.000Z',
      },
    ];
    let asked: unknown = null;
    const context: ResourceContext = {
      query: async (name, data) => {
        asked = { name, data };
        return entries;
      },
    };
    const text = await readRecentChanges(context);
    expect(asked).toEqual({ name: 'getChangeLog', data: { limit: 50 } });
    expect(text).toContain('2 changes, newest first, at most 50.');
    expect(text).toContain('By kind: 1 update Journals, 1 create Scenes.');
    expect(text).toContain(
      '- 2026-09-14T10:02:00.000Z update Journals (Lore of the Coast): Added the page "Harbour".; tool journal-add-page; by Gamemaster'
    );
    expect(text).toContain('(Scene.s9): no summary; undone at 2026-09-14T10:05:00.000Z');
    expect(text).not.toMatch(/[–—]/);
  });

  it('says where the log lives when it is empty, and reports a refusal as an error', async () => {
    expect(formatChanges([])).toMatch(/^No changes are recorded\. The log lives in the browser/);
    await expect(
      readRecentChanges({ query: async () => ({ success: false, error: 'Access denied' }) })
    ).rejects.toThrow('Failed to read the change log: Access denied');
  });
});
