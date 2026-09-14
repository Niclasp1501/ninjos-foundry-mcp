#!/usr/bin/env node
/**
 * Packs the built Foundry module.
 *
 *   node scripts/package-module.mjs [--test] [--no-zip]
 *
 * Needs `npm run build` first; it only copies what is already in module/.
 *
 * Release (default): dist/module/ with module.json unchanged, plus
 * dist/module.zip and dist/module.json for the GitHub release.
 *
 * --test: dist/test-module/ninjos-foundry-mcp/ (and module.zip next to it) for
 * a manual test deployment. The fields "manifest" and "download" are removed,
 * so Foundry has no address to look for an update and never replaces the test
 * copy with the release from the package listing. The version gets a suffix
 * such as 14.2609.4-test.202609141530, so the module list shows it is a test.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const test = args.includes('--test');
const moduleDir = join(project, 'module');
const dist = join(project, 'dist');

function fail(message) {
  console.error(`package-module failed: ${message}`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(moduleDir, 'module.json'), 'utf8'));
for (const built of ['scripts/module/main.js', 'lang/en.json', 'lang/de.json']) {
  if (!existsSync(join(moduleDir, built))) fail(`module/${built} is missing; run npm run build first`);
}
if (!existsSync(join(project, 'LICENSE'))) fail('LICENSE is missing');

const folder = test ? join(dist, 'test-module') : dist;
const stage = test ? join(folder, manifest.id) : join(dist, 'module');
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

const entries = ['scripts', 'styles', 'lang', 'assets'];
for (const entry of entries.filter(entry => entry !== 'scripts')) {
  cpSync(join(moduleDir, entry), join(stage, entry), { recursive: true });
}
// Only what tsconfig.module.json emits. An older build may have left other folders in
// module/scripts (server or test code), and those must never reach a Foundry world.
for (const part of ['module', 'common']) {
  cpSync(join(moduleDir, 'scripts', part), join(stage, 'scripts', part), { recursive: true });
}
cpSync(join(project, 'LICENSE'), join(stage, 'LICENSE'));

const written = { ...manifest };
if (test) {
  delete written.manifest;
  delete written.download;
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 12);
  written.version = `${manifest.version}-test.${stamp}`;
}
const manifestText = `${JSON.stringify(written, null, 2)}\n`;
writeFileSync(join(stage, 'module.json'), manifestText);

// Every file the manifest names must be in the package, or Foundry loads a broken module.
const named = [
  ...(written.esmodules ?? []),
  ...(written.scripts ?? []),
  ...(written.styles ?? []),
  ...(written.languages ?? []).map(language => language.path),
];
for (const path of named) if (!existsSync(join(stage, path))) fail(`module.json names ${path}, which is not built`);

console.log(`Module ${written.version}: ${stage}`);
if (args.includes('--no-zip')) process.exit(0);

const zip = join(folder, 'module.zip');
rmSync(zip, { force: true });
const files = ['module.json', 'LICENSE', ...entries];
// bsdtar writes zip on Windows 10+ and macOS. On Windows it is named explicitly,
// because a GNU tar from Git Bash earlier in PATH reads "F:" as a remote host.
const tar =
  process.platform === 'win32'
    ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar';
const packed = spawnSync(tar, ['-a', '-c', '-f', zip, '-C', stage, ...files], { encoding: 'utf8' });
if (packed.status !== 0 || !existsSync(zip)) {
  rmSync(zip, { force: true });
  const fallback = spawnSync('zip', ['-r', '-q', zip, ...files], { cwd: stage, encoding: 'utf8' });
  if (fallback.status !== 0) fail(`could not pack: ${packed.stderr ?? ''}${fallback.stderr ?? ''}`);
}
if (!test) writeFileSync(join(dist, 'module.json'), manifestText);
console.log(`Zip: ${zip}`);
