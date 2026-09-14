/**
 * The preview with one-time confirmation on the real way: tool registry,
 * module setting over the bridge, dry run of the tool, second call with token.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { MODULE_AREAS } from '../../../module/areas/index.js';
import { undoTestArea } from '../../../module/areas/preview-undo/testing.js';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { FakeFoundry } from '../../../testing/fake-foundry.js';

let harness: AreaHarness | null = null;
afterEach(() => {
  harness?.close();
  harness = null;
});

function open(confirm: boolean) {
  harness = createAreaHarness({
    foundry: new FakeFoundry({
      settings: { 'ninjos-foundry-mcp.confirmDestructiveTools': confirm },
    }),
    moduleAreas: [...MODULE_AREAS, undoTestArea],
  });
  return harness;
}

const text = (result: { content: Array<{ text?: string }> }) => result.content[0]?.text ?? '';
const journals = (h: AreaHarness) => h.foundry.game['journal'] as Map<string, unknown>;

function tokenIn(result: { content: Array<{ text?: string }> }): string {
  const match = /"confirmationToken": "([0-9a-f]+)"/.exec(text(result));
  if (!match) throw new Error(`no token in: ${text(result)}`);
  return match[1] as string;
}

describe('confirm destructive tools', () => {
  it('previews a destructive tool with its dry run and runs it only with the token, once', async () => {
    const h = open(true);
    const { id } = (await h.query('testCreate', { name: 'Crypt' })) as { id: string };

    const preview = await h.call('undo-change', {});
    expect(preview.isError).toBeUndefined();
    expect(text(preview)).toContain('Preview only, nothing was changed.');
    expect(text(preview)).toContain('Dry run: the undo would run. Nothing was changed.');
    expect(text(preview)).toContain('while Gamemaster holds the bridge');
    expect(journals(h).has(id)).toBe(true);

    const token = tokenIn(preview);
    const done = await h.call('undo-change', { confirmationToken: token });
    expect(done.isError).toBeUndefined();
    expect(text(done)).toContain('Undid 1 change(s)');
    expect(journals(h).has(id)).toBe(false);

    const reused = await h.call('undo-change', { confirmationToken: token });
    expect(reused.isError).toBe(true);
    expect(text(reused)).toContain('unknown, used already or expired');
  });

  it('refuses a token for other arguments and changes nothing', async () => {
    const h = open(true);
    const { id } = (await h.query('testCreate', { name: 'Crypt' })) as { id: string };
    const token = tokenIn(await h.call('undo-change', {}));
    const other = await h.call('undo-change', { count: 1, confirmationToken: token });
    expect(other.isError).toBe(true);
    expect(text(other)).toContain('the arguments differ from the previewed ones');
    expect(journals(h).has(id)).toBe(true);
  });

  it('asks nothing for reading tools and dry runs, and nothing at all while the setting is off', async () => {
    const on = open(true);
    await on.query('testCreate', { name: 'Crypt' });
    expect(text(await on.call('list-changes', {}))).toContain('matching changes');
    expect(text(await on.call('undo-change', { dryRun: true }))).toContain('Dry run:');
    on.close();

    const off = open(false);
    const { id } = (await off.query('testCreate', { name: 'Crypt' })) as { id: string };
    expect(text(await off.call('undo-change', {}))).toContain('Undid 1 change(s)');
    expect(journals(off).has(id)).toBe(false);
  });

  it('accepts the token argument while the setting is off, without passing it to the tool', async () => {
    const h = open(false);
    await h.query('testCreate', { name: 'Crypt' });
    const result = await h.call('undo-change', { confirmationToken: 'stale' });
    expect(result.isError).toBeUndefined();
  });
});
