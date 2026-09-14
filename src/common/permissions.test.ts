import { describe, expect, it } from 'vitest';
import {
  checkAccess,
  checkAccessAll,
  resolveAccess,
  permissionLevel,
  permissionOverview,
  type SettingReader,
} from './permissions.js';

const settings =
  (values: Record<string, unknown>): SettingReader =>
  key =>
    values[key];

describe('checkAccess', () => {
  it('always lets reading through, even with writing switched off', () => {
    expect(checkAccess({ kind: 'read' }, settings({ allowWriteOperations: false }))).toEqual({
      allowed: true,
    });
  });

  it('checks the switch before the matrix', () => {
    const decision = checkAccess(
      { kind: 'write', document: 'Scenes', action: 'create' },
      settings({ allowWriteOperations: false, permScenes: 'full' })
    );
    expect(decision).toMatchObject({ allowed: false, code: 'WRITE_DISABLED' });
  });

  it('applies the matrix when the switch is on', () => {
    const read = settings({ allowWriteOperations: true, permJournals: 'read' });
    const decision = checkAccess({ kind: 'write', document: 'Journals', action: 'update' }, read);
    expect(decision).toMatchObject({ allowed: false, code: 'PERMISSION_DENIED' });
    if (!decision.allowed) {
      expect(decision.reason).toContain('permJournals');
      expect(decision.reason).toContain('read only');
    }
  });

  it('keeps deleting off by default and says so', () => {
    const decision = checkAccess(
      { kind: 'write', document: 'Scenes', action: 'delete' },
      settings({})
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toMatch(/off by default/);
    expect(
      checkAccess(
        { kind: 'write', document: 'Scenes', action: 'delete' },
        settings({ permScenes: 'full' })
      )
    ).toEqual({ allowed: true });
  });

  it('lets creating and changing through with the stored defaults', () => {
    expect(
      checkAccess({ kind: 'write', document: 'Actors', action: 'create' }, settings({}))
    ).toEqual({
      allowed: true,
    });
  });

  it('holds tools of other modules to the switch unless they are read only', () => {
    const off = settings({ allowWriteOperations: false });
    expect(checkAccess({ kind: 'extension', readOnly: false }, off)).toMatchObject({
      allowed: false,
    });
    expect(checkAccess({ kind: 'extension', readOnly: true }, off)).toEqual({ allowed: true });
    expect(checkAccess({ kind: 'extension', readOnly: false }, settings({}))).toEqual({
      allowed: true,
    });
  });
});

describe('permissionLevel', () => {
  it('reads a damaged value as read only, never as more', () => {
    expect(permissionLevel(settings({ permScenes: 'everything' }), 'Scenes')).toBe('read');
    expect(permissionLevel(settings({}), 'Scenes')).toBe('write');
  });
});

describe('checkAccessAll', () => {
  it('asks the switch once, before any level', () => {
    const decision = checkAccessAll(
      [
        { kind: 'write', document: 'Scenes', action: 'create' },
        { kind: 'write', document: 'Folders', action: 'delete' },
      ],
      settings({ allowWriteOperations: false })
    );
    expect(decision).toMatchObject({ allowed: false, code: 'WRITE_DISABLED' });
  });

  it('names every refused kind in one reason', () => {
    const decision = checkAccessAll(
      [
        { kind: 'write', document: 'Scenes', action: 'update' },
        { kind: 'write', document: 'Journals', action: 'update' },
        { kind: 'write', document: 'Folders', action: 'create' },
      ],
      settings({ permScenes: 'read', permJournals: 'read' })
    );
    expect(decision).toMatchObject({ allowed: false, code: 'PERMISSION_DENIED' });
    if (!decision.allowed) {
      expect(decision.reason).toContain('permScenes');
      expect(decision.reason).toContain('permJournals');
      expect(decision.reason).not.toContain('permFolders');
    }
  });

  it('lets a list of reads through with the switch off', () => {
    expect(checkAccessAll([{ kind: 'read' }], settings({ allowWriteOperations: false }))).toEqual({
      allowed: true,
    });
  });

  it('holds kinds without a level to the switch and refuses deleting them', () => {
    expect(
      checkAccess({ kind: 'write', document: 'Items', action: 'update' }, settings({}))
    ).toEqual({ allowed: true });
    expect(
      checkAccess(
        { kind: 'write', document: 'Macros', action: 'create' },
        settings({ allowWriteOperations: false })
      )
    ).toMatchObject({ allowed: false, code: 'WRITE_DISABLED' });
    const deleting = checkAccess(
      { kind: 'write', document: 'Cards', action: 'delete' },
      settings({ permFolders: 'full' })
    );
    expect(deleting).toMatchObject({ allowed: false, code: 'PERMISSION_DENIED' });
    if (!deleting.allowed) expect(deleting.reason).toMatch(/no level of their own/);
  });
});

describe('resolveAccess', () => {
  it('takes one access, a list, or a function of the data', () => {
    const write = { kind: 'write', document: 'Journals', action: 'update' } as const;
    expect(resolveAccess(write, {})).toEqual([write]);
    expect(resolveAccess([write, { kind: 'read' }], {})).toHaveLength(2);
    const rule = (data: unknown) =>
      (data as { dryRun?: boolean }).dryRun ? { kind: 'read' as const } : write;
    expect(resolveAccess(rule, { dryRun: true })).toEqual([{ kind: 'read' }]);
    expect(resolveAccess(rule, {})).toEqual([write]);
  });

  it('refuses a rule that declares nothing', () => {
    expect(() => resolveAccess([], {})).toThrow(/declares no access/);
    expect(() => resolveAccess(() => [], {})).toThrow(/declares no access/);
  });
});

it('the overview counts all seven kinds and takes the switch into account', () => {
  const overview = permissionOverview(
    settings({ allowWriteOperations: false, permFolders: 'full' })
  );
  expect(overview.kinds).toHaveLength(7);
  expect(overview.kinds.find(k => k.document === 'Compendiums')).toBeDefined();
  expect(overview.kinds.every(k => !k.canCreate && !k.canDelete)).toBe(true);
});
