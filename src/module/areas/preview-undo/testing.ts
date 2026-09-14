/**
 * A small area for the tests of the preview-undo area: it writes journals the way the
 * packages do (read back, record with the state before and after), so undo is
 * tested against the log shapes and not against one package's details.
 */
import { smallEnough } from '../../../common/change-log.js';
import type { ModuleArea } from '../../areas.js';
import type { QueryHandler } from '../../dispatcher.js';

type Journals = {
  create(data: Record<string, unknown>): Promise<FoundryDocument>;
};

const journals = () => (globalThis as unknown as { JournalEntry: Journals }).JournalEntry;
const arg = (data: unknown, key: string) => (data as Record<string, unknown>)[key];
const byId = (id: unknown) => game.journal.get(String(id)) as FoundryDocument;

const create: QueryHandler = {
  access: { kind: 'write', document: 'Journals', action: 'create' },
  run: async (data, context) => {
    const journal = await journals().create({
      name: String(arg(data, 'name')),
      pages: [{ name: 'Page', text: { content: '<p>x</p>' } }],
    });
    context.recordChange({
      query: 'testCreate',
      tool: 'test-create',
      document: 'Journals',
      action: 'create',
      targets: [{ id: journal.id, uuid: journal.uuid, name: journal.name ?? '' }],
      summary: 'created',
      ...(arg(data, 'withAfter') === false ? {} : { after: smallEnough(journal.toObject()) }),
    });
    return { id: journal.id };
  },
};

async function rename(data: unknown, context: Parameters<QueryHandler['run']>[1]) {
  const journal = byId(arg(data, 'id'));
  const before = journal.name;
  await journal.update({ name: String(arg(data, 'name')) });
  context.recordChange({
    query: 'testRename',
    tool: 'test-rename',
    document: 'Journals',
    action: 'update',
    targets: [{ id: journal.id, uuid: journal.uuid, name: journal.name ?? '' }],
    summary: 'renamed',
    before: { name: before },
    ...(arg(data, 'withAfter') === false ? {} : { after: { name: journal.name } }),
  });
}

const renameJournal: QueryHandler = {
  access: { kind: 'write', document: 'Journals', action: 'update' },
  run: async (data, context) => rename(data, context),
};

const remove: QueryHandler = {
  access: { kind: 'write', document: 'Journals', action: 'delete' },
  run: async (data, context) => {
    const journal = byId(arg(data, 'id'));
    const before = journal.toObject();
    await journal.delete();
    context.recordChange({
      query: 'testDelete',
      tool: 'test-delete',
      document: 'Journals',
      action: 'delete',
      targets: [{ id: journal.id, uuid: journal.uuid, name: journal.name ?? '' }],
      summary: 'deleted',
      before: smallEnough(before),
    });
  },
};

const createAndRename: QueryHandler = {
  access: [
    { kind: 'write', document: 'Journals', action: 'create' },
    { kind: 'write', document: 'Journals', action: 'update' },
  ],
  run: async (data, context) => {
    const { id } = (await create.run(data, context)) as { id: string };
    await rename({ id, name: `${String(arg(data, 'name'))} renamed` }, context);
    return { id };
  },
};

const chat: QueryHandler = {
  access: { kind: 'write', document: 'ChatMessages', action: 'create' },
  run: (_data, context) => {
    context.recordChange({
      query: 'testChat',
      document: 'ChatMessages',
      action: 'create',
      targets: [{ id: 'm1' }],
      summary: 'sent',
    });
  },
};

export const undoTestArea: ModuleArea = {
  id: 'preview-undo-test',
  queries: [
    { names: 'testCreate', handler: create },
    { names: 'testRename', handler: renameJournal },
    { names: 'testDelete', handler: remove },
    { names: 'testCreateAndRename', handler: createAndRename },
    { names: 'testChat', handler: chat },
  ],
};
