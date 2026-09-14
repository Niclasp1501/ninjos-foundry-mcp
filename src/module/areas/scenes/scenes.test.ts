/**
 * The scene queries of the scenes area on a fake Foundry 14 world, through the
 * dispatcher with its GM check, write switch and permission matrix.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import {
  FakeFoundry,
  type FakeDocument,
  type FakeFoundryOptions,
} from '../../../testing/fake-foundry.js';
import { MODULE_ID } from '../../../common/constants.js';
import { addedLevelElevation } from './create.js';
import { withScenes, type FakeCanvas, type ScenesFakeOptions } from './testing.js';

let harness: AreaHarness | null = null;
afterEach(() => {
  harness?.close();
  harness = null;
});

const MEDIA = {
  'Maps/Hafen Nacht.webp': { width: 3000, height: 2000 },
  'Maps/Kerker.webp': { width: 1500, height: 1000 },
};

function open(options: FakeFoundryOptions = {}, scenes: ScenesFakeOptions = {}): AreaHarness {
  const foundry = withScenes(new FakeFoundry(options), { media: MEDIA, ...scenes });
  harness = createAreaHarness({ foundry });
  return harness;
}

const full = { settings: { [`${MODULE_ID}.permScenes`]: 'full' } };

function scene(h: AreaHarness, data: Record<string, unknown>): FakeDocument {
  return h.foundry.seed('Scene', {
    width: 1000,
    height: 800,
    padding: 0,
    grid: { size: 100 },
    ...data,
  });
}

function level(
  h: AreaHarness,
  parent: FakeDocument,
  data: Record<string, unknown> = {}
): FakeDocument {
  return h.foundry.seed(
    'Level',
    { name: 'Level', sort: 0, background: { src: null }, ...data },
    parent
  );
}

const levels = (doc: FakeDocument) => doc.getEmbeddedCollection('Level').contents;

describe('list-scenes', () => {
  it('filters by a part of the name in any case, or the active scene only', async () => {
    const h = open();
    const hafen = scene(h, { name: 'Hafen Nacht', active: true });
    level(h, hafen, { background: { src: 'Maps/Hafen%20Nacht.webp' } });
    scene(h, { name: 'Kerker' });

    const filtered = (await h.query('list-scenes', { filter: 'hafen' })) as Array<
      Record<string, unknown>
    >;
    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toMatchObject({
      name: 'Hafen Nacht',
      active: true,
      background: 'Maps/Hafen Nacht.webp',
      walls: 0,
    });
    await expect(h.query('list-scenes', { include_active_only: true })).resolves.toHaveLength(1);
  });
});

describe('listSceneFolders', () => {
  it('gives the full path, the scenes directly inside, sorted by path, and marks paths deeper than ten', async () => {
    const h = open();
    let parent: string | null = null;
    const ids: string[] = [];
    for (let depth = 0; depth < 11; depth += 1) {
      const folder = h.foundry.seed('Folder', { name: `F${depth}`, type: 'Scene', folder: parent });
      ids.push(folder.id);
      parent = folder.id;
    }
    h.foundry.seed('Folder', { name: 'Journale', type: 'JournalEntry', folder: null });
    scene(h, { name: 'Tief', folder: ids[10] });

    const { folders } = (await h.query('listSceneFolders')) as {
      folders: Array<Record<string, unknown>>;
    };
    expect(folders).toHaveLength(11);
    expect(folders[0]).toEqual({ id: ids[0], path: 'F0', scenes: 0 });
    const deepest = folders.find(folder => folder['id'] === ids[10]);
    expect(deepest).toMatchObject({
      path: 'F1/F2/F3/F4/F5/F6/F7/F8/F9/F10',
      pathIncomplete: true,
      scenes: 1,
    });
  });
});

describe('getActiveScene', () => {
  it('fails without an active scene', async () => {
    await expect(open().query('getActiveScene')).rejects.toMatchObject({
      moduleCode: 'SCENE_NOT_FOUND',
    });
  });

  it('leaves hidden tokens out of the list and the summary unless asked', async () => {
    const h = open();
    const kai = scene(h, { name: 'Kai', active: true });
    h.foundry.seed('Token', { name: 'Wache', x: 1, y: 2, hidden: false, actorId: 'a1' }, kai);
    h.foundry.seed('Token', { name: 'Dieb', x: 3, y: 4, hidden: true }, kai);
    h.foundry.seed('Note', { x: 5, y: 6, text: 'x'.repeat(150) }, kai);

    const shown = (await h.query('getActiveScene', { includeHidden: false })) as Record<
      string,
      any
    >;
    expect(shown['tokens'].map((t: { name: string }) => t.name)).toEqual(['Wache']);
    expect(shown['tokenSummary']).toEqual({ shown: 1, hidden: 0, hiddenNotShown: 1, withActor: 1 });
    expect(shown['notes'][0].text).toHaveLength(100);
    expect(shown['elements']).toEqual({ walls: 0, lights: 0, sounds: 0, notes: 1 });

    const all = (await h.query('getActiveScene', { includeHidden: true })) as Record<string, any>;
    expect(all['tokenSummary']).toEqual({ shown: 2, hidden: 1, withActor: 1 });
    const none = (await h.query('getActiveScene', { includeTokens: false })) as Record<
      string,
      unknown
    >;
    expect(none['tokens']).toBeUndefined();
  });
});

describe('createScene', () => {
  it('measures the file, derives the names, creates the folders, patches the level and stores a thumbnail', async () => {
    const h = open();
    const created = (await h.query('createScene', {
      name: 'SC_Hafen_Nacht',
      background: 'Maps/Hafen Nacht.webp',
      folderPath: 'Orte/Hafen',
    })) as Record<string, any>;

    expect(created).toMatchObject({
      name: 'SC Hafen Nacht',
      navName: 'Hafen Nacht',
      width: 3000,
      height: 2000,
      measured: true,
      foldersCreated: ['Orte', 'Hafen'],
      template: null,
      levelPatched: true,
      thumbnail: { updated: true },
      warnings: [],
    });
    const doc = h.foundry.collection('Scene').get(created['id']) as FakeDocument;
    expect(doc['background']).toEqual({ src: 'Maps/Hafen%20Nacht.webp' });
    expect(doc['navigation']).toBe(false);
    expect(doc['grid']).toEqual({ size: 100 });
    expect(levels(doc)[0]?.['background']).toEqual({ src: 'Maps/Hafen%20Nacht.webp' });
    expect(doc['thumb']).toBe('data:image/webp;base64,AAAA');

    const folders = h.foundry.collection('Folder').contents;
    expect(folders.map(f => [f['name'], f['folder'] === null ? null : 'child'])).toEqual([
      ['Orte', null],
      ['Hafen', 'child'],
    ]);
    expect(folders[0]?.['flags']).toEqual({
      [MODULE_ID]: { createdByMcp: true, mcpGenerated: true, createdAt: expect.any(String) },
    });
    expect(doc['folder']).toBe(folders[1]?.id);
    expect(h.changeLog.list().map(entry => `${entry.document}:${entry.action}`)).toEqual([
      'Scenes:create',
      'Folders:create',
      'Folders:create',
    ]);
  });

  it('copies settings of a template but nothing that lies on its map', async () => {
    const h = open();
    const journal = h.foundry.seed('JournalEntry', { name: 'Hafen' });
    const template = scene(h, {
      name: 'Vorlage',
      width: 5000,
      height: 4000,
      padding: 0.1,
      grid: { size: 140, type: 1 },
      environment: { darknessLevel: 0.5 },
      journal: journal.id,
      thumb: 'old.webp',
    });
    level(h, template, {
      background: { src: 'Maps/Alt.webp', tint: '#ff0000', color: '#123456' },
      elevation: { bottom: 0, top: 30 },
    });
    h.foundry.seed('Wall', { c: [0, 0, 1, 1] }, template);
    h.foundry.seed('Token', { name: 'T' }, template);

    const created = (await h.query('createScene', {
      name: 'Neu',
      background: 'Maps/Unbekannt.webp',
      templateName: 'vorlage',
    })) as Record<string, any>;
    const doc = h.foundry.collection('Scene').get(created['id']) as FakeDocument;
    expect(created).toMatchObject({
      width: 5000,
      height: 4000,
      measured: false,
      template: 'Vorlage',
      templateId: template.id,
    });
    expect(created['warnings'][0]).toContain('could not be measured');
    expect(doc['grid']).toEqual({ size: 140, type: 1 });
    expect(doc['padding']).toBe(0.1);
    expect(doc['environment']).toEqual({ darknessLevel: 0.5 });
    expect(doc['journal']).toBeNull();
    expect(doc['thumb']).toBe('data:image/webp;base64,AAAA');
    expect(doc.getEmbeddedCollection('Wall').size).toBe(0);
    expect(doc.getEmbeddedCollection('Token').size).toBe(0);
    expect(levels(doc)[0]).toMatchObject({
      background: { src: 'Maps/Unbekannt.webp', tint: '#ff0000', color: '#123456' },
      elevation: { bottom: 0, top: 30 },
    });
  });

  it('checks every identifier before the first write', async () => {
    const h = open();
    await expect(
      h.query('createScene', {
        name: 'X',
        background: 'Maps/Kerker.webp',
        folderPath: 'Neu',
        templateName: 'Fehlt',
      })
    ).rejects.toMatchObject({
      moduleCode: 'SCENE_NOT_FOUND',
      message: 'Failed to create scene: Template not found: "Fehlt".',
    });
    expect(h.foundry.operations).toEqual([]);
  });

  it('keeps the scene when the thumbnail fails, and says so', async () => {
    const h = open({}, { thumbnail: 'throws' });
    const created = (await h.query('createScene', {
      name: 'X',
      background: 'Maps/Kerker.webp',
    })) as Record<string, any>;
    expect(created['thumbnail']).toEqual({ updated: false, reason: 'WebGL context lost' });
    expect(created['warnings']).toContain('No thumbnail: WebGL context lost.');
    expect(h.foundry.collection('Scene').size).toBe(1);
  });

  it('refuses two folders of the same name on one level instead of taking the first', async () => {
    const h = open();
    h.foundry.seed('Folder', { name: 'Orte', type: 'Scene', folder: null });
    h.foundry.seed('Folder', { name: 'Orte', type: 'Scene', folder: null });
    await expect(
      h.query('createScene', { name: 'X', background: 'Maps/Kerker.webp', folderPath: 'Orte' })
    ).rejects.toMatchObject({ moduleCode: 'AMBIGUOUS' });
    expect(h.foundry.collection('Scene').size).toBe(0);
  });

  it('links a journal page and activates on request', async () => {
    const h = open();
    const journal = h.foundry.seed('JournalEntry', {
      name: 'Hafen',
      pages: [{ name: 'Kai' }, { name: 'Markt' }],
    });
    const created = (await h.query('createScene', {
      name: 'X',
      background: 'Maps/Kerker.webp',
      journalIdentifier: 'Hafen',
      journalPageName: 'Markt',
      activate: true,
    })) as Record<string, any>;
    const page = journal.getEmbeddedCollection('JournalEntryPage').contents[1];
    expect(created).toMatchObject({
      journal: 'Hafen',
      journalId: journal.id,
      journalPageId: page?.id,
      journalPageName: 'Markt',
    });
    expect(created['activated']).toBe(true);
  });

  it('never matches a page by a part of its name, and lists the pages', async () => {
    const h = open();
    h.foundry.seed('JournalEntry', { name: 'Hafen', pages: [{ _id: 'p1', name: 'Marktplatz' }] });
    await expect(
      h.query('createScene', {
        name: 'X',
        background: 'Maps/Kerker.webp',
        journalIdentifier: 'Hafen',
        journalPageName: 'Markt',
      })
    ).rejects.toMatchObject({
      moduleCode: 'PAGE_NOT_FOUND',
      message:
        'Failed to create scene: Page not found in the journal "Hafen": "Markt". Pages: "Marktplatz" [p1].',
    });
  });

  it('works on a Foundry without levels and reports that the level was not patched', async () => {
    const h = open({ version: '13.351' }, { levels: false });
    const created = (await h.query('createScene', {
      name: 'X',
      background: 'Maps/Kerker.webp',
    })) as Record<string, any>;
    expect(created).toMatchObject({ levelPatched: false, warnings: [] });
  });
});

describe('updateScene', () => {
  it('needs a change and an unambiguous scene, never a part of a name', async () => {
    const h = open();
    scene(h, { name: 'Hafen Nacht' });
    scene(h, { name: 'Kerker' });
    scene(h, { name: 'kerker' });
    await expect(h.query('updateScene', { sceneIdentifier: 'Hafen Nacht' })).rejects.toMatchObject({
      moduleCode: 'NO_CHANGE',
    });
    await expect(
      h.query('updateScene', { sceneIdentifier: 'Hafen', navigation: true })
    ).rejects.toMatchObject({
      moduleCode: 'SCENE_NOT_FOUND',
      message:
        'Failed to update scene: Scene not found: "Hafen". Names containing it: "Hafen Nacht" [' +
        h.foundry.collection('Scene').contents[0]?.id +
        '].',
    });
    await expect(
      h.query('updateScene', { sceneIdentifier: 'KERKER', navigation: true })
    ).rejects.toMatchObject({ moduleCode: 'AMBIGUOUS' });
    expect(h.foundry.operations).toEqual([]);
  });

  it('swaps the background on scene and level, measures it and reads everything back', async () => {
    const h = open();
    const doc = scene(h, { name: 'Alt', background: { src: 'Maps/Alt.webp' } });
    level(h, doc, { background: { src: 'Maps/Alt.webp' } });

    const result = (await h.query('updateScene', {
      sceneIdentifier: 'Alt',
      name: 'SC_Hafen_Nacht',
      background: 'Maps/Hafen Nacht.webp',
      backgroundColor: '#000000',
    })) as Record<string, any>;
    expect(result).toMatchObject({ name: 'SC Hafen Nacht', measured: true, levelPatched: true });
    expect(result['changed']).toEqual([
      'name',
      'navName',
      'background',
      'width',
      'height',
      'backgroundColor',
    ]);
    expect(doc).toMatchObject({
      width: 3000,
      height: 2000,
      navName: 'Hafen Nacht',
      backgroundColor: '#000000',
    });
    expect(levels(doc)[0]?.['background']).toEqual({
      src: 'Maps/Hafen%20Nacht.webp',
      color: '#000000',
    });
    const entry = h.changeLog.list()[0];
    expect(entry).toMatchObject({ action: 'update', undoable: true });
    expect(entry?.before).toMatchObject({ name: 'Alt', background: { src: 'Maps/Alt.webp' } });
  });

  it('removes the journal link with an empty identifier and moves to no folder with an empty path', async () => {
    const h = open();
    const journal = h.foundry.seed('JournalEntry', { name: 'Hafen' });
    const folder = h.foundry.seed('Folder', { name: 'Orte', type: 'Scene', folder: null });
    const doc = scene(h, {
      name: 'Kai',
      journal: journal.id,
      journalEntryPage: 'x',
      folder: folder.id,
    });
    const result = (await h.query('updateScene', {
      sceneIdentifier: 'Kai',
      journalIdentifier: '',
      folderPath: '',
    })) as Record<string, any>;
    expect(result['changed']).toEqual(['journal', 'folder']);
    expect(doc).toMatchObject({ journal: null, journalEntryPage: null, folder: null });
  });

  it('refuses a colour that is not hex', async () => {
    const h = open();
    scene(h, { name: 'Kai' });
    await expect(
      h.query('updateScene', { sceneIdentifier: 'Kai', backgroundColor: 'black' })
    ).rejects.toMatchObject({ moduleCode: 'INVALID_ARGUMENT' });
  });
});

describe('createSceneNote', () => {
  it('places a note that opens the journal page and reads it back', async () => {
    const h = open();
    const doc = scene(h, { name: 'Stadt' });
    const journal = h.foundry.seed('JournalEntry', {
      name: 'Taverne',
      pages: [{ _id: 'pg', name: 'Wirt' }],
    });
    const result = (await h.query('createSceneNote', {
      sceneIdentifier: 'Stadt',
      journalName: journal.id,
      pageName: 'Wirt',
      x: 100,
      y: 5000,
      label: 'Zum Keiler',
    })) as Record<string, any>;
    const note = doc.getEmbeddedCollection('Note').contents[0];
    expect(note).toMatchObject({
      entryId: journal.id,
      pageId: 'pg',
      x: 100,
      y: 5000,
      text: 'Zum Keiler',
      iconSize: 40,
      texture: { src: 'icons/svg/book.svg' },
    });
    expect(result).toMatchObject({
      scene: 'Stadt',
      sceneName: 'Stadt',
      noteId: note?.id,
      journal: 'Taverne',
      pageName: 'Wirt',
    });
    expect(result['warnings'][0]).toContain('lies outside the scene');
  });

  it('finds the note by reading back when Foundry throws after creating it', async () => {
    const h = open();
    const doc = scene(h, { name: 'Stadt' });
    const journal = h.foundry.seed('JournalEntry', { name: 'Taverne' });
    h.foundry.hooks.on('createNote', () => {
      throw new TypeError("Cannot read properties of null (reading 'clipboard')");
    });
    const result = (await h.query('createSceneNote', {
      sceneIdentifier: 'Stadt',
      journalName: journal.id,
      x: 10,
      y: 10,
    })) as Record<string, any>;
    const note = doc.getEmbeddedCollection('Note').contents[0];
    expect(result).toMatchObject({ noteId: note?.id });
    expect(result['warnings'][0]).toContain('the note is on the scene');
  });

  it('needs both coordinates', async () => {
    const h = open();
    scene(h, { name: 'Stadt' });
    h.foundry.seed('JournalEntry', { name: 'Taverne' });
    await expect(
      h.query('createSceneNote', { sceneIdentifier: 'Stadt', journalName: 'Taverne', x: 1 })
    ).rejects.toMatchObject({
      message: 'Failed to create scene note: x and y are required',
    });
  });
});

describe('refreshSceneThumb', () => {
  it('renews the thumbnail, and names the cause when Foundry throws or returns nothing', async () => {
    let h = open();
    const doc = scene(h, { name: 'Kai', thumb: 'old.webp' });
    await expect(h.query('refreshSceneThumb', { sceneIdentifier: 'Kai' })).resolves.toEqual({
      updated: true,
      scene: 'Kai',
      sceneId: doc.id,
      sceneName: 'Kai',
    });
    harness?.close();

    h = open({}, { thumbnail: 'throws' });
    scene(h, { name: 'Kai' });
    await expect(h.query('refreshSceneThumb', { sceneIdentifier: 'Kai' })).rejects.toMatchObject({
      message: 'Failed to refresh scene thumbnail: Thumbnail failed: WebGL context lost',
    });
    harness?.close();

    h = open({}, { thumbnail: 'empty' });
    scene(h, { name: 'Kai' });
    await expect(h.query('refreshSceneThumb', { sceneIdentifier: 'Kai' })).rejects.toMatchObject({
      message:
        'Failed to refresh scene thumbnail: Thumbnail of "Kai" could not be generated: Foundry returned no image',
    });
  });
});

describe('switch-scene', () => {
  it('activates for everyone, reads it back and fits the view', async () => {
    const h = open();
    const old = scene(h, { name: 'Alt', active: true });
    const next = scene(h, { name: 'Hafen', width: 4000, height: 2000 });
    const result = (await h.query('switch-scene', { sceneId: 'hafen' })) as Record<string, any>;
    expect(result).toMatchObject({ success: true, id: next.id, viewOptimized: true, warnings: [] });
    expect([old['active'], next['active']]).toEqual([false, true]);
    const canvas = (globalThis as unknown as { canvas: FakeCanvas }).canvas;
    expect(canvas.pans[0]).toEqual({ x: 3000, y: 1500, scale: 0.475 });
    expect(h.changeLog.list()[0]?.before).toEqual({ activeSceneId: old.id });
  });

  it('needs the write level for scenes', async () => {
    const h = open({ settings: { [`${MODULE_ID}.permScenes`]: 'read' } });
    scene(h, { name: 'Hafen' });
    await expect(h.query('switch-scene', { scene_identifier: 'Hafen' })).rejects.toMatchObject({
      moduleCode: 'PERMISSION_DENIED',
    });
  });
});

describe('deleteScene', () => {
  it('is off by default', async () => {
    const h = open();
    const doc = scene(h, { name: 'Kai' });
    await expect(h.query('deleteScene', { sceneId: doc.id })).rejects.toMatchObject({
      moduleCode: 'PERMISSION_DENIED',
    });
  });

  it('takes the id only, never deletes the active scene, and reads the deletion back', async () => {
    const h = open(full);
    const active = scene(h, { name: 'Aktiv', active: true });
    const doc = scene(h, { name: 'Kai' });
    await expect(h.query('deleteScene', { sceneId: 'Kai' })).rejects.toMatchObject({
      moduleCode: 'SCENE_NOT_FOUND',
      message: `Failed to delete scene: no scene has the id "Kai". A scene is named like that (${doc.id}); delete-scene takes the id only, never a name.`,
    });
    await expect(h.query('deleteScene', { sceneId: active.id })).rejects.toMatchObject({
      moduleCode: 'SCENE_ACTIVE',
    });
    await expect(h.query('deleteScene', { sceneId: doc.id })).resolves.toEqual({
      id: doc.id,
      name: 'Kai',
      deleted: true,
    });
    expect(h.foundry.collection('Scene').has(doc.id)).toBe(false);
    expect(h.changeLog.list()[0]).toMatchObject({ action: 'delete', undoable: true });
  });
});

describe('restoreScene', () => {
  const backup = (entries: unknown) => ({
    files: { 'Bergung/szenen.json': JSON.stringify(entries) },
  });

  it('asks for the index when the list holds several scenes, and names them', async () => {
    const h = open(
      {},
      backup([
        { _id: 's1', name: 'Hafen' },
        { _id: 's2', name: 'Kerker' },
      ])
    );
    await expect(
      h.query('restoreScene', { jsonPath: 'Bergung/szenen.json' })
    ).rejects.toMatchObject({
      moduleCode: 'INDEX_REQUIRED',
      message:
        'Failed to restore scene: No index given. The file contains 2: 0 = Hafen, 1 = Kerker',
    });
    await expect(
      h.query('restoreScene', { jsonPath: 'Bergung/szenen.json', index: 5 })
    ).rejects.toMatchObject({
      moduleCode: 'INDEX_OUT_OF_RANGE',
      message:
        'Failed to restore scene: No entry 5 in the file. It contains 2: 0 = Hafen, 1 = Kerker',
    });
  });

  it('brings walls and tokens back under a new id, never active, and adds a level to an old backup', async () => {
    const h = open(
      {},
      backup({
        _id: 'orig',
        name: 'Kerker',
        active: true,
        thumb: 'x',
        background: { src: 'Maps/Kerker.webp' },
        backgroundColor: '#111111',
        walls: [{ c: [0, 0, 1, 1] }, { c: [1, 1, 2, 2] }],
        tokens: [{ name: 'Wache' }],
        folder: 'gone',
      })
    );
    const result = (await h.query('restoreScene', {
      jsonPath: 'Bergung/szenen.json',
      name: 'SC_Kerker_Neu',
    })) as Record<string, any>;
    expect(result).toMatchObject({
      name: 'SC Kerker Neu',
      kept: { walls: 2, tokens: 1, tiles: 0, lights: 0, sounds: 0, levels: 1 },
      levelAdded: true,
      folderId: null,
    });
    expect(result['id']).not.toBe('orig');
    expect(result['warnings']).toEqual([
      'The folder gone of the backup does not exist in this world; the scene has no folder.',
    ]);
    const doc = h.foundry.collection('Scene').get(result['id']) as FakeDocument;
    expect(doc).toMatchObject({
      active: false,
      navName: 'Kerker Neu',
      thumb: 'data:image/webp;base64,AAAA',
    });
    expect(levels(doc)[0]).toMatchObject({
      background: { src: 'Maps/Kerker.webp', color: '#111111' },
    });
    // No elevation in the backup: the level keeps Foundry's height.
    expect(levels(doc)[0]?.['elevation']).toBeUndefined();
  });

  it('gives the added level the height of the elevations in the backup', async () => {
    const h = open(
      {},
      backup({
        name: 'Turm',
        tiles: [{ elevation: -5 }],
        tokens: [{ name: 'Wache', elevation: 30 }],
        drawings: [{ elevation: 2 }],
        lights: [{}],
      })
    );
    const result = (await h.query('restoreScene', { jsonPath: 'Bergung/szenen.json' })) as Record<
      string,
      any
    >;
    const doc = h.foundry.collection('Scene').get(result['id']) as FakeDocument;
    expect(levels(doc)[0]?.['elevation']).toEqual({ bottom: -5, top: 31 });
    expect(addedLevelElevation({ tokens: [{ elevation: 3 }] })).toEqual({ bottom: 0, top: 21 });
    expect(result['contains']).toBe(
      '0 walls, 1 tiles, 1 lights, 0 sounds, 1 tokens, 1 levels (the backup had no level; one was added)'
    );
  });

  it('refuses keepId when the id is taken, before writing anything', async () => {
    const h = open({}, backup({ _id: 'taken', name: 'Kerker' }));
    scene(h, { _id: 'taken', name: 'Kerker' });
    await expect(
      h.query('restoreScene', { jsonPath: 'Bergung/szenen.json', keepId: true })
    ).rejects.toMatchObject({ moduleCode: 'ID_TAKEN' });
    expect(h.foundry.operations).toEqual([]);
  });

  it('names the cause when the file is not there', async () => {
    const h = open();
    await expect(h.query('restoreScene', { jsonPath: 'Bergung/fehlt.json' })).rejects.toMatchObject(
      {
        moduleCode: 'FILE_NOT_READABLE',
        message:
          'Failed to restore scene: "Bergung/fehlt.json" could not be read: HTTP 404 Not Found. The path counts from the Foundry data directory, for example "Bergung/szenen.json".',
      }
    );
  });
});
