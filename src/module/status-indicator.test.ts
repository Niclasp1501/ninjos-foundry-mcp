/**
 * The readout of the status indicator for a server of the previous generation.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { FakeFoundry } from '../testing/fake-foundry.js';
import type { BridgeStatus } from './bridge-client.js';
import { describeBridgeStatus, menuActions } from './status-indicator.js';

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

describe('switched off on this device', () => {
  const off = (extra: Partial<BridgeStatus> = {}): BridgeStatus => ({
    ...status(),
    enabled: false,
    connected: false,
    connectionState: 'disabled',
    offOnThisDevice: true,
    ...extra,
  });

  it('is grey, names this device only and says how to switch it on again', () => {
    foundry = new FakeFoundry().install();
    const readout = describeBridgeStatus(off());
    expect(readout).toMatchObject({ kind: 'disabled', offOnDevice: true });
    expect(readout.text).toBe('MCP: off on this device');
    expect(readout.detail).toContain('this device only');
    expect(readout.detail).toContain('Switch on for this device');
  });

  it('wins over a standby role the tab still remembers', () => {
    foundry = new FakeFoundry().install();
    const readout = describeBridgeStatus(
      off({ connectionInfo: { ...status().connectionInfo, role: 'standby' } })
    );
    expect(readout.offOnDevice).toBe(true);
  });

  it('offers only the way back while off here', () => {
    foundry = new FakeFoundry().install();
    expect(menuActions(describeBridgeStatus(off()))).toEqual(['deviceOn']);
  });

  it('offers connecting only to a bridge that is not connected, and switching off always', () => {
    foundry = new FakeFoundry().install();
    const down = status({ reconnectAttempts: 2 });
    expect(
      menuActions(
        describeBridgeStatus({ ...down, connected: false, connectionState: 'disconnected' })
      )
    ).toEqual(['connect', 'deviceOff']);
    expect(
      menuActions(
        describeBridgeStatus({ ...down, connected: false, connectionState: 'reconnecting' })
      )
    ).toEqual(['connect', 'deviceOff']);
    expect(menuActions(describeBridgeStatus(status()))).toEqual(['deviceOff']);
    expect(menuActions(describeBridgeStatus(status({ role: 'standby' })))).toEqual(['deviceOff']);
    expect(
      menuActions(
        describeBridgeStatus({
          ...status(),
          enabled: false,
          connected: false,
          connectionState: 'disabled',
        })
      )
    ).toEqual(['deviceOff']);
  });
});
