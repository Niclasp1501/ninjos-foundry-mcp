/**
 * This server against a module of the previous generation. The fake module
 * answers with the shapes described for that generation, not
 * with anything this generation's module returns.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ModuleArea } from '../../../module/areas.js';
import type { QueryHandler } from '../../../module/dispatcher.js';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { worldArea } from './index.js';

let harness: AreaHarness | null = null;
afterEach(() => {
  harness?.close();
  harness = null;
});

type Answer = (data: Record<string, unknown>) => unknown;

const OLD_ANSWERS: Record<string, Answer> = {
  getPermissions: () => ({
    writeOperationsEnabled: true,
    permissions: [
      {
        kind: 'permScenes',
        label: 'Scenes',
        level: 'write',
        canCreate: true,
        canUpdate: true,
        canDelete: false,
      },
      {
        kind: 'permPlaylists',
        label: 'Playlists',
        level: 'full',
        canCreate: true,
        canUpdate: true,
        canDelete: true,
      },
      {
        kind: 'permRollTables',
        label: 'Roll tables',
        level: 'read',
        canCreate: false,
        canUpdate: false,
        canDelete: false,
      },
    ],
  }),
  listPlaylists: data => ({
    playlists: [
      {
        id: 'tavern',
        name: 'Tavern',
        mode: 0,
        playing: false,
        folder: null,
        soundCount: 1,
        ...(data['includeSounds'] === false
          ? {}
          : {
              sounds: [{ id: 'lute', name: 'Lute', path: 'lute.ogg', repeat: true, volume: 0.5 }],
            }),
      },
    ],
  }),
  setScenePlaylist: data =>
    data['playlistName']
      ? {
          scene: 'Harbour',
          playlist: String(data['playlistName']),
          sound: data['soundName'] ?? null,
        }
      : { scene: 'Harbour', playlist: null, sound: null },
  deletePlaylist: () => ({ name: 'Tavern' }),
  listRollTables: () => ({
    tables: [{ id: 't1', name: 'Weather', formula: '1d4', folder: 'Travel', resultCount: 4 }],
    total: 1,
  }),
  createRollTable: data => ({ name: data['name'], formula: '1d2', resultCount: 2, id: 't2' }),
  // Every old handler answers a missing Gamemaster like this, as a normal value (1.3).
  deleteRollTable: () => ({ error: 'Access denied', success: false }),
};

/** The previous module as an area; its own handlers do no permission checks of this generation. */
function oldModule(without: string[] = []): ModuleArea {
  return {
    id: 'world',
    queries: Object.entries(OLD_ANSWERS)
      .filter(([name]) => !without.includes(name))
      .map(([name, answer]) => {
        const handler: QueryHandler = {
          access: { kind: 'read' },
          run: data => answer((data ?? {}) as Record<string, unknown>),
        };
        return { names: name, handler };
      }),
  };
}

const open = (without: string[] = []) =>
  (harness = createAreaHarness({ moduleAreas: [oldModule(without)], serverAreas: [worldArea] }));

const text = (result: { content: Array<{ type: string; text?: string }> }) =>
  result.content[0]?.text ?? '';

describe('permissions from a previous module', () => {
  it('formats the permissions list with label and level', async () => {
    const result = await open().call('get-permissions');
    expect(result.isError).toBeUndefined();
    expect(text(result).split('\n')).toEqual([
      'Writing is permitted in principle.',
      'Per kind (setting: level; deleting needs "full" and is off by default):',
      '- Scenes: create, change (permScenes: write)',
      '- Playlists: create, change, delete (permPlaylists: full)',
      '- Roll tables: read only (permRollTables: read)',
    ]);
  });

  it('derives what a row allows from its level when the flags are missing', async () => {
    const { formatPermissions } = await import('./permissions.js');
    expect(
      formatPermissions({
        writeOperationsEnabled: false,
        permissions: [{ label: 'Scenes', level: 'full' }],
      })
    ).toContain('- Scenes: read only, held back by the switch');
  });
});

describe('playlists from a previous module', () => {
  it('lists playlists with their sounds', async () => {
    expect(text(await open().call('list-playlists'))).toBe(
      'Tavern (1 tracks, id tavern)\n  [lute] Lute'
    );
  });

  it('formats scene, playlist and sound texts', async () => {
    const h = open();
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

  it('formats the deleted name', async () => {
    expect(text(await open().call('delete-playlist', { playlistId: 'tavern' }))).toBe(
      'Playlist "Tavern" deleted.'
    );
  });

  it('names a missing query as a module of another version', async () => {
    const result = await open(['listPlaylists']).call('list-playlists');
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(
      /^Error: Failed to list playlists: the connected Foundry module does not know the query "listPlaylists" \(.*No handler found for query.*\)\. /
    );
  });
});

describe('roll tables from a previous module', () => {
  it('lists the tables', async () => {
    expect(text(await open().call('list-roll-tables'))).toBe('Weather (1d4, 4 entries, id t1)');
  });

  it('formats a created table from resultCount', async () => {
    const result = await open().call('create-roll-table', {
      name: 'Coin',
      results: [{ text: 'heads' }, { text: 'tails' }],
    });
    expect(text(result)).toBe('Roll table "Coin" created (1d2, 2 entries)\nId: t2');
  });

  it('turns "Access denied" into a tool error', async () => {
    const result = await open().call('delete-roll-table', { tableId: 't1' });
    expect(result).toEqual({
      content: [{ type: 'text', text: 'Error: Failed to delete roll table: Access denied' }],
      isError: true,
    });
  });
});
