#!/usr/bin/env node
/**
 * Builds the setup bundle locally into installer/out/. Publishes nothing.
 *
 *   node installer/build.mjs [--node <runtime>] [--node-license <file>] [--platform win32|darwin|linux] [--arch x64|arm64] [--no-zip]
 *
 * A zip needs the Node.js licence (next to the runtime or --node-license) and a
 * LICENSE that names every shipped package; the bundle gets LICENSE.txt and
 * THIRD-PARTY-NOTICES.txt.
 *
 * The bundle holds its own Node runtime, so nobody has to install Node. The
 * runtime is taken from a file on this machine (default: the Node running this
 * script); the script never downloads anything. For another platform, pass the
 * official Node binary of that platform with --node.
 *
 * Writes only below installer/out/. It compiles the server with tsc into the
 * bundle instead of running `npm run build`, which would overwrite build/ that
 * other sessions and the running installation may use.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { productionPackages } from './dependencies.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(project, 'installer', 'out');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const platform = option('--platform', process.platform);
const arch = option('--arch', process.arch);
const nodeBinary = resolve(option('--node', process.execPath));
// The Node.js licence must ship next to the runtime. An installed Node on Windows
// has none next to node.exe, so it can be passed as a file; never downloaded here.
const nodeLicenseOption = option('--node-license', null);
const windows = platform === 'win32';

function fail(message) {
  console.error(`build failed: ${message}`);
  process.exit(1);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: project,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    maxBuffer: 1 << 26,
    ...options,
  });
  if (result.status !== 0) {
    fail(`${command} ${commandArgs.join(' ')}\n${result.stdout ?? ''}${result.stderr ?? ''}`);
  }
  return result.stdout ?? '';
}

const pkg = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8'));
const name = `ninjos-foundry-mcp-server-${pkg.version}-${platform}-${arch}`;
const stage = join(out, name);
if (!stage.startsWith(out + sep)) fail('output folder outside installer/out');
if (!existsSync(nodeBinary)) fail(`no Node runtime at ${nodeBinary}`);

// The runtime must be able to run the server (package.json "engines").
if (platform === process.platform && arch === process.arch) {
  const version = run(`"${nodeBinary}"`, ['--version']).trim();
  const major = Number(/^v(\d+)/.exec(version)?.[1]);
  const wanted = Number(/(\d+)/.exec(pkg.engines?.node ?? '')?.[1] ?? 0);
  if (!(major >= wanted)) fail(`${nodeBinary} is ${version}, the server needs Node ${pkg.engines.node}`);
} else {
  console.warn(`Runtime for ${platform}-${arch} is not checked on this machine: ${nodeBinary}`);
}

rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, 'app'), { recursive: true });

console.log('Compiling the server');
run('npx', ['--no-install', 'tsc', '-p', 'tsconfig.server.json', '--outDir', `"${join(stage, 'app', 'build')}"`]);

console.log('Copying production dependencies');
// From package-lock.json, not from paths npm prints (it may mask them as ***).
let listed;
try {
  listed = productionPackages(project);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
const copied = [];
for (const path of listed) {
  if (copied.some(done => path.startsWith(done + sep))) continue;
  const target = join(stage, 'app', relative(project, path));
  if (!relative(project, path).startsWith(`node_modules${sep}`)) fail(`unexpected dependency path ${path}`);
  cpSync(path, target, { recursive: true, dereference: true });
  copied.push(path);
}

writeFileSync(
  join(stage, 'app', 'package.json'),
  `${JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      private: true,
      description: pkg.description,
      type: 'module',
      engines: pkg.engines,
      dependencies: pkg.dependencies,
    },
    null,
    2
  )}\n`
);

console.log('Adding runtime and scripts');
const runtimeName = windows ? 'node.exe' : 'node';
cpSync(nodeBinary, join(stage, runtimeName));
const nodeLicense = nodeLicenseOption ? resolve(nodeLicenseOption) : join(dirname(nodeBinary), 'LICENSE');
if (existsSync(nodeLicense)) {
  cpSync(nodeLicense, join(stage, 'NODE-LICENSE.txt'));
} else {
  const hint =
    `No Node.js licence at ${nodeLicense}. Pass the LICENSE of this Node version with --node-license ` +
    '(https://raw.githubusercontent.com/nodejs/node/<version>/LICENSE).';
  // A folder for a local look may go without it; a zip is what gets handed out.
  if (args.includes('--no-zip')) console.warn(hint);
  else fail(hint);
}

console.log('Adding licences');
// The project licence, and every notice of the packages in the bundle in one file.
const projectLicense = readFileSync(join(project, 'LICENSE'), 'utf8');
writeFileSync(join(stage, 'LICENSE.txt'), projectLicense.replace(/\r?\n/g, windows ? '\r\n' : '\n'));
const MIT_TEXT = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;
const notices = [
  [
    "Third-party notices for the server of Ninjo's Foundry MCP",
    'Each package below is shipped unmodified under app/node_modules under its own licence.',
    'The Node.js runtime licence is in NODE-LICENSE.txt.',
  ].join('\n'),
];
const unlisted = [];
for (const path of listed) {
  const info = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
  const license = typeof info.license === 'string' ? info.license : JSON.stringify(info.licenses ?? null);
  // LICENSE lists every shipped package by name on a line of its own.
  if (!new RegExp(`^\\s+${info.name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\s*$`, 'm').test(projectLicense)) {
    unlisted.push(info.name);
  }
  const files = readdirSync(path).filter(file => /^(licen[cs]e|copying|notice|copyrightnotice)/i.test(file));
  let text = files.map(file => readFileSync(join(path, file), 'utf8').trim()).join('\n\n');
  if (!text) {
    if (license !== 'MIT') fail(`${info.name} ships no licence file and is not MIT (${license})`);
    const holder = typeof info.author === 'string' ? info.author : (info.author?.name ?? 'the package authors');
    text = `Published without a licence file; package.json declares the MIT License.\n\nMIT License, copyright holder as named in package.json: ${holder}\n\n${MIT_TEXT}`;
  }
  notices.push(`${'='.repeat(72)}\n${info.name} ${info.version} (${license})\n${'='.repeat(72)}\n\n${text}`);
}
if (unlisted.length) fail(`LICENSE does not list these shipped packages: ${[...new Set(unlisted)].join(', ')}`);
writeFileSync(
  join(stage, 'THIRD-PARTY-NOTICES.txt'),
  `${notices.join('\n\n\n')}\n`.replace(/\r?\n/g, windows ? '\r\n' : '\n')
);

const templates = join(project, 'installer', 'templates');
const scripts = windows ? ['setup.cmd', 'uninstall.cmd'] : ['setup.command', 'uninstall.command'];
for (const file of [...scripts, 'README.txt']) {
  let text = readFileSync(join(templates, file), 'utf8').replace(/\r\n/g, '\n');
  if (windows) text = text.replace(/\n/g, '\r\n');
  writeFileSync(join(stage, file), text);
}
if (!windows) for (const file of [runtimeName, ...scripts]) chmodSync(join(stage, file), 0o755);

if (args.includes('--no-zip')) {
  console.log(`Bundle folder: ${stage}`);
  process.exit(0);
}

console.log('Packing');
const zip = join(out, `${name}.zip`);
rmSync(zip, { force: true });
// bsdtar writes zip on Windows 10+ and macOS and keeps the executable bits.
// On Windows it is named explicitly: a GNU tar from Git Bash earlier in PATH
// reads "F:" in the path as a remote host.
const tar =
  process.platform === 'win32'
    ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar';
const packed = spawnSync(tar, ['-a', '-c', '-f', zip, '-C', out, name], { encoding: 'utf8' });
if (packed.status !== 0) {
  const fallback = spawnSync('zip', ['-r', '-q', zip, name], { cwd: out, encoding: 'utf8' });
  if (fallback.status !== 0) fail(`could not pack: ${packed.stderr}${fallback.stderr ?? ''}`);
}
const hash = createHash('sha256').update(readFileSync(zip)).digest('hex');
writeFileSync(join(out, `${name}.zip.sha256`), `${hash}  ${basename(zip)}\n`);
console.log(`Bundle: ${zip}\nSHA-256: ${hash}`);
