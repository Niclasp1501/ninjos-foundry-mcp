import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = join(project, 'scripts', 'lang.mjs');

function run(root: string) {
  const result = spawnSync(process.execPath, [script, '--check', '--root', root], {
    encoding: 'utf8',
  });
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
}

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A throwaway project with module.json and the given fragments (path to text). */
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'lang-check-'));
  roots.push(root);
  const all: Record<string, string> = {
    'module/module.json': JSON.stringify({
      languages: [
        { lang: 'en', path: 'lang/en.json' },
        { lang: 'de', path: 'lang/de.json' },
      ],
    }),
    'src/module/lang.en.json': '{ "ninjos-foundry-mcp": { "core": "Core" } }',
    'src/module/lang.de.json': '{ "ninjos-foundry-mcp": { "core": "Kern" } }',
    ...files,
  };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

describe('language fragments', () => {
  it('pass for the fragments of this project', () => {
    const result = run(project);
    expect(result.output).toContain('fine');
    expect(result.code).toBe(0);
  });

  it('pass for an area that brings both languages', () => {
    const root = fixture({
      'src/module/areas/journals/lang.en.json':
        '{ "ninjos-foundry-mcp": { "journals": { "a": "A" } } }',
      'src/module/areas/journals/lang.de.json':
        '{ "ninjos-foundry-mcp": { "journals": { "a": "Ä" } } }',
    });
    expect(run(root).code).toBe(0);
  });

  it('fail on a key that two fragments define', () => {
    const root = fixture({
      'src/module/areas/journals/lang.en.json': '{ "ninjos-foundry-mcp": { "core": "Again" } }',
      'src/module/areas/journals/lang.de.json': '{ "ninjos-foundry-mcp": { "core": "Nochmal" } }',
    });
    const result = run(root);
    expect(result.code).toBe(1);
    expect(result.output).toContain(
      'src/module/areas/journals/lang.en.json: "ninjos-foundry-mcp.core" is already defined in src/module/lang.en.json'
    );
  });

  it('fail on a key twice in one file, which JSON.parse would hide', () => {
    const root = fixture({
      'src/module/areas/maps/lang.en.json': '{ "x": { "a": "1", "a": "2" } }',
      'src/module/areas/maps/lang.de.json': '{ "x": { "a": "1" } }',
    });
    const result = run(root);
    expect(result.code).toBe(1);
    expect(result.output).toContain('src/module/areas/maps/lang.en.json: "x.a" appears twice');
  });

  it('fail on a key missing in one language and on a missing language file', () => {
    const root = fixture({
      'src/module/areas/world/lang.en.json': '{ "w": { "a": "A", "b": "B" } }',
      'src/module/areas/world/lang.de.json': '{ "w": { "a": "A" } }',
      'src/module/areas/canvas/lang.en.json': '{ "c": { "a": "A" } }',
    });
    const result = run(root);
    expect(result.code).toBe(1);
    expect(result.output).toContain('src/module/areas/world/lang.de.json: "w.b" is missing');
    expect(result.output).toContain('src/module/areas/canvas: lang.de.json is missing');
  });

  it('fail on a key that is a text in one fragment and a group in another', () => {
    const root = fixture({
      'src/module/areas/scenes/lang.en.json': '{ "ninjos-foundry-mcp": { "core": { "x": "X" } } }',
      'src/module/areas/scenes/lang.de.json': '{ "ninjos-foundry-mcp": { "core": { "x": "X" } } }',
    });
    expect(run(root).output).toContain('"ninjos-foundry-mcp.core.x" is already defined');
  });
});
