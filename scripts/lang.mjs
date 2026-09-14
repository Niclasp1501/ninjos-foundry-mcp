#!/usr/bin/env node
/**
 * The language files of the module, put together from one fragment per area.
 *
 * Sources: every file named lang.<code>.json below src/module, that is the
 * core texts in src/module/lang.<code>.json and the texts of a package in
 * src/module/areas/<id>/lang.<code>.json. The languages and the output paths
 * come from module/module.json.
 *
 *   node scripts/lang.mjs            writes module/lang/<code>.json
 *   node scripts/lang.mjs --check    writes nothing, only checks
 *   --root <dir>                     another project root, for the tests
 *
 * Fails, and names file and key, on: invalid JSON, a key twice in one file,
 * the same key in two fragments, a key present in one language but missing
 * in another, a fragment without its counterpart in every language, and a
 * value that is not a string.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRAGMENT = /^lang\.([A-Za-z-]+)\.json$/;

/** Keys that appear twice in one object. JSON.parse keeps the last one and says nothing. */
export function duplicateKeys(text) {
  const found = [];
  const stack = [];
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    const top = stack[stack.length - 1];
    if (char === '"') {
      let end = i + 1;
      while (text[end] !== '"') end += text[end] === '\\' ? 2 : 1;
      if (top?.type === 'object' && top.expectKey) {
        const key = JSON.parse(text.slice(i, end + 1));
        if (top.keys.has(key)) found.push([...top.path, key].join('.'));
        top.keys.add(key);
        top.current = key;
        top.expectKey = false;
      }
      i = end + 1;
      continue;
    }
    if (char === '{' || char === '[') {
      const path = top ? [...top.path, top.type === 'object' ? top.current : String(top.index)] : [];
      stack.push(
        char === '{'
          ? { type: 'object', keys: new Set(), expectKey: true, current: '', path }
          : { type: 'array', index: 0, path }
      );
    } else if (char === '}' || char === ']') {
      stack.pop();
    } else if (char === ',' && top) {
      if (top.type === 'object') top.expectKey = true;
      else top.index += 1;
    }
    i += 1;
  }
  return found;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (FRAGMENT.test(entry.name)) out.push(path);
  }
  return out;
}

/** Leaves as "a.b.c" to value, with problems for anything that is not a string. */
function flatten(value, prefix, leaves, problems, file) {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'string') leaves.set(path, child);
    else if (child && typeof child === 'object' && !Array.isArray(child))
      flatten(child, path, leaves, problems, file);
    else problems.push(`${file}: "${path}" must be a text or an object of texts`);
  }
}

function setPath(target, path, value) {
  const parts = path.split('.');
  let node = target;
  for (const part of parts.slice(0, -1)) node = node[part] ??= {};
  node[parts[parts.length - 1]] = value;
}

/**
 * Check every fragment and merge them per language.
 * Returns { problems: string[], outputs: Array<{ code, path, content }> }.
 */
export function buildLanguages(root) {
  const problems = [];
  const manifest = JSON.parse(readFileSync(join(root, 'module', 'module.json'), 'utf8'));
  const languages = manifest.languages ?? [];
  const codes = languages.map(language => language.lang);
  const rel = file => relative(root, file).replaceAll('\\', '/');

  // Group fragments by folder: every folder needs one file per language.
  const groups = new Map();
  for (const file of walk(join(root, 'src', 'module')).sort()) {
    const code = FRAGMENT.exec(file.split(/[\\/]/).pop())[1];
    if (!codes.includes(code)) {
      problems.push(`${rel(file)}: the language "${code}" is not in module/module.json`);
      continue;
    }
    const folder = dirname(file);
    if (!groups.has(folder)) groups.set(folder, new Map());
    groups.get(folder).set(code, file);
  }

  // The core fragment first, then the areas in alphabetical order.
  const coreFolder = join(root, 'src', 'module');
  const folders = [...groups.keys()].sort((a, b) =>
    a === coreFolder ? -1 : b === coreFolder ? 1 : a.localeCompare(b)
  );

  const merged = new Map(codes.map(code => [code, { object: {}, owners: new Map() }]));

  for (const folder of folders) {
    const files = groups.get(folder);
    const keysPerCode = new Map();
    for (const code of codes) {
      const file = files.get(code);
      if (!file) {
        problems.push(`${rel(folder)}: lang.${code}.json is missing`);
        continue;
      }
      const text = readFileSync(file, 'utf8');
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        problems.push(`${rel(file)}: invalid JSON (${error.message})`);
        continue;
      }
      for (const key of duplicateKeys(text)) problems.push(`${rel(file)}: "${key}" appears twice`);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        problems.push(`${rel(file)}: the top level must be an object`);
        continue;
      }
      const leaves = new Map();
      flatten(parsed, '', leaves, problems, rel(file));
      keysPerCode.set(code, leaves);

      const target = merged.get(code);
      for (const [path, value] of leaves) {
        const clash =
          target.owners.get(path) ??
          [...target.owners.keys()].find(
            other => other.startsWith(`${path}.`) || path.startsWith(`${other}.`)
          );
        if (clash !== undefined) {
          const owner = target.owners.get(path) ?? target.owners.get(clash);
          problems.push(`${rel(file)}: "${path}" is already defined in ${owner}`);
          continue;
        }
        target.owners.set(path, rel(file));
        setPath(target.object, path, value);
      }
    }

    // Every key in every language of this fragment.
    const all = new Set([...keysPerCode.values()].flatMap(leaves => [...leaves.keys()]));
    for (const [code, leaves] of keysPerCode) {
      for (const key of all) {
        if (!leaves.has(key)) problems.push(`${rel(files.get(code))}: "${key}" is missing`);
      }
    }
  }

  const outputs = languages.map(language => ({
    code: language.lang,
    path: join(root, 'module', language.path),
    content: `${JSON.stringify(merged.get(language.lang).object, null, 2)}\n`,
  }));
  return { problems, outputs };
}

function main(argv) {
  const check = argv.includes('--check');
  const rootIndex = argv.indexOf('--root');
  const root =
    rootIndex >= 0
      ? resolve(argv[rootIndex + 1])
      : resolve(dirname(fileURLToPath(import.meta.url)), '..');

  const { problems, outputs } = buildLanguages(root);
  if (problems.length) {
    console.error(`Language fragments: ${problems.length} problem(s)`);
    for (const problem of problems) console.error(`  ${problem}`);
    return 1;
  }
  if (check) {
    console.log(`Language fragments: fine (${outputs.map(o => o.code).join(', ')})`);
    return 0;
  }
  for (const output of outputs) {
    if (!existsSync(dirname(output.path))) mkdirSync(dirname(output.path), { recursive: true });
    writeFileSync(output.path, output.content);
    console.log(`Wrote ${relative(root, output.path)}`);
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
