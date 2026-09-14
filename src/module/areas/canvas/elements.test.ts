import { afterEach, describe, expect, it } from 'vitest';
import { MODULE_ID } from '../../../common/constants.js';
import { openCanvas, type CanvasSetup } from './testing.js';

let setup: CanvasSetup | null = null;
afterEach(() => {
  setup?.harness.close();
  setup = null;
});

async function failure(promise: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await promise;
  } catch (error) {
    return {
      code: String((error as { moduleCode?: unknown }).moduleCode),
      message: (error as Error).message,
    };
  }
  throw new Error('expected a failure');
}

const walls = () => setup!.scene.getEmbeddedCollection('Wall');
const lights = () => setup!.scene.getEmbeddedCollection('AmbientLight');

describe('listing', () => {
  it('counts every type and filters doors and areas', async () => {
    setup = openCanvas();
    const all = (await setup.harness.query('listCanvasElements', {})) as Record<string, unknown>;
    expect(all['counts']).toEqual({ wall: 3, light: 1, sound: 0, region: 1, tile: 1, drawing: 0 });
    expect(all['matching']).toBe(6);
    expect((all['elements'] as unknown[])[1]).toMatchObject({
      type: 'wall',
      id: 'd1',
      door: 'door',
      doorState: 'closed',
    });
    const doors = (await setup.harness.query('listCanvasElements', { doorsOnly: true })) as {
      elements: unknown[];
    };
    expect(doors.elements).toHaveLength(1);
    const area = (await setup.harness.query('listCanvasElements', {
      elementTypes: ['wall'],
      bounds: { x: 650, y: 0, width: 100, height: 100 },
    })) as { elements: Array<{ id: string }> };
    expect(area.elements.map(e => e.id)).toEqual(['win']);
    const page = (await setup.harness.query('listCanvasElements', {
      limit: 2,
      offset: 1,
    })) as Record<string, unknown>;
    expect(page['nextOffset']).toBe(3);
  });
});

describe('creating', () => {
  it('creates walls from words, reads back, marks and records them', async () => {
    setup = openCanvas();
    const answer = (await setup.harness.query('createCanvasElements', {
      elementType: 'wall',
      elements: [{ c: [0, 0, 100, 0], door: 'door', doorState: 'locked', sight: 'limited' }],
    })) as { created: Array<Record<string, unknown>>; warnings: string[] };
    expect(answer.created[0]).toMatchObject({
      door: 'door',
      doorState: 'locked',
      sight: 'limited',
    });
    expect(answer.warnings).toEqual([]);
    const id = String(answer.created[0]?.['id']);
    const stored = walls().get(id)!;
    expect(stored['ds']).toBe(2);
    expect((stored['flags'] as Record<string, Record<string, unknown>>)[MODULE_ID]).toMatchObject({
      createdByMcp: true,
    });
    const change = setup.harness.changeLog.list()[0]!;
    expect(change).toMatchObject({
      document: 'Scenes',
      action: 'create',
      tool: 'create-canvas-elements',
      undoable: true,
    });
    expect(change.targets[0]).toMatchObject({ id, documentName: 'Wall' });
  });

  it('creates a region with its behaviors', async () => {
    setup = openCanvas();
    const answer = (await setup.harness.query('createCanvasElements', {
      elementType: 'region',
      elements: [
        {
          name: 'Pit',
          shapes: [{ type: 'rectangle', x: 0, y: 0, width: 100, height: 100 }],
          behaviors: [{ type: 'teleportToken', name: 'Down' }],
        },
      ],
    })) as { created: Array<Record<string, unknown>> };
    expect(answer.created[0]).toMatchObject({
      name: 'Pit',
      shapes: ['rectangle'],
      behaviors: [{ type: 'teleportToken', name: 'Down' }],
    });
  });

  it('checks every entry before the first write', async () => {
    setup = openCanvas();
    const bad = await failure(
      setup.harness.query('createCanvasElements', {
        elementType: 'wall',
        elements: [{ c: [0, 0, 0, 0] }, { c: [0, 0, 1, 1] }, { c: [0, 0, 1, 1], door: 'gate' }],
      })
    );
    expect(bad.code).toBe('INVALID_ARGUMENT');
    expect(bad.message).toContain('elements[0]: c describes a wall of length 0');
    expect(bad.message).toContain('elements[2]: door "gate"');
    expect(setup.foundry.operations).toHaveLength(0);
    const tooMany = await failure(
      setup.harness.query('createCanvasElements', {
        elementType: 'light',
        elements: Array.from({ length: 201 }, () => ({ x: 1, y: 1 })),
      })
    );
    expect(tooMany.message).toContain('at most 200');
  });

  it('names what was created before Foundry failed', async () => {
    setup = openCanvas();
    let count = 0;
    setup.foundry.onWrite(operation => {
      if (operation.documentName === 'AmbientLight' && ++count === 2) throw new Error('disk full');
    });
    const failed = await failure(
      setup.harness.query('createCanvasElements', {
        elementType: 'light',
        elements: [
          { x: 1, y: 1 },
          { x: 2, y: 2 },
        ],
      })
    );
    expect(failed.code).toBe('CREATE_FAILED');
    expect(failed.message).toMatch(/disk full\. 1 of 2 were created before the failure: \w+\./);
  });

  it('refuses with the switch off, and a dry run tells so', async () => {
    setup = openCanvas({ settings: { [`${MODULE_ID}.allowWriteOperations`]: false } });
    const refused = await failure(
      setup.harness.query('createCanvasElements', {
        elementType: 'light',
        elements: [{ x: 1, y: 1 }],
      })
    );
    expect(refused.code).toBe('WRITE_DISABLED');
    const dry = (await setup.harness.query('createCanvasElements', {
      elementType: 'light',
      elements: [{ x: 1, y: 1 }],
      dryRun: true,
    })) as Record<string, unknown>;
    expect(dry).toMatchObject({ dryRun: true, wouldCreate: 1 });
    expect(dry['refusal']).toContain('Allow Write Operations');
    expect(lights().size).toBe(1);
  });
});

describe('changing', () => {
  it('writes only what differs and keeps the state before', async () => {
    setup = openCanvas();
    const answer = (await setup.harness.query('updateCanvasElements', {
      elementType: 'light',
      updates: [{ id: 'l1', changes: { 'config.dim': 40, hidden: false } }],
    })) as Record<string, unknown>;
    expect(answer['changed']).toEqual([expect.objectContaining({ id: 'l1', 'config.dim': 40 })]);
    expect((lights().get('l1')!['config'] as Record<string, unknown>)['dim']).toBe(40);
    const change = setup.harness.changeLog.list()[0]!;
    expect(change).toMatchObject({ action: 'update', undoable: true });
    expect(change.before).toEqual([expect.objectContaining({ config: { dim: 30, bright: 15 } })]);

    const again = (await setup.harness.query('updateCanvasElements', {
      elementType: 'light',
      updates: [{ id: 'l1', changes: { hidden: false } }],
    })) as Record<string, unknown>;
    expect(again).toMatchObject({ changed: [], unchanged: ['l1'] });
  });

  it('stops on an id of another type and says what it is', async () => {
    setup = openCanvas();
    const missing = await failure(
      setup.harness.query('updateCanvasElements', {
        elementType: 'light',
        updates: [{ id: 'w1', changes: { hidden: true } }],
      })
    );
    expect(missing.code).toBe('NOT_FOUND');
    expect(missing.message).toContain('w1 is a wall');
    expect(setup.foundry.operations).toHaveLength(0);
  });

  it('fails when Foundry keeps the old value', async () => {
    setup = openCanvas();
    setup.foundry.hooks.on('updateAmbientLight', light => {
      ((light as Record<string, unknown>)['config'] as Record<string, unknown>)['dim'] = 30;
    });
    const failed = await failure(
      setup.harness.query('updateCanvasElements', {
        elementType: 'light',
        updates: [{ id: 'l1', changes: { 'config.dim': 50 } }],
      })
    );
    expect(failed.code).toBe('NOT_APPLIED');
    expect(failed.message).toContain('config.dim is 30 instead of 50');
  });

  it('opens and locks doors, and refuses walls that are none', async () => {
    setup = openCanvas();
    const opened = (await setup.harness.query('setDoorState', {
      wallIds: ['d1'],
      state: 'open',
    })) as Record<string, unknown>;
    expect(opened['changed']).toEqual(['d1']);
    expect(walls().get('d1')!['ds']).toBe(1);
    expect(
      await setup.harness.query('setDoorState', { wallIds: ['d1'], state: 'open' })
    ).toMatchObject({
      changed: [],
      unchanged: ['d1'],
    });
    const notDoor = await failure(
      setup.harness.query('setDoorState', { wallIds: ['d1', 'w1'], state: 'locked' })
    );
    expect(notDoor).toMatchObject({ code: 'NOT_A_DOOR' });
    expect(walls().get('d1')!['ds']).toBe(1);
  });
});

describe('deleting', () => {
  it('is refused by default, with a dry run that says so', async () => {
    setup = openCanvas();
    const refused = await failure(
      setup.harness.query('deleteCanvasElements', { elementType: 'light', ids: ['l1'] })
    );
    expect(refused.code).toBe('PERMISSION_DENIED');
    expect(refused.message).toContain('Deleting scenes is not permitted');
    const dry = (await setup.harness.query('deleteCanvasElements', {
      elementType: 'light',
      ids: ['l1'],
      dryRun: true,
    })) as Record<string, unknown>;
    expect(dry['wouldDelete']).toEqual([expect.objectContaining({ id: 'l1' })]);
    expect(dry['refusal']).toContain('Deleting scenes is not permitted');
    expect(lights().size).toBe(1);
  });

  it('deletes with the full level and keeps the state for undo', async () => {
    setup = openCanvas({ settings: { [`${MODULE_ID}.permScenes`]: 'full' } });
    expect(
      await setup.harness.query('deleteCanvasElements', { elementType: 'tile', ids: ['t1'] })
    ).toMatchObject({
      deleted: ['t1'],
    });
    expect(setup.scene.getEmbeddedCollection('Tile').size).toBe(0);
    expect(setup.harness.changeLog.list()[0]).toMatchObject({ action: 'delete', undoable: true });
  });
});

/**
 * Seen in a real world: Foundry 14 without a drawn canvas throws from
 * _onDeleteOperation after its server deleted the documents. The fake throws from the
 * hook, which runs after the document left its collection.
 */
const CLIPBOARD = "Cannot read properties of null (reading 'clipboard')";
/** The fake writes one document after the other; `onCall` 2 throws after the second, as Foundry does after the batch. */
function clientThrows(name: string, onCall = 1): void {
  let calls = 0;
  setup!.foundry.hooks.on(name, () => {
    if (++calls === onCall) throw new TypeError(CLIPBOARD);
  });
}

describe('when Foundry throws after the server wrote (no canvas)', () => {
  it('counts deleted lights as deleted, logs them and undo recreates them with their id', async () => {
    setup = openCanvas({ board: false, settings: { [`${MODULE_ID}.permScenes`]: 'full' } });
    clientThrows('deleteAmbientLight');
    const answer = (await setup.harness.query('deleteCanvasElements', {
      elementType: 'light',
      ids: ['l1'],
    })) as { deleted: string[]; warnings: string[] };
    expect(answer.deleted).toEqual(['l1']);
    expect(answer.warnings[0]).toContain(`TypeError: ${CLIPBOARD}`);
    expect(answer.warnings[0]).toContain('draws no canvas');
    expect(lights().size).toBe(0);
    const change = setup.harness.changeLog.list()[0]!;
    expect(change).toMatchObject({ action: 'delete', undoable: true });
    expect(change.targets[0]).toMatchObject({ id: 'l1', uuid: 'Scene.keep.AmbientLight.l1' });

    clientThrows('createAmbientLight');
    const undone = (await setup.harness.query('undoChanges', { changeId: change.id })) as {
      undone: Array<{ targets: Array<Record<string, unknown>> }>;
    };
    expect(lights().get('l1')).toMatchObject({ x: 200, y: 200 });
    expect(undone.undone[0]?.targets[0]?.['note']).toContain(CLIPBOARD);
  });

  it('fails for what is still there and still logs what is gone', async () => {
    setup = openCanvas({ board: false, settings: { [`${MODULE_ID}.permScenes`]: 'full' } });
    clientThrows('deleteWall');
    const failed = await failure(
      setup.harness.query('deleteCanvasElements', { elementType: 'wall', ids: ['w1', 'd1'] })
    );
    expect(failed.code).toBe('DELETE_FAILED');
    expect(failed.message).toContain('still on the scene when read back: d1');
    expect(failed.message).toMatch(/Deleted all the same: w1, recorded as change \S+; undo-change/);
    const change = setup.harness.changeLog.list()[0]!;
    expect(change.targets.map(t => t.id)).toEqual(['w1']);
    expect(change.before).toEqual([expect.objectContaining({ _id: 'w1' })]);
  });

  it('reads back created and changed elements instead of trusting the throw', async () => {
    setup = openCanvas({ board: false });
    clientThrows('createAmbientLight', 2);
    const created = (await setup.harness.query('createCanvasElements', {
      elementType: 'light',
      elements: [
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ],
    })) as { created: unknown[]; warnings: string[] };
    expect(created.created).toHaveLength(2);
    expect(created.warnings[0]).toContain('all 2 lights are on the scene');
    expect(setup.harness.changeLog.list()[0]).toMatchObject({ action: 'create' });

    clientThrows('updateAmbientLight');
    const changed = (await setup.harness.query('updateCanvasElements', {
      elementType: 'light',
      updates: [{ id: 'l1', changes: { hidden: true } }],
    })) as { changed: unknown[]; warnings: string[] };
    expect(changed.changed).toHaveLength(1);
    expect(changed.warnings[0]).toContain(CLIPBOARD);
    expect(setup.harness.changeLog.list()[0]).toMatchObject({ action: 'update', undoable: true });
  });
});
