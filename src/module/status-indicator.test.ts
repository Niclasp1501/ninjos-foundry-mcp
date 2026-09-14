/**
 * The readout of the status indicator for a server of the previous generation.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { FakeFoundry } from '../testing/fake-foundry.js';
import type { BridgeStatus } from './bridge-client.js';
import { describeBridgeStatus } from './status-indicator.js';

let foundry: FakeFoundry | null = null;
afterEach(() => {
  foundry?.uninstall();
  foundry = null;
});

function status(extra: Partial<BridgeStatus['connectionInfo']> = {}): BridgeStatus {
  return {
    enabled: true,
    connected: true,
    connectionState: 'connected',
    connectionInfo: {
      type: 'websocket',
      config: { host: 'localhost', port: 41415 },
      url: 'ws://localhost:41415/foundry-mcp',
      reconnectAttempts: 0,
      pageOrigin: 'http://localhost:30000',
      serverProtocol: 1,
      ...extra,
    },
  };
}

describe('status indicator', () => {
  it('says an old server is connected and what to do, in its tooltip', () => {
    foundry = new FakeFoundry().install();
    const readout = describeBridgeStatus(status({ previousServer: true }));
    expect(readout.kind).toBe('outdated');
    expect(readout.text).toBe('MCP: old server');
    expect(readout.detail).toContain('localhost:41415');
    expect(readout.detail).toContain('previous generation');
    expect(readout.detail).toContain('new server package');
  });

  it('stays green for a current server', () => {
    foundry = new FakeFoundry().install();
    expect(describeBridgeStatus(status({ serverProtocol: 2 })).kind).toBe('connected');
  });

  it('uses the translation when there is one', () => {
    foundry = new FakeFoundry({
      translations: { 'ninjos-foundry-mcp.indicator.outdated': 'MCP: alter Server' },
    }).install();
    expect(describeBridgeStatus(status({ previousServer: true })).text).toBe('MCP: alter Server');
  });
});
