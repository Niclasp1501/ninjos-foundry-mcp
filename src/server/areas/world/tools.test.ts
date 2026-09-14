/**
 * The tools of the world area from the registry to the module handlers and back.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { MODULE_ID } from '../../../common/constants.js';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { FakeFoundry, type FakeFoundryOptions } from '../../../testing/fake-foundry.js';
import { readToolDirectory } from '../../../testing/tool-directory.js';
import { worldArea } from './index.js';
import { formatPermissions } from './permissions.js';
import { formatPlaylists } from './playlists.js';
import { formatRollTables } from './roll-tables.js';

let harness: AreaHarness | null = null;
afterEach(() => {
  harness?.close();
  harness = null;
});

const open = (options: FakeFoundryOptions = {}) =>
  (harness = createAreaHarness({ foundry: new FakeFoundry(options) }));

const text = (result: { content: Array<{ type: string; text?: string }> }) =>
  result.content[0]?.text ?? '';

describe('names and parameters', () => {
  it('match the tool directory of the previous generation', () => {
    const listed = readToolDirectory();
    const described = new Map(listed.map(tool => [tool.name, tool.inputSchema]));
    for (const tool of worldArea.tools ?? []) {
      const schema = described.get(tool.name) as
        { properties: Record<string, { type: string }>; required?: string[] } | undefined;
      expect(schema, tool.name).toBeDefined();
      const own = tool.inputSchema as {
        properties: Record<string, { type: string }>;
        required?: string[];
      };
      expect(Object.keys(own.properties).sort(), tool.name).toEqual(
        Object.keys(schema?.properties ?? {}).sort()
      );
      for (const [name, property] of Object.entries(schema?.properties ?? {}))
        expect(own.properties[name]?.type, `${tool.name}.${name}`).toBe(property.type);
      expect(own.required ?? [], tool.name).toEqual(schema?.required ?? []);
    }
  });
});

describe('get-permissions', () => {
  it('starts with the switch and lists every kind with its setting', async () => {
    const result = await open().call('get-permissions');
    const lines = text(result).split('\n');
    expect(lines[0]).toBe('Writing is permitted in principle.');
    expect(lines).toContain('- compendiums: create, change (permCompendiums: write)');
    expect(text(result)).toContain(
      'Tools of other modules (toolProviderModules): no module is released'
    );
  });

  it('warns when the switch is off', async () => {
    const result = await open({
      settings: { [`${MODULE_ID}.allowWriteOperations`]: false },
    }).call('get-permissions');
    expect(text(result)).toMatch(
      /^CAUTION: "Allow Write Operations" is off, the AI changes nothing at all\./
    );
    expect(text(result)).toContain(
      '- scenes: read only (permScenes: write), held back by the switch'
    );
  });

  it('explains the release lists', () => {
    const out = formatPermissions({
      writeOperationsEnabled: true,
      kinds: [],
      compendiumReleaseList: {
        setting: 'writableCompendiums',
        mode: 'listed',
        entries: ['world.a'],
      },
      extensionTools: {
        setting: 'toolProviderModules',
        releasedModules: ['shops'],
        registeredTools: [{ name: 'shop-buy', moduleId: 'shops', readOnly: false }],
      },
    });
    expect(out).toContain('Compendium release list (writableCompendiums): only world.a.');
    expect(out).toContain('- shop-buy from shops: writing, runs');
  });

  it('passes an answer of unknown form on unchanged', () => {
    expect(formatPermissions({ odd: 1 })).toContain('"odd": 1');
  });
});

describe('playlist tools', () => {
  it('say so for an empty world', async () => {
    expect(text(await open().call('list-playlists'))).toBe('No playlists in this world.');
  });

  it('list playlists with their tracks', async () => {
    const h = open();
    h.foundry.seed('Playlist', {
      _id: 'tavern',
      name: 'Tavern',
      sounds: [{ _id: 'lute', name: 'Lute' }],
    });
    expect(text(await h.call('list-playlists'))).toBe(
      'Tavern (1 tracks, id tavern)\n  [lute] Lute'
    );
    expect(text(await h.call('list-playlists', { includeSounds: false }))).toBe(
      'Tavern (1 tracks, id tavern)'
    );
  });

  it('link and unlink a scene', async () => {
    const h = open();
    h.foundry.seed('Playlist', {
      _id: 'tavern',
      name: 'Tavern',
      sounds: [{ _id: 'lute', name: 'Lute' }],
    });
    h.foundry.seed('Scene', { _id: 'harbour', name: 'Harbour' });
    expect(
      text(
        await h.call('set-scene-playlist', {
          sceneIdentifier: 'Harbour',
          playlistName: 'Tavern',
          soundName: 'Lute',
        })
      )
    ).toBe('Scene "Harbour": playlist "Tavern", track "Lute"');
    expect(
      text(await h.call('set-scene-playlist', { sceneIdentifier: 'Harbour', playlistName: '' }))
    ).toBe('Scene "Harbour": link removed');
  });

  it('report a refusal as a tool error with its cause', async () => {
    const h = open();
    h.foundry.seed('Playlist', { _id: 'tavern', name: 'Tavern', sounds: [] });
    const result = await h.call('delete-playlist', { playlistId: 'tavern' });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(
      /^Error: Failed to delete playlist: Deleting playlists is not permitted\. .*"permPlaylists"/
    );
  });

  it('delete by id with the full level', async () => {
    const h = open({ settings: { [`${MODULE_ID}.permPlaylists`]: 'full' } });
    h.foundry.seed('Playlist', { _id: 'tavern', name: 'Tavern', sounds: [] });
    expect(text(await h.call('delete-playlist', { playlistId: 'tavern' }))).toBe(
      'Playlist "Tavern" deleted.'
    );
  });

  it('accept a bare list as the answer', () => {
    expect(formatPlaylists([])).toBe('No playlists in this world.');
    expect(formatPlaylists([{ id: 'p', name: 'P', soundCount: 2 }])).toBe('P (2 tracks, id p)');
  });
});

describe('roll table tools', () => {
  it('say so for an empty world', async () => {
    expect(text(await open().call('list-roll-tables'))).toBe('No roll tables in this world.');
  });

  it('create, list and delete a table', async () => {
    const h = open({ settings: { [`${MODULE_ID}.permRollTables`]: 'full' } });
    const created = text(
      await h.call('create-roll-table', {
        name: 'Loot',
        folderPath: 'Treasure',
        results: [{ text: 'gold' }, { text: 'gem' }, { text: 'nothing', range: [4, 6] }],
      })
    );
    expect(created).toMatch(
      /^Roll table "Loot" created \(1d6, 3 entries\)\nId: (\S+)\nFolder: Treasure/
    );
    expect(created).toContain('Warning: No entry covers 3; a roll there draws nothing.');
    const id = /Id: (\S+)/.exec(created)?.[1] ?? '';

    expect(text(await h.call('list-roll-tables'))).toBe(`Loot (1d6, 3 entries, id ${id})`);
    expect(text(await h.call('delete-roll-table', { tableId: id }))).toBe(
      'Roll table "Loot" deleted.'
    );
  });

  it('check the arguments before the module is asked', async () => {
    const h = open();
    const result = await h.call('create-roll-table', { name: 'Loot' });
    expect(text(result)).toBe(
      'Error: Invalid arguments for create-roll-table: results is required'
    );
    expect(formatRollTables({ tables: [] })).toBe('No roll tables in this world.');
  });
});

describe('an old module', () => {
  it('answering "Access denied" as a normal value is an error', async () => {
    const legacy = (harness = createAreaHarness({
      moduleAreas: [
        {
          id: 'world',
          queries: [
            {
              names: 'listRollTables',
              handler: {
                access: { kind: 'read' },
                run: () => ({ success: false, error: 'Access denied' }),
              },
            },
          ],
        },
      ],
      serverAreas: [worldArea],
    }));
    const result = await legacy.call('list-roll-tables');
    expect(result).toEqual({
      content: [{ type: 'text', text: 'Error: Failed to list roll tables: Access denied' }],
      isError: true,
    });
  });
});
