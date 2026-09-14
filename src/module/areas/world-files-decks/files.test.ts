import { afterEach, describe, expect, it } from 'vitest';
import { MODULE_ID } from '../../../common/constants.js';
import { openWorldFiles, putFile, type WorldFilesSetup } from './testing.js';

let setup: WorldFilesSetup | null = null;
afterEach(() => {
  setup?.harness.close();
  setup = null;
});

const W = 'worlds/test-world';
const text = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes);

describe('browseFiles', () => {
  it('lists a folder with decoded paths and filters by extension', async () => {
    setup = openWorldFiles();
    putFile(setup.fake, `${W}/maps/a b.png`);
    putFile(setup.fake, `${W}/maps/notes.md`);
    putFile(setup.fake, `${W}/maps/old/c.png`);
    const answer = await setup.harness.query('browseFiles', {
      path: `/${W}/maps/`,
      extensions: ['.PNG'],
    });
    expect(answer).toMatchObject({
      source: 'data',
      path: `${W}/maps`,
      dirs: [{ name: 'old', path: `${W}/maps/old` }],
      files: [{ name: 'a b.png', path: `${W}/maps/a b.png` }],
      totalFiles: 1,
    });
    expect(
      await setup.harness.query('browseFiles', { source: 'public', path: 'icons/svg' })
    ).toMatchObject({
      files: [{ name: 'mystery-man.svg' }],
    });
  });

  it('names a missing folder and refuses a path outside', async () => {
    setup = openWorldFiles();
    await expect(setup.harness.query('browseFiles', { path: `${W}/nope` })).rejects.toMatchObject({
      moduleCode: 'NOT_FOUND',
      message: expect.stringContaining('does not exist'),
    });
    await expect(setup.harness.query('browseFiles', { path: '../secrets' })).rejects.toMatchObject({
      moduleCode: 'INVALID_ARGUMENT',
    });
  });
});

describe('createDirectory', () => {
  it('creates every missing level, reads back, and leaves an existing folder', async () => {
    setup = openWorldFiles();
    const dry = await setup.harness.query('createDirectory', {
      path: `${W}/handouts/letters`,
      dryRun: true,
    });
    expect(dry).toMatchObject({ wouldCreate: [`${W}/handouts`, `${W}/handouts/letters`] });
    expect(setup.fake.dirs.has(`${W}/handouts`)).toBe(false);
    expect(
      await setup.harness.query('createDirectory', { path: `${W}/handouts/letters` })
    ).toMatchObject({
      created: [`${W}/handouts`, `${W}/handouts/letters`],
    });
    expect(await setup.harness.query('createDirectory', { path: `${W}/handouts` })).toMatchObject({
      existed: true,
    });
    expect(setup.harness.changeLog.list()).toHaveLength(1);
    expect(setup.harness.changeLog.list()[0]).toMatchObject({
      document: 'Files',
      action: 'create',
    });
  });

  it('never writes into packages or another world', async () => {
    setup = openWorldFiles();
    for (const path of ['modules/mine', 'worlds/other/maps']) {
      await expect(setup.harness.query('createDirectory', { path })).rejects.toMatchObject({
        moduleCode: 'PERMISSION_DENIED',
      });
    }
  });
});

describe('uploadFile', () => {
  it('writes text, refuses to replace without overwrite, replaces with it', async () => {
    setup = openWorldFiles();
    expect(
      await setup.harness.query('uploadFile', { path: W, name: 'note.md', text: 'Hällo' })
    ).toMatchObject({
      path: `${W}/note.md`,
      bytes: 6,
      replaced: false,
    });
    expect(text(setup.fake.files.get(`${W}/note.md`))).toBe('Hällo');
    await expect(
      setup.harness.query('uploadFile', { path: W, name: 'note.md', text: 'x' })
    ).rejects.toMatchObject({
      moduleCode: 'EXISTS',
    });
    expect(
      await setup.harness.query('uploadFile', {
        path: W,
        name: 'note.md',
        base64: btoa('new'),
        overwrite: true,
      })
    ).toMatchObject({ replaced: true });
    expect(text(setup.fake.files.get(`${W}/note.md`))).toBe('new');
    expect(setup.harness.changeLog.list()[0]).toMatchObject({
      document: 'Files',
      action: 'update',
      undoable: false,
    });
  });

  it('refuses scripts, types Foundry does not accept, bad base64, size and missing folders', async () => {
    setup = openWorldFiles();
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ path: W, name: 'x.js', text: 'alert(1)' }, 'PERMISSION_DENIED'],
      [{ path: W, name: 'x.pdf', text: 'x' }, 'PERMISSION_DENIED'],
      [{ path: W, name: 'x.png', base64: '###' }, 'INVALID_ARGUMENT'],
      [{ path: W, name: 'x.txt', text: 'x', base64: 'eA==' }, 'INVALID_ARGUMENT'],
      [{ path: W, name: 'x.txt', text: 'x'.repeat(600 * 1024) }, 'INVALID_ARGUMENT'],
      [{ path: `${W}/none`, name: 'x.txt', text: 'x' }, 'NOT_FOUND'],
    ];
    for (const [data, code] of cases) {
      await expect(setup.harness.query('uploadFile', data)).rejects.toMatchObject({
        moduleCode: code,
      });
    }
    expect(setup.fake.files.size).toBe(0);
  });

  it('checks a dry run without the switch and reports what would happen', async () => {
    setup = openWorldFiles({ settings: { [`${MODULE_ID}.allowWriteOperations`]: false } });
    expect(
      await setup.harness.query('uploadFile', { path: W, name: 'a.txt', text: 'abc', dryRun: true })
    ).toEqual({
      dryRun: true,
      path: `${W}/a.txt`,
      bytes: 3,
      wouldReplace: false,
    });
    await expect(
      setup.harness.query('uploadFile', { path: W, name: 'a.txt', text: 'abc' })
    ).rejects.toMatchObject({
      moduleCode: 'WRITE_DISABLED',
    });
  });

  it('reports an upload that is not there afterwards', async () => {
    setup = openWorldFiles();
    const picker = (globalThis as Record<string, unknown>)['FilePicker'] as Record<string, unknown>;
    picker['upload'] = async () => ({ status: 'success', path: `${W}/ghost.txt` });
    await expect(
      setup.harness.query('uploadFile', { path: W, name: 'ghost.txt', text: 'x' })
    ).rejects.toMatchObject({
      moduleCode: 'NOT_APPLIED',
    });
  });
});

describe('copyFile', () => {
  it('copies through fetch and upload and keeps the original', async () => {
    setup = openWorldFiles();
    putFile(setup.fake, `${W}/old/map.png`, 'PNGDATA');
    setup.fake.dirs.add(`${W}/new`);
    expect(
      await setup.harness.query('copyFile', { from: `${W}/old/map.png`, to: `${W}/new` })
    ).toMatchObject({
      path: `${W}/new/map.png`,
      bytes: 7,
    });
    expect(text(setup.fake.files.get(`${W}/new/map.png`))).toBe('PNGDATA');
    expect(setup.fake.files.has(`${W}/old/map.png`)).toBe(true);
    expect(setup.fake.fetched).toEqual([`/worlds/test-world/old/map.png`]);
  });

  it('refuses a missing source and the same file', async () => {
    setup = openWorldFiles();
    putFile(setup.fake, `${W}/a.png`);
    await expect(
      setup.harness.query('copyFile', { from: `${W}/b.png`, to: `${W}/elsewhere` })
    ).rejects.toMatchObject({
      moduleCode: 'NOT_FOUND',
    });
    await expect(
      setup.harness.query('copyFile', { from: `${W}/a.png`, to: W })
    ).rejects.toMatchObject({
      moduleCode: 'INVALID_ARGUMENT',
    });
  });
});

describe('references', () => {
  function seedWorld(current: WorldFilesSetup): void {
    const { foundry, fake } = current;
    putFile(fake, `${W}/maps/a.png`);
    foundry.seed('Scene', {
      _id: 's1',
      name: 'Cellar',
      background: { src: `${W}/maps/a.png` },
      tokens: [
        { _id: 't1', name: 'Rat', texture: { src: `${W}/tokens/rat.png` } },
        { _id: 't2', name: 'Any', texture: { src: `${W}/tokens/*.png` } },
      ],
    });
    foundry.seed('JournalEntry', {
      _id: 'j1',
      name: 'Notes',
      pages: [{ _id: 'p1', name: 'P', text: { content: `<p><img src="${W}/maps/b.webp"></p>` } }],
    });
    foundry.seed('Actor', { _id: 'a1', name: 'Ghost', img: `${W}/mapsold/c.png` });
    foundry.seed('Actor', { _id: 'a2', name: 'Nobody', img: 'icons/svg/mystery-man.svg' });
  }

  it('finds exactly the fields that point into a folder', async () => {
    setup = openWorldFiles();
    seedWorld(setup);
    const answer = await setup.harness.query('findFileReferences', { path: `${W}/maps` });
    expect(answer).toMatchObject({
      totalReferences: 2,
      documents: 2,
      references: [
        { uuid: 'Scene.s1', field: 'background.src', paths: [`${W}/maps/a.png`] },
        { uuid: 'JournalEntry.j1', field: 'pages[p1].text.content', paths: [`${W}/maps/b.webp`] },
      ],
    });
    await expect(setup.harness.query('findFileReferences', { path: 'ab' })).rejects.toMatchObject({
      moduleCode: 'INVALID_ARGUMENT',
    });
  });

  it('finds missing files, looks in public files, counts wildcards', async () => {
    setup = openWorldFiles();
    seedWorld(setup);
    const answer = (await setup.harness.query('findMissingFiles')) as Record<string, unknown>;
    expect(answer).toMatchObject({
      referencedFiles: 5,
      checkedFiles: 5,
      totalMissing: 3,
      wildcardsSkipped: 1,
    });
    const missing = answer['missing'] as Array<Record<string, unknown>>;
    expect(missing.map(entry => entry['path'])).toEqual([
      `${W}/maps/b.webp`,
      `${W}/mapsold/c.png`,
      `${W}/tokens/rat.png`,
    ]);
    expect(missing[0]).toMatchObject({
      reason: 'the folder exists, the file is not in it',
      references: [{ uuid: 'JournalEntry.j1', field: 'pages[p1].text.content' }],
    });
    expect(String(missing[1]?.['reason'])).toContain('cannot be listed');
    const under = (await setup.harness.query('findMissingFiles', {
      under: `${W}/maps`,
      collections: ['journal', 'scenes'],
    })) as Record<string, unknown>;
    expect(under).toMatchObject({ totalMissing: 1, referencedFiles: 2 });
    const limited = (await setup.harness.query('findMissingFiles', {
      maxDirectories: 1,
    })) as Record<string, unknown>;
    expect(limited).toMatchObject({ checkedFolders: 1, notCheckedFolders: 3 });
  });
});
