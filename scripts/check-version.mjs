#!/usr/bin/env node
/**
 * Checks every version source before a release, and the tag against them.
 *
 *   node scripts/check-version.mjs [v14.2609.4]
 *
 * Without a tag it only checks that the sources agree. Version scheme:
 * <Foundry generation>.<YYMM>.<running number>, tag with a leading "v".
 *
 * Sources: package.json, both version fields of package-lock.json and
 * module/module.json. The server reads its version from package.json at
 * runtime and the setup bundle copies it, so nothing else carries a number.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPOSITORY = 'Niclasp1501/ninjos-foundry-mcp';
export const MANIFEST_URL = `https://github.com/${REPOSITORY}/releases/latest/download/module.json`;
export const downloadUrl = version =>
  `https://github.com/${REPOSITORY}/releases/download/v${version}/module.zip`;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = file => JSON.parse(readFileSync(join(root, file), 'utf8'));
const problems = [];

const manifest = readJson('module/module.json');
const pkg = readJson('package.json');
const lock = readJson('package-lock.json');
const version = manifest.version;

const sources = [
  ['module/module.json', manifest.version],
  ['package.json', pkg.version],
  ['package-lock.json', lock.version],
  ['package-lock.json packages[""]', lock.packages?.['']?.version],
];
for (const [file, found] of sources) {
  const same = found === version;
  console.log(`${same ? ' ' : '!'} ${String(found).padEnd(14)} ${file}`);
  if (!same) problems.push(`${file} has ${found}, module/module.json has ${version}`);
}

if (manifest.id !== 'ninjos-foundry-mcp') {
  problems.push(`module.json id is "${manifest.id}", it must stay "ninjos-foundry-mcp"`);
}
if (manifest.manifest !== MANIFEST_URL) {
  problems.push(`module.json manifest is "${manifest.manifest}", expected ${MANIFEST_URL}`);
}
if (manifest.download !== downloadUrl(version)) {
  problems.push(`module.json download is "${manifest.download}", expected ${downloadUrl(version)}`);
}

const parts = /^(\d+)\.(\d{2})(\d{2})\.(\d+)$/.exec(version ?? '');
if (!parts) {
  problems.push(`"${version}" does not follow <Foundry generation>.<YYMM>.<number>`);
} else {
  const [, generation, year, month, number] = parts;
  if (Number(month) < 1 || Number(month) > 12) problems.push(`"${month}" in ${version} is no month`);
  if (Number(number) < 1) problems.push(`the running number in ${version} starts at 1`);
  const verified = String(manifest.compatibility?.verified ?? '');
  if (verified.split('.')[0] !== generation) {
    problems.push(
      `${version} names Foundry ${generation}, but compatibility.verified is "${verified}"`
    );
  }
  const now = new Date();
  const thisYear = String(now.getUTCFullYear()).slice(2);
  const thisMonth = String(now.getUTCMonth() + 1).padStart(2, '0');
  // Only a warning: a release early in a month may still belong to the previous one.
  if (year !== thisYear || month !== thisMonth) {
    console.warn(`  Warning: today is 20${thisYear}-${thisMonth}, ${version} names 20${year}-${month}.`);
  }
}

const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
const escaped = String(version).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
if (!new RegExp(`^## \\[${escaped}\\]`, 'm').test(changelog)) {
  problems.push(`CHANGELOG.md has no section "## [${version}]"; the release text is taken from it`);
}

const tag = process.argv[2];
if (tag) {
  if (tag !== `v${version}`) problems.push(`tag "${tag}" does not match version ${version}`);
  else console.log(`Tag ${tag} matches.`);
}

if (problems.length) {
  console.error('\nVersion check failed:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`\nVersion ${version} is consistent.`);
