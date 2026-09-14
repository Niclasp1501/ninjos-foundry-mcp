import { describe, expect, it } from 'vitest';
import {
  ConfigShapeError,
  describeEntries,
  mergeServerEntry,
  removeServerEntries,
  serverMatcher,
} from './client-config.js';

const ROOT = 'C:\\Users\\gm\\AppData\\Local\\FoundryMCPServer';
const desired = { command: `${ROOT}\\node.exe`, args: [`${ROOT}\\app\\build\\server\\wrapper.js`] };
const legacyArgs = [`${ROOT}\\foundry-mcp-server\\packages\\mcp-server\\dist\\index.cjs`];
const install = serverMatcher({ wrappers: [desired.args[0] as string], claimKey: true });
const removal = serverMatcher({ wrappers: [desired.args[0] as string], claimKey: false });

describe('mergeServerEntry', () => {
  it('adds the entry and keeps other servers and settings', () => {
    const config = {
      globalShortcut: 'Ctrl+Space',
      mcpServers: { files: { command: 'npx', args: ['-y', 'files'] } },
    };
    const edit = mergeServerEntry(config, desired, install, { add: true });
    expect(edit.changed).toBe(true);
    expect(edit.changes).toEqual([{ key: 'foundry-mcp', kind: 'added' }]);
    expect(edit.value).toEqual({
      globalShortcut: 'Ctrl+Space',
      mcpServers: {
        files: { command: 'npx', args: ['-y', 'files'] },
        'foundry-mcp': { ...desired, env: {} },
      },
    });
    expect(config.mcpServers).not.toHaveProperty('foundry-mcp');
  });

  it('creates mcpServers when the file has none', () => {
    const edit = mergeServerEntry({ theme: 'dark' }, desired, install, { add: true });
    expect(Object.keys(edit.value)).toEqual(['theme', 'mcpServers']);
  });

  it('adds nothing where adding is not wanted', () => {
    const edit = mergeServerEntry({ mcpServers: {} }, desired, install, { add: false });
    expect(edit.changed).toBe(false);
    expect(edit.changes).toEqual([]);
  });

  it('updates an entry of the previous installer and keeps env, extra fields and position', () => {
    const config = {
      mcpServers: {
        first: { command: 'a' },
        'foundry-mcp': {
          command: `${ROOT}\\node.exe`,
          args: legacyArgs,
          env: { FOUNDRY_PORT: '31415', LOG_LEVEL: 'debug' },
          disabled: false,
        },
        last: { command: 'b' },
      },
    };
    const edit = mergeServerEntry(config, desired, install, { add: true });
    expect(edit.changes).toEqual([{ key: 'foundry-mcp', kind: 'updated' }]);
    const servers = edit.value['mcpServers'] as Record<string, unknown>;
    expect(Object.keys(servers)).toEqual(['first', 'foundry-mcp', 'last']);
    expect(servers['foundry-mcp']).toEqual({
      command: desired.command,
      args: desired.args,
      env: { FOUNDRY_PORT: '31415', LOG_LEVEL: 'debug' },
      disabled: false,
    });
  });

  it('takes over an entry under another key instead of adding a second one', () => {
    const config = {
      mcpServers: {
        foundry: {
          command: 'node',
          args: [
            '/Applications/FoundryMCPServer.app/Contents/Resources/foundry-mcp-server/index.cjs',
          ],
          env: { FOUNDRY_HOST: 'localhost' },
        },
      },
    };
    const edit = mergeServerEntry(config, desired, install, { add: true });
    expect(edit.changes).toEqual([{ key: 'foundry', kind: 'updated' }]);
    expect(Object.keys(edit.value['mcpServers'] as object)).toEqual(['foundry']);
  });

  it('folds duplicates into foundry-mcp and keeps their variables', () => {
    const config = {
      mcpServers: {
        'foundry-vtt-mcp': {
          command: 'node',
          args: legacyArgs,
          env: { LOG_LEVEL: 'info', FOUNDRY_PORT: '1' },
        },
        'foundry-mcp': { command: 'node', args: legacyArgs, env: { FOUNDRY_PORT: '31415' } },
      },
    };
    const edit = mergeServerEntry(config, desired, install, { add: true });
    expect(edit.changes).toEqual([
      { key: 'foundry-mcp', kind: 'updated' },
      { key: 'foundry-vtt-mcp', kind: 'removed' },
    ]);
    expect(edit.value['mcpServers']).toEqual({
      'foundry-mcp': { ...desired, env: { FOUNDRY_PORT: '31415', LOG_LEVEL: 'info' } },
    });
  });

  it('changes nothing on a second run', () => {
    const once = mergeServerEntry({}, desired, install, { add: true });
    const twice = mergeServerEntry(once.value, desired, install, { add: true });
    expect(twice.changed).toBe(false);
    expect(twice.changes).toEqual([{ key: 'foundry-mcp', kind: 'unchanged' }]);
  });

  it('does not add next to a look-alike, and reports it', () => {
    const config = {
      mcpServers: {
        foundry: {
          command: 'node',
          args: ['F:/work/ninjos-foundry-mcp/packages/mcp-server/dist/index.js'],
        },
      },
    };
    const edit = mergeServerEntry(config, desired, install, { add: true });
    expect(edit.changed).toBe(false);
    expect(edit.addSkipped).toBe(true);
    expect(edit.lookAlikes).toEqual(['foundry']);
  });

  it('refuses shapes it would have to guess about', () => {
    expect(() => mergeServerEntry([], desired, install, { add: true })).toThrow(ConfigShapeError);
    expect(() => mergeServerEntry({ mcpServers: [] }, desired, install, { add: true })).toThrow(
      ConfigShapeError
    );
  });
});

describe('removeServerEntries', () => {
  it('removes only entries that start this installation', () => {
    const config = {
      mcpServers: {
        'foundry-mcp': { ...desired, env: {} },
        old: { command: 'x', args: legacyArgs },
        files: { command: 'npx' },
      },
    };
    const edit = removeServerEntries(config, removal);
    expect(edit.value).toEqual({ mcpServers: { files: { command: 'npx' } } });
    expect(edit.changes.map(c => c.key)).toEqual(['foundry-mcp', 'old']);
  });

  it('leaves a foundry-mcp entry of a repository build to its owner', () => {
    const config = {
      mcpServers: {
        'foundry-mcp': {
          command: 'node',
          args: ['/src/ninjos-foundry-mcp/packages/mcp-server/dist/index.js'],
        },
      },
    };
    const edit = removeServerEntries(config, removal);
    expect(edit.changed).toBe(false);
    expect(edit.lookAlikes).toEqual(['foundry-mcp']);
  });

  it('describes entries without changing them', () => {
    const config = { mcpServers: { 'foundry-mcp': { command: 'n', args: legacyArgs } } };
    expect(describeEntries(config, install)).toEqual({
      owned: [{ key: 'foundry-mcp', paths: ['n', ...legacyArgs] }],
      lookAlikes: [],
    });
  });
});
