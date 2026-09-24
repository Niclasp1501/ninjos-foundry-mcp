#!/usr/bin/env node
/**
 * Checks the files this repository ships for text that does not belong in a
 * public repository:
 *
 * - references to working notes that are not part of it (their paths and
 *   file names), because a reader would look for files that do not exist
 * - internal work markers (package, stage and wave numbers), which mean
 *   nothing outside the team that wrote them
 * - home network addresses, e-mail addresses, personal folders, keys and
 *   tokens
 * - private names (domains, hosts, accounts, names from the author's own
 *   campaigns used as examples); examples stay neutral ("Locations/Harbour")
 *   so a reader is not left guessing
 *
 * Private names are only stored as SHA-256 digests, so publishing this check
 * does not publish the list. A line is normalised (percent-decoded, camelCase
 * split, lowercased, ü ö ä ß folded to ue oe ae ss, other accents removed),
 * split into words of letters or digits, and every run of one to
 * MAX_NAME_WORDS adjacent words, joined by one space, is hashed and compared.
 * A match is reported with file and line only, never with the text.
 *
 * Errors fail the check. Warnings are printed and let it pass; the only one
 * left is a note in the shared brand file, which is kept unchanged.
 *
 * Usage: node scripts/check-public.mjs
 * A comment should give the reason itself instead of pointing elsewhere.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const self = relative(root, fileURLToPath(import.meta.url))
  .split(sep)
  .join('/');

/** What is shipped: folders and files at the root of the repository. */
const SHIPPED = [
  '.github',
  '.gitattributes',
  '.gitignore',
  '.husky',
  '.prettierignore',
  '.prettierrc.json',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'README.md',
  'SECURITY.md',
  'docs/EXTENSION-TOOLS.md',
  'docs/INSTALLATION.en.md',
  'docs/INSTALLATION.md',
  'installer',
  'module',
  'scripts',
  'src',
  'package.json',
  'tsconfig.base.json',
  'tsconfig.module.json',
  'tsconfig.server.json',
  'tsconfig.test.json',
  'vitest.config.ts',
];

/** Build output and dependencies inside shipped folders; never checked in. */
const SKIPPED_DIRS = new Set(['node_modules', 'installer/out', 'module/scripts', 'module/lang']);
const BINARY = /\.(png|jpe?g|gif|webp|ico|woff2?|zip|gz|exe|dll|node)$/i;

const NOTES =
  'abfragen|abfragen-daten|bruecke|effekte-und-wiedergabe|einstellungen|figuren|fremdmodule|' +
  'installation|journale|kampagne|karten|kompatibilitaet|kompendien|mac-einrichtung|' +
  'oberflaeche|spielsysteme|szenen|token-und-wuerfel|welt|funktionsumfang|etappen-plan';

/**
 * Rules as [name, test, quiet]. A test is a regular expression or a function
 * of the line. A quiet rule reports file and line without the text, so the
 * output of the check does not repeat what it found.
 */
const ERRORS = [
  ['working notes', /\bdocs\/(?:verhalten|ziel|pakete)\b/],
  ['working notes', /\b(?:PAKETE|ENTSCHEIDUNGEN|UMSTIEG|UEBERTRAG|ALTE-ANLEITUNG|TESTLAUF)\b/],
  ['working notes', /offene-fragen|\bCLAUDE\.md\b/],
  ['working notes', new RegExp(`\\b(?:${NOTES})\\.md\\b`)],
  ['working notes', /\bwerkzeuge\.json\b/],
  ['working notes', /\bneu\/(?:src|docs|module|scripts|installer)\b/],
  ['work marker', /\b[Pp]ackages? 4\.\d+/],
  ['work marker', /\bKern ?\d\b|\bKERN\d|\bkern\d/],
  ['work marker', /\bEtappe\b|\bWelle\b|\bSpur [12]\b|Bitte an den Kern/],
  ['work marker', /\b[Ss]tage \d\b|\bstage plan\b|\b[Ww]aves? \d\b/],
  ['work marker', /\bpackage: '\d/],
  ['work marker', /\/\/ 4\.\d+\s*$/],
  ['work marker', /\b[Tt]est run of \d|\b[Ff]inding \d|\((?:open )?question \d+\)/],
  ['private name (hashed match)', line => privateNameHit(line), true],
  [
    'private network address',
    /\b(?:10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\b/,
    true,
  ],
  ['e-mail address', line => foreignEmail(line), true],
  ['personal folder', /[\\/](?:Users|home)[\\/]+ninjo\b/i],
  [
    'secret',
    /\bgh[pousr]_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bsk-[A-Za-z0-9_-]{20,}|\bAIza[0-9A-Za-z_-]{20,}|\bAKIA[0-9A-Z]{16}\b|\bxox[abprs]-[A-Za-z0-9-]{10,}|PRIVATE KEY-----/,
    true,
  ],
];

/**
 * The brand file is shared by every module of the author and stays unchanged
 * here, so its note about a working file is only reported.
 */
const WARNINGS = [['working notes of the brand file', /\bKONZEPT-[\w-]+\.md\b/]];

/** Longest private name, in words. */
export const MAX_NAME_WORDS = 4;

/**
 * SHA-256 of each private name after normalisation: its words joined by one
 * space. Kept in sync with a plain list outside the repository.
 */
// BEGIN PRIVATE NAME DIGESTS
export const PRIVATE_NAME_DIGESTS = new Set([
  '052ceccfe5c7a4187181bcbab2760a80c8151a1260b31f1c3213166fedb0a6ef',
  '120f783c877aa088511771ea22e4839f7d0310315bdc6fa19ba5b9f4b015a218',
  '18972b0f81104c0f7d6bb0031417a0c1bd8fe522e56abc04e20ef4153fdc63ae',
  '276bb46a03045906f8e18f124c32eaef7d277847326a3d144d5e7d10018983dd',
  '3f703e030353da785f37ac0e6dc215b22dce95d63c9748c256c5d77ac2ceac47',
  '42787c13fbb5126c05f727359ec30035b91d326899ad9b433b25f9d8cc6fd388',
  '522183afe6ac960e19cca2b07c415c77fd51586def37f3f56022e8517545d966',
  '5640a025c7974d1cab6913c1086495b68462d523e1cb8cfb7d73f0bd3eca13e6',
  '6dcc7d5d92f3d17b12ad4c3a952e77d021db5b479192b9992178e5ce22541570',
  '9ac01e8e4a120fa3e9cc64d3df4fab8e663f95e854abbddcccb3b57116a34cdb',
  '9dd0c878e361a5769b522ae5a3a79276824e445ff93252b68827953431060856',
  'a7d765dd1fbf9ee2af86801948bbc4a4435985566c4528460b10cfc0d085a466',
  'ab7a02308593cfda2dc36ceaf271057c122aa10fd81e98f489906d52a61c4eee',
  'af477c1013997c2eda86f441b5ca80dcf9228c8e74db54dc7f8fdf177d88ef26',
  'b9a80a8483dd1ae5f9b9412eb9c3e2ae0fda01abb5dcaef74359f2fbeb54c7b9',
  'bba62c27abe42846526073b050f37bc7e8f27cb78b6cd3a35337fdf2c6351608',
  'c2954949a3505c074f61126cd4e78bf1de83d1645473f06f6654f933628c11dc',
  'c3d9cb635daa008b8e2fd19044c1a850ccddc6598be70196a6cf976b8f436713',
  'de645af5814894825f604813f819800952a074e4123e1381b43a3f8a1e6d6632',
  'f040d5d0d2a53d6230ce45d3e01898a98c0f67f4ce826531aff7d36f16d5b11d',
]);
// END PRIVATE NAME DIGESTS

/** GitHub's noreply form is the only address a public commit or file may carry. */
const NOREPLY = /^\d+\+[A-Za-z0-9-]+@users\.noreply\.github\.com$|^noreply@github\.com$/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g;

export function foreignEmail(line) {
  return (line.match(EMAIL) ?? []).some(address => !NOREPLY.test(address));
}

/** Lowercase words of a text as the digests expect them. */
export function nameWords(text) {
  const decoded = text.replace(/(?:%[0-9A-Fa-f]{2})+/g, run => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
  const folded = decoded
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/ü/g, 'ue')
    .replace(/ö/g, 'oe')
    .replace(/ä/g, 'ae')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '');
  return folded.match(/[a-z]+|[0-9]+/g) ?? [];
}

const digestCache = new Map();
export function nameDigest(phrase) {
  let digest = digestCache.get(phrase);
  if (digest === undefined) {
    digest = createHash('sha256').update(phrase).digest('hex');
    if (digestCache.size < 200_000) digestCache.set(phrase, digest);
  }
  return digest;
}

/** Whether any run of adjacent words in the line hashes to a private name. */
export function privateNameHit(line, digests = PRIVATE_NAME_DIGESTS) {
  const words = nameWords(line);
  for (let start = 0; start < words.length; start += 1) {
    let phrase = '';
    for (let count = 0; count < MAX_NAME_WORDS && start + count < words.length; count += 1) {
      phrase = count === 0 ? words[start] : `${phrase} ${words[start + count]}`;
      if (digests.has(nameDigest(phrase))) return true;
    }
  }
  return false;
}

/**
 * Proves the matching without naming anything private: a made-up name is
 * caught in every spelling the normalisation covers, neutral examples pass the
 * real list, and each generic rule still fires.
 */
export function selfCheck() {
  const problems = [];
  const expect = (ok, what) => ok || problems.push(what);
  expect(PRIVATE_NAME_DIGESTS.size > 0, 'the list of private name digests is empty');
  for (const digest of PRIVATE_NAME_DIGESTS)
    expect(/^[0-9a-f]{64}$/.test(digest), `not a SHA-256 digest: ${digest}`);

  const madeUp = new Set([
    nameDigest('kuestenweg'),
    nameDigest('harbour gate'),
    nameDigest('tower 7'),
  ]);
  for (const line of [
    'Küstenweg',
    'see KÜSTENWEG here',
    'K%C3%BCstenweg',
    'kuestenweg',
    'Harbour-Gate',
    'harbourGate',
    'harbour%20gate',
    'Locations/Harbour/Gate',
    'tower-7',
    'tower7',
  ])
    expect(privateNameHit(line, madeUp), `made-up name not caught in "${line}"`);
  for (const line of ['Kuestenwege', 'Harbour', 'harbour, then gates', 'tower 8', 'tower 77'])
    expect(!privateNameHit(line, madeUp), `made-up name caught in "${line}"`);

  for (const line of [
    'Locations/Harbour',
    "name: 'Test Fighter'",
    'Küstenweg',
    'https://example.com/world',
    "Ninjo's Foundry MCP",
    'ninjos-foundry-mcp',
  ])
    expect(!privateNameHit(line), `neutral example flagged: "${line}"`);

  const samples = [
    ['private network address', `host 192.168.${1}.20`],
    ['private network address', `host 10.0.${0}.5`],
    ['e-mail address', `mail ${'someone'}@example.org`],
    ['secret', `token ${'ghp_'}${'a'.repeat(30)}`],
    ['secret', `GEMINI_API_KEY=${'AIza'}${'b'.repeat(35)}`],
  ];
  for (const [rule, line] of samples) {
    const found = ERRORS.some(([name, test]) => name === rule && matches(test, line));
    expect(found, `rule "${rule}" does not fire on its sample`);
  }
  for (const line of [
    'Author <44606632+someone@users.noreply.github.com>',
    'loopback 127.0.0.1 and the documentation range 192.0.2.20',
    'version 10.2 of the tool',
  ])
    expect(!ERRORS.some(([, test]) => matches(test, line)), `neutral example flagged: "${line}"`);
  return problems;
}

function matches(test, line) {
  return typeof test === 'function' ? test(line) : test.test(line);
}

function* walk(path) {
  const full = join(root, path);
  let stat;
  try {
    stat = statSync(full);
  } catch {
    return;
  }
  if (stat.isDirectory()) {
    if (SKIPPED_DIRS.has(path) || path.endsWith('/node_modules')) return;
    for (const name of readdirSync(full).sort()) yield* walk(`${path}/${name}`);
  } else if (!BINARY.test(path) && path !== self) {
    yield path;
  }
}

function main() {
  const problems = selfCheck();
  if (problems.length) {
    for (const problem of problems) console.error(`self-check ${problem}`);
    console.error('The check itself is broken; nothing was scanned.');
    process.exitCode = 1;
    return;
  }

  const errors = [];
  const warnings = [];
  const report = (list, path, index, rule, line, quiet) =>
    list.push(`${path}:${index + 1}: ${rule}${quiet ? '' : `: ${line.trim()}`}`);
  let files = 0;
  for (const entry of SHIPPED) {
    for (const path of walk(entry)) {
      files += 1;
      const lines = readFileSync(join(root, path), 'utf8').split('\n');
      lines.forEach((line, index) => {
        for (const [rule, test, quiet] of ERRORS)
          if (matches(test, line)) report(errors, path, index, rule, line, quiet);
        for (const [rule, test] of WARNINGS)
          if (matches(test, line)) report(warnings, path, index, rule, line, false);
      });
    }
  }

  for (const line of warnings) console.warn(`warning ${line}`);
  for (const line of errors) console.error(`error ${line}`);
  console.log(
    `Checked ${files} shipped files: ${errors.length} error(s), ${warnings.length} warning(s).`
  );
  if (errors.length) {
    console.error('Give the reason in the text itself instead of the reference or marker.');
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
