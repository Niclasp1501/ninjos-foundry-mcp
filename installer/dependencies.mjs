/**
 * Which installed packages the server needs at runtime, read from
 * package-lock.json instead of the text output of `npm ls`.
 *
 * `npm ls --parseable` prints absolute paths, and npm masks parts it takes for
 * secrets as `***` (seen with a session id inside a temp folder). The printed
 * paths then match nothing on disk. The lockfile holds the same tree with
 * locations relative to the project, so nothing printed is compared.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const NESTED = '/node_modules/';

/** The folder whose node_modules a package at `location` searches next. */
function parentLocation(location) {
  const index = location.lastIndexOf(NESTED);
  return index < 0 ? '' : location.slice(0, index);
}

/** Node's lookup: own node_modules first, then each enclosing one up to the root. */
function lookup(packages, from, name) {
  let base = from;
  for (;;) {
    const candidate = base ? `${base}${NESTED}${name}` : `node_modules/${name}`;
    if (packages[candidate]) return candidate;
    if (!base) return undefined;
    base = parentLocation(base);
  }
}

/**
 * Walks the runtime dependency graph of a lockfile (version 2 or 3) from the
 * root package. Dev dependencies of the root are never followed.
 *
 * @param {unknown} lock parsed package-lock.json
 * @returns {{ location: string, optional: boolean }[]} sorted by location
 */
export function productionPackagesFromLock(lock) {
  const packages = /** @type {any} */ (lock)?.packages;
  if (!packages || typeof packages !== 'object' || !packages['']) {
    throw new Error('package-lock.json has no "packages" map (lockfileVersion 2 or newer needed)');
  }
  /** @type {Map<string, boolean>} location -> reached only through optional edges */
  const found = new Map();
  const queue = [{ location: '', optional: false }];
  while (queue.length > 0) {
    const { location, optional } = /** @type {{ location: string, optional: boolean }} */ (
      queue.shift()
    );
    const entry = packages[location];
    const edges = [
      ...Object.keys(entry.dependencies ?? {}).map(name => [name, false]),
      ...Object.keys(entry.optionalDependencies ?? {}).map(name => [name, true]),
      ...Object.keys(entry.peerDependencies ?? {}).map(name => [
        name,
        Boolean(entry.peerDependenciesMeta?.[name]?.optional),
      ]),
    ];
    for (const [name, edgeOptional] of edges) {
      const target = lookup(packages, location, name);
      const reachedOptionally = optional || edgeOptional;
      if (!target) {
        if (reachedOptionally) continue;
        throw new Error(
          `package-lock.json does not resolve "${name}" needed by ${location || 'the project'}; run npm install`
        );
      }
      if (packages[target].link) {
        throw new Error(`"${target}" is a linked package; the bundle cannot copy links`);
      }
      const known = found.get(target);
      if (known === undefined || (known && !reachedOptionally)) {
        found.set(target, reachedOptionally);
        queue.push({ location: target, optional: reachedOptionally });
      }
    }
  }
  return [...found]
    .map(([location, optional]) => ({ location, optional }))
    .sort((a, b) => (a.location < b.location ? -1 : a.location > b.location ? 1 : 0));
}

/**
 * Absolute folders of the runtime packages installed in `project`. Checks
 * package.json against the lockfile and the lockfile against node_modules. An
 * optional package that is not installed (another platform) is skipped.
 *
 * @param {string} project folder with package.json, package-lock.json, node_modules
 * @returns {string[]} sorted absolute paths
 */
export function productionPackages(project) {
  const root = resolve(project);
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const lockFile = join(root, 'package-lock.json');
  if (!existsSync(lockFile)) throw new Error(`no package-lock.json in ${root}`);
  const lock = JSON.parse(readFileSync(lockFile, 'utf8'));
  const locked = lock.packages?.['']?.dependencies ?? {};
  for (const [name, range] of Object.entries(pkg.dependencies ?? {})) {
    if (locked[name] !== range) {
      throw new Error(`package-lock.json is out of date for "${name}"; run npm install`);
    }
  }
  const paths = [];
  for (const { location, optional } of productionPackagesFromLock(lock)) {
    const path = join(root, ...location.split('/'));
    if (!existsSync(join(path, 'package.json'))) {
      if (optional) continue;
      throw new Error(`${location} is in package-lock.json but not installed; run npm ci`);
    }
    paths.push(path);
  }
  return paths.sort();
}
