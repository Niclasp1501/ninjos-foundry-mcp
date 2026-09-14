import { describe, expect, it } from 'vitest';
import { ChangeLog } from './change-log.js';
import {
  checkAccessAll,
  DOCUMENT_KIND_OF,
  UNLEVELED_KINDS,
  WRITE_SWITCH_ONLY,
  type SettingReader,
} from './permissions.js';

const settings =
  (values: Record<string, unknown>): SettingReader =>
  key =>
    values[key];

describe('chat messages as a kind without a level', () => {
  it('lets sending and changing through with the switch on', () => {
    for (const action of ['create', 'update'] as const) {
      expect(
        checkAccessAll([{ kind: 'write', document: 'ChatMessages', action }], settings({}))
      ).toEqual({ allowed: true });
    }
  });

  it('names the switch first when it is off', () => {
    expect(
      checkAccessAll(
        [{ kind: 'write', document: 'ChatMessages', action: 'delete' }],
        settings({ allowWriteOperations: false })
      )
    ).toMatchObject({ allowed: false, code: 'WRITE_DISABLED' });
  });

  it('refuses deleting with the sentence the chat tools already show', () => {
    const decision = checkAccessAll(
      [{ kind: 'write', document: 'ChatMessages', action: 'delete' }],
      settings({ permJournals: 'full' })
    );
    expect(decision).toEqual({
      allowed: false,
      code: 'PERMISSION_DENIED',
      reason:
        'Deleting chat messages is not permitted. Chat messages have no level of their own in the permission ' +
        'settings yet, and deleting needs the level "create, change and delete", so it stays off.',
    });
  });

  it('is known by label and by Foundry document name', () => {
    expect(UNLEVELED_KINDS.ChatMessages.label).toBe('chat messages');
    expect(DOCUMENT_KIND_OF['ChatMessage']).toBe('ChatMessages');
  });

  it('can be recorded in the change log and found by its kind', () => {
    const log = new ChangeLog();
    log.record({
      query: 'sendChatMessage',
      document: 'ChatMessages',
      action: 'create',
      targets: [{ id: 'm1' }],
      summary: 'Sent a message.',
    });
    log.record({
      query: 'requestPlayerRolls',
      document: 'Multiple',
      documents: ['ChatMessages', 'Actors'],
      action: 'create',
      targets: [{ id: 'm2', documentName: 'ChatMessage' }],
      summary: 'Asked for a roll.',
    });
    expect(log.list({ document: 'ChatMessages' }).map(entry => entry.query)).toEqual([
      'requestPlayerRolls',
      'sendChatMessage',
    ]);
  });
});

describe('the switch alone', () => {
  it('asks only the switch, no level', () => {
    expect(checkAccessAll([WRITE_SWITCH_ONLY], settings({ permScenes: 'read' }))).toEqual({
      allowed: true,
    });
    expect(
      checkAccessAll([WRITE_SWITCH_ONLY], settings({ allowWriteOperations: false }))
    ).toMatchObject({ allowed: false, code: 'WRITE_DISABLED' });
  });

  it('adds nothing to the reasons of a refused level next to it', () => {
    const decision = checkAccessAll(
      [WRITE_SWITCH_ONLY, { kind: 'write', document: 'Scenes', action: 'update' }],
      settings({ permScenes: 'read' })
    );
    expect(decision).toMatchObject({ allowed: false, code: 'PERMISSION_DENIED' });
    if (!decision.allowed) expect(decision.reason).toMatch(/^Changing scenes is not permitted/);
  });
});
