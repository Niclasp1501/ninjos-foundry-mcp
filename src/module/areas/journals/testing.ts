/**
 * What the journals area needs beyond the default fake: compendium packs with an
 * index and compendium uuids, and files the browser fetches from the data
 * directory. Call these after createAreaHarness, which installs the globals.
 */
import {
  FakeDocument,
  type DocumentData,
  type FakeFoundry,
} from '../../../testing/fake-foundry.js';

export interface FakePack {
  id: string;
  documentName: string;
  entries: DocumentData[];
}

export function withPacks(foundry: FakeFoundry, packs: FakePack[]): FakeFoundry {
  const byId = new Map(
    packs.map(pack => {
      const documents = new Map(
        pack.entries.map(entry => {
          const document = new FakeDocument(foundry, pack.documentName, entry, null);
          return [document.id, document] as const;
        })
      );
      return [
        pack.id,
        {
          collection: pack.id,
          documentName: pack.documentName,
          documents,
          getIndex: async () =>
            [...documents.values()].map(document => ({
              _id: document.id,
              name: document['name'] as string,
            })),
        },
      ] as const;
    })
  );
  foundry.game['packs'] = { get: (id: string) => byId.get(id) };
  const resolve = (uuid: string) => {
    const match = /^Compendium\.(.+)\.([A-Za-z]+)\.([^.]+)$/.exec(uuid);
    if (!match) return foundry.fromUuid(uuid);
    const pack = byId.get(match[1] as string);
    if (!pack || pack.documentName !== match[2]) return null;
    return pack.documents.get(match[3] as string) ?? null;
  };
  foundry.setGlobal('fromUuid', async (uuid: string) => resolve(uuid));
  foundry.setGlobal('fromUuidSync', (uuid: string) => resolve(uuid));
  return foundry;
}

/** Files by path as the browser would fetch them; a number is an HTTP status without body. */
export function withDataFiles(
  foundry: FakeFoundry,
  files: Record<string, string | number>,
  requests: string[] = []
): FakeFoundry {
  foundry.setGlobal('fetch', async (url: string) => {
    requests.push(url);
    const path = decodeURIComponent(url.replace(/^\//, ''));
    const file = files[path];
    if (file === undefined) return new Response('', { status: 404, statusText: 'Not Found' });
    if (typeof file === 'number') return new Response('', { status: file, statusText: 'Failed' });
    return new Response(file, { status: 200 });
  });
  return foundry;
}
