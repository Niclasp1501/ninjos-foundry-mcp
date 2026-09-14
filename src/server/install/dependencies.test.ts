import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  productionPackages,
  productionPackagesFromLock,
} from '../../../installer/dependencies.mjs';

type Entry = Record<string, unknown>;

/** A lockfile like npm writes it: dev packages carry `dev`, nested copies their own location. */
function sampleLock(): { lockfileVersion: number; packages: Record<string, Entry> } {
  return {
    lockfileVersion: 3,
    packages: {
      '': {
        name: 'sample',
        dependencies: { alpha: '1.0.0', '@scope/beta': '2.0.0' },
        devDependencies: { tester: '5.0.0' },
      },
      'node_modules/alpha': { version: '1.0.0', dependencies: { shared: '^1.0.0' } },
      'node_modules/@scope/beta': {
        version: '2.0.0',
        dependencies: { shared: '^2.0.0' },
        optionalDependencies: { 'native-other-os': '1.0.0' },
        peerDependencies: { 'peer-extra': '*' },
        peerDependenciesMeta: { 'peer-extra': { optional: true } },
      },
      'node_modules/@scope/beta/node_modules/shared': { version: '2.1.0' },
      'node_modules/shared': { version: '1.4.0' },
      'node_modules/native-other-os': { version: '1.0.0', optional: true },
      'node_modules/tester': { version: '5.0.0', dev: true, dependencies: { helper: '1' } },
      'node_modules/helper': { version: '1.0.0', dev: true },
    },
  };
}

describe('productionPackagesFromLock', () => {
  it('follows runtime edges with Node lookup and never the dev tree', () => {
    expect(productionPackagesFromLock(sampleLock())).toEqual([
      { location: 'node_modules/@scope/beta', optional: false },
      { location: 'node_modules/@scope/beta/node_modules/shared', optional: false },
      { location: 'node_modules/alpha', optional: false },
      { location: 'node_modules/native-other-os', optional: true },
      { location: 'node_modules/shared', optional: false },
    ]);
  });

  it('marks a package required once any required path reaches it', () => {
    const lock = sampleLock();
    lock.packages['node_modules/alpha'] = {
      version: '1.0.0',
      dependencies: { shared: '^1.0.0', 'native-other-os': '1.0.0' },
    };
    const native = productionPackagesFromLock(lock).find(
      entry => entry.location === 'node_modules/native-other-os'
    );
    expect(native).toEqual({ location: 'node_modules/native-other-os', optional: false });
  });

  it('fails with the name when a required dependency is not in the lockfile', () => {
    const lock = sampleLock();
    delete lock.packages['node_modules/shared'];
    expect(() => productionPackagesFromLock(lock)).toThrow(
      /"shared" needed by node_modules\/alpha/
    );
  });

  it('refuses lockfiles without a packages map and linked packages', () => {
    expect(() => productionPackagesFromLock({ lockfileVersion: 1, dependencies: {} })).toThrow(
      /lockfileVersion 2/
    );
    const lock = sampleLock();
    lock.packages['node_modules/alpha'] = { link: true, resolved: 'packages/alpha' };
    expect(() => productionPackagesFromLock(lock)).toThrow(/linked package/);
  });
});

describe('productionPackages', () => {
  let dir: string;

  beforeEach(() => {
    // Only locations from the lockfile are joined to this folder; no printed path is compared.
    dir = mkdtempSync(join(tmpdir(), 'ninjo-deps-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function install(location: string): void {
    const folder = join(dir, ...location.split('/'));
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'package.json'), '{}');
  }

  function project(lock = sampleLock()): void {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'sample', dependencies: lock.packages['']?.['dependencies'] })
    );
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lock));
  }

  it('returns the installed runtime folders and skips an optional package of another platform', () => {
    project();
    for (const location of [
      'node_modules/alpha',
      'node_modules/@scope/beta',
      'node_modules/@scope/beta/node_modules/shared',
      'node_modules/shared',
      'node_modules/tester',
      'node_modules/helper',
    ]) {
      install(location);
    }
    expect(productionPackages(dir)).toEqual(
      [
        join(dir, 'node_modules', '@scope', 'beta'),
        join(dir, 'node_modules', '@scope', 'beta', 'node_modules', 'shared'),
        join(dir, 'node_modules', 'alpha'),
        join(dir, 'node_modules', 'shared'),
      ].sort()
    );
  });

  it('fails when a required package is not installed', () => {
    project();
    install('node_modules/alpha');
    expect(() => productionPackages(dir)).toThrow(/not installed; run npm ci/);
  });

  it('fails when package.json and the lockfile disagree', () => {
    project();
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'sample', dependencies: { alpha: '1.1.0', '@scope/beta': '2.0.0' } })
    );
    expect(() => productionPackages(dir)).toThrow(/out of date for "alpha"/);
  });
});
