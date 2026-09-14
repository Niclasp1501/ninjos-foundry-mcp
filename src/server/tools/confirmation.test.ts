import { describe, expect, it } from 'vitest';
import { BridgeError } from '../bridge/foundry-bridge.js';
import type { ToolResult } from '../control/api.js';
import {
  argumentsHash,
  ConfirmationGate,
  splitConfirmation,
  type ConfirmationMode,
} from './confirmation.js';

const DESTRUCTIVE = { name: 'delete-thing', destructive: true, hasDryRun: true };

function gate(mode: ConfirmationMode | (() => never), clock = { now: 1_000_000 }) {
  let asked = 0;
  const instance = new ConfirmationGate({
    query: async () => {
      asked += 1;
      return typeof mode === 'function' ? mode() : mode;
    },
    now: () => clock.now,
    ttlMs: 60_000,
  });
  return { instance, clock, asked: () => asked };
}

const dryRuns: Array<Record<string, unknown>> = [];
const dry = async (args: Record<string, unknown>): Promise<ToolResult> => {
  dryRuns.push(args);
  return { content: [{ type: 'text', text: 'Would delete 2 things.' }] };
};

function tokenOf(result: ToolResult): string {
  const match = /"confirmationToken": "([0-9a-f]+)"/.exec(result.content[0]?.text ?? '');
  if (!match) throw new Error(`no token in ${result.content[0]?.text}`);
  return match[1] as string;
}

describe('ConfirmationGate', () => {
  it('lets every call through while the mode is off, and never asks for tools that do not destroy', async () => {
    const off = gate({ enabled: false });
    expect(await off.instance.check(DESTRUCTIVE, { id: 'a' }, undefined, dry)).toEqual({
      run: true,
      args: { id: 'a' },
    });
    const on = gate({ enabled: true, userId: 'gm' });
    expect(
      await on.instance.check({ ...DESTRUCTIVE, destructive: false }, { id: 'a' }, undefined, dry)
    ).toMatchObject({ run: true });
    expect(
      await on.instance.check(DESTRUCTIVE, { id: 'a', dryRun: true }, undefined, dry)
    ).toMatchObject({
      run: true,
    });
    expect(on.asked()).toBe(0);
  });

  it('answers a preview with the dry run and a token, and runs once with that token', async () => {
    const { instance } = gate({ enabled: true, userId: 'gm', userName: 'Ninjo' });
    const first = await instance.check(DESTRUCTIVE, { id: 'a', count: 2 }, undefined, dry);
    expect(first.run).toBe(false);
    const preview = (first as { result: ToolResult }).result;
    expect(preview.isError).toBeUndefined();
    expect(preview.content[0]?.text).toContain('Preview only, nothing was changed.');
    expect(preview.content[0]?.text).toContain('Would delete 2 things.');
    expect(preview.content[0]?.text).toContain('while Ninjo holds the bridge');
    expect(dryRuns.at(-1)).toEqual({ id: 'a', count: 2, dryRun: true });

    const token = tokenOf(preview);
    // The same arguments in another order fit.
    expect(await instance.check(DESTRUCTIVE, { count: 2, id: 'a' }, token, dry)).toEqual({
      run: true,
      args: { count: 2, id: 'a' },
    });
    const again = await instance.check(DESTRUCTIVE, { id: 'a', count: 2 }, token, dry);
    expect((again as { result: ToolResult }).result.content[0]?.text).toContain(
      'unknown, used already or expired'
    );
  });

  it('refuses a token for other arguments, another tool, another Gamemaster or after expiry', async () => {
    const mode: ConfirmationMode = { enabled: true, userId: 'gm' };
    const { instance, clock } = gate(() => mode as never);
    const issue = async () =>
      tokenOf(
        ((await instance.check(DESTRUCTIVE, { id: 'a' }, undefined, dry)) as { result: ToolResult })
          .result
      );
    const text = async (tool: typeof DESTRUCTIVE, args: Record<string, unknown>, token: string) =>
      ((await instance.check(tool, args, token, dry)) as { result: ToolResult }).result.content[0]
        ?.text ?? '';

    expect(await text(DESTRUCTIVE, { id: 'b' }, await issue())).toContain('the arguments differ');
    expect(await text({ ...DESTRUCTIVE, name: 'other' }, { id: 'a' }, await issue())).toContain(
      'issued for the tool delete-thing'
    );
    const forGm = await issue();
    mode.userId = 'gm2';
    expect(await text(DESTRUCTIVE, { id: 'a' }, forGm)).toContain('another Gamemaster');
    mode.userId = 'gm';
    const stale = await issue();
    clock.now += 60_001;
    expect(await text(DESTRUCTIVE, { id: 'a' }, stale)).toContain('expired');
  });

  it('issues no token when the dry run already fails, and says why', async () => {
    const { instance } = gate({ enabled: true, userId: 'gm' });
    const outcome = await instance.check(DESTRUCTIVE, { id: 'x' }, undefined, async () => ({
      content: [{ type: 'text', text: 'Error: No thing "x"' }],
      isError: true,
    }));
    const result = (outcome as { result: ToolResult }).result;
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(
      'its dry run already fails, so no confirmation token was issued'
    );
    expect(result.content[0]?.text).toContain('No thing "x"');
  });

  it('describes the call when the tool has no dry run', async () => {
    const { instance } = gate({ enabled: true, userId: 'gm' });
    const outcome = await instance.check(
      { ...DESTRUCTIVE, hasDryRun: false },
      { id: 'a' },
      undefined,
      dry
    );
    expect((outcome as { result: ToolResult }).result.content[0]?.text).toContain(
      'has no dry run, so this preview cannot show its effect. It would be called with: {"id":"a"}'
    );
  });

  it('counts an older module and a missing bridge as off, but refuses when the mode cannot be read otherwise', async () => {
    const old = gate(() => {
      throw new BridgeError(
        'MODULE_ERROR',
        'No handler found for query: getConfirmationMode',
        'UNKNOWN_QUERY'
      );
    });
    expect(await old.instance.check(DESTRUCTIVE, {}, undefined, dry)).toMatchObject({ run: true });
    const gone = gate(() => {
      throw new BridgeError('NOT_CONNECTED', 'Foundry VTT module not connected');
    });
    expect(await gone.instance.check(DESTRUCTIVE, {}, undefined, dry)).toMatchObject({ run: true });
    const slow = gate(() => {
      throw new BridgeError('TIMEOUT', 'Query timed out');
    });
    const outcome = await slow.instance.check(DESTRUCTIVE, {}, undefined, dry);
    expect((outcome as { result: ToolResult }).result.content[0]?.text).toContain(
      'so nothing was run and nothing was changed: Query timed out'
    );
  });
});

describe('helpers', () => {
  it('splits the token off and hashes arguments without regard to key order', () => {
    expect(splitConfirmation({ a: 1, confirmationToken: 't' })).toEqual({
      args: { a: 1 },
      token: 't',
    });
    expect(splitConfirmation({ a: 1 }).token).toBeUndefined();
    expect(argumentsHash({ a: 1, b: { c: 2, d: 3 } })).toBe(
      argumentsHash({ b: { d: 3, c: 2 }, a: 1 })
    );
    expect(argumentsHash({ a: 1 })).not.toBe(argumentsHash({ a: 2 }));
  });
});
