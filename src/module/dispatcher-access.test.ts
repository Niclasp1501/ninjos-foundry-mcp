import { describe, expect, it } from 'vitest';
import { ChangeLog } from '../common/change-log.js';
import type { Access } from '../common/permissions.js';
import { QueryDispatcher, QueryError, type QueryHandler } from './dispatcher.js';

const dispatcherWith = (values: Record<string, unknown>) =>
  new QueryDispatcher({
    isGM: () => true,
    readSetting: key => values[key],
    changeLog: new ChangeLog(),
  });

const update: Access = { kind: 'write', document: 'Journals', action: 'update' };
const remove: Access = { kind: 'write', document: 'Journals', action: 'delete' };

describe('access rules in the dispatcher', () => {
  it('lets a dry run through as a read while writing is off', async () => {
    const d = dispatcherWith({ allowWriteOperations: false });
    const handler: QueryHandler = {
      access: data => ((data as { dryRun?: boolean }).dryRun ? { kind: 'read' } : update),
      run: () => 'ran',
    };
    d.register('rewrite', handler);
    await expect(d.dispatch('rewrite', { dryRun: true })).resolves.toBe('ran');
    await expect(d.dispatch('rewrite', {})).rejects.toMatchObject({ code: 'WRITE_DISABLED' });
  });

  it('adds the delete level only when the flag asks for it', async () => {
    const d = dispatcherWith({});
    d.register('split', {
      access: data => [
        update,
        ...((data as { deleteOriginal?: boolean }).deleteOriginal ? [remove] : []),
      ],
      run: () => 'split',
    });
    await expect(d.dispatch('split', {})).resolves.toBe('split');
    await expect(d.dispatch('split', { deleteOriginal: true })).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });

  it('checks every access of a list before the handler runs', async () => {
    const d = dispatcherWith({ permFolders: 'read' });
    let ran = false;
    d.register('create', {
      access: [
        { kind: 'write', document: 'Scenes', action: 'create' },
        { kind: 'write', document: 'Folders', action: 'create' },
      ],
      run: () => {
        ran = true;
      },
    });
    await expect(d.dispatch('create', {})).rejects.toThrow(/permFolders/);
    expect(ran).toBe(false);
  });

  it('turns a broken rule into an error and keeps the code of a query error', async () => {
    const d = dispatcherWith({});
    d.register('empty', { access: () => [], run: () => 'never' });
    d.register('bad', {
      access: () => {
        throw new QueryError('INVALID_ARGUMENT', 'dryRun must be true or false');
      },
      run: () => 'never',
    });
    await expect(d.dispatch('empty', {})).rejects.toMatchObject({ code: 'ACCESS_RULE_FAILED' });
    await expect(d.dispatch('bad', {})).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('offers the same decision to the handler for what it learns later', async () => {
    const d = dispatcherWith({ permFolders: 'read' });
    d.register('late', {
      access: { kind: 'write', document: 'RollTables', action: 'create' },
      run: (_data, context) => {
        const problem = context.accessProblem({
          kind: 'write',
          document: 'Folders',
          action: 'create',
        });
        expect(problem).toContain('permFolders');
        context.requireAccess(
          { kind: 'write', document: 'Folders', action: 'create' },
          'The folder "Travel" would have to be created.'
        );
        return 'unreachable';
      },
    });
    await expect(d.dispatch('late', {})).rejects.toThrow(
      /^The folder "Travel" would have to be created\. Creating folders is not permitted/
    );
  });
});
