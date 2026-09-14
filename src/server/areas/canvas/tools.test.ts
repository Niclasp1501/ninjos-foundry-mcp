/**
 * The tools of the canvas area from the registry to the module handlers and back.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { MODULE_AREAS } from '../../../module/areas/index.js';
import { openCanvas, type CanvasSetup } from '../../../module/areas/canvas/testing.js';
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import { canvasArea } from './index.js';

let setup: CanvasSetup | null = null;
let plain: AreaHarness | null = null;
afterEach(() => {
  setup?.harness.close();
  plain?.close();
  setup = null;
  plain = null;
});

const text = (result: { content: Array<{ type: string; text?: string }> }) =>
  result.content[0]?.text ?? '';

describe('registration', () => {
  it('offers thirteen tools in the group canvas with annotations', async () => {
    setup = openCanvas();
    const own = new Set((canvasArea.tools ?? []).map(tool => tool.name));
    expect(own.size).toBe(13);
    expect((canvasArea.tools ?? []).every(tool => tool.group === 'canvas')).toBe(true);
    expect([...own].every(name => /^[a-z]+(-[a-z]+)+$/.test(name))).toBe(true);
    const listed = (await setup.harness.tools.list()).filter(tool => own.has(tool.name));
    expect(listed).toHaveLength(13);
    const byName = new Map(listed.map(tool => [tool.name, tool.annotations]));
    for (const name of [
      'list-canvas-elements',
      'get-canvas-view',
      'measure-distance',
      'check-wall-collision',
      'find-path',
      'find-tokens-in-range',
    ])
      expect(byName.get(name)).toMatchObject({ readOnlyHint: true });
    expect(byName.get('delete-canvas-elements')).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
    expect(byName.get('ping-canvas')).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    });
  });
});

describe('tool texts', () => {
  it('creates, lists and names a refused delete', async () => {
    setup = openCanvas();
    const created = text(
      await setup.harness.call('create-canvas-elements', {
        elementType: 'wall',
        elements: [{ c: [0, 900, 200, 900], door: 'door' }],
      })
    );
    expect(created).toMatch(
      /^Created 1 wall\(s\) on the scene "Keep" \[keep\] \(the active scene\), read back:\n- wall \w+: c \[0,900,200,900\], door "door", doorState "closed"/
    );
    const listed = text(await setup.harness.call('list-canvas-elements', { doorsOnly: true }));
    expect(listed).toContain('walls 4, lights 1, sounds 0, regions 1, tiles 1, drawings 0');
    expect(listed).toContain('2 match; showing 1 to 2:');
    const refused = await setup.harness.call('delete-canvas-elements', {
      elementType: 'wall',
      ids: ['w1'],
    });
    expect(refused.isError).toBe(true);
    expect(text(refused)).toContain(
      'Failed to delete canvas elements: Deleting scenes is not permitted'
    );
    const invalid = await setup.harness.call('create-canvas-elements', {
      elementType: 'door',
      elements: [{}],
    });
    expect(text(invalid)).toContain('Invalid arguments for create-canvas-elements');
  });

  it('describes the view, a path and the range', async () => {
    setup = openCanvas({ board: false });
    expect(text(await setup.harness.call('get-canvas-view', {}))).toContain(
      "There is no drawn canvas in the Gamemaster's browser. pan-camera, ping-canvas, set-targets will fail"
    );
    expect(
      text(
        await setup.harness.call('measure-distance', {
          from: { tokenId: 'Hero' },
          to: { tokenId: 'Goblin' },
        })
      )
    ).toMatch(/^20 ft \(4 grid spaces\) from x 150, y 150 \("Hero" \[hero\]\) to x 550, y 150/);
    expect(
      text(
        await setup.harness.call('check-wall-collision', {
          from: { tokenId: 'Hero' },
          to: { tokenId: 'Goblin' },
        })
      )
    ).toContain(': blocked (decided by stored walls).\nWalls on the line, nearest first:\n- w1:');
    expect(
      text(
        await setup.harness.call('find-path', {
          from: { tokenId: 'Hero' },
          to: { tokenId: 'Goblin' },
        })
      )
    ).toContain('by grid search');
    expect(
      text(
        await setup.harness.call('find-tokens-in-range', {
          from: { tokenId: 'Hero' },
          distance: 20,
          requireLineOfSight: true,
        })
      )
    ).toContain('Behind walls for sight: "Goblin" [gob].');
  });

  it('says the module is too old when it lacks the query', async () => {
    plain = createAreaHarness({ moduleAreas: MODULE_AREAS.filter(area => area.id !== 'canvas') });
    const result = await plain.call('get-canvas-view', {});
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('does not know the query "getCanvasView"');
  });
});
