/**
 * The tools of the journals area against the tool directory, and one call each way
 * from the registry to the module handler and back.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { FakeFoundry } from '../../../testing/fake-foundry.js';
import { readToolDirectory } from '../../../testing/tool-directory.js';
import { JOURNAL_TOOLS } from './tools.js';

interface Listed {
  name: string;
  inputSchema: {
    properties?: Record<string, { type?: string; enum?: unknown[]; items?: unknown }>;
    required?: string[];
  };
}

const directory = readToolDirectory() as unknown as Listed[];

let harness: AreaHarness | null = null;
afterEach(() => {
  harness?.close();
  harness = null;
});

describe('journal tools', () => {
  it.each(JOURNAL_TOOLS.map(tool => [tool.name, tool] as const))(
    '%s has the name and parameters of the tool directory',
    (name, tool) => {
      const listed = directory.find(entry => entry.name === name);
      expect(listed, `${name} is in the tool directory`).toBeDefined();
      const own = tool.inputSchema as Listed['inputSchema'];
      const expected = listed!.inputSchema;
      expect(Object.keys(own.properties ?? {}).sort()).toEqual(
        Object.keys(expected.properties ?? {}).sort()
      );
      expect([...(own.required ?? [])].sort()).toEqual([...(expected.required ?? [])].sort());
      for (const [key, property] of Object.entries(expected.properties ?? {})) {
        expect(own.properties?.[key]?.type, `${name}.${key}`).toBe(property.type);
        expect(own.properties?.[key]?.enum, `${name}.${key}`).toEqual(property.enum);
        expect(JSON.stringify(own.properties?.[key]?.items ?? null).includes('enum')).toBe(
          JSON.stringify(property.items ?? null).includes('enum')
        );
      }
      expect(tool.description).not.toMatch(/[–—]/);
    }
  );

  it('covers every journal tool of the previous generation', () => {
    expect(JOURNAL_TOOLS.map(tool => tool.name).sort()).toEqual(
      [
        'list-journals',
        'search-journals',
        'journal-create',
        'journal-set-page',
        'journal-add-page',
        'journal-append-page',
        'journal-page-from-file',
        'journal-split-page',
        'journal-rename',
        'journal-delete-page',
        'journal-delete',
        'journal-rewrite-images',
        'journal-link-tags',
        'world-rewrite-paths',
        'actor-set-token',
        'actor-refresh-from-source',
        'folder-rename',
        'folder-delete',
      ].sort()
    );
  });

  it('reads a journal from the tool to the module and back as one JSON text', async () => {
    harness = createAreaHarness({ foundry: new FakeFoundry() });
    harness.foundry.seed('JournalEntry', {
      _id: 'j',
      name: 'J',
      pages: [{ _id: 'p', name: 'P', type: 'text', text: { content: 'hi' } }],
    });
    const result = await harness.call('list-journals', { journalId: 'j' });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]?.text ?? '')).toMatchObject({
      mode: 'journal',
      content: 'hi',
    });
  });

  it('turns a refusal into a tool error with its cause', async () => {
    harness = createAreaHarness({ foundry: new FakeFoundry() });
    harness.foundry.seed('JournalEntry', { _id: 'j', name: 'J' });
    await expect(harness.call('journal-delete', { journalId: 'j' })).resolves.toMatchObject({
      isError: true,
      content: [{ text: expect.stringMatching(/^Error: Deleting journals is not permitted/) }],
    });
    await expect(harness.call('journal-rename', { journalId: 'j' })).resolves.toMatchObject({
      isError: true,
      content: [{ text: 'Error: Invalid arguments for journal-rename: newName is required' }],
    });
  });
});
