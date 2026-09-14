import { describe, expect, it } from 'vitest';
import { BridgeError } from '../bridge/foundry-bridge.js';
import { isUnknownQuery, moduleTooOld, moduleTooOldMessage } from './results.js';

describe('isUnknownQuery', () => {
  it('recognises the code of this generation and the message of the previous one', () => {
    expect(isUnknownQuery(new BridgeError('MODULE_ERROR', 'anything', 'UNKNOWN_QUERY'))).toBe(true);
    expect(
      isUnknownQuery(new BridgeError('MODULE_ERROR', 'No handler found for query: listPlaylists'))
    ).toBe(true);
    expect(isUnknownQuery(new Error('no handler found for query: x'))).toBe(true);
    expect(isUnknownQuery({ moduleCode: 'UNKNOWN_QUERY', message: '' })).toBe(true);
  });

  it('leaves every other failure alone', () => {
    expect(isUnknownQuery(new BridgeError('TIMEOUT', 'Query timed out'))).toBe(false);
    expect(isUnknownQuery(new BridgeError('MODULE_ERROR', 'Access denied', 'ACCESS_DENIED'))).toBe(
      false
    );
    expect(isUnknownQuery('Journal not found')).toBe(false);
    expect(isUnknownQuery(undefined)).toBe(false);
  });
});

describe('moduleTooOld', () => {
  const cause = new BridgeError('MODULE_ERROR', 'No handler found for query: manageEffects');

  it('says which query is missing, that nothing changed, what to do, and keeps the cause', () => {
    expect(moduleTooOldMessage('manageEffects', cause, 'manage effects')).toBe(
      'Failed to manage effects: the connected Foundry module does not know the query "manageEffects", ' +
        'so it is older than this server. Nothing was changed in the world. ' +
        "Update the module Ninjo's Foundry MCP in Foundry and reload the world. " +
        '(No handler found for query: manageEffects)'
    );
    expect(moduleTooOldMessage('manageEffects', cause)).toMatch(
      /^The connected Foundry module does not know the query "manageEffects"/
    );
  });

  it('gives an error only when the module lacks the query', () => {
    expect(moduleTooOld('manageEffects', cause)?.message).toContain('older than this server');
    expect(moduleTooOld('manageEffects', new Error('Access denied'))).toBeNull();
  });
});
