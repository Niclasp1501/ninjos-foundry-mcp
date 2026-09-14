/**
 * The tools of the generic-access area from the registry to the module handlers and back.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { MODULE_ID } from '../../../common/constants.js';
import { openGeneric, type GenericSetup } from '../../../module/areas/generic-access/testing.js';
import { genericAccessArea } from './index.js';

let setup: GenericSetup | null = null;
afterEach(() => {
  setup?.harness.close();
  setup = null;
});

const text = (result: { content: Array<{ type: string; text?: string }> }) =>
  result.content[0]?.text ?? '';

function open(settings: Record<string, unknown> = {}): GenericSetup {
  setup = openGeneric({ settings });
  setup.foundry.seed('Actor', {
    _id: 'a1',
    name: 'Grok',
    type: 'character',
    system: { attributes: { hp: { value: 10 } }, biography: 'x'.repeat(1500) },
  });
  setup.foundry.seed('Actor', { _id: 'a2', name: 'Anna', type: 'npc' });
  return setup;
}

describe('registration', () => {
  it('offers six tools in the documents group with annotations', async () => {
    const { harness } = open();
    const own = new Set((genericAccessArea.tools ?? []).map(tool => tool.name));
    expect([...own].sort()).toEqual([
      'create-document',
      'delete-document',
      'describe-document-type',
      'get-document',
      'list-documents',
      'update-document',
    ]);
    const listed = (await harness.tools.list()).filter(tool => own.has(tool.name));
    expect(listed).toHaveLength(6);
    const byName = new Map(listed.map(tool => [tool.name, tool.annotations]));
    expect(byName.get('list-documents')).toMatchObject({ readOnlyHint: true });
    expect(byName.get('describe-document-type')).toMatchObject({ readOnlyHint: true });
    expect(byName.get('create-document')).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });
    expect(byName.get('delete-document')).toMatchObject({ destructiveHint: true });
    expect((genericAccessArea.tools ?? []).every(tool => tool.group === 'documents')).toBe(true);
    for (const tool of genericAccessArea.tools ?? []) expect(tool.description).not.toMatch(/[–—]/);
  });
});

describe('tool texts', () => {
  it('lists with paging hints', async () => {
    const { harness } = open();
    const result = await harness.call('list-documents', { documentType: 'Actor', limit: 1 });
    expect(text(result)).toContain('1 of 2 matching Actor documents in the world');
    expect(text(result)).toContain('call again with offset 1');
    expect(text(result)).toContain('Specialised tools for Actor: list-characters');
  });

  it('reads a large document in parts', async () => {
    const { harness } = open();
    const result = await harness.call('get-document', { uuid: 'Actor.a1', maxChars: 1000 });
    expect(text(result)).toMatch(/Continue with chunkStart 1000 and fingerprint "[0-9a-z]+"/);
  });

  it('reports the change read back, and a refused dry run', async () => {
    const { harness } = open();
    const updated = await harness.call('update-document', {
      uuid: 'Actor.a1',
      changes: { 'system.attributes.hp.value': 4 },
    });
    expect(text(updated)).toContain(
      'as read back from Foundry:\n- system.attributes.hp.value: 10 -> 4'
    );

    const dry = await harness.call('delete-document', { uuid: 'Actor.a2', dryRun: true });
    expect(text(dry)).toContain('Dry run, nothing was changed. The real call would be REFUSED:');
    expect(text(dry)).toContain('permActors');
  });

  it('turns a refusal into a tool error with its cause', async () => {
    const { harness } = open({ [`${MODULE_ID}.allowWriteOperations`]: false });
    const result = await harness.call('create-document', {
      documentType: 'Actor',
      data: { name: 'x' },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Allow Write Operations');
    expect(setup?.foundry.operations).toHaveLength(0);
  });

  it('describes a type as JSON', async () => {
    const { harness } = open();
    const result = await harness.call('describe-document-type', { documentType: 'Actor' });
    expect(JSON.parse(text(result))).toMatchObject({ documentName: 'Actor', world: true });
  });
});
