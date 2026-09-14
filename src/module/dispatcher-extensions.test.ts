import { describe, expect, it, vi } from 'vitest';
import { ChangeLog } from '../common/change-log.js';
import { QueryDispatcher } from './dispatcher.js';
import { ExtensionTools, type ExtensionToolDefinition } from './extension-tools.js';

const quiet = { log: () => undefined, warn: () => undefined };

function settingsOf(values: Record<string, unknown>) {
  return (key: string) => values[key];
}

describe('QueryDispatcher', () => {
  const build = (values: Record<string, unknown> = {}, gm = true) => {
    const log = new ChangeLog();
    const dispatcher = new QueryDispatcher({
      isGM: () => gm,
      readSetting: settingsOf(values),
      changeLog: log,
    });
    return { dispatcher, log };
  };

  it('finds a handler under both spellings of the query name', async () => {
    const { dispatcher } = build();
    dispatcher.register(['listExtensionTools', 'listFremdwerkzeuge'], {
      access: { kind: 'read' },
      run: () => [],
    });
    await expect(dispatcher.dispatch('ninjos-foundry-mcp.listFremdwerkzeuge', {})).resolves.toEqual(
      []
    );
    await expect(dispatcher.dispatch('listExtensionTools', {})).resolves.toEqual([]);
  });

  it('answers an unknown query with the documented text', async () => {
    const { dispatcher } = build();
    await expect(dispatcher.dispatch('ninjos-foundry-mcp.nothing', {})).rejects.toThrow(
      'No handler found for query: ninjos-foundry-mcp.nothing'
    );
  });

  it('refuses everyone but a Gamemaster, as an error', async () => {
    const { dispatcher } = build({}, false);
    dispatcher.register('getWorldInfo', { access: { kind: 'read' }, run: () => ({}) });
    await expect(dispatcher.dispatch('getWorldInfo', {})).rejects.toMatchObject({
      code: 'ACCESS_DENIED',
    });
  });

  it('checks switch and matrix before a writing handler runs', async () => {
    const run = vi.fn();
    const { dispatcher } = build({ allowWriteOperations: false });
    dispatcher.register('deleteScene', {
      access: { kind: 'write', document: 'Scenes', action: 'delete' },
      run,
    });
    await expect(dispatcher.dispatch('deleteScene', {})).rejects.toMatchObject({
      code: 'WRITE_DISABLED',
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('gives writing handlers the change log', async () => {
    const { dispatcher, log } = build();
    dispatcher.register('createScene', {
      access: { kind: 'write', document: 'Scenes', action: 'create' },
      run: (_data, context) =>
        context.recordChange({
          query: 'createScene',
          document: 'Scenes',
          action: 'create',
          targets: [{ id: 's1' }],
          summary: 'Created',
        }).id,
    });
    const id = await dispatcher.dispatch('createScene', {});
    expect(log.get(id as string)?.undoable).toBe(true);
  });
});

describe('ExtensionTools', () => {
  const tool = (overrides: Partial<ExtensionToolDefinition> = {}): ExtensionToolDefinition => ({
    name: 'shop-stock',
    description: 'Put an item into a shop.',
    inputSchema: { type: 'object', properties: { item: { type: 'string' } }, required: ['item'] },
    handler: async args => ({ stocked: args['item'] }),
    ...overrides,
  });

  const build = (values: Record<string, unknown> = { toolProviderModules: 'shops' }, gm = true) => {
    const hooks: Array<(register: (id: string, def: ExtensionToolDefinition) => unknown) => void> =
      [];
    const written: Record<string, unknown> = {};
    const tools = new ExtensionTools({
      readSetting: settingsOf(values),
      writeSetting: async (key, value) => {
        written[key] = value;
      },
      isGM: () => gm,
      callHook: (_name, register) => hooks.forEach(listener => listener(register)),
      log: quiet,
    });
    return { tools, hooks, written, values };
  };

  it('refuses modules that are not released, names of this project, and missing parts', () => {
    const { tools } = build();
    expect(tools.registerTool('other', tool())).toMatchObject({
      accepted: false,
      reason: expect.stringMatching(/not released/),
    });
    expect(tools.registerTool('shops', tool({ name: 'list-scenes' }))).toMatchObject({
      accepted: false,
      reason: '"list-scenes" is a tool of this module and must not be overridden',
    });
    expect(tools.registerTool('shops', tool({ description: '' }))).toMatchObject({
      accepted: false,
    });
    expect(tools.registerTool('', tool())).toMatchObject({
      reason: 'the id of the registering module is missing',
    });
    expect(tools.registerTool('shops', tool())).toEqual({ accepted: true });
  });

  it('keeps a name for the module that registered it first', () => {
    const { tools } = build({ toolProviderModules: 'shops, trade' });
    tools.registerTool('shops', tool());
    expect(tools.registerTool('trade', tool())).toMatchObject({
      reason: '"shop-stock" is already registered by "shops"',
    });
    expect(tools.registerTool('shops', tool({ description: 'Newer text.' }))).toEqual({
      accepted: true,
    });
    expect(tools.list()[0]?.description).toBe('Newer text.');
  });

  it('answers the server with the tools under "tools", the field the previous server reads', () => {
    const { tools } = build();
    tools.registerTool('shops', tool());
    expect(tools.listForServer()).toEqual({ tools: tools.list() });
    expect(tools.listForServer().tools[0]).toMatchObject({
      name: 'shop-stock',
      moduleId: 'shops',
      inputSchema: { type: 'object' },
    });
  });

  it('collects through the hook at init and again at ready without losing entries', () => {
    const { tools, hooks } = build();
    hooks.push(register => register('shops', tool()));
    tools.collect({ clear: true });
    hooks.push(register => register('shops', tool({ name: 'shop-price' })));
    tools.collect({ clear: false });
    expect(tools.list().map(t => t.name)).toEqual(['shop-stock', 'shop-price']);
  });

  it('drops a module from the list as soon as it is taken off the release list', async () => {
    const { tools, values } = build();
    tools.registerTool('shops', tool());
    values['toolProviderModules'] = '';
    expect(tools.list()).toEqual([]);
    await expect(
      tools.call({ name: 'shop-stock', args: { item: 'rope' } }, () => undefined)
    ).rejects.toThrow('"shops" is no longer released, the tool "shop-stock" is blocked.');
  });

  it('runs the handler, checks the arguments and answers with text', async () => {
    const { tools } = build();
    tools.registerTool('shops', tool());
    await expect(
      tools.call({ name: 'shop-stock', args: { item: 'rope' } }, () => undefined)
    ).resolves.toBe('{\n  "stocked": "rope"\n}');
    await expect(
      tools.call({ name: 'shop-stock', arguments: {} }, () => undefined)
    ).rejects.toThrow('Invalid arguments for shop-stock: item is required');
  });

  it('holds writing tools to the write switch, but lets read only tools through', async () => {
    const { tools } = build({ toolProviderModules: 'shops', allowWriteOperations: false });
    tools.registerTool('shops', tool());
    tools.registerTool(
      'shops',
      tool({
        name: 'shop-list',
        annotations: { readOnlyHint: true },
        inputSchema: { type: 'object' },
        handler: () => 'list',
      })
    );
    await expect(
      tools.call({ name: 'shop-stock', args: { item: 'x' } }, () => undefined)
    ).rejects.toMatchObject({ code: 'WRITE_DISABLED' });
    await expect(tools.call({ name: 'shop-list', args: {} }, () => undefined)).resolves.toBe(
      'list'
    );
  });

  it('reports a failing handler with its cause, and a hanging one after its time limit', async () => {
    vi.useFakeTimers();
    try {
      const { tools } = build();
      tools.registerTool(
        'shops',
        tool({ handler: () => Promise.reject(new Error('out of stock')) })
      );
      await expect(
        tools.call({ name: 'shop-stock', args: { item: 'x' } }, () => undefined)
      ).rejects.toThrow('Third-party tool failed: out of stock');

      tools.registerTool(
        'shops',
        tool({
          name: 'shop-hang',
          timeoutMs: 1000,
          inputSchema: { type: 'object' },
          handler: () => new Promise(() => undefined),
        })
      );
      const hanging = tools.call({ name: 'shop-hang', args: {} }, () => undefined);
      const settled = expect(hanging).rejects.toMatchObject({ code: 'TIMEOUT' });
      await vi.advanceTimersByTimeAsync(1001);
      await settled;
    } finally {
      vi.useRealTimers();
    }
  });

  it('passes progress from the handler on', async () => {
    const { tools } = build();
    tools.registerTool(
      'shops',
      tool({
        handler: (_args, context) => {
          context.progress(1, 2, 'half');
          return 'ok';
        },
      })
    );
    const seen: unknown[] = [];
    await tools.call({ name: 'shop-stock', args: { item: 'x' } }, p => seen.push(p));
    expect(seen).toEqual([{ progress: 1, total: 2, message: 'half' }]);
  });

  it('refuses a player, as an error', async () => {
    const { tools } = build({ toolProviderModules: 'shops' }, false);
    tools.registerTool('shops', tool());
    await expect(
      tools.call({ name: 'shop-stock', args: { item: 'x' } }, () => undefined)
    ).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  });

  it('carries the release list over from the old key without overwriting a new value', async () => {
    const fromOld = build({ werkzeugModule: 'shops' });
    expect(fromOld.tools.releasedModules()).toEqual(['shops']);
    await fromOld.tools.migrateLegacySetting();
    expect(fromOld.written).toEqual({ toolProviderModules: 'shops' });

    const both = build({ werkzeugModule: 'old', toolProviderModules: 'new' });
    await both.tools.migrateLegacySetting();
    expect(both.written).toEqual({});
  });
});
