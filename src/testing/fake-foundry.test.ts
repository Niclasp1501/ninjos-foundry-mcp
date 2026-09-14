import { afterEach, describe, expect, it } from 'vitest';
import { FakeDocument, FakeFoundry } from './fake-foundry.js';

let foundry: FakeFoundry | null = null;
afterEach(() => {
  foundry?.uninstall();
  foundry = null;
});

const open = (...args: ConstructorParameters<typeof FakeFoundry>) =>
  (foundry = new FakeFoundry(...args).install());

describe('FakeFoundry documents', () => {
  it('creates, updates and deletes world and embedded documents, and records each write', async () => {
    const f = open();
    const JournalEntry = f.documentClass('JournalEntry');
    const entry = (await JournalEntry.create({ name: 'Lore', flags: { a: 1 } })) as FakeDocument;
    expect(f.game['journal']).toBe(f.collection('JournalEntry'));
    expect(f.collection('JournalEntry').getName('Lore')).toBe(entry);

    const [page] = await entry.createEmbeddedDocuments('JournalEntryPage', [
      { name: 'One', text: { content: '<p>a</p>' } },
    ]);
    await entry.updateEmbeddedDocuments('JournalEntryPage', [
      { _id: page!.id, 'text.content': '<p>b</p>' },
    ]);
    expect(entry.toObject()['pages']).toEqual([
      { _id: page!.id, name: 'One', text: { content: '<p>b</p>' } },
    ]);

    await entry.update({ 'flags.-=a': null, 'flags.b': 2 });
    expect(entry['flags']).toEqual({ b: 2 });

    await entry.deleteEmbeddedDocuments('JournalEntryPage', [page!.id]);
    await entry.delete();
    expect(f.collection('JournalEntry').size).toBe(0);
    expect(f.operations.map(o => `${o.action} ${o.documentName}`)).toEqual([
      'create JournalEntry',
      'create JournalEntryPage',
      'update JournalEntryPage',
      'update JournalEntry',
      'delete JournalEntryPage',
      'delete JournalEntry',
    ]);
    expect(f.hooks.calls.map(c => c.name)).toContain('deleteJournalEntry');
  });

  it('checks every id before the first change', async () => {
    const f = open();
    const scene = f.seed('Scene', { name: 'Map', notes: [{ _id: 'n1', text: 'x' }] });
    await expect(
      scene.updateEmbeddedDocuments('Note', [
        { _id: 'n1', text: 'changed' },
        { _id: 'missing', text: 'y' },
      ])
    ).rejects.toThrow('Note "missing" does not exist in Scene.');
    expect(scene.getEmbeddedCollection('Note').get('n1')?.['text']).toBe('x');
    expect(f.operations).toEqual([]);
  });

  it('lets only a Gamemaster write, and lets a test refuse a write', async () => {
    const f = open({
      users: [
        { id: 'gm', name: 'GM', isGM: true },
        { id: 'p', name: 'Player' },
      ],
    });
    const actor = f.seed('Actor', { name: 'Hero' });
    f.setUser('Player');
    await expect(actor.update({ name: 'X' })).rejects.toThrow('User "Player" lacks permission');
    f.setUser('gm');
    const remove = f.onWrite(() => {
      throw new Error('disk full');
    });
    await expect(actor.update({ name: 'X' })).rejects.toThrow('disk full');
    expect(actor['name']).toBe('Hero');
    remove();
    await actor.update({ name: 'X' });
    expect(actor['name']).toBe('X');
  });

  it('finds documents by uuid and can be extended with types and methods', async () => {
    const f = open();
    f.defineDocumentType('Scene', {
      collection: 'scenes',
      embedded: { Note: 'notes' },
      extend: document => {
        document['activate'] = async () => document.update({ active: true });
      },
    });
    const scene = f.seed('Scene', { name: 'Map', notes: [{ _id: 'n1' }] });
    await (scene['activate'] as () => Promise<unknown>)();
    expect(scene['active']).toBe(true);
    const global = globalThis as unknown as { fromUuidSync(uuid: string): unknown; Scene: unknown };
    expect(global.fromUuidSync(`Scene.${scene.id}.Note.n1`)).toBe(
      scene.getEmbeddedCollection('Note').get('n1')
    );
    expect(global.Scene).toBeDefined();
  });
});

describe('FakeFoundry settings, users and globals', () => {
  it('behaves like game.settings: registered only, defaults, stored values, onChange', async () => {
    const changes: unknown[] = [];
    const f = open({ settings: { 'mod.stored': 'saved' } });
    const settings = f.game['settings'] as {
      register(ns: string, key: string, config: object): void;
      get(ns: string, key: string): unknown;
      set(ns: string, key: string, value: unknown): Promise<unknown>;
    };
    expect(() => settings.get('mod', 'plain')).toThrow(
      '"mod.plain" is not a registered game setting'
    );
    settings.register('mod', 'plain', { default: 3, onChange: (v: unknown) => changes.push(v) });
    settings.register('mod', 'stored', { default: 'initial' });
    expect(settings.get('mod', 'plain')).toBe(3);
    expect(settings.get('mod', 'stored')).toBe('saved');
    await settings.set('mod', 'plain', 4);
    expect(settings.get('mod', 'plain')).toBe(4);
    expect(changes).toEqual([4]);
  });

  it('knows the logged in user and restores the globals it replaced', () => {
    const scope = globalThis as Record<string, unknown>;
    scope['game'] = 'before';
    const f = open({ users: [{ name: 'Player' }, { name: 'GM', isGM: true }] });
    expect(scope['game']).toBe(f.game);
    expect(f.game.user?.name).toBe('Player');
    f.setUser('GM');
    expect(f.game.user?.isGM).toBe(true);
    f.uninstall();
    expect(scope['game']).toBe('before');
    expect('Hooks' in scope).toBe(false);
    delete scope['game'];
  });
});
