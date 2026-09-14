/**
 * The tools of the effects-playback area from the registry to the module handlers and back,
 * and against a module that does not know their queries.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ModuleArea } from '../../../module/areas.js';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { FakeFoundry } from '../../../testing/fake-foundry.js';
import { withPlayback } from '../../../module/areas/effects-playback/testing.js';
import { effectsPlaybackArea } from './index.js';

let harness: AreaHarness | null = null;
afterEach(() => {
  harness?.close();
  harness = null;
});

const text = (result: { content: Array<{ type: string; text?: string }> }) =>
  result.content[0]?.text ?? '';

/** Parameters as the original names them, plus `channel`. */
const PARAMETERS: Record<string, { all: string[]; required: string[] }> = {
  'manage-effects': {
    all: [
      'action',
      'actorIdentifier',
      'parentType',
      'parentItemIdentifier',
      'effectId',
      'effectData',
    ],
    required: ['action', 'actorIdentifier', 'parentType'],
  },
  'manage-playlists': {
    all: [
      'action',
      'playlist',
      'name',
      'mode',
      'fade',
      'description',
      'sorting',
      'folder',
      'color',
      'channel',
      'sounds',
      'updates',
    ],
    required: ['action'],
  },
  'control-playlist': { all: ['playlist', 'command', 'sound'], required: ['playlist', 'command'] },
  'update-scene-music': {
    all: ['scene_identifier', 'playlist', 'playlist_sound'],
    required: ['scene_identifier'],
  },
  'replace-journal-page': {
    all: ['journalId', 'pageId', 'newContent', 'newPageName'],
    required: ['journalId', 'pageId', 'newContent'],
  },
};

describe('names and parameters', () => {
  it('are the original ones', () => {
    const tools = effectsPlaybackArea.tools ?? [];
    expect(tools.map(tool => tool.name).sort()).toEqual(Object.keys(PARAMETERS).sort());
    for (const tool of tools) {
      const schema = tool.inputSchema as {
        properties: Record<string, unknown>;
        required: string[];
      };
      expect(Object.keys(schema.properties).sort(), tool.name).toEqual(
        [...(PARAMETERS[tool.name]?.all ?? [])].sort()
      );
      expect(schema.required, tool.name).toEqual(PARAMETERS[tool.name]?.required);
      expect(tool.description, tool.name).not.toMatch(/[–—]/);
    }
  });
});

describe('through the whole way', () => {
  it('answers with the result as JSON', async () => {
    const h = (harness = createAreaHarness({ foundry: withPlayback(new FakeFoundry()) }));
    h.foundry.seed('Playlist', {
      _id: 'tavern',
      name: 'Tavern',
      mode: 0,
      sounds: [{ _id: 'lute', name: 'Lute' }],
    });
    const result = await h.call('control-playlist', { playlist: 'Tavern', command: 'play' });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(text(result))).toMatchObject({
      success: true,
      action: 'play',
      playlist: { playing: true },
    });
  });

  it('passes null on, so update-scene-music can clear', async () => {
    const h = (harness = createAreaHarness());
    h.foundry.seed('Playlist', { _id: 'tavern', name: 'Tavern', sounds: [] });
    const scene = h.foundry.seed('Scene', { _id: 'harbour', name: 'Harbour', playlist: 'tavern' });
    const result = await h.call('update-scene-music', {
      scene_identifier: 'Harbour',
      playlist: null,
    });
    expect(result.isError).toBeFalsy();
    expect(scene['playlist']).toBeNull();
  });

  it('wraps a module error once, with its cause', async () => {
    const h = (harness = createAreaHarness());
    const result = await h.call('manage-playlists', {
      action: 'update',
      playlist: 'Forest',
      fade: 1,
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(
      /^Error: Failed to manage playlists: playlist not found: "Forest"\. There are no playlists\./
    );
  });

  it('refuses unknown parameters before the module is asked', async () => {
    const h = (harness = createAreaHarness());
    const result = await h.call('control-playlist', {
      playlist: 'Tavern',
      command: 'play',
      volume: 1,
    });
    expect(text(result)).toBe(
      'Error: Invalid arguments for control-playlist: volume is not a known parameter'
    );
    expect(h.foundry.operations).toEqual([]);
  });
});

describe('a module that does not know the queries', () => {
  it('is named as too old, with the cause', async () => {
    const h = (harness = createAreaHarness({
      moduleAreas: [],
      serverAreas: [effectsPlaybackArea],
    }));
    const result = await h.call('manage-effects', {
      action: 'create',
      actorIdentifier: 'Hero',
      parentType: 'actor',
      effectData: { name: 'Haste' },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(
      /^Error: Failed to manage effects: the connected Foundry module does not know the query manageEffects, so it is older than this server\..*Nothing was changed\. \(No handler found for query: manageEffects\)$/
    );
  });

  describe('replace-journal-page through the previous queries', () => {
    function oldModule(pageType = 'text') {
      const store = { content: '<p>old</p>', writes: 0 };
      const area: ModuleArea = {
        id: 'previous',
        queries: [
          {
            names: 'listJournals',
            handler: {
              access: { kind: 'read' },
              run: () => [
                {
                  id: 'lore',
                  name: 'Lore',
                  pages: [{ id: 'intro', name: 'Intro', type: pageType }],
                },
              ],
            },
          },
          {
            names: 'updateJournalContent',
            handler: {
              access: { kind: 'read' },
              run: data => {
                store.content = String((data as { content: string }).content);
                store.writes += 1;
                return { success: true, pageId: 'intro', pageName: 'Intro' };
              },
            },
          },
          {
            names: 'getJournalPageContent',
            handler: {
              access: { kind: 'read' },
              run: data => {
                const { offset = 0, maxChars = 50000 } = data as {
                  offset?: number;
                  maxChars?: number;
                };
                const content = store.content.slice(offset, offset + maxChars);
                const next = offset + content.length;
                return {
                  content,
                  contentLength: store.content.length,
                  hasMore: next < store.content.length,
                  nextOffset: next,
                };
              },
            },
          },
        ],
      };
      const h = (harness = createAreaHarness({
        moduleAreas: [area],
        serverAreas: [effectsPlaybackArea],
      }));
      return { h, store };
    }

    it('writes and compares the whole page read back in chunks', async () => {
      const { h, store } = oldModule();
      const long = `<p>${'x'.repeat(250_000)}</p>`;
      const result = await h.call('replace-journal-page', {
        journalId: 'lore',
        pageId: 'intro',
        newContent: long,
      });
      expect(result.isError).toBeFalsy();
      expect(JSON.parse(text(result))).toMatchObject({
        verified: true,
        length: long.length,
        pageName: 'Intro',
      });
      expect(text(result)).toContain('older than this server');
      expect(store.content).toBe(long);
    });

    it('refuses renaming and non-text pages without writing', async () => {
      const first = oldModule();
      const renamed = await first.h.call('replace-journal-page', {
        journalId: 'lore',
        pageId: 'intro',
        newContent: 'x',
        newPageName: 'New',
      });
      expect(text(renamed)).toMatch(
        /does not know the query replaceJournalPage.*Nothing was changed/
      );
      expect(first.store.writes).toBe(0);
      first.h.close();

      const second = oldModule('image');
      const image = await second.h.call('replace-journal-page', {
        journalId: 'lore',
        pageId: 'intro',
        newContent: 'x',
      });
      expect(text(image)).toMatch(/is a image page; only text pages have HTML content/);
      expect(second.store.writes).toBe(0);
    });
  });
});
