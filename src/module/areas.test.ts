import { describe, expect, it } from 'vitest';
import { ChangeLog } from '../common/change-log.js';
import { MODULE_AREAS } from './areas/index.js';
import { areaSettings, installAreaQueries, type ModuleArea } from './areas.js';
import { QueryDispatcher, type QueryHandler } from './dispatcher.js';

const handler: QueryHandler = { access: { kind: 'read' }, run: () => 'ok' };

const dispatcher = () =>
  new QueryDispatcher({
    isGM: () => true,
    readSetting: () => undefined,
    changeLog: new ChangeLog(),
  });

describe('installAreaQueries', () => {
  it('registers every spelling of an area query', async () => {
    const d = dispatcher();
    installAreaQueries([{ id: 'a', queries: [{ names: ['listX', 'listY'], handler }] }], d);
    await expect(d.dispatch('ninjos-foundry-mcp.listY', {})).resolves.toBe('ok');
  });

  it('names both owners when two areas answer the same query', () => {
    const areas: ModuleArea[] = [
      { id: 'journals', queries: [{ names: 'listFolders', handler }] },
      { id: 'scenes', queries: [{ names: 'listFolders', handler }] },
    ];
    expect(() => installAreaQueries(areas, dispatcher())).toThrow(
      'The query "listFolders" of area "scenes" is already registered by area "journals"'
    );
  });

  it('refuses a query the core already answers', () => {
    const d = dispatcher();
    d.register('ping', handler);
    expect(() =>
      installAreaQueries([{ id: 'world', queries: [{ names: 'ping', handler }] }], d)
    ).toThrow('already registered by the core');
  });

  it('installs the real list without a conflict and collects its settings', () => {
    expect(() => installAreaQueries(MODULE_AREAS, dispatcher())).not.toThrow();
    expect(Array.isArray(areaSettings(MODULE_AREAS))).toBe(true);
  });
});
