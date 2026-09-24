import { describe, expect, it } from 'vitest';
import { CLOSE_ORIGIN_REJECTED } from './constants.js';
import { judgeClose, reconnectDelay, STEADY_DELAY_MS } from './reconnect.js';
import { RESERVED_TOOL_NAMES } from './reserved-tools.js';
import { DEFAULT_QUERY_TIMEOUT_MS, queryTimeoutMs, timeoutMessage } from './timeouts.js';

describe('reconnectDelay', () => {
  it('starts fast and settles at 10 seconds without giving up', () => {
    expect(STEADY_DELAY_MS).toBe(10_000);
    expect(reconnectDelay(1)).toBe(1000);
    expect(reconnectDelay(3)).toBe(5000);
    expect(reconnectDelay(4)).toBe(STEADY_DELAY_MS);
    expect(reconnectDelay(10_000)).toBe(STEADY_DELAY_MS);
  });

  it('never lets a later attempt wait longer than an earlier one', () => {
    for (let attempt = 1; attempt < 20; attempt += 1) {
      expect(reconnectDelay(attempt + 1)).toBeGreaterThanOrEqual(reconnectDelay(attempt));
      expect(reconnectDelay(attempt)).toBeLessThanOrEqual(STEADY_DELAY_MS);
    }
  });
});

describe('judgeClose', () => {
  it('stops on a refused origin and on a close we asked for, retries everything else', () => {
    expect(judgeClose(CLOSE_ORIGIN_REJECTED, false)).toBe('stop-rejected');
    expect(judgeClose(1000, true)).toBe('stop-requested');
    expect(judgeClose(1000, false)).toBe('retry');
    expect(judgeClose(1006, false)).toBe('retry');
  });
});

describe('queryTimeoutMs', () => {
  it('uses the default for ordinary queries and longer limits for known heavy ones', () => {
    expect(queryTimeoutMs('ninjos-foundry-mcp.getWorldInfo')).toBe(DEFAULT_QUERY_TIMEOUT_MS);
    expect(queryTimeoutMs('ninjos-foundry-mcp.exportToCompendium')).toBe(600_000);
    expect(queryTimeoutMs('delete-compendium-entries')).toBe(300_000);
  });

  it('knows the long queries of the previous server and never lets the variable shorten them', () => {
    expect(queryTimeoutMs('ninjos-foundry-mcp.importFromCompendium')).toBe(120_000);
    expect(queryTimeoutMs('ninjos-foundry-mcp.rewriteWorldPaths')).toBe(300_000);
    expect(queryTimeoutMs('ninjos-foundry-mcp.worldRewritePaths')).toBe(300_000);
    expect(queryTimeoutMs('ninjos-foundry-mcp.listCompendiumEntries', 5)).toBe(60_000);
    expect(queryTimeoutMs('ninjos-foundry-mcp.listCompendiumEntries', 90_000)).toBe(90_000);
    expect(queryTimeoutMs('ninjos-foundry-mcp.getWorldInfo', 45_000)).toBe(45_000);
  });

  it('never shortens a heavy query below a larger configured default', () => {
    expect(queryTimeoutMs('listCompendiumEntries', 120_000)).toBe(120_000);
  });

  it('tells the model that a timeout is not a failure', () => {
    expect(timeoutMessage('exportToCompendium', 600_000)).toMatch(/does NOT mean the work failed/);
  });
});

it('reserves the tool names of the previous generation, returning ones included', () => {
  expect(RESERVED_TOOL_NAMES.has('list-scenes')).toBe(true);
  expect(RESERVED_TOOL_NAMES.has('move-token')).toBe(true);
  expect(RESERVED_TOOL_NAMES.size).toBe(93);
});
