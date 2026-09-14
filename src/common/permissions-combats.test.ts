import { describe, expect, it } from 'vitest';
import { ChangeLog } from './change-log.js';
import {
  checkAccessAll,
  DOCUMENT_KIND_OF,
  isMatrixKind,
  permissionOverview,
  UNLEVELED_KINDS,
  type SettingReader,
} from './permissions.js';

const settings =
  (values: Record<string, unknown>): SettingReader =>
  key =>
    values[key];

describe('combat encounters as a kind without a level', () => {
  it('is known by label and by Foundry document name, and has no level', () => {
    expect(UNLEVELED_KINDS.Combats.label).toBe('combat encounters');
    expect(DOCUMENT_KIND_OF['Combat']).toBe('Combats');
    expect(isMatrixKind('Combats')).toBe(false);
  });

  it('lets creating and changing through with the switch, and names the switch first when off', () => {
    for (const action of ['create', 'update'] as const) {
      expect(
        checkAccessAll([{ kind: 'write', document: 'Combats', action }], settings({}))
      ).toEqual({ allowed: true });
    }
    expect(
      checkAccessAll(
        [{ kind: 'write', document: 'Combats', action: 'update' }],
        settings({ allowWriteOperations: false })
      )
    ).toMatchObject({ allowed: false, code: 'WRITE_DISABLED' });
  });

  it('refuses deleting with the sentence the combat tools show', () => {
    const decision = checkAccessAll(
      [{ kind: 'write', document: 'Combats', action: 'delete' }],
      settings({ permScenes: 'full' })
    );
    expect(decision).toEqual({
      allowed: false,
      code: 'PERMISSION_DENIED',
      reason:
        'Deleting combat encounters is not permitted. Combat encounters have no level of their own in the ' +
        'permission settings yet, and deleting needs the level "create, change and delete", so it stays off.',
    });
  });

  it('leaves the overview of levels as it was', () => {
    expect(permissionOverview(settings({})).kinds.map(kind => kind.document)).not.toContain(
      'Combats'
    );
  });

  it('is recorded without a cast and found by its kind', () => {
    const log = new ChangeLog();
    log.record({
      query: 'createCombat',
      document: 'Multiple',
      documents: ['Combats', 'ChatMessages'],
      action: 'create',
      targets: [{ id: 'c1', documentName: 'Combat' }],
      summary: 'Created an encounter.',
    });
    expect(log.list({ document: 'Combats' })).toHaveLength(1);
  });
});
