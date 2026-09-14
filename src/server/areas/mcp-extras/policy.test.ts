/**
 * When the mcp-extras area tells the sessions that the tool list or resources
 * changed, and which system tools it lists.
 */
import { describe, expect, it } from 'vitest';
import { dnd5eAdapter } from '../../../common/areas/dnd5e/adapter.js';
import { pf2eAdapter } from '../../../common/areas/pf2e/adapter.js';
import { SystemAdapterRegistry } from '../../../common/game-systems.js';
import { SystemDetector } from '../../../common/system-detection.js';
import type { BridgeConnectionEvent } from '../../bridge/foundry-bridge.js';
import { readConfig } from '../../config.js';
import type { BackendEvent, ListedTool } from '../../control/api.js';
import { silentLogger } from '../../logger.js';
import type { ServerAreaContext } from '../../tools/areas.js';
import type { AreaMcpAccess, ToolCallEvent } from '../../tools/notifications.js';
import { ServerRequestError } from '../../tools/requests.js';
import { ListChangePolicy } from './policy.js';

const EVENT: BridgeConnectionEvent = {
  type: 'introduced',
  connection: { id: 'c1', role: 'active', transport: 'websocket', protocol: 2 },
  moduleConnected: true,
};

function tool(name: string): ListedTool {
  return { name, description: name, inputSchema: { type: 'object' } };
}

function setup(system = 'dnd5e') {
  const emitted: BackendEvent[] = [];
  const tools: ListedTool[] = [
    tool('get-world-info'),
    tool('dnd5e-create-npc'),
    tool('pf2e-manage-conditions'),
  ];
  const callListeners = new Set<(event: ToolCallEvent) => void>();
  let filter: ((name: string) => boolean) | null = null;
  let connected = true;
  const mcp: AreaMcpAccess = {
    emit: event => void emitted.push(event),
    listTools: async () => tools.filter(t => !filter || filter(t.name)),
    onToolCall: listener => {
      callListeners.add(listener);
      return () => callListeners.delete(listener);
    },
    setToolFilter: next => {
      filter = next;
    },
  };
  const context: ServerAreaContext = {
    areaId: 'mcp-extras',
    logger: silentLogger,
    config: readConfig({}).config,
    env: {},
    query: async name => {
      if (name !== 'getWorldInfo') throw new Error(`unexpected query ${name}`);
      return { id: 'w', title: 'W', system };
    },
    isModuleConnected: () => connected,
    signal: new AbortController().signal,
    mcp,
  };
  const registry = new SystemAdapterRegistry();
  registry.register(dnd5eAdapter, 'dnd5e');
  registry.register(pf2eAdapter, 'pf2e');
  const detector = new SystemDetector();
  const policy = new ListChangePolicy({ debounceMs: 0, registry, detector });
  const call = (event: ToolCallEvent) => {
    for (const listener of callListeners) listener(event);
  };
  return {
    policy,
    context,
    emitted,
    tools,
    detector,
    call,
    listeners: () => callListeners.size,
    filter: () => filter,
    disconnect: () => {
      connected = false;
    },
  };
}

const types = (events: BackendEvent[]) => events.map(event => event.type);

describe('ListChangePolicy', () => {
  it('does nothing without notifications (area tests without a backend)', () => {
    const { policy, context } = setup();
    const { mcp: _mcp, ...bare } = context;
    policy.start(bare);
    policy.connection(EVENT, bare);
    expect(policy.visible('pf2e-manage-conditions')).toBe(true);
  });

  it('hides the tools of other systems once the system is known, and says the list changed', async () => {
    const s = setup('dnd5e');
    s.policy.start(s.context);
    await s.policy.settled(s.context);
    expect(s.policy.visible('pf2e-manage-conditions')).toBe(true);

    s.policy.connection(EVENT, s.context);
    await s.policy.settled(s.context);
    expect(s.policy.visible('pf2e-manage-conditions')).toBe(false);
    expect(s.policy.visible('dnd5e-create-npc')).toBe(true);
    expect(s.policy.visible('get-world-info')).toBe(true);
    expect(types(s.emitted)).toEqual(['resources_updated', 'tools_changed']);
    expect(s.emitted[0]).toEqual({ type: 'resources_updated', prefixes: ['foundry://'] });

    // The backend forgets the system when the module leaves; the list is whole again.
    s.detector.invalidate();
    s.disconnect();
    s.policy.connection({ ...EVENT, type: 'disconnected', moduleConnected: false }, s.context);
    await s.policy.settled(s.context);
    expect(types(s.emitted)).toEqual([
      'resources_updated',
      'tools_changed',
      'resources_updated',
      'tools_changed',
    ]);
  });

  it('hides every system tool in a world whose system has no adapter', async () => {
    const s = setup('homebrew');
    s.policy.start(s.context);
    await s.policy.settled(s.context);
    s.policy.connection(EVENT, s.context);
    await s.policy.settled(s.context);
    expect(s.policy.visible('dnd5e-create-npc')).toBe(false);
    expect(s.policy.visible('pf2e-manage-conditions')).toBe(false);
    expect(types(s.emitted)).toEqual(['resources_updated', 'tools_changed']);
  });

  it('sends no tool notification when the list stayed the same, however many events came', async () => {
    const s = setup('dnd5e');
    s.policy.start(s.context);
    await s.policy.settled(s.context);
    s.policy.connection(EVENT, s.context);
    await s.policy.settled(s.context);
    s.emitted.length = 0;
    s.policy.connection({ ...EVENT, type: 'connected' }, s.context);
    s.policy.connection(EVENT, s.context);
    await s.policy.settled(s.context);
    expect(types(s.emitted)).toEqual(['resources_updated']);
  });

  it('notices a tool of another module that appeared', async () => {
    const s = setup('dnd5e');
    s.policy.start(s.context);
    await s.policy.settled(s.context);
    s.policy.connection(EVENT, s.context);
    await s.policy.settled(s.context);
    s.emitted.length = 0;
    s.tools.push(tool('shop-stock'));
    s.policy.connection(EVENT, s.context);
    await s.policy.settled(s.context);
    expect(types(s.emitted)).toEqual(['resources_updated', 'tools_changed']);
  });

  it('updates the resources a successful write can touch, never after a read or a failure', () => {
    const s = setup();
    s.policy.start(s.context);
    s.call({ name: 'list-journals', group: 'journals', readOnly: true, isError: false });
    s.call({ name: 'journal-create', group: 'journals', readOnly: false, isError: true });
    s.call({ name: 'journal-create', group: 'journals', readOnly: false, isError: false });
    s.call({ name: 'shop-stock', group: null, readOnly: false, isError: false });
    expect(s.emitted).toEqual([
      {
        type: 'resources_updated',
        prefixes: ['foundry://changes/', 'foundry://journal/', 'foundry://world/'],
      },
      { type: 'resources_updated', prefixes: ['foundry://'] },
    ]);
  });

  it('removes its listener and filter when it stops', () => {
    const s = setup();
    s.policy.start(s.context);
    expect(s.listeners()).toBe(1);
    expect(s.filter()).not.toBeNull();
    s.policy.stop(s.context);
    expect(s.listeners()).toBe(0);
    expect(s.filter()).toBeNull();
  });

  it('takes a change a module part reports, and checks what it sends', async () => {
    const s = setup('homebrew');
    const request = s.policy.request();
    const requestContext = {
      connection: EVENT.connection,
      logger: silentLogger,
    };
    expect(await request.run({ resources: ['foundry://scene/'] }, requestContext)).toEqual({
      delivered: false,
    });
    s.policy.start(s.context);
    await s.policy.settled(s.context);
    expect(
      await request.run({ resources: ['foundry://scene/'], tools: true }, requestContext)
    ).toEqual({
      delivered: true,
    });
    await s.policy.settled(s.context);
    expect(s.emitted[0]).toEqual({ type: 'resources_updated', prefixes: ['foundry://scene/'] });
    expect(() => request.run({ resources: ['https://x'] }, requestContext)).toThrow(
      ServerRequestError
    );
  });
});
