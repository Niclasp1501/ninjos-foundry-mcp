/**
 * What the world-files-decks area needs beyond the default fake: world time, pause, the
 * module socket, the list of registered settings, a FilePicker over files in
 * memory, fetch for those files, CONST, and card stacks that move cards.
 *
 * The card moves follow Foundry's rules as the package relies on them: a card
 * leaving a deck stays there marked drawn, a card leaving a hand or pile is
 * removed, a card keeps its id, and a card coming back to its deck of origin
 * is marked not drawn again.
 */
import { joinPath, parentOf } from '../../../common/areas/world-files-decks/paths.js';
import { MODULE_ID } from '../../../common/constants.js';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import {
  FakeFoundry,
  type FakeCollection,
  type FakeDocument,
  type FakeFoundryOptions,
} from '../../../testing/fake-foundry.js';

export interface WorldFilesFake {
  time: { worldTime: number; calendar?: unknown; advance(seconds: number): Promise<number> };
  emitted: Array<{ event: string; payload: unknown }>;
  listeners: Map<string, Array<(payload: unknown, ...rest: unknown[]) => unknown>>;
  dirs: Set<string>;
  files: Map<string, Uint8Array>;
  publicFiles: Set<string>;
  fetched: string[];
}

export interface WorldFilesOptions {
  /** Whether the manifest declares "socket": true. Default true. */
  socket?: boolean;
  /** Give game.time a calendar. Default false. */
  calendar?: boolean;
  /**
   * Cards named as Foundry shows them: a card without a face up (`face` null)
   * reads "Unbekannt (<stack>)" from `name`, while `toObject()` and `_source`
   * keep the real name, as in a real world. Default false.
   */
  faceDownLabel?: boolean;
}

const CONST = {
  CARD_DRAW_MODES: { TOP: 0, BOTTOM: 1, RANDOM: 2 },
  USER_ROLES: { NONE: 0, PLAYER: 1, TRUSTED: 2, ASSISTANT: 3, GAMEMASTER: 4 },
  UPLOADABLE_FILE_EXTENSIONS: {
    png: 'image/png',
    jpg: 'image/jpeg',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    txt: 'text/plain',
    md: 'text/markdown',
    json: 'application/json',
    mp3: 'audio/mpeg',
  },
};

type Stack = FakeDocument & { cards: FakeCollection<FakeDocument> };

function cardsOf(stack: FakeDocument): FakeDocument[] {
  return (stack as Stack).cards.contents.sort(
    (a, b) => Number(a['sort'] ?? 0) - Number(b['sort'] ?? 0)
  );
}

function availableOf(stack: FakeDocument): FakeDocument[] {
  return cardsOf(stack).filter(card => stack['type'] !== 'deck' || card['drawn'] !== true);
}

function defineCards(foundry: FakeFoundry, options: WorldFilesOptions): void {
  const all = () => foundry.collection('Cards').contents;
  const method = (target: FakeDocument, name: string, value: unknown) =>
    Object.defineProperty(target, name, { value, enumerable: false, writable: true });

  if (options.faceDownLabel) {
    foundry.defineDocumentType('Card', {
      extend: card => {
        const sourceName = String(card['name'] ?? '');
        delete card['name'];
        const stored = card.toObject.bind(card);
        const hidden = (name: string, descriptor: PropertyDescriptor) =>
          Object.defineProperty(card, name, {
            enumerable: false,
            configurable: true,
            ...descriptor,
          });
        hidden('name', {
          get: () =>
            typeof card['face'] === 'number'
              ? sourceName
              : `Unbekannt (${String(card.parent?.['name'] ?? '')})`,
          set: () => undefined,
        });
        hidden('toObject', { value: () => ({ ...stored(), name: sourceName }) });
        hidden('_source', { get: () => ({ ...stored(), name: sourceName }) });
      },
    });
  }

  foundry.defineDocumentType('Cards', {
    collection: 'cards',
    embedded: { Card: 'cards' },
    extend: stack => {
      const pass = async (to: FakeDocument, ids: string[]) => {
        for (const id of ids) {
          const card = (stack as Stack).cards.get(id);
          if (!card) throw new Error(`Card ${id} is not in ${stack.id}`);
          const data = card.toObject();
          if (stack['type'] === 'deck')
            await stack.updateEmbeddedDocuments('Card', [{ _id: id, drawn: true }]);
          else await stack.deleteEmbeddedDocuments('Card', [id]);
          if ((to as Stack).cards.get(id)) {
            await to.updateEmbeddedDocuments('Card', [{ _id: id, drawn: false }]);
          } else {
            await to.createEmbeddedDocuments('Card', [
              { ...data, drawn: false, origin: data['origin'] ?? stack.id },
            ]);
          }
        }
        return ids;
      };
      const pick = (how: unknown) => {
        const list = availableOf(stack);
        const chosen =
          how === CONST.CARD_DRAW_MODES.BOTTOM || how === CONST.CARD_DRAW_MODES.RANDOM
            ? list.at(-1)
            : list[0];
        if (!chosen) throw new Error(`${String(stack['name'])} has no cards left`);
        return chosen.id;
      };
      const deal = async (targets: FakeDocument[], number = 1, options: { how?: unknown } = {}) => {
        for (const target of targets)
          for (let i = 0; i < number; i += 1) await pass(target, [pick(options.how)]);
      };
      method(stack, 'pass', pass);
      method(stack, 'deal', deal);
      method(
        stack,
        'draw',
        async (from: FakeDocument, number = 1, options: { how?: unknown } = {}) =>
          (from['deal'] as typeof deal)([stack], number, options)
      );
      method(stack, 'shuffle', async () => {
        const list = cardsOf(stack);
        await stack.updateEmbeddedDocuments(
          'Card',
          list.map((card, index) => ({ _id: card.id, sort: (list.length - index) * 10 }))
        );
      });
      method(stack, 'recall', async () => {
        if (stack['type'] === 'deck') {
          for (const other of all()) {
            if (other.id === stack.id) continue;
            const ids = cardsOf(other)
              .filter(card => card['origin'] === stack.id)
              .map(card => card.id);
            if (ids.length) await other.deleteEmbeddedDocuments('Card', ids);
          }
          const drawn = cardsOf(stack).filter(card => card['drawn'] === true);
          if (drawn.length)
            await stack.updateEmbeddedDocuments(
              'Card',
              drawn.map(card => ({ _id: card.id, drawn: false }))
            );
          return;
        }
        for (const card of cardsOf(stack)) {
          const origin = all().find(other => other.id === card['origin']);
          if (origin && (origin as Stack).cards.get(card.id))
            await origin.updateEmbeddedDocuments('Card', [{ _id: card.id, drawn: false }]);
          await stack.deleteEmbeddedDocuments('Card', [card.id]);
        }
      });
    },
  });
}

/** Everything above on a fake. Call before seeding and before the harness registers settings. */
export function withWorldFilesDecks(
  foundry: FakeFoundry,
  options: WorldFilesOptions = {}
): WorldFilesFake {
  const time: WorldFilesFake['time'] = {
    worldTime: 0,
    advance: async seconds => {
      time.worldTime += seconds;
      return time.worldTime;
    },
  };
  if (options.calendar) {
    time.calendar = {
      name: 'Test calendar',
      timeToComponents: (seconds: number) => ({
        day: Math.floor(seconds / 86400),
        hour: Math.floor(seconds / 3600) % 24,
      }),
      format: (seconds: number) =>
        `Day ${Math.floor(seconds / 86400) + 1}, ${Math.floor(seconds / 3600) % 24}:00`,
    };
  }
  const fake: WorldFilesFake = {
    time,
    emitted: [],
    listeners: new Map(),
    dirs: new Set(['', 'worlds', 'worlds/test-world', 'modules']),
    files: new Map(),
    publicFiles: new Set(['icons/svg/mystery-man.svg']),
    fetched: [],
  };
  const game = foundry.game;
  game['time'] = time;
  game['paused'] = false;
  game['togglePause'] = (pause: boolean) => {
    game['paused'] = pause;
  };
  game['socket'] = {
    emit: (event: string, payload: unknown) => void fake.emitted.push({ event, payload }),
    on: (event: string, callback: (payload: unknown) => unknown) =>
      fake.listeners.set(event, [...(fake.listeners.get(event) ?? []), callback]),
  };
  const modules = game['modules'] as { get(id: string): unknown };
  const moduleGet = modules.get;
  game['modules'] = {
    get: (id: string) =>
      id === MODULE_ID ? { id, active: true, socket: options.socket !== false } : moduleGet(id),
  };

  const settings = game['settings'] as {
    register(namespace: string, key: string, config: Record<string, unknown>): void;
    settings?: Map<string, Record<string, unknown>>;
  };
  const registered = new Map<string, Record<string, unknown>>();
  const register = settings.register;
  settings.settings = registered;
  settings.register = (namespace, key, config) => {
    registered.set(`${namespace}.${key}`, { ...config, namespace, key });
    register(namespace, key, config);
  };

  const listing = (dirs: ReadonlySet<string>, files: Iterable<string>, target: string) => ({
    target,
    dirs: [...dirs].filter(dir => dir && parentOf(dir) === target).map(encodeURI),
    files: [...files].filter(file => parentOf(file) === target).map(encodeURI),
  });
  const publicDirs = () => {
    const out = new Set<string>();
    for (const file of fake.publicFiles) {
      let dir = parentOf(file);
      while (dir) {
        out.add(dir);
        dir = parentOf(dir);
      }
    }
    return out;
  };
  foundry.setGlobal('FilePicker', {
    browse: async (source: string, target: string) => {
      const dir = decodeURI(target).replace(/^\/+|\/+$/g, '');
      if (source === 'public') {
        const dirs = publicDirs();
        if (dir && !dirs.has(dir)) throw new Error(`Directory ${dir} does not exist`);
        return listing(dirs, fake.publicFiles, dir);
      }
      if (!fake.dirs.has(dir)) throw new Error(`Directory ${dir} does not exist`);
      return listing(fake.dirs, fake.files.keys(), dir);
    },
    createDirectory: async (_source: string, target: string) => {
      if (fake.dirs.has(target)) throw new Error(`EEXIST: ${target} exists`);
      if (!fake.dirs.has(parentOf(target))) throw new Error(`ENOENT: ${parentOf(target)}`);
      fake.dirs.add(target);
      return target;
    },
    upload: async (_source: string, directory: string, file: File) => {
      if (!fake.dirs.has(directory)) return { status: 'error', message: 'no such folder' };
      const path = joinPath(directory, file.name);
      fake.files.set(path, new Uint8Array(await file.arrayBuffer()));
      return { status: 'success', path };
    },
  });
  foundry.setGlobal('fetch', async (url: string) => {
    fake.fetched.push(url);
    const path = decodeURIComponent(url.replace(/^\/+/, ''));
    const bytes = fake.files.get(path);
    if (!bytes) return new Response(null, { status: 404 });
    return new Response(bytes as BlobPart, {
      headers: { 'content-length': String(bytes.byteLength), 'content-type': 'image/png' },
    });
  });
  foundry.setGlobal('CONST', CONST);
  defineCards(foundry, options);
  return fake;
}

export interface WorldFilesSetup {
  harness: AreaHarness;
  foundry: FakeFoundry;
  fake: WorldFilesFake;
}

/** A harness over a fake with everything above. Seed after this call. */
export function openWorldFiles(
  options: FakeFoundryOptions = {},
  worldOptions: WorldFilesOptions = {}
): WorldFilesSetup {
  const foundry = new FakeFoundry(options);
  const fake = withWorldFilesDecks(foundry, worldOptions);
  const harness = createAreaHarness({ foundry });
  return { harness, foundry, fake };
}

/** Store a file in the fake data storage, with its folders. */
export function putFile(fake: WorldFilesFake, path: string, content = 'x'): void {
  let dir = parentOf(path);
  const dirs: string[] = [];
  while (dir) {
    dirs.push(dir);
    dir = parentOf(dir);
  }
  for (const entry of dirs) fake.dirs.add(entry);
  fake.files.set(path, new TextEncoder().encode(content));
}
