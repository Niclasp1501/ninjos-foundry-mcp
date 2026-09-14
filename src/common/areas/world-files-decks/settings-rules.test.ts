import { describe, expect, it } from 'vitest';
import {
  isSecretKey,
  settingValueForListing,
  settingValueProblem,
  settingWriteRefusal,
  WRITABLE_WORLD_SETTINGS,
} from './settings-rules.js';

describe('setting rules', () => {
  it('starts with an empty list of writable settings', () => {
    expect(WRITABLE_WORLD_SETTINGS).toEqual([]);
    expect(settingWriteRefusal('core.time', 'world', WRITABLE_WORLD_SETTINGS)?.reason).toContain(
      'list is empty'
    );
  });

  it('refuses in the order own module, secret, scope, list', () => {
    const all = ['ninjos-foundry-mcp.permScenes', 'm.apiKey', 'core.rollMode', 'core.x'];
    expect(settingWriteRefusal('ninjos-foundry-mcp.permScenes', 'world', all)?.code).toBe(
      'OWN_SETTING'
    );
    expect(settingWriteRefusal('m.apiKey', 'world', all)?.code).toBe('SECRET');
    expect(settingWriteRefusal('core.rollMode', 'client', all)?.code).toBe('NOT_WORLD');
    expect(settingWriteRefusal('core.y', 'world', all)?.code).toBe('NOT_ALLOWED');
    expect(settingWriteRefusal('core.x', 'world', all)).toBeNull();
  });

  it('recognises keys that look like secrets', () => {
    for (const key of [
      'apiKey',
      'api_key',
      'password',
      'discordToken',
      'clientSecret',
      'webhookUrl',
    ]) {
      expect(isSecretKey(key)).toBe(true);
    }
    expect(isSecretKey('rollMode')).toBe(false);
  });

  it('checks values against type, choices and range', () => {
    expect(settingValueProblem('a', { type: Number })).toContain('number');
    expect(settingValueProblem(3, { type: Number, range: { min: 0, max: 2 } })).toContain(
      'at most 2'
    );
    expect(settingValueProblem('c', { type: String, choices: { a: 'A', b: 'B' } })).toContain(
      '"a", "b"'
    );
    expect(settingValueProblem(true, { type: Boolean })).toBeNull();
    expect(settingValueProblem({}, { type: Object })).toContain('Only settings of type');
  });

  it('shortens large values for a listing', () => {
    expect(settingValueForListing({ a: 1 })).toEqual({ value: { a: 1 } });
    const big = settingValueForListing('x'.repeat(5000));
    expect(big.truncated).toBe(true);
    expect(String(big.value)).toHaveLength(4000);
  });
});
